-- Piece 4, version 2 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud): the Home office schedule uses the piece 3
-- schedule engine as built. cb_schedules takes kind 'home_office'; cb_save_schedule_entry accepts it (and keeps an
-- entry's schedule kind when it is put in again); History, printing and deleting name the schedule by its kind
-- ("Home office schedule", "Vehicle schedule"). The first car's delete rule (20261212260000) stays for Vehicle
-- schedules only. The standard entries "Home office" and "Auto expenses" are hidden in the app only: no data changes.
-- No table or column is dropped. Safe to run twice.

alter table public.cb_schedules drop constraint if exists cb_schedules_kind_check;
alter table public.cb_schedules add constraint cb_schedules_kind_check check (kind in ('vehicle', 'home_office'));

create or replace function private.cb_schedule_name(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'home_office' then 'Home office schedule' else 'Vehicle schedule' end;
$$;
revoke all on function private.cb_schedule_name(text) from public, anon, authenticated;

-- Save an entry from a schedule (piece 3), for either kind.
create or replace function public.cb_save_schedule_entry(p_file uuid, p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean,
  p_lines jsonb, p_wp_ref text, p_date date, p_attachments text[], p_seq integer, p_schedule jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_e public.cb_entries;
  v_s public.cb_schedules;
  v_id uuid;
  v_label text;
  v_itc boolean;
  v_kind text;
  v_name text;
  c jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null, 'File not found.');
  if p_entry is not null then
    select * into v_e from public.cb_entries where id = p_entry;
    perform private.require(v_e.id is not null and v_e.file_id = p_file and v_e.origin = 'schedule', 'Entry not found.');
    select * into v_s from public.cb_schedules where entry_id = p_entry;
  else
    perform private.require(p_schedule is not null, 'Open the schedule and put it in the entry.');
  end if;
  if p_schedule is not null then
    perform private.require(p_schedule ->> 'kind' in ('vehicle', 'home_office'), 'Unknown schedule.');
    -- One schedule per entry: putting it in again keeps its kind.
    perform private.require(v_s.id is null or v_s.kind = p_schedule ->> 'kind', 'This entry holds another schedule.');
    perform private.require(private.cb_schedule_amounts_of(p_lines) = private.cb_schedule_amounts_of(p_schedule -> 'lines'),
      'Change this amount in its schedule: click the Schedule tag.');
    -- "Claim the ITC": ticked unless the reviewer or an owner unticks it.
    v_itc := coalesce((p_schedule ->> 'itc')::boolean, true);
    perform private.require(v_itc = coalesce(v_s.itc_claim, true) or (select auth.uid()) = v_file.reviewer_id or private.is_owner(),
      'Only the file''s reviewer or an owner can change "Claim the ITC".');
    perform set_config('cb.schedule_save', 'on', true);
  end if;
  v_kind := coalesce(p_schedule ->> 'kind', v_s.kind, 'vehicle');
  v_name := private.cb_schedule_name(v_kind);
  if p_entry is null then
    v_id := public.cb_add_entry(p_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, null, p_attachments, p_seq);
    update public.cb_entries set origin = 'schedule' where id = v_id;
    insert into public.cb_schedules (file_id, entry_id, kind, method, choice, itc_claim, inputs, snapshot, result, created_by)
    values (p_file, v_id, v_kind, coalesce(p_schedule ->> 'method', 'prorated'), coalesce(p_schedule ->> 'choice', 'higher'), v_itc, coalesce(p_schedule -> 'inputs', '{}'),
            coalesce(p_schedule -> 'snapshot', '{}'), coalesce(p_schedule -> 'result', '{}'), (select auth.uid()));
    v_label := private.cb_entry_label(v_id);
    perform private.cb_log_event(p_file, 'schedule_created', 'entries', format('%s created for entry %s', v_name, v_label), null, null, v_label, '', '', '');
    if not v_itc then
      perform private.cb_log_event(p_file, 'schedule_itc', 'entries', format('%s %s: Claim the ITC unticked', v_name, v_label), null, null, v_label, '', 'Ticked', 'Unticked');
    end if;
  else
    v_id := public.cb_edit_entry(p_entry, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, null, p_attachments, p_seq);
    v_label := private.cb_entry_label(v_id);
    if p_schedule is not null then
      for c in select * from jsonb_array_elements(coalesce(p_schedule -> 'changes', '[]'::jsonb)) loop
        perform private.cb_log_event(p_file, case when c ->> 'what' = 'Method' then 'schedule_method_switched' else 'schedule_input_changed' end, 'entries',
          format('%s %s: %s', v_name, v_label, lower(c ->> 'what')), null, null, v_label, c ->> 'what', c ->> 'old', c ->> 'new');
      end loop;
      if v_itc <> coalesce(v_s.itc_claim, true) then
        perform private.cb_log_event(p_file, 'schedule_itc', 'entries', format('%s %s: Claim the ITC %s', v_name, v_label, case when v_itc then 'ticked' else 'unticked' end),
          null, null, v_label, '', case when v_itc then 'Unticked' else 'Ticked' end, case when v_itc then 'Ticked' else 'Unticked' end);
      end if;
      update public.cb_schedules set method = coalesce(p_schedule ->> 'method', 'prorated'), choice = coalesce(p_schedule ->> 'choice', 'higher'), itc_claim = v_itc,
          inputs = coalesce(p_schedule -> 'inputs', '{}'), snapshot = coalesce(p_schedule -> 'snapshot', '{}'), result = coalesce(p_schedule -> 'result', '{}'),
          updated_by = (select auth.uid()), updated_at = now()
       where entry_id = v_id;
    end if;
  end if;
  if p_schedule is not null then
    perform private.cb_log_event(p_file, 'schedule_put_in', 'entries', format('%s put into entry %s', v_name, v_label), null, null, v_label, '',
      '', left(coalesce(p_schedule ->> 'summary', ''), 300));
    perform set_config('cb.schedule_save', '', true);
  end if;
  return v_id;
end;
$$;
revoke all on function public.cb_save_schedule_entry(uuid, uuid, text, text, text, boolean, jsonb, text, date, text[], integer, jsonb) from public, anon;
grant execute on function public.cb_save_schedule_entry(uuid, uuid, text, text, text, boolean, jsonb, text, date, text[], integer, jsonb) to authenticated, service_role;

create or replace function public.cb_schedule_printed(p_schedule uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_s public.cb_schedules; v_label text;
begin
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into v_s from public.cb_schedules where id = p_schedule;
  perform private.require(v_s.id is not null, 'Schedule not found.');
  v_label := private.cb_entry_label(v_s.entry_id);
  perform private.cb_log_event(v_s.file_id, 'schedule_printed', 'entries', format('%s %s printed', private.cb_schedule_name(v_s.kind), v_label), null, null, v_label, '', '', '');
end;
$$;
revoke all on function public.cb_schedule_printed(uuid) from public, anon;
grant execute on function public.cb_schedule_printed(uuid) to authenticated, service_role;

-- Deleting a schedule's entry (piece 3 version 2): History names the schedule by its kind.
create or replace function private.cb_schedule_entry_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_first uuid;
  v_other uuid;
begin
  if old.origin = 'schedule' and exists (select 1 from public.cb_files where id = old.file_id) then
    select s.entry_id into v_first from public.cb_schedules s
     where s.file_id = old.file_id and s.kind = 'vehicle' order by s.created_at, s.id limit 1;
    if v_first = old.id then
      select s.entry_id into v_other from public.cb_schedules s
       where s.file_id = old.file_id and s.kind = 'vehicle' and s.entry_id <> old.id order by s.created_at, s.id limit 1;
      if v_other is not null then
        raise exception '%', format('This entry holds the company-paid car costs. Delete %s first.', split_part(private.cb_entry_label(v_other), ' ', 1))
          using errcode = 'P0001';
      end if;
    end if;
    perform private.cb_log_event(old.file_id, 'schedule_deleted', 'entries', format('Entry %s deleted with its %s', private.cb_entry_label(old.id),
      private.cb_schedule_name(coalesce((select kind from public.cb_schedules where entry_id = old.id), 'vehicle'))),
      null, null, private.cb_entry_label(old.id), '', '', '');
  end if;
  return old;
end;
$$;
revoke all on function private.cb_schedule_entry_deleted() from public, anon, authenticated;
drop trigger if exists cb_schedule_entry_deleted on public.cb_entries;
create trigger cb_schedule_entry_deleted before delete on public.cb_entries for each row execute function private.cb_schedule_entry_deleted();
