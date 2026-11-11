-- Front office batch, step 2 (section 2): "New lead by phone". Staff enter the caller's answers in
-- the same screening the client sees online; those answers count as the client's. The lead records
-- who took the call. No alert emails for a lead staff entered themselves, except one sent to Hashim
-- (status With Hashim), which alerts like a website lead.

alter table public.leads add column taken_by uuid references public.staff (id);
comment on column public.leads.taken_by is 'Phone leads: the staff member who took the call and entered the answers.';

create or replace function public.create_phone_lead(p_route text, p_contact jsonb, p_answers jsonb, p_status text, p_client uuid, p_company text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_me uuid := (select auth.uid());
begin
  perform private.require(private.can_edit('leads'), 'You need Edit on Leads to enter a phone lead.');
  perform private.require(p_route in ('personal', 'company'), 'Unknown form.');
  perform private.require(p_status in ('new', 'call_needed', 'out_of_scope'), 'Unknown finish.');
  perform private.require(length(btrim(coalesce(p_contact ->> 'first_name', ''))) between 1 and 80 and length(btrim(coalesce(p_contact ->> 'last_name', ''))) between 1 and 80, 'Enter the caller''s first and last name.');
  perform private.require(coalesce(p_contact ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Enter the caller''s email.');
  perform private.require(coalesce(btrim(p_contact ->> 'phone'), '') ~ '^[0-9 ()+.-]{7,25}$', 'Enter the caller''s phone number.');
  if p_client is not null then
    perform private.require(exists (select 1 from public.clients where id = p_client), 'Client not found.');
  end if;
  insert into public.leads (route, status, first_name, last_name, email, phone, province, answers, source, assigned_to, taken_by, client_id, company_name)
  values (p_route, p_status, btrim(p_contact ->> 'first_name'), btrim(p_contact ->> 'last_name'), lower(btrim(p_contact ->> 'email')), btrim(p_contact ->> 'phone'),
          p_contact ->> 'province', coalesce(p_answers, '{}'), 'Phone', v_me, v_me, p_client, left(btrim(coalesce(p_company, '')), 200))
  returning id into v_id;
  -- Staff already have this lead in hand: no alert or reminder, unless it goes to Hashim.
  if p_status = 'new' then
    insert into public.lead_alerts (lead_id, kind, sent_at, recipients, error) values (v_id, 'new', now(), 0, 'Phone lead: entered by staff'), (v_id, 'reminder', now(), 0, 'Phone lead: entered by staff');
  end if;
  return v_id;
end;
$$;
revoke all on function public.create_phone_lead(text, jsonb, jsonb, text, uuid, text) from public, anon;
grant execute on function public.create_phone_lead(text, jsonb, jsonb, text, uuid, text) to authenticated;
