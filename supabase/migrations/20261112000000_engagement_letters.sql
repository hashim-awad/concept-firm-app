-- Front office batch, step 4 (section 7): Engagement letters is the archive of every letter, whatever
-- the path. A signed quote or proposal is its client's letter. A New letter (owners, the Letter
-- Builder) marked Final is sent for online signing with the same signing engine, as a quote record of
-- kind "letter"; it waits for signature and moves to Signed when signed.

alter table public.quotes drop constraint quotes_kind_check;
alter table public.quotes add constraint quotes_kind_check check (kind in ('t1', 'corporate', 'proposal', 'letter'));
alter table public.quotes drop constraint quotes_quote_fields;
alter table public.quotes add constraint quotes_quote_fields check (kind in ('proposal', 'letter') or (lead_id is not null and tax_year is not null and total_cents is not null));

-- A Final letter from the Letter Builder, sent for signing. p_details: {doc_kind, inputs, document_id,
-- version, engagement_id, label}. p_signers: [{first_name, last_name, email}], one or two.
create or replace function public.create_letter_quote(p_client uuid, p_title text, p_company text, p_details jsonb, p_signers jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_staff public.staff;
  v_ver uuid := (select id from public.wording_versions where is_current);
  v_n int := jsonb_array_length(coalesce(p_signers, '[]'::jsonb));
  v_s jsonb;
  v_i int := 0;
begin
  perform private.require(private.is_owner(), 'Only an owner can issue a Final letter.');
  perform private.require(p_details ->> 'doc_kind' in ('corporate_letter', 't1_letter'), 'Unknown letter.');
  perform private.require(v_n between 1 and 2, 'A letter has one or two signers.');
  for v_s in select * from jsonb_array_elements(p_signers) loop
    perform private.require(length(btrim(coalesce(v_s ->> 'first_name', ''))) between 1 and 80 and length(btrim(coalesce(v_s ->> 'last_name', ''))) between 1 and 80, 'Each signer needs a first and last name.');
    perform private.require(coalesce(v_s ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Add the client''s email on the client record: the signing link goes there.');
  end loop;
  select * into v_staff from public.staff where id = (select auth.uid());
  insert into public.quotes (kind, status, title, client_id, company_name, details, sent_at, sent_by, valid_until, sender, signer, wording, wording_label, created_by)
  values ('letter', 'sent', left(btrim(coalesce(p_title, '')), 200), p_client, nullif(left(btrim(coalesce(p_company, '')), 200), ''), p_details,
          now(), v_staff.id, (now() at time zone 'America/Toronto')::date + 21,
          jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
          coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
          coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver), '{}'::jsonb),
          (select label from public.wording_versions where id = v_ver), v_staff.id)
  returning id into v_id;
  for v_s in select * from jsonb_array_elements(p_signers) loop
    insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
    values (v_id, v_i, btrim(v_s ->> 'first_name'), btrim(v_s ->> 'last_name'), lower(btrim(v_s ->> 'email')),
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
    v_i := v_i + 1;
  end loop;
  return v_id;
end;
$$;
revoke all on function public.create_letter_quote(uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_letter_quote(uuid, text, text, jsonb, jsonb) to authenticated;

-- Signing: a company letter needs the signer's title; a signed letter marks its engagement signed.
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
    if v_q.kind = 'letter' and v_q.details ->> 'engagement_id' ~ '^[0-9a-f-]{36}$' then
      update public.engagements set status = 'EL signed', el_signed = (now() at time zone 'America/Toronto')::date
      where id = (v_q.details ->> 'engagement_id')::uuid and status = 'EL sent';
    end if;
  end if;
  return v_all;
end;
$$;
revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) to service_role;

-- Staff with Documents read letters (the Letter Builder's people) as well as Pricing with Leads.
drop policy "Pricing viewers read quotes" on public.quotes;
create policy "Staff read quotes and letters" on public.quotes for select to authenticated
  using (((select private.can_view('pricing')) and ((select private.can_view('leads')) or (kind = 'proposal' and (select private.can_view('documents')))))
         or (kind = 'letter' and (select private.can_view('documents'))));
drop policy "Pricing viewers read signers" on public.quote_signers;
-- Signing links are private: Pricing with Leads (quotes), Pricing with Documents (proposals), and
-- Documents for New letters only.
create policy "Staff read signers" on public.quote_signers for select to authenticated
  using (((select private.can_view('pricing')) and (select private.can_view('leads')))
         or exists (select 1 from public.quotes q where q.id = quote_id and (select private.can_view('documents'))
                    and (q.kind = 'letter' or (q.kind = 'proposal' and (select private.can_view('pricing'))))));

-- The Quotes list and its badge are offers only; letters are under Engagement letters.
create or replace function public.quote_list()
returns table (id uuid, kind text, status text, client text, client_id uuid, lead_id uuid, source text, total_cents int,
               options int, sent_at timestamptz, valid_until date, signed_at timestamptz, document_id uuid)
language plpgsql stable security definer set search_path = '' as $$
declare v_price boolean := private.can_view('pricing');
begin
  perform private.require(private.can_view('leads'), 'You do not have access to quotes.');
  return query
  select q.id, q.kind, q.status,
         coalesce(nullif(btrim(q.company_name), ''), c.legal_name, nullif(btrim(q.title), ''),
                  (select string_agg(s.first_name || ' ' || s.last_name, ' and ' order by s.person) from public.quote_signers s where s.quote_id = q.id),
                  nullif(btrim(q.proposal #>> '{legacy,prospect}'), ''), 'Untitled'),
         q.client_id, q.lead_id,
         case when l.id is null then '' when l.source ilike 'phone%' then 'Phone' else 'Website' end,
         case when v_price then q.total_cents end,
         coalesce(jsonb_array_length(case when jsonb_typeof(q.proposal -> 'opts') = 'array' then q.proposal -> 'opts' end), 0),
         q.sent_at, q.valid_until, q.signed_at, q.document_id
  from public.quotes q
  left join public.leads l on l.id = q.lead_id
  left join public.clients c on c.id = q.client_id
  where q.kind <> 'letter'
  order by coalesce(q.sent_at, q.created_at) desc;
end;
$$;

-- The Engagement letters page (mockup 3): every letter sent or signed, whatever the path. No fees.
create or replace function public.letter_list()
returns table (id uuid, kind text, status text, client text, letter text, came_from text, sent_at timestamptz, signed_at timestamptz, lead_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('documents') or private.can_view('leads'), 'You do not have access to engagement letters.');
  return query
  select q.id, q.kind, q.status,
         coalesce(nullif(btrim(q.company_name), ''), c.legal_name, nullif(btrim(q.title), ''),
                  (select string_agg(s.first_name || ' ' || s.last_name, ' and ' order by s.person) from public.quote_signers s where s.quote_id = q.id), 'Untitled'),
         case q.kind
           when 't1' then 'Personal tax ' || q.tax_year
           when 'corporate' then 'Year-end ' || to_char(q.year_end, 'Mon FMDD, YYYY')
           when 'proposal' then coalesce('Monthly: ' || (q.proposal -> 'opts' -> q.chosen_option ->> 'name'), 'Monthly proposal')
           else coalesce(nullif(q.details ->> 'label', ''), 'Engagement letter') end,
         case q.kind
           when 'letter' then 'New letter'
           when 'proposal' then 'Proposal' || coalesce(' (' || (q.proposal -> 'opts' -> q.chosen_option ->> 'name') || ')', '')
           else 'Quote (' || case when l.source ilike 'phone%' then 'phone' else 'website' end || ')' end,
         q.sent_at, q.signed_at, q.lead_id
  from public.quotes q
  left join public.leads l on l.id = q.lead_id
  left join public.clients c on c.id = q.client_id
  where q.status <> 'draft' and (q.kind <> 'proposal' or jsonb_typeof(q.proposal -> 'opts') = 'array')
  order by coalesce(q.signed_at, q.sent_at) desc;
end;
$$;
revoke all on function public.letter_list() from public, anon;
grant execute on function public.letter_list() to authenticated;

-- The Engagement letters badge: letters waiting for a signature (quotes, proposals and new letters).
create or replace function public.letters_waiting_count()
returns int language sql stable security definer set search_path = '' as $$
  select case when private.can_view('documents') or private.can_view('leads') then
    (select count(*)::int from public.quotes where status in ('sent', 'viewed') and valid_until >= (now() at time zone 'America/Toronto')::date)
  else 0 end
$$;
revoke all on function public.letters_waiting_count() from public, anon;
grant execute on function public.letters_waiting_count() to authenticated;

-- Declined: a New letter can be marked declined by staff with Edit on Documents too.
create or replace function public.mark_quote_declined(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_q public.quotes;
begin
  select * into v_q from public.quotes where id = p_id for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(private.can_edit('leads') or (v_q.kind = 'letter' and private.can_edit('documents')), 'You need Edit on Leads to change a quote.');
  perform private.require(v_q.status in ('draft', 'sent', 'viewed'), 'Only an open quote can be marked declined.');
  update public.quotes set status = 'declined', declined_at = now() where id = p_id;
  update public.leads set status = 'lost', closed_at = coalesce(closed_at, now()) where id = v_q.lead_id and status not in ('signed', 'lost');
end;
$$;
