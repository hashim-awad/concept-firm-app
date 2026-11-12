-- Fixes from Hashim's step 5 test (Nov 13, 2026): a couple's two client records are linked as spouses,
-- and staff can read the three new engagement columns. Engagements use column grants (20261109000000), so
-- columns added in 20261113000000 were unreadable and every engagement list came back empty.
grant select (came_from, quote_id, client2_id) on public.engagements to authenticated;

create or replace function private.on_quote_signed(p_quote uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  q public.quotes;
  l public.leads;
  s0 public.quote_signers;
  s1 public.quote_signers;
  v_client uuid; v_client2 uuid; v_eng uuid;
  v_today date := (now() at time zone 'America/Toronto')::date;
  v_from text; v_opt jsonb; v_f jsonb; v_row jsonb; v_ye date; v_books boolean;
begin
  select * into q from public.quotes where id = p_quote;
  if q.id is null or q.status <> 'signed' then return; end if;
  if exists (select 1 from public.engagements where quote_id = q.id) then return; end if;
  select * into l from public.leads where id = q.lead_id;
  select * into s0 from public.quote_signers where quote_id = q.id and person = 0;
  select * into s1 from public.quote_signers where quote_id = q.id and person = 1;
  v_from := case when l.source ilike 'phone%' then 'Quote (phone)' else 'Quote (website)' end;

  if q.kind = 't1' then
    v_client := coalesce(l.client_id, private.client_for_signing(q.id, 'individual', s0.first_name || ' ' || s0.last_name, s0.email, l.province, jsonb_build_object('salutation', s0.first_name)));
    if s1.quote_id is not null then
      v_client2 := private.client_for_signing(q.id, 'individual', s1.first_name || ' ' || s1.last_name, s1.email, l.province, jsonb_build_object('salutation', s1.first_name));
      -- The two people of a couple are linked as spouses on their client records.
      if v_client2 <> v_client and not exists (select 1 from public.client_links where (client_id = v_client and linked_id = v_client2) or (client_id = v_client2 and linked_id = v_client)) then
        insert into public.client_links (client_id, linked_id, relationship) values (v_client, v_client2, 'spouse');
      end if;
    end if;
    insert into public.engagements (client_id, client2_id, title, type, fiscal_year_end, el_version, status, el_issued, el_signed, t1_individual, t1_tax_year, t1_fee, came_from, quote_id, notes)
    values (v_client, v_client2,
            s0.first_name || ' ' || s0.last_name || coalesce(' and ' || s1.first_name || ' ' || s1.last_name, '') || ' T1 ' || q.tax_year,
            'T1 personal', make_date(q.tax_year, 12, 31), coalesce(q.wording_label, ''), 'EL signed', (q.sent_at at time zone 'America/Toronto')::date, v_today,
            s0.first_name || ' ' || s0.last_name || coalesce(' and ' || s1.first_name || ' ' || s1.last_name, ''), q.tax_year, q.total_cents / 100.0, v_from, q.id,
            case when s1.quote_id is not null then 'One household fee for both returns.' else '' end)
    returning id into v_eng;

  elsif q.kind = 'corporate' then
    v_client := coalesce(l.client_id, private.client_for_signing(q.id, 'corporation', q.company_name, s0.email, l.province,
      jsonb_build_object('signing_officer', s0.first_name || ' ' || s0.last_name, 'signer_title', coalesce(s0.signed_title, ''), 'salutation', s0.first_name,
                         'year_end_md', to_char(q.year_end, 'MM-DD'))));
    insert into public.engagements (client_id, title, type, fiscal_year_end, el_version, status, el_issued, el_signed, fee, came_from, quote_id)
    values (v_client, q.company_name || ' FYE ' || q.year_end, 'Year-end compilation + T2', q.year_end, coalesce(q.wording_label, ''), 'EL signed',
            (q.sent_at at time zone 'America/Toronto')::date, v_today, q.total_cents / 100.0, v_from, q.id)
    returning id into v_eng;

  elsif q.kind = 'proposal' then
    v_f := q.proposal -> 'f';
    v_opt := q.proposal -> 'opts' -> q.chosen_option;
    v_ye := case when coalesce(v_f ->> 'L_ye', '') ~ '^\d{4}-\d{2}-\d{2}$' then (v_f ->> 'L_ye')::date end;
    v_books := coalesce((v_opt -> 'svc' ->> 'books')::boolean, false);
    v_client := coalesce(q.client_id, private.client_for_signing(q.id, 'corporation', coalesce(nullif(btrim(q.company_name), ''), v_f ->> 'L_company', v_f ->> 'name'), s0.email, v_f ->> 'province',
      jsonb_build_object('signing_officer', s0.first_name || ' ' || s0.last_name, 'signer_title', coalesce(s0.signed_title, ''), 'salutation', coalesce(nullif(v_f ->> 'L_salutation', ''), v_f ->> 'salutation', ''),
                         'street_address', v_f ->> 'L_addr1', 'address_line2', v_f ->> 'L_addr2', 'city', v_f ->> 'L_city', 'postal_code', upper(coalesce(v_f ->> 'L_postal', '')),
                         'year_end_md', coalesce(to_char(v_ye, 'MM-DD'), ''))));
    insert into public.engagements (client_id, title, type, fiscal_year_end, el_version, status, el_issued, el_signed, fee, monthly_fee, monthly_billing_starts, came_from, quote_id, notes)
    values (v_client, coalesce(nullif(btrim(q.company_name), ''), v_f ->> 'L_company', v_f ->> 'name') || ' FYE ' || coalesce(v_ye::text, ''),
            case when v_books then 'Monthly full service' else 'Year-end compilation + T2' end, v_ye, coalesce(q.wording_label, ''), 'EL signed',
            (q.sent_at at time zone 'America/Toronto')::date, v_today,
            nullif((select sum(private.amount(x ->> 'amt')) from jsonb_array_elements(v_opt -> 'lines') x where x ->> 'kind' in ('year', 'once')), 0),
            nullif((select sum(private.amount(x ->> 'amt')) from jsonb_array_elements(v_opt -> 'lines') x where x ->> 'kind' = 'month' and (x ->> 'svc') !~* 'software'), 0),
            case when coalesce(v_f ->> 'L_startMonth', '') ~ '^\d{4}-\d{2}$' then ((v_f ->> 'L_startMonth') || '-01')::date end,
            'Proposal (' || coalesce(v_opt ->> 'name', 'option') || ')', q.id,
            'Option signed: ' || coalesce(v_opt ->> 'name', '') || '. Software is a separate monthly line.')
    returning id into v_eng;

  elsif q.kind = 'letter' then
    -- The engagement the Letter Builder prepared at Final (details.engagement), written now.
    v_client := q.client_id;
    v_row := q.details -> 'engagement';
    -- A letter issued before this change already has its engagement (EL sent): mark it signed.
    if v_row is null and q.details ->> 'engagement_id' ~ '^[0-9a-f-]{36}$' then
      update public.engagements set status = 'EL signed', el_signed = v_today, came_from = 'New letter', quote_id = q.id
      where id = (q.details ->> 'engagement_id')::uuid and el_signed is null;
      return;
    end if;
    if v_row is null or v_client is null then return; end if;
    select id into v_eng from public.engagements
     where client_id = v_client and fiscal_year_end = (v_row ->> 'fiscal_year_end')::date and el_signed is null
       and ((v_row ->> 'type') = 'T1 personal') = (type = 'T1 personal') limit 1;
    if v_eng is null then
      insert into public.engagements (client_id, title, type, fiscal_year_end, status, el_signed, came_from, quote_id)
      values (v_client, v_row ->> 'title', v_row ->> 'type', (v_row ->> 'fiscal_year_end')::date, 'EL signed', v_today, 'New letter', q.id)
      returning id into v_eng;
    else
      update public.engagements set status = 'EL signed', el_signed = v_today, came_from = 'New letter', quote_id = q.id where id = v_eng;
    end if;
    update public.engagements set
      el_version = coalesce(v_row ->> 'el_version', el_version), el_issued = coalesce((v_row ->> 'el_issued')::date, el_issued),
      period_start = coalesce((v_row ->> 'period_start')::date, period_start), fee = coalesce((v_row ->> 'fee')::numeric, fee),
      monthly_fee = coalesce((v_row ->> 'monthly_fee')::numeric, monthly_fee), monthly_billing_starts = coalesce((v_row ->> 'monthly_billing_starts')::date, monthly_billing_starts),
      payment_method = coalesce(v_row ->> 'payment_method', payment_method), letter_data = coalesce(v_row -> 'letter_data', letter_data),
      registration_confirmed = coalesce((v_row ->> 'registration_confirmed')::boolean, registration_confirmed),
      t1_individual = coalesce(v_row ->> 't1_individual', t1_individual), t1_tax_year = coalesce((v_row ->> 't1_tax_year')::int, t1_tax_year),
      cra_authorization = coalesce(v_row ->> 'cra_authorization', cra_authorization), notes = btrim(coalesce(notes, '') || ' ' || coalesce(v_row ->> 'notes', ''))
    where id = v_eng;
  end if;

  update public.quotes set client_id = v_client where id = q.id and client_id is null;
  update public.leads set client_id = v_client where id = q.lead_id and client_id is null;
end;
$$;
revoke all on function private.on_quote_signed(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
