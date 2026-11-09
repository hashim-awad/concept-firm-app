-- Phase 2 step 4: leads (brief "Lead flow"; decisions 15, 17, 19, 21). Approved plan, Nov 9, 2026.
-- Every submission from the public start page becomes a lead. The public form calls submit_lead()
-- (anonymous callers can do nothing else). The start page stays closed until an owner opens it.
-- Privacy: the activity log records lead changes without their contents (no names or emails), so the
-- 24-month deletion of lost and out-of-scope leads leaves nothing behind but date and count.

create table public.leads (
  id            uuid primary key default gen_random_uuid(),
  route         text not null check (route in ('personal', 'company')),
  status        text not null default 'new' check (status in ('new', 'call_needed', 'out_of_scope', 'quoted', 'sent', 'signed', 'lost')),
  first_name    text not null check (length(btrim(first_name)) between 1 and 80),
  last_name     text not null check (length(btrim(last_name)) between 1 and 80),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  phone         text not null default '' check (phone = '' or phone ~ '^[0-9 ()+.-]{7,25}$'),
  province      text not null check (province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT')),
  answers       jsonb not null default '{}',
  source        text not null default 'Website',
  assigned_to   uuid references public.staff (id),
  client_id     uuid references public.clients (id),
  notes         text not null default '',
  ip_hash       text not null default '',
  closed_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index leads_status_idx on public.leads (status, created_at desc);
create index leads_ip_idx on public.leads (ip_hash, created_at desc);
alter table public.leads enable row level security;

create policy "Lead viewers read leads" on public.leads for select to authenticated using ((select private.can_view('leads')));
create policy "Lead editors change leads" on public.leads for update to authenticated
  using ((select private.can_edit('leads'))) with check ((select private.can_edit('leads')));
grant select, update on public.leads to authenticated;

create trigger leads_touch before update on public.leads for each row execute function private.touch_updated_at();

-- Closed leads get their closing date (for retention); reopening clears it. Only owners reassign.
create or replace function private.lead_rules()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status in ('lost', 'out_of_scope', 'signed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.closed_at := now(); end if;
  if new.status not in ('lost', 'out_of_scope', 'signed') then new.closed_at := null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to and (select auth.uid()) is not null and not private.is_owner() then
    raise exception 'Only an owner can reassign a lead.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (new.route, new.first_name, new.last_name, new.email, new.phone, new.province, new.answers, new.ip_hash, new.created_at)
     is distinct from (old.route, old.first_name, old.last_name, old.email, old.phone, old.province, old.answers, old.ip_hash, old.created_at) then
    raise exception 'What the client entered cannot be changed. Add a note instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger leads_rules before insert or update on public.leads for each row execute function private.lead_rules();

-- Activity log without contents: which lead, what changed (field names only).
create or replace function private.log_lead_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_fields text[];
begin
  if tg_op = 'UPDATE' then
    select array_agg(key order by key) into v_fields from jsonb_each(to_jsonb(new)) n
    where key not in ('updated_at', 'closed_at') and n.value is distinct from (to_jsonb(old) -> key);
  end if;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), lower(tg_op), 'leads', coalesce(new.id, old.id)::text,
          case when tg_op = 'UPDATE' then jsonb_build_object('fields', coalesce(v_fields, '{}'), 'status', new.status)
               when tg_op = 'INSERT' then jsonb_build_object('route', new.route, 'status', new.status)
               else '{}'::jsonb end);
  return coalesce(new, old);
end;
$$;
create trigger leads_log after insert or update or delete on public.leads for each row execute function private.log_lead_change();

-- Settings: lead sources (decision 17, owner-editable list) and the start page switch (owner only).
insert into public.settings (key, value) values
  ('lead_sources', '["Website", "Referral", "Existing client", "Brokerage or team partner", "Talk or event", "Social media", "Other"]'),
  ('start_page_open', 'false')
on conflict (key) do nothing;

-- The public form. Anonymous callers may only do this. Spam: a submission limit per visitor and in
-- total (the hidden trap field and the time check are in the page). The visitor's address is stored
-- only as a keyed hash made by the server.
create or replace function public.submit_lead(p_route text, p_contact jsonb, p_answers jsonb, p_ip_hash text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_open boolean := coalesce((select (value #>> '{}')::boolean from public.settings where key = 'start_page_open'), false);
  v_assign jsonb := (select value from public.settings where key = 'lead_assignment');
  v_ids jsonb;
  v_n int;
  v_idx int;
  v_staff uuid;
  v_id uuid;
begin
  perform private.require(v_open or private.is_active_staff(), 'This form is not open yet.');
  perform private.require(p_route in ('personal', 'company'), 'Unknown form.');
  perform private.require(coalesce(p_ip_hash, '') ~ '^[0-9a-f]{64}$', 'The form could not be checked. Please try again.');
  perform private.require((select count(*) from public.leads where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') < 5,
    'You have sent this form several times in the last hour. Please try again later, or call us.');
  perform private.require((select count(*) from public.leads where created_at > now() - interval '1 hour') < 200,
    'We are receiving a lot of requests right now. Please try again in an hour, or call us.');
  perform private.require(p_route <> 'personal' or coalesce(btrim(p_contact ->> 'phone'), '') <> '', 'Enter your phone number.');

  v_ids := coalesce(v_assign -> 'staff_ids', '[]'::jsonb);
  v_n := jsonb_array_length(v_ids);
  if v_assign ->> 'mode' = 'single' and v_n >= 1 then
    v_staff := (v_ids ->> 0)::uuid;
  elsif v_assign ->> 'mode' = 'rotate' and v_n >= 1 then
    v_idx := coalesce((v_assign ->> 'next_index')::int, 0) % v_n;
    v_staff := (v_ids ->> v_idx)::uuid;
    update public.settings set value = jsonb_set(value, '{next_index}', to_jsonb((v_idx + 1) % v_n)) where key = 'lead_assignment';
  end if;
  if v_staff is not null and not exists (select 1 from public.staff where id = v_staff and is_active) then v_staff := null; end if;

  insert into public.leads (route, first_name, last_name, email, phone, province, answers, assigned_to, ip_hash)
  values (p_route, btrim(p_contact ->> 'first_name'), btrim(p_contact ->> 'last_name'), lower(btrim(p_contact ->> 'email')),
          coalesce(btrim(p_contact ->> 'phone'), ''), p_contact ->> 'province', coalesce(p_answers, '{}'), v_staff, p_ip_hash)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.submit_lead(text, jsonb, jsonb, text) from public;
grant execute on function public.submit_lead(text, jsonb, jsonb, text) to anon, authenticated;

-- Is the start page open? (Public pages ask before showing the form.)
create or replace function public.start_page_open()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select (value #>> '{}')::boolean from public.settings where key = 'start_page_open'), false)
$$;
grant execute on function public.start_page_open() to anon, authenticated;

-- Decision 21: lost and out-of-scope leads are deleted after the retention period (default 24 months).
-- Signed leads are kept. Logged with date and count only. Run daily by the server (service key).
create or replace function public.purge_closed_leads()
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_months int := coalesce((select (value #>> '{}')::int from public.settings where key = 'retention_months'), 24);
  v_count int;
begin
  alter table public.leads disable trigger leads_log;
  delete from public.leads where status in ('lost', 'out_of_scope') and closed_at < now() - make_interval(months => v_months);
  get diagnostics v_count = row_count;
  alter table public.leads enable trigger leads_log;
  if v_count > 0 then
    insert into public.activity_log (action, entity_type, details) values ('leads_deleted', 'leads', jsonb_build_object('count', v_count, 'months', v_months));
  end if;
  return v_count;
end;
$$;
revoke all on function public.purge_closed_leads() from public, anon, authenticated;
grant execute on function public.purge_closed_leads() to service_role;

create or replace function public.update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
  v_ids jsonb;
  v_count int;
begin
  perform private.require(private.can_edit('settings'), 'You do not have permission to change settings.');
  if p_key = 'lead_assignment' then
    v_mode := p_value ->> 'mode';
    v_ids := coalesce(p_value -> 'staff_ids', '[]'::jsonb);
    perform private.require(v_mode in ('single', 'unassigned', 'rotate'),
      'Assignment must be: one person, unassigned queue, or rotate.');
    perform private.require(jsonb_typeof(v_ids) = 'array', 'Staff list is not valid.');
    v_count := jsonb_array_length(v_ids);
    perform private.require(
      (v_mode = 'unassigned' and v_count = 0) or (v_mode = 'single' and v_count = 1) or (v_mode = 'rotate' and v_count >= 2),
      'Choose one person for "one person", two or more for "rotate", none for "unassigned".');
    perform private.require(not exists (
      select 1 from jsonb_array_elements_text(v_ids) e(id)
      where not exists (select 1 from public.staff s where s.id::text = e.id and s.is_active)
    ), 'Every chosen person must be an active staff member.');
    p_value := jsonb_build_object('mode', v_mode, 'staff_ids', v_ids, 'next_index', 0);
  elsif p_key = 'retention_months' then
    perform private.require(jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::int between 1 and 120,
      'Retention must be a whole number of months from 1 to 120.');
  elsif p_key in ('signer_engagement_letter', 'signer_proposal', 'signer_other') then
    perform private.require(private.is_owner(), 'Only an owner can change signer names.');
    perform private.require(length(btrim(coalesce(p_value ->> 'name', ''))) between 2 and 120, 'Enter the signer name.');
    perform private.require(length(btrim(coalesce(p_value ->> 'title', ''))) between 2 and 60, 'Enter the signer title.');
    p_value := jsonb_build_object('name', btrim(p_value ->> 'name'), 'title', btrim(p_value ->> 'title'));
  elsif p_key = 'lead_sources' then
    perform private.require(jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) between 1 and 30
      and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) not between 1 and 60),
      'Each lead source needs a name of up to 60 characters; keep at least one.');
    p_value := (select jsonb_agg(btrim(e #>> '{}')) from jsonb_array_elements(p_value) e);
  elsif p_key = 'start_page_open' then
    perform private.require(private.is_owner(), 'Only an owner can open or close the public start page.');
    perform private.require(jsonb_typeof(p_value) = 'boolean', 'Choose open or closed.');
  elsif p_key = 'business_hours' then
    perform private.require(private.valid_business_hours(p_value), 'Each day needs a start and end time, start before end, or Closed.');
    p_value := jsonb_build_object('mon', p_value -> 'mon', 'tue', p_value -> 'tue', 'wed', p_value -> 'wed', 'thu', p_value -> 'thu', 'fri', p_value -> 'fri', 'sat', p_value -> 'sat', 'sun', p_value -> 'sun');
  elsif p_key = 'booking_link' then
    perform private.require(jsonb_typeof(p_value) = 'string' and ((p_value #>> '{}') = '' or (p_value #>> '{}') ~ '^https://[^ ]+$'),
      'The booking link must start with https://');
  elsif p_key = 't1_rules' then
    perform private.require(private.is_owner(), 'Only an owner can change the T1 rule values.');
    perform private.require((p_value ->> 'moving_km') ~ '^\d{1,3}$' and (p_value ->> 'moving_km')::int between 1 and 500, 'Enter the moving distance in kilometres.');
    perform private.require((p_value ->> 't1135_simple_over') ~ '^\d{1,9}$' and (p_value ->> 't1135_detailed_from') ~ '^\d{1,9}$'
      and (p_value ->> 't1135_simple_over')::bigint < (p_value ->> 't1135_detailed_from')::bigint, 'The detailed T1135 threshold must be above the simplified one.');
    perform private.require(coalesce(p_value ->> 'checked_on', '') ~ '^\d{4}-\d{2}-\d{2}$', 'Enter the date you checked the values on canada.ca.');
    p_value := jsonb_build_object('moving_km', (p_value ->> 'moving_km')::int, 't1135_simple_over', (p_value ->> 't1135_simple_over')::bigint,
      't1135_detailed_from', (p_value ->> 't1135_detailed_from')::bigint, 'checked_on', p_value ->> 'checked_on', 'source', 'canada.ca');
  elsif p_key = 'taxdome_account_url' then
    perform private.require(private.is_owner(), 'Only an owner can change the TaxDome link.');
    perform private.require(jsonb_typeof(p_value) = 'string' and ((p_value #>> '{}') = '' or ((p_value #>> '{}') ~ '^https://' and (p_value #>> '{}') like '%{id}%')),
      'The TaxDome link must start with https:// and contain {id} where the account id goes.');
  elsif p_key = 'signature_image' then
    perform private.require(private.is_owner(), 'Only an owner can change the signature image.');
    p_value := jsonb_build_object('uploaded', coalesce((p_value ->> 'uploaded')::boolean, false), 'uploaded_at', now());
  else
    perform private.require(false, 'Unknown setting: ' || p_key);
  end if;
  update public.settings set value = p_value, updated_by = (select auth.uid()) where key = p_key;
end;
$$;
