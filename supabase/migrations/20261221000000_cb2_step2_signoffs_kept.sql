-- CloseBook2 piece CB2-0, step 2 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md rules 13 and 14). QuickBooks Online's audit
-- history: record everything, show nothing unless the accountant goes looking.
-- - A sign-off is a person's act. No change ever clears, stamps or reopens it. (Taking back your own sign-off stays.)
-- - History records every change to the file, signed step or not: one row per action the person took, with what, who,
--   when and the step it belongs to. An entry added with its lines is one row, the lines inside; an edit is one row with
--   the old and new values inside; a delete is one row with what was deleted.
-- - The MAL is never withdrawn by a change.
-- No sign-off on Live is removed. No column is dropped.

alter table public.cb_file_history add column if not exists entry_id uuid;
create index if not exists cb_file_history_entry on public.cb_file_history (entry_id, at) where entry_id is not null;

-- Safety net for "every change is in History": a change that writes no row of its own (a trigger saw the data move, the
-- action logged nothing) gets one row at commit. A change that logged its own row gets nothing more, so one action is
-- one row. The queue holds one line per file and step per transaction.
create table if not exists private.cb_change_queue (
  id bigint generated always as identity primary key,
  file_id uuid not null, step text not null, why text not null default '', actor_id uuid, txid bigint not null default txid_current(),
  unique (txid, file_id, step)
);
create or replace function private.cb_change_flush()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
begin
  -- Rows of this file already written in this transaction (the action's own row) are the record.
  if not exists (select 1 from public.cb_file_history where file_id = new.file_id and at = now())
     and exists (select 1 from public.cb_files where id = new.file_id) then
    insert into public.cb_file_history (file_id, actor_id, action, step, detail) values (new.file_id, new.actor_id, 'changed', new.step, left(coalesce(nullif(new.why, ''), 'Changed'), 500));
  end if;
  delete from private.cb_change_queue where id = new.id;
  return null;
end;
$function$;
drop trigger if exists cb_change_flush on private.cb_change_queue;
create constraint trigger cb_change_flush after insert on private.cb_change_queue deferrable initially deferred for each row execute function private.cb_change_flush();
revoke all on table private.cb_change_queue from public, anon, authenticated;
revoke all on function private.cb_change_flush() from public, anon, authenticated;


-- The one place that removed sign-offs on a change: it now only makes sure the change is in History.
CREATE OR REPLACE FUNCTION private.cb_clear_step(p_file uuid, p_step text, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.cb_files where id = p_file) then return; end if;
  -- An entry's own changes are recorded by the entry (cb_entry_audit, cb_edit_entry, cb_delete_entry).
  if coalesce(p_why, '') ~ '^Entry \d{4}-\d{3}' then return; end if;
  insert into private.cb_change_queue (file_id, step, why, actor_id) values (p_file, p_step, coalesce(p_why, ''), (select auth.uid()))
  on conflict (txid, file_id, step) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_clear_substeps(p_file uuid, p_subs text[], p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_why text := btrim(coalesce(p_why, ''));
begin
  perform private.cb_clear_step(p_file, 'records', format('%s: %s', private.cb_substep_label(p_subs), v_why));
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_substep_guard(p_file uuid, p_subs text[], p_confirm boolean, p_what text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- No question and no removal: the change goes ahead; History records it.
  perform private.cb_clear_substeps(p_file, p_subs, p_what);
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_records_follow(p_file uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_prep int; v_rev int; v_pby uuid; v_pat timestamptz; v_rby uuid; v_rat timestamptz;
begin
  select count(*) filter (where prepared_at is not null), count(*) filter (where reviewed_at is not null) into v_prep, v_rev
    from public.cb_substep_signoffs where file_id = p_file;
  select prepared_by, prepared_at into v_pby, v_pat from public.cb_substep_signoffs where file_id = p_file and prepared_at is not null order by prepared_at desc limit 1;
  select reviewed_by, reviewed_at into v_rby, v_rat from public.cb_substep_signoffs where file_id = p_file and reviewed_at is not null order by reviewed_at desc limit 1;
  if v_prep = 3 then
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at, reviewed_by, reviewed_at)
    values (p_file, 'records', v_pby, v_pat, case when v_rev = 3 then v_rby end, case when v_rev = 3 then v_rat end)
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at,
      reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
  elsif exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'records') then
    -- Only a person taking back their own sub-step sign-off gets here: step 3 is no longer fully prepared.
    delete from public.cb_step_signoffs where file_id = p_file and step = 'records';
    perform private.cb_log(p_file, 'signoff_removed', 'records', 'A Banking sub-step sign-off was taken back');
  end if;
end;
$function$;

-- A master account change on step 4 is one History row; the step 4 sign-off stays.
CREATE OR REPLACE FUNCTION private.cb_assign_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.line_no is distinct from old.line_no then return null; end if;
  -- Step 4 only: nothing that rests on it moves (cb_clear_step would also clear steps 6 to 8).
  if true then
    perform private.cb_log(new.file_id, 'mapping_changed', 'code', format('%s: master account %s to %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')));
  end if;
  return null;
end;
$function$;

-- Step 2 keeps its sign-off when it is saved again.
CREATE OR REPLACE FUNCTION public.cb_save_opening(p_file uuid, p_codes jsonb, p_re_stated numeric, p_ni_typed numeric, p_note text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_code text;
  v_acc text;
  v_bank uuid;
  v_on text[];
  v_n int := 0;
  v_before jsonb; v_after jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) <= 1000, 'Lines are missing.');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    v_code := v_row ->> 'code';
    perform private.require(v_code ~ '^\d{4}$' and private.cb_gifi_type(v_code) is not null, format('GIFI %s is not a code Closebook can use.', v_code));
    perform private.require(v_code not in ('2599', '3499', '3600', '3620', '3640', '3680', '3849', '8299', '9368', '9999'), format('%s is a total: it calculates by itself.', v_code));
    v_acc := nullif(v_row ->> 'account', ''); v_bank := null;
    if v_acc like 'bank:%' then
      -- One of the file's bank or card accounts, on this GIFI line or one of its detail lines.
      select b.id into v_bank from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
       where b.id = substr(v_acc, 6)::uuid and b.file_id = p_file and left(c.line_no, 4) = any(private.cb_gifi_family(v_code));
      perform private.require(v_bank is not null, format('That bank account is not on GIFI line %s.', v_code));
      v_acc := null;
    end if;
    perform private.require(v_acc is null or v_acc = any(private.cb_chart_on_code(v_code)), format('Account %s is not on GIFI line %s.', v_acc, v_code));
    -- A Schedule 100 line with one standard account, and no bank account of the file on it, takes it.
    if v_acc is null and v_bank is null and private.cb_gifi_type(v_code) not in ('Revenue', 'Expense') then
      v_on := private.cb_chart_on_code(v_code);
      if cardinality(v_on) = 1 and not exists (select 1 from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
                                                 where b.file_id = p_file and left(c.line_no, 4) = any(private.cb_gifi_family(v_code))) then
        v_acc := v_on[1];
      end if;
    end if;
    -- As printed on the T2; dividends (3700 to 3719) always negative (rule 3).
    insert into public.cb_opening_balances (file_id, code, amount, chart_account, bank_account)
    values (p_file, v_code, case when v_code::int between 3700 and 3719 then -abs(round((v_row ->> 'amount')::numeric, 2)) else round((v_row ->> 'amount')::numeric, 2) end, v_acc, v_bank)
    on conflict (file_id, code) do update set amount = public.cb_opening_balances.amount + excluded.amount;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = coalesce(opening_source, 'manual'), opening_re_stated = p_re_stated, opening_ni_typed = p_ni_typed,
         opening_note = left(coalesce(btrim(p_note), ''), 300), opening_set_by = (select auth.uid()), opening_set_at = now(),
         updated_at = now()
   where id = p_file;
  -- One place for last year's Schedule 125 (item 8): the tab's lines feed the statements' prior-year column.
  select coalesce(jsonb_agg(jsonb_build_array(code, amount) order by code), '[]'::jsonb) into v_before from public.cb_opening_s125 where file_id = p_file;
  delete from public.cb_opening_s125 where file_id = p_file;
  insert into public.cb_opening_s125 (file_id, code, amount)
  select p_file, code, amount from public.cb_opening_balances where file_id = p_file and amount <> 0 and private.cb_gifi_type(code) in ('Revenue', 'Expense');
  select coalesce(jsonb_agg(jsonb_build_array(code, amount) order by code), '[]'::jsonb) into v_after from public.cb_opening_s125 where file_id = p_file;
  if v_before <> v_after then perform private.cb_clear_step(p_file, 'statements', 'Last year''s Schedule 125 changed'); end if;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_first_year(p_file uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  if p_on then
    perform private.require(not exists (select 1 from public.cb_accounts where file_id = p_file and last_year <> 0),
      'This file has last year''s amounts: it is not a first year.');
    perform private.require(not exists (select 1 from public.cb_files where client_id = v_file.client_id and year_end < v_file.year_end),
      'There is an earlier Closebook file for this client: it is not a first year.');
    delete from public.cb_opening_balances where file_id = p_file;
    delete from public.cb_opening_s125 where file_id = p_file;
    update public.cb_files set first_year = true, opening_source = null, opening_re_stated = null, opening_ni_typed = null,
      updated_at = now() where id = p_file;
  else
    update public.cb_files set first_year = false, updated_at = now() where id = p_file;
  end if;
  insert into public.cb_file_fs (file_id, first_year, updated_by) values (p_file, p_on, (select auth.uid()))
  on conflict (file_id) do update set first_year = excluded.first_year, updated_by = excluded.updated_by, updated_at = now();
  perform private.cb_log(p_file, case when p_on then 'first_year_on' else 'first_year_off' end, 'opening',
    case when p_on then 'First year: no opening balances' else 'Not a first year: enter the opening balances' end);
  perform private.cb_clear_step(p_file, 'opening', case when p_on then 'First year chosen' else 'First year taken back' end);
end;
$function$;

-- Taking back your own reviewer sign-off on a step leaves step 7 as signed.
CREATE OR REPLACE FUNCTION public.cb_unsign_step(p_file uuid, p_step text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  r public.cb_step_signoffs;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'reviewed' then
    perform private.require(r.reviewed_at is not null and (r.reviewed_by = (select auth.uid()) or private.cb_can('remove_signoffs')), 'There is no reviewer sign-off of yours to take back.');
    if p_step = 'review' then delete from public.cb_step_signoffs where file_id = p_file and step = 'review';
    else update public.cb_step_signoffs set reviewed_by = null, reviewed_at = null where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'unsigned_reviewed', p_step, case when r.reviewed_by = (select auth.uid()) then ''
      else format('Removed the reviewer sign-off of %s', coalesce((select full_name from public.staff where id = r.reviewed_by), 'someone else')) end);
  else
    perform private.require(r.prepared_at is not null and (r.prepared_by = (select auth.uid()) or private.cb_can('remove_signoffs')), 'There is no preparer sign-off of yours to take back.');
    perform private.require(r.reviewed_at is null, 'The step is reviewed: the reviewer takes back their sign-off first.');
    delete from public.cb_step_signoffs where file_id = p_file and step = p_step;
    if p_step = 'opening' then update public.cb_files set opening_signed_by = null, opening_signed_at = null where id = p_file; end if;
    perform private.cb_log(p_file, 'unsigned_prepared', p_step, case when r.prepared_by = (select auth.uid()) then ''
      else format('Removed the preparer sign-off of %s', coalesce((select full_name from public.staff where id = r.prepared_by), 'someone else')) end);
  end if;
end;
$function$;

-- An entry as it stands, in one line: number, type, date, description and every line (debits positive, tax code).
create or replace function private.cb_entry_snapshot(p_entry uuid)
 returns text language sql stable security definer set search_path to ''
as $function$
  select format('%s-%s %s, %s%s: %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), e.kind, to_char(coalesce(e.entry_date, f.year_end), 'Mon FMDD, YYYY'),
    case when e.note <> '' then ', ' || e.note else '' end,
    coalesce((select string_agg(format('%s %s %s%s%s', case when l.amount >= 0 then 'Dr' else 'Cr' end, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name),
        to_char(abs(l.amount), 'FM999,999,999,990.00'), case when l.is_tax then ' (sales tax)' when coalesce(l.tax_code, '') <> '' then ' ' || l.tax_code else '' end,
        case when l.memo <> '' then ' (' || l.memo || ')' else '' end), '; ' order by l.amount desc, a.number)
      from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = e.id), 'no lines'))
  from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = p_entry;
$function$;
revoke all on function private.cb_entry_snapshot(uuid) from public, anon, authenticated;

-- An entry added, or changed some other way than "Edit" (a schedule saved again), is one History row at commit, with the
-- entry before and after. The entry keeps its last snapshot. A save that already wrote its own row for the entry, or that
-- changes nothing the snapshot shows (booked mark, looked at), writes nothing.
alter table public.cb_entries add column if not exists audit_snapshot text;
create or replace function private.cb_entry_audit()
 returns trigger language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_e public.cb_entries; v_now text; v_no text;
begin
  if tg_table_name = 'cb_entries' then v_id := coalesce(new.id, old.id);
  elsif tg_op = 'DELETE' then v_id := old.entry_id;
  else v_id := new.entry_id; end if;
  select * into v_e from public.cb_entries where id = v_id;
  if v_e.id is null then return null; end if;
  v_now := private.cb_entry_snapshot(v_id);
  if v_e.audit_snapshot is not distinct from v_now then return null; end if;
  update public.cb_entries set audit_snapshot = v_now where id = v_id;
  if exists (select 1 from public.cb_file_history where entry_id = v_id and at = now()) then return null; end if;
  v_no := split_part(v_now, ' ', 1);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, old_value, new_value)
  values (v_e.file_id, (select auth.uid()), case when v_e.created_at = now() then 'entry_created' else 'entry_changed' end, 'entries',
          format('Entry %s %s', v_no, case when v_e.created_at = now() then 'added' else 'changed' end), v_id, v_no, coalesce(v_e.audit_snapshot, ''), v_now);
  return null;
end;
$function$;
revoke all on function private.cb_entry_audit() from public, anon, authenticated;
drop trigger if exists cb_entry_audit on public.cb_entries;
create constraint trigger cb_entry_audit after insert or update on public.cb_entries deferrable initially deferred for each row execute function private.cb_entry_audit();
drop trigger if exists cb_entry_audit on public.cb_entry_lines;
create constraint trigger cb_entry_audit after insert or update or delete on public.cb_entry_lines deferrable initially deferred for each row execute function private.cb_entry_audit();


-- An edit is one History row, with the entry's old and new values inside.
CREATE OR REPLACE FUNCTION public.cb_edit_entry(p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date DEFAULT NULL::date, p_standard uuid DEFAULT NULL::uuid, p_attachments text[] DEFAULT '{}'::text[], p_seq integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_what text; v_was text; v_now text;
  v_e public.cb_entries;
  v_file public.cb_files;
  v_new public.cb_entries;
  v_label text;
  v_old_lines text;
  v_new_lines text;
  v_old_all text; v_new_all text;   -- piece 10b
  v_seq int;
  r record;
begin
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require(coalesce(v_e.origin, '') <> 'expenses_personal', 'Change this entry on the Expenses paid personally paper.');
  -- Piece 3: an amount from a schedule changes only in its schedule (the account may change).
  perform private.require(coalesce(v_e.origin, '') <> 'schedule' or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
    or private.cb_schedule_amounts(p_entry) = private.cb_schedule_amounts_of(p_lines), 'Change this amount in its schedule: click the Schedule tag.');
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  -- Piece E1: no entry approval; an entry changes until the file is locked (booked entries: the booked guard).
  perform private.require(v_e.booked_at is null, 'This entry is booked in QuickBooks. Unmark it first to change it.');
  select * into v_file from public.cb_files where id = v_e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked. Reopen it to change entries.');
  perform private.cb_entry_head_check(v_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_attachments);
  v_seq := coalesce(p_seq, v_e.seq);
  perform private.require(v_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = v_e.file_id and seq = v_seq and id <> p_entry),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(v_seq::text, 3, '0')));
  v_label := private.cb_entry_label(p_entry);
  v_old_lines := private.cb_entry_lines_text(p_entry);

  -- The header, in place. The per-type number changes only when the type does (it is unique per type).
  update public.cb_entries set kind = p_kind, reason = p_reason, note = btrim(p_note), reverse_next_year = coalesce(p_reverse, false),
      wp_ref = btrim(p_wp_ref), entry_date = coalesce(p_date, v_file.year_end), attachments = coalesce(p_attachments, '{}'), seq = v_seq,
      number = case when p_kind = v_e.kind then v_e.number else coalesce((select max(number) from public.cb_entries where file_id = v_e.file_id and kind = p_kind), 0) + 1 end,
      needs_review = true, reviewed_by = null, reviewed_at = null
   where id = p_entry
  returning * into v_new;
  -- The lines, written again by the same rules as a new entry.
  -- Piece 10b: the lines' own triggers leave step 6 alone here; step 6 reopens below only when the lines differ
  -- (every line, sales tax lines included: account and amount).
  select coalesce(string_agg(l.account_id::text || ':' || l.amount::text, ',' order by l.account_id, l.amount), '') into v_old_all
    from public.cb_entry_lines l where l.entry_id = p_entry;
  perform set_config('cb.lines_rewrite', 'on', true);
  delete from public.cb_entry_lines where entry_id = p_entry;
  perform private.cb_entry_write_lines(p_entry, v_file, p_kind, p_reason, p_reverse, p_lines);
  perform set_config('cb.lines_rewrite', '', true);
  v_new_lines := private.cb_entry_lines_text(p_entry);
  -- A TJE that stays a TJE clears step 8 only (piece 6); a change of type reopens step 6 through cb_changed.
  select coalesce(string_agg(l.account_id::text || ':' || l.amount::text, ',' order by l.account_id, l.amount), '') into v_new_all
    from public.cb_entry_lines l where l.entry_id = p_entry;
  if v_new_all is distinct from v_old_all and not (v_e.kind = 'TJE' and p_kind = 'TJE') then
    perform private.cb_clear_step(v_e.file_id, 'compare', format('Entry %s changed: lines', private.cb_entry_label(p_entry)));
  end if;

  -- History (CB2-0 step 2): one row for the edit, naming what changed, with the old and new values inside.
  select string_agg(lower(what), ', ' order by n), string_agg(what || ': ' || coalesce(was, ''), E'\n' order by n), string_agg(what || ': ' || coalesce(now, ''), E'\n' order by n)
    into v_what, v_was, v_now from (values
      (1, 'Number', v_new.seq = v_e.seq, v_label, private.cb_entry_label(p_entry)),
      (2, 'Type', p_kind = v_e.kind, v_e.kind, p_kind),
      (3, 'Date', v_new.entry_date = v_e.entry_date, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), to_char(v_new.entry_date, 'Mon FMDD, YYYY')),
      (4, 'Description', v_new.note = v_e.note, v_e.note, v_new.note),
      (5, 'W/P ref', v_new.wp_ref = v_e.wp_ref, v_e.wp_ref, v_new.wp_ref),
      (6, 'Reverses next year', v_new.reverse_next_year = v_e.reverse_next_year, case when v_e.reverse_next_year then 'Yes' else 'No' end, case when v_new.reverse_next_year then 'Yes' else 'No' end),
      (7, 'Attachments', v_new.attachments = v_e.attachments,
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_e.attachments) x), ', '), ''), 'None'),
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_new.attachments) x), ', '), ''), 'None')),
      (8, 'Lines', v_new_lines = v_old_lines, v_old_lines, v_new_lines)) as x(n, what, same, was, now)
    where not same;
  if v_what is not null then
    insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, reason, old_value, new_value)
    values (v_e.file_id, (select auth.uid()), 'entry_edited', 'entries', left(format('Entry %s changed: %s', private.cb_entry_label(p_entry), v_what), 500), p_entry,
            left(private.cb_entry_label(p_entry), 300), left(v_what, 300), v_was, v_now);
  end if;
  update public.cb_files set updated_at = now() where id = v_e.file_id;
  return p_entry;
end;
$function$;

-- A delete is one History row, with the whole entry inside.
CREATE OR REPLACE FUNCTION public.cb_delete_entry(p_entry uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_e public.cb_entries; v_label text; r record;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  -- Piece E1: hold the file as an edit does, so a delete cannot slip past a lock made at the same moment.
  perform 1 from public.cb_files where id = v_e.file_id for update;
  perform private.require((select phase from public.cb_files where id = v_e.file_id) <> 'locked', 'This file is locked. Reopen it to delete entries.');
  perform private.require(v_e.booked_at is null, 'This entry is booked in QuickBooks. Unmark it first to delete it.');
  -- History (CB2-0 step 2): one row for the delete, with the whole entry inside (every line, sales tax lines included).
  v_label := private.cb_entry_label(p_entry);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, reason, old_value, new_value)
  values (v_e.file_id, (select auth.uid()), 'entry_deleted', 'entries',
          left(format('Entry %s deleted (%s, %s): %s', v_label, v_e.kind, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), v_e.note), 500), p_entry, left(v_label, 300), 'Entry',
          format('W/P ref %s; %s', coalesce(nullif(v_e.wp_ref, ''), 'none'), private.cb_entry_snapshot(p_entry)), '');
  delete from public.cb_entries where id = p_entry;
end;
$function$;

-- Review fixes (test round, Nov 21, 2026). An edit that changes only the sales tax lines is an "entry_edited" change:
-- the lines text now includes them. The audit row is skipped when the action already wrote its own row for the file in
-- this transaction (an OBE entry, a reclassify), so one action is one row.
create or replace function private.cb_entry_lines_text(p_entry uuid)
 returns text language sql stable security definer set search_path to ''
as $function$
  select coalesce(string_agg(trim(concat_ws(' ', nullif(a.number, ''), a.name, case when l.amount > 0 then 'Dr' else 'Cr' end,
           to_char(abs(l.amount), 'FM999,999,999,990.00'), case when l.is_tax then '(sales tax)' else nullif(l.tax_code, '') end)), ' · '
           order by l.is_tax, l.amount < 0, a.number, l.id), '')
    from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id
   where l.entry_id = p_entry;
$function$;

CREATE OR REPLACE FUNCTION private.cb_entry_audit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_e public.cb_entries; v_now text; v_no text;
begin
  if tg_table_name = 'cb_entries' then v_id := coalesce(new.id, old.id);
  elsif tg_op = 'DELETE' then v_id := old.entry_id;
  else v_id := new.entry_id; end if;
  select * into v_e from public.cb_entries where id = v_id;
  if v_e.id is null then return null; end if;
  v_now := private.cb_entry_snapshot(v_id);
  if v_e.audit_snapshot is not distinct from v_now then return null; end if;
  update public.cb_entries set audit_snapshot = v_now where id = v_id;
  if exists (select 1 from public.cb_file_history where (entry_id = v_id or (file_id = v_e.file_id and action not in ('changed', 'entry_created', 'entry_changed'))) and at = now()) then return null; end if;
  v_no := split_part(v_now, ' ', 1);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, old_value, new_value)
  values (v_e.file_id, (select auth.uid()), case when v_e.created_at = now() then 'entry_created' else 'entry_changed' end, 'entries',
          format('Entry %s %s', v_no, case when v_e.created_at = now() then 'added' else 'changed' end), v_id, v_no, coalesce(v_e.audit_snapshot, ''), v_now);
  return null;
end;
$function$;
