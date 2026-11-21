-- CloseBook2 piece CB2-0 version 7: fixes from the one spec-checker run (docs/CLOSEBOOK2.md rule 16), Nov 21, 2026.
-- 1. Part 4 item 1: the line that cleared an outstanding item may be in any account of the file (it was still refused when
--    it was in another account).
-- 2. Part 4 item 8: the "Reclass entry" box is saved inside the entry's own save (public.cb_save_entry), so one save writes
--    one History row. When the box changes, the entry's row says so; when only the box changes, one row records it.

CREATE OR REPLACE FUNCTION public.cb_add_outstanding(p_account uuid, p_edge text, p_date date, p_description text, p_dir text, p_amount numeric, p_cleared_line uuid, p_kind text DEFAULT 'item'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_acc public.cb_bank_accounts; v_file public.cb_files; v_line public.cb_bank_lines; v_id uuid; v_left numeric;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_account;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_edge in ('start', 'end'), 'Choose the start or the end of the year.');
  perform private.require(coalesce(p_kind, 'item') in ('item', 'rounding'), 'Choose what kind of item it is.');
  if p_kind = 'rounding' then
    v_left := private.cb_edge_left(p_account, p_edge);
    perform private.require(v_left is not null and v_left <> 0, 'There is no difference left to round.');   -- CB2-0 v7: any amount
    insert into public.cb_bank_outstanding (file_id, account_id, edge, item_date, description, dir, amount, cleared_line, created_by, kind)
    values (v_acc.file_id, p_account, p_edge, case when p_edge = 'start' then v_file.year_start - 1 else v_file.year_end end,
            'Rounding (the T2 is in whole dollars)', case when v_left > 0 then 'in' else 'out' end, abs(v_left), null, (select auth.uid()), 'rounding')
    returning id into v_id;
    perform private.cb_log_event(v_acc.file_id, 'bank_outstanding', 'records', 'Rounding added', null, null, v_acc.name, '', '', to_char(abs(v_left), 'FM999,999,999,990.00'));
    return v_id;
  end if;
  perform private.require(p_dir in ('in', 'out'), 'Choose what kind of item it is.');
  perform private.require(p_date is not null, 'Enter the date of the item.');
  perform private.require(length(btrim(coalesce(p_description, ''))) between 1 and 200, 'Describe the item, for example "Cheque #204".');
  perform private.require(p_amount is not null and p_amount > 0 and round(p_amount, 2) = p_amount, 'Enter the amount as a positive number with up to 2 decimals.');
  if p_cleared_line is not null then
    select * into v_line from public.cb_bank_lines where id = p_cleared_line and file_id = v_acc.file_id;
    perform private.require(v_line.id is not null, 'That line is not in this file.');   -- CB2-0 v7: any account in the file
    -- CB2-0 review round (spec step 4): the clearing line may differ in amount; the reconciliation shows the difference.
    perform private.require(not exists (select 1 from public.cb_bank_transfers where out_line = p_cleared_line or in_line = p_cleared_line), 'That line is matched as a transfer. Unmatch it first.');
    perform private.require(v_line.source <> 'outstanding', 'That line already clears an outstanding item.');
  end if;
  insert into public.cb_bank_outstanding (file_id, account_id, edge, item_date, description, dir, amount, cleared_line, created_by,
                                          prior_status, prior_chart, prior_tax, prior_source, prior_reason, prior_by, prior_at)
  values (v_acc.file_id, p_account, p_edge, p_date, btrim(p_description), p_dir, p_amount, p_cleared_line, (select auth.uid()),
          v_line.status, v_line.chart_account, v_line.tax_code, v_line.source, v_line.reviewer_reason, v_line.coded_by, v_line.coded_at) returning id into v_id;
  if p_cleared_line is not null then
    -- The books already hold it (last year): the line posts nothing while the item is there.
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set status = 'matched', source = 'outstanding', chart_account = null, tax_code = null, coded_by = (select auth.uid()), coded_at = now() where id = p_cleared_line;
    perform set_config('cb.transfer', '', true);
  end if;
  perform private.cb_log_event(v_acc.file_id, 'bank_outstanding', 'records',
    case when p_cleared_line is null then format('Outstanding item added at the %s of the year', p_edge) else 'Outstanding item added; its line in the year now posts nothing' end,
    v_line.statement_id, v_line.id, format('%s · %s %s', v_acc.name, btrim(p_description), to_char(p_amount, 'FM999,999,999,990.00')), '',
    case when v_line.id is null then '' else private.cb_coding_text(v_line.status, v_line.chart_account, v_line.tax_code) end,
    case when v_line.id is null then '' else 'Clears an outstanding item' end);
  return v_id;
end;
$function$;

create or replace function private.cb_history_one_action() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
declare v_note text := coalesce(current_setting('cb.reclass_note', true), '');
begin
  if coalesce(current_setting('cb.one_action', true), '') = 'on' then return null; end if;
  -- The entry's own row carries the Reclass entry change (once).
  if v_note <> '' and new.entry_id is not null then
    new.detail := coalesce(new.detail, '') || v_note;
    perform set_config('cb.reclass_note', '', true);
  end if;
  return new;
end;
$function$;

-- The entry form's save: add (p_entry null) or change an entry, with its Reclass entry box, as one action.
create or replace function public.cb_save_entry(p_file uuid, p_entry uuid, p_reclass boolean, p_kind text, p_reason text, p_note text,
  p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date default null, p_standard uuid default null,
  p_attachments text[] default '{}'::text[], p_seq integer default null)
 returns uuid language plpgsql security definer set search_path to ''
as $function$
declare v_on boolean := coalesce(p_reclass, p_kind = 'RJE'); v_was boolean; v_id uuid; v_note text := '';
begin
  if p_entry is not null then
    select is_reclass into v_was from public.cb_entries where id = p_entry and file_id = p_file;
    perform private.require(v_was is not null, 'Entry not found.');
  else
    v_was := (p_kind = 'RJE');   -- what a new entry starts as (private.cb_entry_reclass_default)
  end if;
  if v_was <> v_on then
    v_note := format('; Reclass entry %s', case when v_on then 'ticked' else 'unticked' end);
  end if;
  perform set_config('cb.reclass_note', v_note, true);
  if p_entry is not null then
    v_id := public.cb_edit_entry(p_entry, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_standard, p_attachments, p_seq);
  else
    v_id := public.cb_add_entry(p_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_standard, p_attachments, p_seq);
  end if;
  if v_note <> '' then
    v_note := coalesce(current_setting('cb.reclass_note', true), '');   -- still set: the save wrote no row of its own
    perform set_config('cb.reclass_note', '', true);
    perform set_config('cb.one_action', 'on', true);
    update public.cb_entries set is_reclass = v_on where id = v_id;
    perform set_config('cb.one_action', '', true);
    if v_note <> '' then
      insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, old_value, new_value)
      values (p_file, (select auth.uid()), 'entry_reclass', 'entries',
              format('Entry %s: Reclass entry %s', private.cb_entry_label(v_id), case when v_on then 'ticked' else 'unticked' end),
              v_id, private.cb_entry_label(v_id), case when v_on then 'No' else 'Yes' end, case when v_on then 'Yes' else 'No' end);
    end if;
    perform set_config('cb.one_action', 'on', true);
  end if;
  return v_id;
end;
$function$;
revoke all on function public.cb_save_entry(uuid, uuid, boolean, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) from public, anon;
grant execute on function public.cb_save_entry(uuid, uuid, boolean, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) to authenticated;
