-- Corporate year-end quote: fixes from Hashim's review of the first signed quote (Nov 10, 2026).
-- 1. The company's signer types their title; it shows next to "I have authority to bind the Company."
-- 2. The quote keeps the account counts from the form, so Part A lists the accounts the bookkeeping covers.
-- The wording changes are in the app (editable pieces) and recorded in docs/BRIEF.md.

alter table public.t1_quote_signers add column signed_title text;

create or replace function public.record_t1_signature(p_quote uuid, p_person int, p_name text, p_ip text, p_agent text, p_hash text, p_same_device boolean, p_title text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_q public.t1_quotes;
  v_all boolean;
begin
  select * into v_q from public.t1_quotes where id = p_quote for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status = 'sent', 'This quote cannot be signed.');
  perform private.require(v_q.valid_until >= (now() at time zone 'America/Toronto')::date, 'This quote has expired.');
  perform private.require(length(btrim(coalesce(p_name, ''))) between 2 and 120, 'Type your full name to sign.');
  perform private.require(coalesce(p_hash, '') ~ '^[0-9a-f]{64}$', 'The document could not be checked.');
  -- A company's signer gives their title, next to "I have authority to bind the Company."
  perform private.require(v_q.kind <> 'corporate' or length(btrim(coalesce(p_title, ''))) between 2 and 80, 'Type your title at the company to sign.');
  update public.t1_quote_signers
     set signed_at = now(), signed_name = btrim(p_name), signed_ip = left(coalesce(p_ip, ''), 100),
         signed_agent = left(coalesce(p_agent, ''), 400), document_hash = p_hash, same_device = coalesce(p_same_device, false),
         signed_title = case when v_q.kind = 'corporate' then btrim(p_title) end
   where quote_id = p_quote and person = p_person and signed_at is null;
  perform private.require(found, 'Already signed.');
  v_all := not exists (select 1 from public.t1_quote_signers where quote_id = p_quote and signed_at is null);
  if v_all then
    update public.t1_quotes set status = 'signed', signed_at = now() where id = p_quote;
    update public.leads set status = 'signed' where id = v_q.lead_id;
  end if;
  return v_all;
end;
$$;

revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text) to service_role;

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
      tax_year = extract(year from v_lead.year_end)::int,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('counts', v_lead.answers -> 'counts') where id = v_id and status = 'draft';
    return v_id;
  end if;
  insert into public.t1_quotes (lead_id, kind, tax_year, couple, lines, total_cents, company_name, year_end, details, created_by)
  values (p_lead, 'corporate', extract(year from v_lead.year_end)::int, false, v_q.lines, v_q.subtotal_cents, btrim(v_lead.company_name), v_lead.year_end,
          jsonb_build_object('books', v_lead.answers ->> 'books', 'extras', coalesce(v_lead.answers -> 'extras', '{}'::jsonb), 'province', v_lead.province,
            'counts', v_lead.answers -> 'counts'),
          (select auth.uid()))
  returning id into v_id;
  insert into public.t1_quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_lead.first_name, v_lead.last_name, v_lead.email, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  return v_id;
end;
$$;
revoke all on function public.create_corporate_quote(uuid) from public, anon;
grant execute on function public.create_corporate_quote(uuid) to authenticated;
