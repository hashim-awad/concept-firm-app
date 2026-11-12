-- Front office batch, step 5 (sections 8 and 9): a signed quote, proposal or New letter adds the
-- client (when new) as "Waiting for TaxDome" and creates the engagement, with where it came from.
-- Couples: one engagement for the household, linked to both client records (Hashim, Nov 11, 2026).

-- Clients: a third status, "Waiting for TaxDome", for records added by a signing.
alter table public.clients drop constraint clients_status_check;
alter table public.clients add constraint clients_status_check check (status in ('active', 'inactive', 'waiting_taxdome'));
alter table public.clients add column created_from_quote uuid references public.quotes (id);

-- Engagements: where it came from, the quote or letter signed, the second person of a couple, and the
-- statuses owners set by hand (on hold, client left, ended).
alter table public.engagements add column came_from text not null default '';
alter table public.engagements add column quote_id uuid unique references public.quotes (id);
alter table public.engagements add column client2_id uuid references public.clients (id);
alter table public.engagements drop constraint engagements_status_check;
alter table public.engagements add constraint engagements_status_check check (status in
  ('EL drafted', 'EL sent', 'EL signed', 'Draft package sent', 'MAL signed', 'Issued', 'Cancelled', 'On hold', 'Client left', 'Ended'));
create index engagements_client2_idx on public.engagements (client2_id);

-- A dollar amount from a fee line ("$1,150", "1150.00"); null for "Included" or blank.
create or replace function private.amount(p text)
returns numeric language sql immutable set search_path = '' as $$
  select case when btrim(coalesce(p, '')) ~ '^\$?[0-9][0-9,]*(\.[0-9]+)?$' then replace(replace(btrim(p), '$', ''), ',', '')::numeric end
$$;

-- Find or add the client a signing belongs to. An existing record wins (by id, then by the same name and
-- email for a person, or the same legal name for a company). A new one waits for the TaxDome import.
create or replace function private.client_for_signing(p_quote uuid, p_kind text, p_name text, p_email text, p_province text, p_extra jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_kind = 'individual' then
    select id into v_id from public.clients where kind = 'individual' and lower(btrim(legal_name)) = lower(btrim(p_name)) and lower(btrim(email)) = lower(btrim(coalesce(p_email, ''))) order by created_at limit 1;
  else
    select id into v_id from public.clients where kind = 'corporation' and lower(btrim(legal_name)) = lower(btrim(p_name)) order by created_at limit 1;
  end if;
  if v_id is not null then return v_id; end if;
  insert into public.clients (kind, legal_name, entity_type, email, province, status, created_from_quote, source,
                              signing_officer, signer_title, salutation, street_address, address_line2, city, postal_code, year_end_md)
  values (p_kind, left(btrim(p_name), 200), case when p_kind = 'individual' then 'Individual' else 'Other' end, lower(btrim(coalesce(p_email, ''))),
          case when p_province in ('ON', 'AB', 'BC') then p_province else 'OTHER' end, 'waiting_taxdome', p_quote, jsonb_build_object('from', 'Signed in Studio'),
          coalesce(p_extra ->> 'signing_officer', ''), coalesce(p_extra ->> 'signer_title', ''), coalesce(p_extra ->> 'salutation', ''),
          coalesce(p_extra ->> 'street_address', ''), coalesce(p_extra ->> 'address_line2', ''), coalesce(p_extra ->> 'city', ''),
          coalesce(p_extra ->> 'postal_code', ''), coalesce(p_extra ->> 'year_end_md', ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Everything that follows a signing: the client(s) and the engagement. Runs once, when all have signed.
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
revoke all on function private.client_for_signing(uuid, text, text, text, text, jsonb), private.on_quote_signed(uuid), private.amount(text) from public, anon, authenticated;

-- Signing: the same rules as before; when all have signed, the client and engagement follow.
create or replace function public.record_t1_signature(p_quote uuid, p_person int, p_name text, p_ip text, p_agent text, p_hash text, p_same_device boolean,
  p_title text default null, p_option int default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_all boolean;
  v_company boolean;
begin
  select * into v_q from public.quotes where id = p_quote for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status in ('sent', 'viewed'), 'This quote cannot be signed.');
  perform private.require(v_q.valid_until >= (now() at time zone 'America/Toronto')::date, 'This quote has expired.');
  perform private.require(length(btrim(coalesce(p_name, ''))) between 2 and 120, 'Type your full name to sign.');
  perform private.require(coalesce(p_hash, '') ~ '^[0-9a-f]{64}$', 'The document could not be checked.');
  v_company := v_q.kind in ('corporate', 'proposal') or (v_q.kind = 'letter' and v_q.details ->> 'doc_kind' = 'corporate_letter');
  perform private.require(not v_company or length(btrim(coalesce(p_title, ''))) between 2 and 80, 'Type your title at the company to sign.');
  if v_q.kind = 'proposal' then
    perform private.require(p_option is not null and p_option >= 0 and p_option < jsonb_array_length(v_q.proposal -> 'opts'), 'Choose an option to sign.');
  end if;
  update public.quote_signers
     set signed_at = now(), signed_name = btrim(p_name), signed_ip = left(coalesce(p_ip, ''), 100),
         signed_agent = left(coalesce(p_agent, ''), 400), document_hash = p_hash, same_device = coalesce(p_same_device, false),
         signed_title = case when v_company then btrim(p_title) end
   where quote_id = p_quote and person = p_person and signed_at is null;
  perform private.require(found, 'Already signed.');
  if v_q.kind = 'proposal' then update public.quotes set chosen_option = p_option where id = p_quote; end if;
  v_all := not exists (select 1 from public.quote_signers where quote_id = p_quote and signed_at is null);
  if v_all then
    update public.quotes set status = 'signed', signed_at = now() where id = p_quote;
    update public.leads set status = 'signed', closed_at = coalesce(closed_at, now()) where id = v_q.lead_id;
    perform private.on_quote_signed(p_quote);
  end if;
  return v_all;
end;
$$;
revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) to service_role;

-- The TaxDome import makes a waiting client Active when it matches it.
create or replace function private.taxdome_activates()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'waiting_taxdome' and new.taxdome_account_id is not null and old.taxdome_account_id is distinct from new.taxdome_account_id then
    new.status := 'active';
  end if;
  return new;
end;
$$;
create trigger clients_taxdome_activates before update of taxdome_account_id on public.clients for each row execute function private.taxdome_activates();

-- People are not in the TaxDome import (it reads T2 companies): an owner marks them matched by hand.
create or replace function public.mark_client_in_taxdome(p_client uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can mark a client as matched in TaxDome.');
  update public.clients set status = 'active' where id = p_client and status = 'waiting_taxdome';
  perform private.require(found, 'This client is not waiting for TaxDome.');
end;
$$;
revoke all on function public.mark_client_in_taxdome(uuid) from public, anon;
grant execute on function public.mark_client_in_taxdome(uuid) to authenticated;
