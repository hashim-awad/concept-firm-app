-- Front office batch, step 1 (sections 3 and 5): one quote record for every offer.
-- Personal tax quotes, company year-end quotes and monthly proposals are one table, "quotes",
-- with the statuses Draft, Sent, Viewed, Signed, Declined and Expired. The T1 and corporate quote
-- table is renamed (its rows, links and signatures stay as they are); proposals recorded in the
-- old Proposals list are copied in as kind "proposal". Functions keep their names; their bodies
-- are re-created because they named the old table.

alter table public.t1_quotes rename to quotes;
alter table public.t1_quote_signers rename to quote_signers;
alter trigger t1_quotes_log on public.quotes rename to quotes_log;

-- Statuses and kinds.
alter table public.quotes drop constraint t1_quotes_status_check;
alter table public.quotes add constraint quotes_status_check check (status in ('draft', 'sent', 'viewed', 'signed', 'declined', 'expired'));
alter table public.quotes drop constraint t1_quotes_kind_check;
alter table public.quotes add constraint quotes_kind_check check (kind in ('t1', 'corporate', 'proposal'));

-- A proposal may start without a lead, has no tax year or line prices, and its figures live in
-- its options (proposal); a draft proposal has no total yet.
alter table public.quotes alter column lead_id drop not null;
alter table public.quotes alter column tax_year drop not null;
alter table public.quotes alter column couple set default false;
alter table public.quotes alter column lines set default '[]';
alter table public.quotes alter column total_cents drop not null;
alter table public.quotes add constraint quotes_quote_fields check (kind = 'proposal' or (lead_id is not null and tax_year is not null and total_cents is not null));

alter table public.quotes
  add column client_id          uuid references public.clients (id),
  add column title              text check (title is null or length(title) <= 200),
  add column proposal           jsonb,          -- the proposal builder's inputs {f, opts, rec}; staff only
  add column chosen_option      int,            -- the option the client picked and signed (0, 1 or 2)
  add column document_id        uuid references public.documents (id),
  add column viewed_at          timestamptz,    -- first time the client opened their link
  add column declined_at        timestamptz,
  add column legacy_proposal_id uuid unique references public.proposals (id);
create index quotes_status_idx on public.quotes (status, valid_until);
create index quotes_client_idx on public.quotes (client_id);

-- Copy the old Proposals list in. Nothing is deleted; the old table stops being written to.
insert into public.quotes (kind, status, title, client_id, sent_at, valid_until, proposal, created_at, created_by, legacy_proposal_id, signed_at, declined_at)
select 'proposal',
       case p.status when 'Accepted' then 'signed' when 'Declined' then 'declined' when 'Expired' then 'expired' when 'Sent' then 'sent' else 'draft' end,
       left(p.title, 200), p.client_id,
       case when p.status <> 'Draft' then coalesce(p.date_sent::timestamptz, p.created_at) end,
       case when p.status <> 'Draft' then coalesce(p.valid_until, coalesce(p.date_sent, p.created_at::date) + 21) end,
       jsonb_build_object('legacy', jsonb_build_object('options', p.options_data, 'summary', p.options_summary, 'recommended', p.recommended,
         'chosen', p.chosen_option, 'prospect', p.prospect_name, 'contact', p.contact, 'province', p.province, 'segment', p.segment, 'notes', p.notes)),
       p.created_at, p.created_by, p.id,
       case when p.status = 'Accepted' then p.updated_at end,
       case when p.status = 'Declined' then p.updated_at end
from public.proposals p;
update public.quotes q set document_id = d.id
from public.documents d where d.proposal_id = q.legacy_proposal_id and q.legacy_proposal_id is not null;

-- The old seven-argument signing function was replaced by the eight-argument one.
drop function if exists public.record_t1_signature(uuid, integer, text, text, text, text, boolean);

create or replace function public.create_t1_quote(p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_q public.lead_quotes;
  v_h jsonb;
  v_couple boolean;
  v_id uuid;
  v_token text;
begin
  perform private.require(private.can_edit('pricing') and private.can_edit('leads'), 'You need Edit on Pricing and Leads to prepare a quote.');
  select * into v_lead from public.leads where id = p_lead;
  perform private.require(v_lead.id is not null, 'Lead not found.');
  perform private.require(v_lead.route = 'personal', 'Only personal tax leads have a T1 quote.');
  select * into v_q from public.lead_quotes where lead_id = p_lead;
  perform private.require(v_q.lead_id is not null, 'This lead has no quote from its answers (out of scope, or sent before the screening questions).');
  select id into v_id from public.quotes where lead_id = p_lead;
  if v_id is not null then return v_id; end if;
  v_h := coalesce(v_lead.answers -> 'household', '{}'::jsonb);
  v_couple := v_h ->> 'filing_type' = 'couple';
  insert into public.quotes (lead_id, tax_year, couple, lines, total_cents, created_by)
  values (p_lead, coalesce((v_lead.answers ->> 'tax_year')::int, private.t1_tax_year(v_lead.created_at)), v_couple,
          v_q.lines, v_q.subtotal_cents, (select auth.uid()))
  returning id into v_id;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_lead.first_name, v_lead.last_name, v_lead.email, v_token);
  if v_couple then
    perform private.require(coalesce(v_h ->> 'spouse_email', '') <> '', 'The spouse''s email is missing from the answers.');
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
    values (v_id, 1, btrim(v_h ->> 'spouse_first_name'), btrim(v_h ->> 'spouse_last_name'), lower(btrim(v_h ->> 'spouse_email')), v_token);
  end if;
  return v_id;
end;
$$;

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
  select id into v_id from public.quotes where lead_id = p_lead;
  if v_id is not null then
    update public.quotes set company_name = btrim(v_lead.company_name), year_end = v_lead.year_end,
      tax_year = extract(year from v_lead.year_end)::int,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('counts', v_lead.answers -> 'counts') where id = v_id and status = 'draft';
    return v_id;
  end if;
  insert into public.quotes (lead_id, kind, tax_year, couple, lines, total_cents, company_name, year_end, details, created_by)
  values (p_lead, 'corporate', extract(year from v_lead.year_end)::int, false, v_q.lines, v_q.subtotal_cents, btrim(v_lead.company_name), v_lead.year_end,
          jsonb_build_object('books', v_lead.answers ->> 'books', 'extras', coalesce(v_lead.answers -> 'extras', '{}'::jsonb), 'province', v_lead.province,
            'counts', v_lead.answers -> 'counts'),
          (select auth.uid()))
  returning id into v_id;
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_lead.first_name, v_lead.last_name, v_lead.email, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  return v_id;
end;
$$;

create or replace function public.mark_t1_quote_sent(p_id uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_staff public.staff;
  v_until date := (now() at time zone 'America/Toronto')::date + 21;
  v_ver uuid := (select id from public.wording_versions where is_current);
begin
  perform private.require(private.can_edit('pricing') and private.can_edit('leads'), 'You need Edit on Pricing and Leads to send a quote.');
  select * into v_q from public.quotes where id = p_id;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.kind in ('t1', 'corporate'), 'Send a proposal from the proposal builder.');
  perform private.require(v_q.status = 'draft', 'This quote is already marked sent.');
  if v_q.kind = 'corporate' then
    perform private.require(coalesce(btrim(v_q.company_name), '') <> '' and v_q.year_end is not null, 'Enter the company''s legal name and year-end first.');
  end if;
  select * into v_staff from public.staff where id = (select auth.uid());
  update public.quotes set status = 'sent', sent_at = now(), sent_by = v_staff.id, valid_until = v_until,
    sender = jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
    signer = coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
    wording = coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver), '{}'::jsonb),
    wording_label = (select label from public.wording_versions where id = v_ver)
  where id = p_id;
  update public.leads set status = 'sent' where id = v_q.lead_id;
  return v_until;
end;
$$;

-- Signing: a sent quote the client has opened (viewed) can be signed too.
create or replace function public.record_t1_signature(p_quote uuid, p_person int, p_name text, p_ip text, p_agent text, p_hash text, p_same_device boolean, p_title text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_all boolean;
begin
  select * into v_q from public.quotes where id = p_quote for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status in ('sent', 'viewed'), 'This quote cannot be signed.');
  perform private.require(v_q.valid_until >= (now() at time zone 'America/Toronto')::date, 'This quote has expired.');
  perform private.require(length(btrim(coalesce(p_name, ''))) between 2 and 120, 'Type your full name to sign.');
  perform private.require(coalesce(p_hash, '') ~ '^[0-9a-f]{64}$', 'The document could not be checked.');
  -- A company's signer gives their title, next to "I have authority to bind the Company."
  perform private.require(v_q.kind = 't1' or length(btrim(coalesce(p_title, ''))) between 2 and 80, 'Type your title at the company to sign.');
  update public.quote_signers
     set signed_at = now(), signed_name = btrim(p_name), signed_ip = left(coalesce(p_ip, ''), 100),
         signed_agent = left(coalesce(p_agent, ''), 400), document_hash = p_hash, same_device = coalesce(p_same_device, false),
         signed_title = case when v_q.kind <> 't1' then btrim(p_title) end
   where quote_id = p_quote and person = p_person and signed_at is null;
  perform private.require(found, 'Already signed.');
  v_all := not exists (select 1 from public.quote_signers where quote_id = p_quote and signed_at is null);
  if v_all then
    update public.quotes set status = 'signed', signed_at = now() where id = p_quote;
    update public.leads set status = 'signed', closed_at = coalesce(closed_at, now()) where id = v_q.lead_id;
  end if;
  return v_all;
end;
$$;
revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text) to service_role;

create or replace function public.store_t1_signed_pdf(p_quote uuid, p_path text, p_sha256 text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes set pdf_path = p_path, pdf_sha256 = p_sha256 where id = p_quote and status = 'signed' and pdf_path is null;
end;
$$;

-- Viewed: the first time the client opens their link (the server calls this; staff pages never do).
create or replace function public.mark_quote_viewed(p_token text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes q set status = 'viewed', viewed_at = now()
  from public.quote_signers s
  where s.token = p_token and s.quote_id = q.id and q.status = 'sent'
    and q.valid_until >= (now() at time zone 'America/Toronto')::date;
end;
$$;
revoke all on function public.mark_quote_viewed(text) from public, anon, authenticated;
grant execute on function public.mark_quote_viewed(text) to service_role;

-- Expired: a sent or viewed quote past its 21 days. Run daily by the scheduler and when a quote
-- list opens; returns how many changed.
create or replace function public.expire_quotes()
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.quotes set status = 'expired'
  where status in ('sent', 'viewed') and valid_until < (now() at time zone 'America/Toronto')::date;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.expire_quotes() from public, anon;
grant execute on function public.expire_quotes() to authenticated, service_role;

-- Declined: staff record the client's answer (from a sent, viewed or draft quote).
create or replace function public.mark_quote_declined(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_q public.quotes;
begin
  perform private.require(private.can_edit('leads'), 'You need Edit on Leads to change a quote.');
  select * into v_q from public.quotes where id = p_id for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status in ('draft', 'sent', 'viewed'), 'Only an open quote can be marked declined.');
  update public.quotes set status = 'declined', declined_at = now() where id = p_id;
  update public.leads set status = 'lost', closed_at = coalesce(closed_at, now()) where id = v_q.lead_id and status not in ('signed', 'lost');
end;
$$;
revoke all on function public.mark_quote_declined(uuid) from public, anon;
grant execute on function public.mark_quote_declined(uuid) to authenticated;

-- The Quotes list (section 3): everyone with Leads sees every quote; the total only with Pricing.
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
  order by coalesce(q.sent_at, q.created_at) desc;
end;
$$;
revoke all on function public.quote_list() from public, anon;
grant execute on function public.quote_list() to authenticated;

-- The menu badge: quotes sent and waiting for the client's signature (Leads viewers; no figures).
create or replace function public.quotes_waiting_count()
returns int language sql stable security definer set search_path = '' as $$
  select case when private.can_view('leads') then
    (select count(*)::int from public.quotes where status in ('sent', 'viewed') and valid_until >= (now() at time zone 'America/Toronto')::date)
  else 0 end
$$;
revoke all on function public.quotes_waiting_count() from public, anon;
grant execute on function public.quotes_waiting_count() to authenticated;
