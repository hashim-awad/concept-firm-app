-- Piece E1, retire entry approval (Hashim, Nov 20, 2026; benchmark CaseWare Cloud: the Adjustments page is signed off as a
-- whole, and changes after review take the sign-off back instead of locking). Entries change or delete until the file is
-- locked; step 5 Prepared and Reviewed cover them all. cb_review_entry stays and refuses (nothing dropped); the approval
-- columns on cb_entries stay, unused, and keep their old values (D4 A: no Live data change). Decisions: E1-Q1 A with D2 A
-- (Booked after step 5 Reviewed; a TJE after step 8 Reviewed), D3 A (GST/HST answers that change take back step 5),
-- D5 B (the step 5 preparer does not also sign Reviewed while entries wait to be looked at, unless they have Partner
-- sign-off), D6 A (refusal wording). Deleting an entry writes its lines to History; step 5 Reviewed records what it covered.
-- Steps 1 to 4 exception (approved): cb_save_setup and cb_clear_typed_step change their GST/HST reset.
set check_function_bodies = off;

create or replace function public.cb_review_entry(p_entry uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- Piece E1: entry approval was retired; step 5 Prepared and Reviewed cover all entries (CaseWare). Kept so nothing is dropped.
  perform private.require(false, 'Entry approval was retired. Sign step 5 instead.');
end;
$function$
;

create or replace function public.cb_edit_entry(p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date DEFAULT NULL::date, p_standard uuid DEFAULT NULL::uuid, p_attachments text[] DEFAULT '{}'::text[], p_seq integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
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

  -- History: one row per thing that changed, with the old and new value.
  for r in select * from (values
      ('Number', v_new.seq = v_e.seq, v_label, private.cb_entry_label(p_entry)),
      ('Type', p_kind = v_e.kind, v_e.kind, p_kind),
      ('Date', v_new.entry_date = v_e.entry_date, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), to_char(v_new.entry_date, 'Mon FMDD, YYYY')),
      ('Description', v_new.note = v_e.note, v_e.note, v_new.note),
      ('W/P ref', v_new.wp_ref = v_e.wp_ref, v_e.wp_ref, v_new.wp_ref),
      ('Reverses next year', v_new.reverse_next_year = v_e.reverse_next_year, case when v_e.reverse_next_year then 'Yes' else 'No' end, case when v_new.reverse_next_year then 'Yes' else 'No' end),
      ('Attachments', v_new.attachments = v_e.attachments,
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_e.attachments) x), ', '), ''), 'None'),
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_new.attachments) x), ', '), ''), 'None')),
      ('Lines', v_new_lines = v_old_lines, v_old_lines, v_new_lines)) as x(what, same, was, now)
    where not same loop
    perform private.cb_log_event(v_e.file_id, 'entry_edited', 'entries', format('Entry %s changed: %s', private.cb_entry_label(p_entry), lower(r.what)),
      null, null, private.cb_entry_label(p_entry), r.what, r.was, r.now);
  end loop;
  update public.cb_files set updated_at = now() where id = v_e.file_id;
  return p_entry;
end;
$function$
;

create or replace function public.cb_delete_entry(p_entry uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_e public.cb_entries;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require((select phase from public.cb_files where id = v_e.file_id) <> 'locked', 'This file is locked. Reopen it to delete entries.');
  perform private.require(v_e.booked_at is null, 'This entry is booked in QuickBooks. Unmark it first to delete it.');
  -- Piece E1: the trail keeps what was deleted: type, date and every line (account and amount).
  perform private.cb_log_event(v_e.file_id, 'entry_deleted', 'entries',
    format('Entry %s deleted (%s, %s)', private.cb_entry_label(p_entry), v_e.kind, to_char(v_e.entry_date, 'Mon FMDD, YYYY')),
    null, null, private.cb_entry_label(p_entry), 'Lines', private.cb_entry_lines_text(p_entry), '');
  delete from public.cb_entries where id = p_entry;
end;
$function$
;

create or replace function public.cb_mark_booked(p_entry uuid, p_booked boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.cb_entries; v_file public.cb_files; v_step text; v_sign public.cb_step_signoffs; v_by text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into e from public.cb_entries where id = p_entry;
  perform private.require(e.id is not null, 'Entry not found.');
  select * into v_file from public.cb_files where id = e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked. Reopen it to change entries.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Only trial balance files book entries in the client''s books.');
  -- Piece E1: nothing goes to the client before review. AJE and RJE: step 5 Reviewed. TJE: step 8 Reviewed (a TJE added
  -- after review clears step 8 only). The History row names the sign-off it relied on.
  v_step := case when e.kind = 'TJE' then 't2' else 'entries' end;
  select * into v_sign from public.cb_step_signoffs where file_id = e.file_id and step = v_step;
  perform private.require(not p_booked or v_sign.reviewed_at is not null,
    case when v_step = 't2' then 'Sign step 8 Reviewed first: a tax entry is booked after step 8 is reviewed.' else 'Sign step 5 Reviewed first: entries are booked after step 5 is reviewed.' end);
  v_by := coalesce((select full_name from public.staff where id = v_sign.reviewed_by), '');
  perform set_config('cb.booked_mark', 'on', true);
  update public.cb_entries set booked_at = case when p_booked then now() end, booked_by = case when p_booked then (select auth.uid()) end where id = p_entry;
  perform set_config('cb.booked_mark', 'off', true);
  perform private.cb_log_event(e.file_id, 'entry_booked', 'entries', format('%s %s %s', e.kind, e.number, case when p_booked then format('marked Booked in QuickBooks, under step %s Reviewed by %s, %s', case when v_step = 't2' then 8 else 5 end, v_by, to_char(v_sign.reviewed_at, 'Mon FMDD, YYYY')) else 'no longer marked Booked in QuickBooks' end),
    null, null, null, null, null, null, null);
end;
$function$
;

create or replace function private.cb_booked_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_entry uuid; v_booked timestamptz;
begin
  if tg_table_name = 'cb_entries' then
    if coalesce(current_setting('cb.booked_mark', true), '') = 'on' then return case when tg_op = 'DELETE' then old else new end; end if;
    v_booked := old.booked_at;
  else
    v_entry := case when tg_op = 'DELETE' then old.entry_id else new.entry_id end;
    select booked_at into v_booked from public.cb_entries where id = v_entry;
  end if;
  perform private.require(v_booked is null, case when tg_op = 'DELETE' and tg_table_name = 'cb_entries' then 'This entry is booked in QuickBooks. Unmark it first to delete it.' else 'This entry is booked in QuickBooks. Unmark it first to change it.' end);
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$
;

create or replace function private.cb_step_waiting(p_file uuid, p_step text)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
begin
  if p_step = 'opening' then
    if exists (select 1 from public.cb_accounts where file_id = p_file and account_key = 'opening' and needs_reviewer) then
      v_out := v_out || 'A difference with last year''s closing balances.'::text;
    end if;
  elsif p_step = 'code' then
    select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'reviewer';
    if v_n > 0 then v_out := v_out || format('%s line%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'entries' then
    -- Piece E1: entries are no longer approved one by one; step 7 lists them to look at and holds nothing up.
    v_out := v_out || private.cb_step5_waiting(p_file);
  elsif p_step = 'mapping' then
    -- Piece 10: the key retired; the reviewer's GIFI checks wait in step 7 (private.cb_review_problems). Kept for old callers.
    v_out := v_out || private.cb_gifi_review_waiting(p_file);
  end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s to clear.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$
;

create or replace function public.cb_save_setup(p_file uuid, p_setup jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_key text;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(jsonb_typeof(p_setup) = 'object', 'Answers are missing.');
  for v_key in select jsonb_object_keys(p_setup) loop
    perform private.require(v_key in ('realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered', 'gst_frequency', 'quick_method', 'gst_rt', 'gst_year_same', 'quick_method_type'), format('Unknown question %s.', v_key));
  end loop;
  perform private.require(coalesce(p_setup ->> 'gst_frequency', 'annual') in ('annual', 'quarterly', 'monthly'), 'Choose annual, quarterly or monthly.');
  -- Round 13: the GST/HST account (RT0001 by default) and whether the GST/HST year is the fiscal year.
  perform private.require(coalesce(p_setup ->> 'gst_rt', 'RT0001') ~ '^RT[0-9]{4}$', 'The GST/HST account is RT and four digits, for example RT0001.');
  perform private.require(coalesce(jsonb_typeof(p_setup -> 'gst_year_same'), 'boolean') = 'boolean', 'Answer Yes or No.');
  -- Round 20: the quick method rate that applies, services (most real estate businesses) or goods for resale.
  perform private.require(coalesce(p_setup ->> 'quick_method_type', 'services') in ('services', 'goods'), 'Choose Services or Goods for resale.');
  v_new := coalesce(v_file.setup, '{}'::jsonb) || p_setup;
  update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
  -- Before November 17 an unanswered file was coded as a registrant on the regular method; compare with that.
  if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from coalesce((v_new ->> 'gst_registered')::boolean, true)
     or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from coalesce((v_new ->> 'quick_method')::boolean, false)
     -- Round 20: the quick method rate changed on a quick method file (services when not answered).
     or (coalesce((v_new ->> 'quick_method')::boolean, false)
         and coalesce(v_file.setup ->> 'quick_method_type', 'services') is distinct from coalesce(v_new ->> 'quick_method_type', 'services')) then
    update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
     where l.file_id = p_file and l.status = 'done'
       and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
    update public.cb_entries e set needs_review = true
     where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
    -- Piece E1: entries with sales tax are worked out under the old answers: step 5 is signed again.
    if found then perform private.cb_clear_step(p_file, 'entries', 'The GST/HST answers changed: entries with sales tax to check'); end if;
  end if;
end;
$function$
;

create or replace function public.cb_clear_typed_step(p_file uuid, p_step text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_n int;
  v_bank boolean;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked. Nothing was cleared.');
  v_n := array_position(array['setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'], p_step);
  perform private.require(v_n is not null, 'Unknown step.');
  perform private.require(not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = p_step
                                       and (s.prepared_at is not null or s.reviewed_at is not null)),
    format('Step %s is signed. Take back the sign-off first.', v_n));
  perform private.require(p_step not in ('records', 'review'), format('Nothing is typed on step %s. Imports and uploads are removed where they are listed.', v_n));
  v_bank := v_file.books in ('statements', 'paper');

  if p_step = 'setup' then
    v_new := '{}'::jsonb;
    update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
    -- As cb_save_setup: GST/HST answers that change how tax is worked out send the taxed work back to the reviewer.
    if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from true
       or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from false then
      update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
       where l.file_id = p_file and l.status = 'done'
         and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
      update public.cb_entries e set needs_review = true
       where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
      -- Piece E1: entries with sales tax are worked out under the old answers: step 5 is signed again.
      if found then perform private.cb_clear_step(p_file, 'entries', 'The GST/HST answers changed: entries with sales tax to check'); end if;
    end if;
    delete from public.cb_acceptance where file_id = p_file;
  elsif p_step = 'opening' then
    delete from public.cb_opening_balances where file_id = p_file;
    delete from public.cb_opening_s125 where file_id = p_file;
    update public.cb_files set opening_source = null, opening_re_stated = null, opening_ni_typed = null, opening_note = '',
      opening_set_by = null, opening_set_at = null, first_year = false, updated_at = now() where id = p_file;
  elsif p_step = 'code' then
    if v_bank then
      delete from public.cb_bank_transfers where file_id = p_file;
      update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null
       where file_id = p_file and status in ('done', 'ask_client', 'reviewer');
    else
      update public.cb_accounts set line_no = null, mapping_source = null, mapped_by = null, mapped_at = null
       where file_id = p_file and mapping_source = 'preparer';
    end if;
  elsif p_step = 'entries' then
    delete from public.cb_revenue_sources where file_id = p_file;
    delete from public.cb_revenue_checks where file_id = p_file;
    update public.cb_sh_flags set note = '', noted_by = null, noted_at = null where file_id = p_file and (note <> '' or noted_at is not null);
    delete from public.cb_sh_repaid where file_id = p_file;
  elsif p_step = 'compare' then
    -- Piece 10: what the preparer types in step 6: the explanations, the ticks and the answers.
    delete from public.cb_flag_notes where file_id = p_file;
    delete from public.cb_new_accounts where file_id = p_file;
    delete from public.cb_compare_seen where file_id = p_file;
    delete from public.cb_year_changes where file_id = p_file;
  elsif p_step = 't2' then
    delete from public.cb_t2_tieouts where file_id = p_file;
  elsif p_step = 'statements' then
    perform private.require(not exists (select 1 from public.cb_file_fs where file_id = p_file and mal_quote_id is not null),
      'The MAL is out for signature. Withdraw it first.');
    update public.cb_file_fs set dividends = '[]'::jsonb, updated_by = null, updated_at = now() where file_id = p_file;
  elsif p_step = 'lock' then
    delete from public.cb_checklist_answers where file_id = p_file;
    update public.cb_file_close set tax_balance = null, tax_due = null, noa_issued = null, noa_penalty = 0, noa_interest = 0,
      hst_filed = false, hst_balance = null, hst_due = null, fed_tax = null, prov_tax = null, fed_tax_prior = null, prov_tax_prior = null,
      instalments = '[]'::jsonb, updated_at = now()
     where file_id = p_file;
  end if;

  perform private.cb_log(p_file, 'step_cleared', p_step, format('Everything typed in step %s cleared', v_n));
  -- The review rests on every step.
  perform private.cb_clear_step(p_file, 'review', format('Step %s was cleared', v_n));
end;
$function$
;

create or replace function public.cb_sign_step(p_file uuid, p_step text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; r public.cb_step_signoffs; v_list text[]; v_look int := 0; v_same text := '';
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'), 'Unknown step.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  perform private.require(not (p_step = 'records' and v_file.books in ('statements', 'paper')), 'Step 3 is signed in its sub-steps: 3.1, 3.2 and 3.3.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(private.cb_can('prepare'), 'You need the Prepare right to sign as preparer.');
    perform private.require(p_step <> 'review', 'Step 7 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) when p_step = 'statements' then private.cb_step9_problems(p_file)
      when p_step = 'lock' then private.cb_step10_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
    perform private.cb_log(p_file, 'prepared', p_step, '');
  else
    perform private.require(private.cb_can('review'), 'You need the Review right to sign as reviewer.');
    perform private.require(r.reviewed_at is null, 'This step is already reviewed.');
    -- Piece E1 (D5 B): while entries wait to be looked at, the person who prepared step 5 does not also sign it Reviewed,
    -- unless they have Partner sign-off; then the same-person line and History give the reason.
    if p_step = 'entries' then
      select count(*) into v_look from public.cb_entries where file_id = p_file and needs_review;
      if v_look > 0 and r.prepared_by = (select auth.uid()) then
        perform private.require(private.cb_can('partner'),
          'You prepared step 5 and entries wait to be looked at. Someone else signs Reviewed, or someone with Partner sign-off.');
        v_same := ' (Partner sign-off)';
      end if;
    end if;
    if p_step = 'review' then
      v_list := private.cb_review_problems(p_file);
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (p_file, 'review', (select auth.uid()), now())
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    else
      perform private.require(r.prepared_at is not null, 'The preparer signs first.');
      v_list := case when p_step = 't2' then coalesce((select array_agg(x) from unnest(private.cb_step8_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'statements' then coalesce((select array_agg(x) from unnest(private.cb_step9_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'lock' then coalesce((select array_agg(x) from unnest(private.cb_step10_problems(p_file)) x where x not like '%review note%'), '{}')
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' || v_same else '' end);
    -- Piece E1: what step 5 Reviewed covered at that moment.
    if p_step = 'entries' then
      perform private.cb_log_event(p_file, 'step5_covered', 'entries',
        format('Step 5 Reviewed covers %s entr%s, debits %s; %s to look at',
          (select count(*) from public.cb_entries where file_id = p_file), case when (select count(*) from public.cb_entries where file_id = p_file) = 1 then 'y' else 'ies' end,
          to_char(coalesce((select sum(l.amount) from public.cb_entry_lines l join public.cb_entries e on e.id = l.entry_id where e.file_id = p_file and l.amount > 0), 0), 'FM999,999,999,990.00'),
          v_look),
        null, null, null, null, null, null, null);
    end if;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$
;
