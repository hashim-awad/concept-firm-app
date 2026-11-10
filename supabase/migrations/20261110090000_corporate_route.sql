-- Phase 2 step 9: the corporate route (batch sections 10 and 11; Appendix C).

-- 1. Year-end price book items (section 11). Added only where missing. A code already used for a
--    different item stops the deploy with the clash named, so nothing is overwritten.
do $$
declare
  v_line uuid := (select id from public.service_lines where key = 't2');
  v_ye text := coalesce((select income_account from public.catalogue_items where code = 'YE-102'), '');
  v_gst text := coalesce((select income_account from public.catalogue_items where code = 'GST-101'), '');
  r record;
begin
  for r in select * from (values
    ('YE-110', 'Year-end, books kept by a bookkeeper or accountant', 'per year-end', 180000, 110, 'ye'),
    ('YE-111', 'Year-end, books kept by the owner in accounting software', 'per year-end', 240000, 111, 'ye'),
    ('YE-112', 'Year-end, bank and credit card statements only (includes 1 bank account and 1 credit card)', 'per year-end', 290000, 112, 'ye'),
    ('YE-120', 'Additional bank account, credit card or line of credit', 'per account', 25000, 120, 'ye'),
    ('YE-121', 'Bank loan, or car loan or lease', 'per loan or lease', 10000, 121, 'ye'),
    ('GST-110', 'Annual GST/HST return (corporate)', 'per return', 19900, 210, 'gst')
  ) as v(code, name, unit, cents, sort, acct) loop
    if exists (select 1 from public.catalogue_items where code = r.code) then
      if (select name from public.catalogue_items where code = r.code) <> r.name then
        raise exception 'Price book code % is already used for "%". Section 11 says to take the next free number: tell Claude which one to use.', r.code, (select name from public.catalogue_items where code = r.code);
      end if;
      continue;
    end if;
    insert into public.catalogue_items (service_line_id, code, name, description, unit_label, per_spouse, sort_order, category, income_account, price_type, studio_source)
    values (v_line, r.code, r.name, '', r.unit, false, r.sort, 'Corporate year-end', case r.acct when 'ye' then v_ye else v_gst end, 'Fixed', 'Phase 2 batch, section 11');
    insert into public.item_prices (item_id, amount_cents, effective_from, note)
    select id, r.cents, (now() at time zone 'America/Toronto')::date, 'Phase 2 batch, section 11' from public.catalogue_items where code = r.code;
  end loop;
end;
$$;

-- 2. Lead fields staff fill in for a company: the legal name (the form does not ask for it, and a
--    quote cannot be issued without it), the confirmed year-end, and the first-year checklist.
alter table public.leads
  add column company_name        text not null default '' check (length(company_name) <= 200),
  add column year_end            date,
  add column first_year_tag_done boolean not null default false,
  add column draft_token_hash    text;

-- What the client entered stays as sent, except that a company lead started on the first screen gets
-- the rest of its answers once, when the form is finished (through complete_company_lead only).
create or replace function private.lead_rules()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('lost', 'out_of_scope', 'signed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.closed_at := now(); end if;
  if new.status not in ('lost', 'out_of_scope', 'signed') then new.closed_at := null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to and (select auth.uid()) is not null and not private.is_owner() then
    raise exception 'Only an owner can reassign a lead.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and current_setting('app.lead_complete', true) is distinct from 'on'
     and (new.route, new.first_name, new.last_name, new.email, new.phone, new.province, new.answers, new.ip_hash, new.created_at)
     is distinct from (old.route, old.first_name, old.last_name, old.email, old.phone, old.province, old.answers, old.ip_hash, old.created_at) then
    raise exception 'What the client entered cannot be changed. Add a note instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Server only: give a started company lead its private key (stored as a SHA-256 hash).
create or replace function public.set_company_lead_key(p_lead uuid, p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(coalesce(p_token, '') ~ '^[0-9a-f]{64}$', 'Bad key.');
  update public.leads set draft_token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
  where id = p_lead and route = 'company' and draft_token_hash is null and answers ->> 'partial' = 'true';
  perform private.require(found, 'Lead not found.');
end;
$$;

-- Server only: finish a company lead with the rest of its answers, once, with its private key.
create or replace function public.complete_company_lead(p_lead uuid, p_token text, p_answers jsonb, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(p_status in ('new', 'call_needed'), 'Bad status.');
  perform private.require(jsonb_typeof(p_answers) = 'object' and p_answers ->> 'form' = 'corporate-v1', 'Bad answers.');
  perform set_config('app.lead_complete', 'on', true);
  update public.leads set answers = p_answers, status = p_status, draft_token_hash = null
  where id = p_lead and route = 'company' and draft_token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
    and answers ->> 'partial' = 'true';
  perform private.require(found, 'This form has already been sent, or the link expired. Please start again.');
  perform set_config('app.lead_complete', 'off', true);
end;
$$;
revoke all on function public.set_company_lead_key(uuid, text), public.complete_company_lead(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.set_company_lead_key(uuid, text), public.complete_company_lead(uuid, text, jsonb, text) to service_role;

-- 3. Corporate year-end quotes share the quote, signing and PDF records with T1 quotes.
alter table public.t1_quotes
  add column kind         text not null default 't1' check (kind in ('t1', 'corporate')),
  add column company_name text,
  add column year_end     date,
  add column details      jsonb;

create or replace function public.create_corporate_quote(p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_q public.lead_quotes;
  v_id uuid;
begin
  perform private.require(private.can_edit('pricing') and private.can_edit('leads'), 'You need Edit on Pricing and Leads to prepare a quote.');
  select * into v_lead from public.leads where id = p_lead;
  perform private.require(v_lead.id is not null and v_lead.route = 'company', 'Only company leads have a year-end quote.');
  perform private.require(btrim(v_lead.company_name) <> '', 'Enter the company''s legal name on the lead first. The form does not ask for it.');
  perform private.require(v_lead.year_end is not null, 'Confirm the company''s year-end on the lead first.');
  select * into v_q from public.lead_quotes where lead_id = p_lead;
  perform private.require(v_q.lead_id is not null, 'This lead has no quote from its answers (it needs a call).');
  select id into v_id from public.t1_quotes where lead_id = p_lead;
  if v_id is not null then
    update public.t1_quotes set company_name = btrim(v_lead.company_name), year_end = v_lead.year_end,
      tax_year = extract(year from v_lead.year_end)::int where id = v_id and status = 'draft';
    return v_id;
  end if;
  insert into public.t1_quotes (lead_id, kind, tax_year, couple, lines, total_cents, company_name, year_end, details, created_by)
  values (p_lead, 'corporate', extract(year from v_lead.year_end)::int, false, v_q.lines, v_q.subtotal_cents, btrim(v_lead.company_name), v_lead.year_end,
          jsonb_build_object('books', v_lead.answers ->> 'books', 'extras', coalesce(v_lead.answers -> 'extras', '{}'::jsonb), 'province', v_lead.province),
          (select auth.uid()))
  returning id into v_id;
  insert into public.t1_quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_lead.first_name, v_lead.last_name, v_lead.email, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  return v_id;
end;
$$;
revoke all on function public.create_corporate_quote(uuid) from public, anon;
grant execute on function public.create_corporate_quote(uuid) to authenticated;

-- A sent quote keeps the whole published wording (the corporate Part B is the master letter's wording).
create or replace function public.mark_t1_quote_sent(p_id uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v_q public.t1_quotes;
  v_staff public.staff;
  v_until date := (now() at time zone 'America/Toronto')::date + 21;
  v_ver uuid := (select id from public.wording_versions where is_current);
begin
  perform private.require(private.can_edit('pricing') and private.can_edit('leads'), 'You need Edit on Pricing and Leads to send a quote.');
  select * into v_q from public.t1_quotes where id = p_id;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status = 'draft', 'This quote is already marked sent.');
  if v_q.kind = 'corporate' then
    perform private.require(coalesce(btrim(v_q.company_name), '') <> '' and v_q.year_end is not null, 'Enter the company''s legal name and year-end first.');
  end if;
  select * into v_staff from public.staff where id = (select auth.uid());
  update public.t1_quotes set status = 'sent', sent_at = now(), sent_by = v_staff.id, valid_until = v_until,
    sender = jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
    signer = coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
    wording = coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver), '{}'::jsonb),
    wording_label = (select label from public.wording_versions where id = v_ver)
  where id = p_id;
  update public.leads set status = 'sent' where id = v_q.lead_id;
  return v_until;
end;
$$;

-- The server reads the new lead fields for the quote and the alerts.
grant update (status, source) on public.leads to service_role;
