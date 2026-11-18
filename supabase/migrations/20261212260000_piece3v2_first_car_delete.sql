-- Piece 3, version 2 (Hashim, Nov 18, 2026): the entry whose Vehicle schedule holds the company-paid car costs (the
-- file's first Vehicle schedule, as the schedule window reads it) cannot be deleted while another Vehicle schedule
-- entry exists on the file: the other car's saved entry holds 0.00 for those costs, so they would stay in expenses
-- beside an allowance (ITA 6(1)(b)(x) and (xi)). Delete the other car's entry first. The entry deleted with its
-- schedule is still recorded in History, as in 20261212250000. When the whole file is deleted, nothing is refused.
-- No table or column is dropped. Safe to run twice.

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
    perform private.cb_log_event(old.file_id, 'schedule_deleted', 'entries', format('Entry %s deleted with its Vehicle schedule', private.cb_entry_label(old.id)),
      null, null, private.cb_entry_label(old.id), '', '', '');
  end if;
  return old;
end;
$$;
revoke all on function private.cb_schedule_entry_deleted() from public, anon, authenticated;
drop trigger if exists cb_schedule_entry_deleted on public.cb_entries;
create trigger cb_schedule_entry_deleted before delete on public.cb_entries for each row execute function private.cb_schedule_entry_deleted();
