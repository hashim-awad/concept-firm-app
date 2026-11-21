-- CloseBook2 piece CB2-0 version 7, Part 4 item 3 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md rule 5). One field on every
-- entry: "Reclass entry", default no. Existing AJE and TJE are no; RJE are yes. The trial balance by group puts an entry in
-- Adj's or Reclass from it, and the journal totals and the client entry list follow it. No rule or permission depends on it.
alter table public.cb_entries add column if not exists is_reclass boolean not null default false;
update public.cb_entries set is_reclass = (kind = 'RJE') where is_reclass is distinct from (kind = 'RJE');

-- A new entry made as an RJE (the opening RJE) is ticked; anything else starts unticked.
create or replace function private.cb_entry_reclass_default() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
begin
  if tg_op = 'INSERT' and new.kind = 'RJE' then new.is_reclass := true; end if;
  return new;
end;
$function$;
revoke all on function private.cb_entry_reclass_default() from public, anon, authenticated;
drop trigger if exists cb_entry_reclass_default on public.cb_entries;
create trigger cb_entry_reclass_default before insert on public.cb_entries for each row execute function private.cb_entry_reclass_default();

-- The entry form's checkbox. One History row when it changes.
create or replace function public.cb_set_entry_reclass(p_entry uuid, p_on boolean)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare v_e public.cb_entries;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_e from public.cb_entries where id = p_entry for update;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.cb_file_open(v_e.file_id);
  if v_e.is_reclass = coalesce(p_on, false) then return; end if;
  perform private.cb_one_action(true);
  update public.cb_entries set is_reclass = coalesce(p_on, false) where id = p_entry;
  perform private.cb_one_action(false);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, old_value, new_value)
  values (v_e.file_id, (select auth.uid()), 'entry_reclass', 'entries', format('Entry %s: Reclass entry %s', private.cb_entry_label(p_entry), case when p_on then 'ticked' else 'unticked' end),
          p_entry, private.cb_entry_label(p_entry), case when p_on then 'No' else 'Yes' end, case when p_on then 'Yes' else 'No' end);
  perform private.cb_one_action(true);
end;
$function$;
revoke all on function public.cb_set_entry_reclass(uuid, boolean) from public, anon;
grant execute on function public.cb_set_entry_reclass(uuid, boolean) to authenticated;
