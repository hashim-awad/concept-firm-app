-- Front office batch, step 1 (section 5, items 1 and 2): a proposal is a quote record from the
-- moment it is started (Draft), and the client picks an option and signs online in one step. The
-- chosen option becomes the corporate engagement letter, signed in that same step.

-- Who reads quotes: Pricing with Leads (as before), or Pricing with Documents for proposals (the
-- proposal builder's people).
drop policy "Pricing and leads viewers read quotes" on public.quotes;
create policy "Pricing viewers read quotes" on public.quotes for select to authenticated
  using ((select private.can_view('pricing')) and ((select private.can_view('leads')) or (kind = 'proposal' and (select private.can_view('documents')))));
drop policy "Pricing and leads viewers read signers" on public.quote_signers;
create policy "Pricing viewers read signers" on public.quote_signers for select to authenticated
  using ((select private.can_view('pricing')) and ((select private.can_view('leads')) or (select private.can_view('documents'))));

-- Save a draft proposal (the builder saves as staff work). p_id null starts a new one.
-- p_data: {f, opts, rec}. A sent proposal never changes.
create or replace function public.save_proposal(p_id uuid, p_client uuid, p_lead uuid, p_title text, p_data jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_q public.quotes; v_id uuid;
begin
  perform private.require(private.can_edit('documents') and private.can_view('pricing'), 'You need Edit on Documents and the Pricing permission to work on a proposal.');
  perform private.require(jsonb_typeof(p_data -> 'opts') = 'array' and jsonb_typeof(p_data -> 'f') = 'object', 'The proposal could not be read.');
  perform private.require(length(coalesce(p_title, '')) <= 200, 'The name is too long.');
  if p_lead is not null then
    perform private.require(exists (select 1 from public.leads where id = p_lead and route = 'company'), 'Only a company lead can have a proposal.');
  end if;
  if p_id is null then
    if p_lead is not null then
      -- One quote per lead: reopen the lead's proposal rather than start a second one.
      select id into v_id from public.quotes where lead_id = p_lead;
      perform private.require(v_id is null or (select kind from public.quotes where id = v_id) = 'proposal', 'This lead already has a quote.');
    end if;
    if v_id is null then
      insert into public.quotes (kind, status, title, client_id, lead_id, proposal, created_by)
      values ('proposal', 'draft', nullif(btrim(p_title), ''), p_client, p_lead, p_data, (select auth.uid()))
      returning id into v_id;
      return v_id;
    end if;
    p_id := v_id;
  end if;
  select * into v_q from public.quotes where id = p_id for update;
  perform private.require(v_q.id is not null and v_q.kind = 'proposal', 'Proposal not found.');
  perform private.require(v_q.status = 'draft', 'This proposal was sent. It cannot change.');
  update public.quotes set title = nullif(btrim(p_title), ''), client_id = p_client, lead_id = coalesce(v_q.lead_id, p_lead), proposal = p_data where id = p_id;
  return p_id;
end;
$$;

create or replace function public.delete_proposal_draft(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('documents') and private.can_view('pricing'), 'You need Edit on Documents and the Pricing permission to work on a proposal.');
  delete from public.quotes where id = p_id and kind = 'proposal' and status = 'draft';
  perform private.require(found, 'Only a draft proposal can be deleted.');
end;
$$;

-- Send: owners only (a Final proposal was always Hashim's). Valid 21 days. The signing officer from
-- the Letter details step gets the private link. The wording in use is kept with the quote.
create or replace function public.send_proposal(p_id uuid, p_first text, p_last text, p_email text)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v_q public.quotes;
  v_staff public.staff;
  v_until date := (now() at time zone 'America/Toronto')::date + 21;
  v_ver uuid := (select id from public.wording_versions where is_current);
begin
  perform private.require(private.is_owner(), 'Only an owner can send a proposal.');
  select * into v_q from public.quotes where id = p_id for update;
  perform private.require(v_q.id is not null and v_q.kind = 'proposal', 'Proposal not found.');
  perform private.require(v_q.status = 'draft', 'This proposal was already sent.');
  perform private.require(length(btrim(coalesce(p_first, ''))) between 1 and 80 and length(btrim(coalesce(p_last, ''))) between 1 and 80, 'Enter the signing officer''s first and last name.');
  perform private.require(coalesce(p_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(p_email) <= 200, 'Enter the signing officer''s email.');
  perform private.require(jsonb_array_length(v_q.proposal -> 'opts') between 1 and 3, 'A proposal has one to three options.');
  select * into v_staff from public.staff where id = (select auth.uid());
  update public.quotes set status = 'sent', sent_at = now(), sent_by = v_staff.id, valid_until = v_until,
    sender = jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
    signer = coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
    wording = coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver), '{}'::jsonb),
    wording_label = (select label from public.wording_versions where id = v_ver),
    company_name = nullif(btrim(v_q.proposal -> 'f' ->> 'L_company'), '')
  where id = p_id;
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (p_id, 0, btrim(p_first), btrim(p_last), lower(btrim(p_email)), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  update public.leads set status = 'sent' where id = v_q.lead_id and status not in ('signed', 'lost');
  return v_until;
end;
$$;
revoke all on function public.save_proposal(uuid, uuid, uuid, text, jsonb), public.delete_proposal_draft(uuid), public.send_proposal(uuid, text, text, text) from public, anon;
grant execute on function public.save_proposal(uuid, uuid, uuid, text, jsonb), public.delete_proposal_draft(uuid), public.send_proposal(uuid, text, text, text) to authenticated;

-- Signing records the option the client chose (proposals must name one).
drop function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text);
create or replace function public.record_t1_signature(p_quote uuid, p_person int, p_name text, p_ip text, p_agent text, p_hash text, p_same_device boolean,
  p_title text default null, p_option int default null)
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
  perform private.require(v_q.kind = 't1' or length(btrim(coalesce(p_title, ''))) between 2 and 80, 'Type your title at the company to sign.');
  if v_q.kind = 'proposal' then
    perform private.require(p_option is not null and p_option >= 0 and p_option < jsonb_array_length(v_q.proposal -> 'opts'), 'Choose an option to sign.');
  end if;
  update public.quote_signers
     set signed_at = now(), signed_name = btrim(p_name), signed_ip = left(coalesce(p_ip, ''), 100),
         signed_agent = left(coalesce(p_agent, ''), 400), document_hash = p_hash, same_device = coalesce(p_same_device, false),
         signed_title = case when v_q.kind <> 't1' then btrim(p_title) end
   where quote_id = p_quote and person = p_person and signed_at is null;
  perform private.require(found, 'Already signed.');
  if v_q.kind = 'proposal' then update public.quotes set chosen_option = p_option where id = p_quote; end if;
  v_all := not exists (select 1 from public.quote_signers where quote_id = p_quote and signed_at is null);
  if v_all then
    update public.quotes set status = 'signed', signed_at = now() where id = p_quote;
    update public.leads set status = 'signed', closed_at = coalesce(closed_at, now()) where id = v_q.lead_id;
  end if;
  return v_all;
end;
$$;
revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean, text, int) to service_role;
