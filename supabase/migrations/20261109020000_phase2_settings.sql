-- Phase 2 settings (batch sections 3, 4, 8 and 16; plan step 3, Nov 9, 2026). Values, not decisions:
-- the fields are built here and Hashim fills them in.
--   business_hours: when the lead timer and the 45-business-minute reminder count (Toronto time).
--   booking_link:   the "choose a time" button on the call path (corporate leads).
--   t1_rules:       T1 screening rule values, editable without code: the moving-expense distance and the
--                   T1135 cost thresholds (checked on canada.ca by Hashim, Nov 9, 2026).
--   staff.phone:    each person's phone, for the sender block on quote emails.

insert into public.settings (key, value) values
  ('business_hours', '{"mon": null, "tue": null, "wed": null, "thu": null, "fri": null, "sat": null, "sun": null}'),
  ('booking_link', '""'),
  ('t1_rules', '{"moving_km": 40, "t1135_simple_over": 100000, "t1135_detailed_from": 250000, "checked_on": "2026-11-09", "source": "canada.ca"}')
on conflict (key) do nothing;

alter table public.staff add column phone text not null default '' check (phone = '' or phone ~ '^[0-9 ()+.-]{7,25}$');

-- A person changes their own phone; staff-account editors change others' (as for names).
create or replace function public.update_staff_phone(p_staff_id uuid, p_phone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(
    p_staff_id = (select auth.uid()) and private.is_active_staff()
    or private.can_edit('staff_accounts') and private.role_within_caller((select role_id from public.staff where id = p_staff_id)),
    'You do not have permission to change this phone number.');
  perform private.require(coalesce(btrim(p_phone), '') = '' or btrim(p_phone) ~ '^[0-9 ()+.-]{7,25}$', 'Enter the phone number with digits only, for example 226-789-9591.');
  update public.staff set phone = coalesce(btrim(p_phone), '') where id = p_staff_id;
  perform private.require(found, 'Staff member not found.');
end;
$$;
revoke all on function public.update_staff_phone(uuid, text) from public, anon;
grant execute on function public.update_staff_phone(uuid, text) to authenticated;

-- Hour checks for business_hours: each day is null (closed) or ["HH:MM", "HH:MM"] with start before end.
create or replace function private.valid_business_hours(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(p) = 'object'
    and (select count(*) from jsonb_object_keys(p) k where k not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun')) = 0
    and not exists (
      select 1 from jsonb_each(p) d
      where jsonb_typeof(d.value) <> 'null' and not (
        jsonb_typeof(d.value) = 'array' and jsonb_array_length(d.value) = 2
        and (d.value ->> 0) ~ '^([01]\d|2[0-3]):[0-5]\d$' and (d.value ->> 1) ~ '^([01]\d|2[0-3]):[0-5]\d$'
        and (d.value ->> 0) < (d.value ->> 1)))
$$;

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
