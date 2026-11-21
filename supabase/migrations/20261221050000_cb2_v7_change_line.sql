-- CloseBook2 piece CB2-0 version 7, Part 4 items 2 and 8 (Hashim, Nov 21, 2026).
-- One action, one History row: an action that writes its own row sets cb.one_action for the rest of the transaction, and
-- every other History write in that transaction is skipped (private.cb_history_one_action). The deferred safety-net row
-- (private.cb_change_flush) already writes nothing when a row exists.
-- Item 2: public.cb_change_line changes the account, sales tax code, split or memo of any coded bank line in place,
-- including a split line, a line in a transfer (the transfer is undone; its other line goes back to To code) and a line
-- that cleared an outstanding item (the item is open again). One History row with the coding before and after. Kept as
-- "unbalanced entry": a split's lines add up to the bank line.

create or replace function private.cb_history_one_action() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
begin
  if coalesce(current_setting('cb.one_action', true), '') = 'on' then return null; end if;
  return new;
end;
$function$;
revoke all on function private.cb_history_one_action() from public, anon, authenticated;
drop trigger if exists cb_history_one_action on public.cb_file_history;
create trigger cb_history_one_action before insert on public.cb_file_history for each row execute function private.cb_history_one_action();

-- Quiet the other History writers for the rest of this transaction (the caller writes its own row first or last).
create or replace function private.cb_one_action(p_on boolean) returns void
 language sql security definer set search_path to ''
as $function$ select set_config('cb.one_action', case when p_on then 'on' else '' end, true); $function$;
revoke all on function private.cb_one_action(boolean) from public, anon, authenticated;

-- A bank line's coding in words: "65100 Office expenses, HST_ON", "Split: …", "Transfer to …", "Clears an outstanding item".
create or replace function private.cb_line_coding(p_line uuid) returns text
 language sql stable security definer set search_path to ''
as $function$
  select case
    when exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id)
      then 'Transfer with ' || coalesce((select a.name from public.cb_bank_accounts a where a.id = l.transfer_account), 'another account')
    when exists (select 1 from public.cb_bank_outstanding o where o.cleared_line = l.id) then 'Clears an outstanding item'
    when l.is_split then 'Split: ' || coalesce((select string_agg(concat_ws(' ', s.chart_account, s.tax_code, to_char(s.amount, 'FM999,999,990.00')), '; ' order by s.row_no)
                                            from public.cb_line_splits s where s.line_id = l.id), '')
    else concat_ws(', ', nullif(concat_ws(' ', l.chart_account, (select c.name from public.cb_chart_accounts c where c.number = l.chart_account)), ''), l.tax_code)
  end || case when coalesce(l.memo, '') <> '' then ' · Memo: ' || l.memo else '' end
  from public.cb_bank_lines l where l.id = p_line;
$function$;
revoke all on function private.cb_line_coding(uuid) from public, anon, authenticated;

create or replace function public.cb_change_line(p_file uuid, p_line uuid, p_change jsonb)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  l public.cb_bank_lines;
  v_old text; v_new text; r jsonb; i int := 0; v_sum numeric := 0; v_acc text; v_tax text;
  v_memo text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(jsonb_typeof(p_change) = 'object', 'Nothing to change.');
  select * into l from public.cb_bank_lines where id = p_line and file_id = p_file for update;
  perform private.require(l.id is not null, 'Line not found.');
  perform private.require(l.status in ('done', 'reviewer', 'matched') and not private.cb_line_pending(l), 'Only a coded line changes here.');
  v_old := private.cb_line_coding(l.id);
  perform private.cb_one_action(true);
  if p_change ? 'memo' then
    v_memo := btrim(regexp_replace(regexp_replace(coalesce(p_change ->> 'memo', ''), E'\r\n?', E'\n', 'g'), '[ \t]+', ' ', 'g'));
    perform private.require(length(v_memo) <= 2000, 'Keep the internal note under 2,000 characters.');
    update public.cb_bank_lines set memo = v_memo where id = l.id;
  end if;
  if p_change ? 'account' or p_change ? 'splits' then
    -- Out of a transfer (its other line goes back to To code) and off an outstanding item (the item is open again).
    delete from public.cb_bank_transfers where out_line = l.id or in_line = l.id;
    update public.cb_bank_outstanding set cleared_line = null where cleared_line = l.id;
    perform set_config('cb.transfer', 'on', true);
    if p_change ? 'splits' then
      perform private.require(jsonb_typeof(p_change -> 'splits') = 'array' and jsonb_array_length(p_change -> 'splits') between 2 and 30, 'A split has two lines or more.');
      delete from public.cb_line_splits where line_id = l.id;
      for r in select * from jsonb_array_elements(p_change -> 'splits') loop
        i := i + 1;
        perform private.require(exists (select 1 from public.cb_chart_accounts where number = r ->> 'account'), format('Line %s: choose an account.', i));
        perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = r ->> 'tax'), format('Line %s: choose a sales tax code.', i));
        perform private.require(coalesce((r ->> 'amount')::numeric, 0) <> 0, format('Line %s: enter an amount.', i));
        insert into public.cb_line_splits (file_id, line_id, row_no, chart_account, tax_code, amount, memo)
        values (l.file_id, l.id, i, r ->> 'account', r ->> 'tax', round((r ->> 'amount')::numeric, 2), left(btrim(coalesce(r ->> 'memo', '')), 300));
        v_sum := v_sum + round((r ->> 'amount')::numeric, 2);
      end loop;
      -- Kept as "unbalanced entry": the split adds up to the bank line.
      perform private.require(v_sum = abs(l.amount), format('Left to split: %s. Nothing was saved.', private.cb_money(abs(l.amount) - v_sum)));
      update public.cb_bank_lines set is_split = true, chart_account = null, tax_code = null, status = 'done', source = 'manual', rule_id = null,
        transfer_account = null, coded_by = (select auth.uid()), coded_at = now() where id = l.id;
    else
      v_acc := p_change ->> 'account'; v_tax := coalesce(nullif(p_change ->> 'tax', ''), l.tax_code);
      perform private.require(exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account.');
      perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code.');
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_acc, tax_code = v_tax, is_split = false, status = 'done', source = 'manual', rule_id = null,
        transfer_account = null, coded_by = (select auth.uid()), coded_at = now() where id = l.id;
    end if;
    perform set_config('cb.transfer', '', true);
  elsif p_change ? 'tax' then
    v_tax := nullif(p_change ->> 'tax', '');
    perform private.require(not l.is_split and l.transfer_account is null, 'A split or a transfer changes its sales tax line by line: send the split.');
    perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code.');
    update public.cb_bank_lines set tax_code = v_tax, source = 'manual', rule_id = null where id = l.id;
  end if;
  v_new := private.cb_line_coding(l.id);
  perform private.cb_one_action(false);
  if v_new is distinct from v_old then
    perform private.cb_log_event(p_file, 'line_changed', 'code', 'Line changed', l.statement_id, l.id, private.cb_line_label(l), '', v_old, v_new);
  end if;
  perform private.cb_one_action(true);   -- nothing else writes for this action
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$;
revoke all on function public.cb_change_line(uuid, uuid, jsonb) from public, anon;
grant execute on function public.cb_change_line(uuid, uuid, jsonb) to authenticated;

-- Item 8: History is visible to everyone who can open the file (Closebook at View or more), not only the Review right.
drop policy if exists "Owners read file history" on public.cb_file_history;
drop policy if exists "Closebook viewers read file history" on public.cb_file_history;
create policy "Closebook viewers read file history" on public.cb_file_history for select to authenticated
  using ((select private.can_view('closebook')));

-- Item 8: a schedule save is one History row (what changed inside it); a reclassify is one row per line, no summary.
CREATE OR REPLACE FUNCTION public.cb_save_schedule_entry(p_file uuid, p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date, p_attachments text[], p_seq integer, p_schedule jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_notes text[] := '{}';
  v_old text[] := '{}';
  v_new text[] := '{}';
  v_created boolean := p_entry is null;
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
    perform private.require(p_schedule ->> 'kind' in ('vehicle', 'home_office', 'expenses'), 'Unknown schedule.');
    -- One schedule per entry: putting it in again keeps its kind.
    perform private.require(v_s.id is null or v_s.kind = p_schedule ->> 'kind', 'This entry holds another schedule.');
    perform private.require(private.cb_schedule_amounts_of(p_lines) = private.cb_schedule_amounts_of(p_schedule -> 'lines'),
      'Change this amount in its schedule: click the Schedule tag.');
    -- "Claim the ITC": ticked unless the reviewer or someone with the Review right unticks it.
    v_itc := coalesce((p_schedule ->> 'itc')::boolean, true);
    perform set_config('cb.schedule_save', 'on', true);
  end if;
  v_kind := coalesce(p_schedule ->> 'kind', v_s.kind, 'vehicle');
  v_name := private.cb_schedule_name(v_kind);
  perform private.cb_one_action(true);   -- CB2-0 v7 item 8: one History row for the save, written at the end
  if p_entry is null then
    v_id := public.cb_add_entry(p_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, null, p_attachments, p_seq);
    update public.cb_entries set origin = 'schedule' where id = v_id;
    insert into public.cb_schedules (file_id, entry_id, kind, method, choice, itc_claim, inputs, snapshot, result, created_by)
    values (p_file, v_id, v_kind, coalesce(p_schedule ->> 'method', 'prorated'), coalesce(p_schedule ->> 'choice', 'higher'), v_itc, coalesce(p_schedule -> 'inputs', '{}'),
            coalesce(p_schedule -> 'snapshot', '{}'), coalesce(p_schedule -> 'result', '{}'), (select auth.uid()));
    v_label := private.cb_entry_label(v_id);
    if not v_itc then v_notes := v_notes || 'Claim the ITC unticked'::text; end if;
  else
    v_id := public.cb_edit_entry(p_entry, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, null, p_attachments, p_seq);
    v_label := private.cb_entry_label(v_id);
    if p_schedule is not null then
      for c in select * from jsonb_array_elements(coalesce(p_schedule -> 'changes', '[]'::jsonb)) loop
        v_notes := v_notes || lower(c ->> 'what'); v_old := v_old || format('%s: %s', c ->> 'what', c ->> 'old'); v_new := v_new || format('%s: %s', c ->> 'what', c ->> 'new');
      end loop;
      if v_itc <> coalesce(v_s.itc_claim, true) then
        v_notes := v_notes || format('Claim the ITC %s', case when v_itc then 'ticked' else 'unticked' end);
        v_old := v_old || format('Claim the ITC: %s', case when v_itc then 'Unticked' else 'Ticked' end); v_new := v_new || format('Claim the ITC: %s', case when v_itc then 'Ticked' else 'Unticked' end);
      end if;
      update public.cb_schedules set method = coalesce(p_schedule ->> 'method', 'prorated'), choice = coalesce(p_schedule ->> 'choice', 'higher'), itc_claim = v_itc,
          inputs = coalesce(p_schedule -> 'inputs', '{}'), snapshot = coalesce(p_schedule -> 'snapshot', '{}'), result = coalesce(p_schedule -> 'result', '{}'),
          updated_by = (select auth.uid()), updated_at = now()
       where entry_id = v_id;
    end if;
  end if;
  if p_schedule is not null then
    perform set_config('cb.schedule_save', '', true);
  end if;
  perform private.cb_one_action(false);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, reason, old_value, new_value)
  values (p_file, (select auth.uid()), case when v_created then 'schedule_created' else 'schedule_saved' end, 'entries',
    left(format('%s %s entry %s%s', v_name, case when v_created then 'created for' else 'saved for' end, v_label,
      case when cardinality(v_notes) > 0 then ': ' || array_to_string(v_notes, ', ') else '' end), 500), v_id, v_label, '',
    left(array_to_string(v_old, E'\n'), 300), left(coalesce(nullif(array_to_string(v_new, E'\n'), ''), p_schedule ->> 'summary', ''), 300));
  perform private.cb_one_action(true);   -- the entry's own audit row is part of this save
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_reclassify(p_file uuid, p_items jsonb, p_account text, p_tax text, p_total numeric DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  v_bankfile boolean := v_file.books in ('statements', 'paper');
  v_acc text := nullif(btrim(coalesce(p_account, '')), '');
  v_tax text := nullif(btrim(coalesce(p_tax, '')), '');
  v_chart public.cb_chart_accounts;
  v_target uuid; v_label text := ''; v_batch uuid; it jsonb;
  l public.cb_bank_lines; el public.cb_entry_lines; e public.cb_entries;
  v_new_acc text; v_new_tax text; v_bn int := 0; v_en int := 0; v_from text[] := '{}';
begin
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Tick the lines to reclassify.');
  perform private.require(v_acc is not null or v_tax is not null, 'Choose an account, a sales tax code, or both.');
  if v_acc is not null then
    if v_bankfile then
      select * into v_chart from public.cb_chart_accounts where number = v_acc;
      perform private.require(v_chart.number is not null, 'Choose an account from the chart.');
      perform private.require(not private.cb_bank_chart(p_file, v_acc), 'Bank, card and loan accounts change in step 3 and step 4, not here.');
      v_label := v_chart.number || ' ' || v_chart.name;
    else
      perform private.require(v_acc ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.cb_accounts where id = v_acc::uuid and file_id = p_file and line_no is not null),
        'Choose one of this file''s accounts.');
      v_target := v_acc::uuid; v_label := private.cb_account_label(v_target);
    end if;
  end if;
  perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code from the list.');
  insert into public.cb_reclass_batches (file_id, created_by, target, target_label, tax, total)
  values (p_file, (select auth.uid()), coalesce(v_acc, ''), v_label, v_tax, coalesce(p_total, 0)) returning id into v_batch;

  for it in select * from jsonb_array_elements(p_items) loop
    if it ->> 'kind' = 'bank' then
      perform private.require(v_bankfile, 'Line not found.');
      select * into l from public.cb_bank_lines where id = (it ->> 'id')::uuid and file_id = p_file for update;
      perform private.require(l.id is not null, 'Line not found. Nothing was changed.');
      perform private.require(l.status in ('done', 'reviewer') and not private.cb_line_pending(l), format('%s: only a posted line changes here. Post it in step 4 first. Nothing was changed.', left(l.description, 40)));
      perform private.require(l.transfer_account is null and coalesce(l.source, '') not in ('transfer', 'outstanding')
        and not exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id), format('%s is a transfer: change it in step 4. Nothing was changed.', left(l.description, 40)));
      perform private.require(not l.is_split, format('%s is split: change it with Split. Nothing was changed.', left(l.description, 40)));
      perform private.require(l.chart_account is not null, 'Line not found. Nothing was changed.');
      v_new_acc := coalesce(v_acc, l.chart_account); v_new_tax := coalesce(v_tax, l.tax_code);
      if v_new_acc is distinct from l.chart_account or v_new_tax is distinct from l.tax_code then
        insert into public.cb_reclass_items (batch_id, kind, item_id, old_account, old_tax, old_source, old_rule, new_account, new_tax)
        values (v_batch, 'bank', l.id, l.chart_account, l.tax_code, l.source, l.rule_id, v_new_acc, v_new_tax);
        v_from := array_append(v_from, l.chart_account);
        -- The line's own trigger logs "Coding changed" (old and new), and cb_changed removes step 4's sign-off.
        update public.cb_bank_lines set chart_account = v_new_acc, tax_code = v_new_tax, source = 'manual', rule_id = null where id = l.id;
        v_bn := v_bn + 1;
      end if;
    elsif it ->> 'kind' = 'entry' then
      select * into el from public.cb_entry_lines where id = (it ->> 'id')::uuid for update;
      select * into e from public.cb_entries where id = el.entry_id;
      perform private.require(e.id is not null and e.file_id = p_file, 'Entry line not found. Nothing was changed.');
      perform private.require(not coalesce(el.is_tax, false), format('Entry %s: a sales tax line follows its entry. Change the entry in step 5. Nothing was changed.', private.cb_entry_label(e.id)));
      perform private.require(coalesce(e.origin, '') = '', format('Entry %s comes from a working paper: change it there. Nothing was changed.', private.cb_entry_label(e.id)));
      if v_acc is null then continue; end if;   -- an entry line keeps its sales tax (its tax line is worked out in step 5)
      if v_bankfile and v_target is null then
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id into v_target from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
      end if;
      if v_target is distinct from el.account_id then
        insert into public.cb_reclass_items (batch_id, kind, item_id, old_account, old_tax, new_account, new_tax)
        values (v_batch, 'entry', el.id, el.account_id::text, el.tax_code, v_target::text, el.tax_code);
        v_from := array_append(v_from, coalesce(private.cb_account_label(el.account_id), ''));
        perform private.cb_log_event(p_file, 'entry_line_reclassified', 'entries', format('Entry %s line reclassified', private.cb_entry_label(e.id)), null, null,
          private.cb_entry_label(e.id), coalesce(nullif(el.memo, ''), ''), coalesce(private.cb_account_label(el.account_id), ''), v_label);
        update public.cb_entry_lines set account_id = v_target where id = el.id;   -- cb_changed removes step 5's sign-off
        v_en := v_en + 1;
      end if;
    else
      raise exception 'Line not found. Nothing was changed.' using errcode = 'P0001';
    end if;
  end loop;
  perform private.require(v_bn + v_en > 0, 'Nothing to change: the ticked lines already have this account and sales tax.');
  update public.cb_reclass_batches set n = v_bn + v_en where id = v_batch;
  -- CB2-0 v7 item 8: one History row per line reclassified (as bulk coding); no summary row, no extra entry row.
  perform private.cb_one_action(true);
  return v_batch;
end;
$function$;
