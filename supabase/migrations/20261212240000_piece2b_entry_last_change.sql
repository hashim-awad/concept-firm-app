-- Piece 2b (Hashim, Nov 18, 2026): the entry window's sign-off box shows "Last changed by <name> · <date>" under
-- "Prepared by" when an entry was changed after it was first saved. File history stays owner-only (round 8 rule);
-- this function gives anyone who can view Closebook only the name and date of an entry's latest "Entry changed"
-- row, nothing else. History rows name an entry by its label ("2026-001 AJE"), not its id: the latest edit row
-- carries the entry's current label (only an edit changes it), and rows from before the entry was created are left
-- out, so an old, deleted entry's history never shows on a new entry that took its number.
-- Adds no table or column, drops nothing, changes no data. Safe to run twice.
create or replace function public.cb_entry_last_change(p_entry uuid)
returns table (changed_by text, changed_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_e public.cb_entries;
begin
  perform private.require(private.can_view('closebook'), 'You need View on Closebook.');
  select * into v_e from public.cb_entries where id = p_entry;
  if v_e.id is null then return; end if;
  return query
    select coalesce(s.full_name, ''), h.at
      from public.cb_file_history h left join public.staff s on s.id = h.actor_id
     where h.file_id = v_e.file_id and h.action = 'entry_edited' and h.ref_label = private.cb_entry_label(v_e.id) and h.at >= v_e.created_at
     order by h.at desc, h.id desc
     limit 1;
end;
$$;
revoke all on function public.cb_entry_last_change(uuid) from public, anon;
grant execute on function public.cb_entry_last_change(uuid) to authenticated;
