-- CloseBook2 piece CB2-0, step 4 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md rule 13). Only four hard stops: an unbalanced
-- entry, posting to a total line, a locked period or file, and a compilation report dated before the MAL is signed.
-- Every other refusal of a business rule goes; the screens show the same items as warnings and the person decides.
-- Kept: access rights, a locked file, input that cannot be read, and state that does not exist (see
-- docs/cb2/refusals.md for the full list). Signing with open items records them in the sign-off's History row.
-- Also (Hashim, answers 2): "To look at", the "For the reviewer" filter and the same-person rule on step 5 are removed.

-- Sign-offs: open items, the preparer-first order and the step 5 same-person rule no longer refuse.
CREATE OR REPLACE FUNCTION public.cb_sign_step(p_file uuid, p_step text, p_role text)
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
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
    perform private.cb_log(p_file, 'prepared', p_step, case when cardinality(v_list) > 0 then 'Signed with open items: ' || array_to_string(v_list, ' ') else '' end);
  else
    perform private.require(private.cb_can('review'), 'You need the Review right to sign as reviewer.');
    perform private.require(r.reviewed_at is null, 'This step is already reviewed.');
    -- Piece E1 (D5 B): while entries wait to be looked at, the person who prepared step 5 does not also sign it Reviewed,
    -- unless they have Partner sign-off; then the same-person line and History give the reason.
    if p_step = 'entries' then
      select count(*) into v_look from public.cb_entries where file_id = p_file and needs_review and kind <> 'TJE';
      if v_look > 0 and r.prepared_by = (select auth.uid()) then
        v_same := ' (Partner sign-off)';
      end if;
    end if;
    if p_step = 'review' then
      v_list := private.cb_review_problems(p_file);
      insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (p_file, 'review', (select auth.uid()), now())
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    else
      v_list := case when p_step = 't2' then coalesce((select array_agg(x) from unnest(private.cb_step8_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'statements' then coalesce((select array_agg(x) from unnest(private.cb_step9_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'lock' then coalesce((select array_agg(x) from unnest(private.cb_step10_problems(p_file)) x where x not like '%review note%'), '{}')
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, concat_ws(' ', case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person.' end,
      case when cardinality(coalesce(v_list, '{}')) > 0 then 'Signed with open items: ' || array_to_string(v_list, ' ') end));
    -- Piece E1: what step 5 Reviewed covered at that moment.
    if p_step = 'entries' then
      perform private.cb_log_event(p_file, 'step5_covered', 'entries',
        format('Step 5 Reviewed covers %s AJE and RJE entr%s, debits %s; %s to look at%s',
          (select count(*) from public.cb_entries where file_id = p_file and kind <> 'TJE'),
          case when (select count(*) from public.cb_entries where file_id = p_file and kind <> 'TJE') = 1 then 'y' else 'ies' end,
          to_char(coalesce((select sum(l.amount) from public.cb_entry_lines l join public.cb_entries e on e.id = l.entry_id where e.file_id = p_file and e.kind <> 'TJE' and l.amount > 0), 0), 'FM999,999,999,990.00'),
          v_look,
          case when exists (select 1 from public.cb_entries where file_id = p_file and kind = 'TJE')
            then format('; %s TJE under step 8', (select count(*) from public.cb_entries where file_id = p_file and kind = 'TJE')) else '' end),
        null, null, null, null, null, null, null);
    end if;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sign_substep(p_file uuid, p_sub text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; r public.cb_substep_signoffs; v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.books in ('statements', 'paper'), 'Banking sub-steps are for bank and card files.');
  perform private.require(p_sub in ('3.1', '3.2', '3.3'), 'Unknown sub-step.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_substep_signoffs where file_id = p_file and substep = p_sub;
  v_list := private.cb_banking_problems(p_file, p_sub);
  if p_role = 'prepared' then
    perform private.require(private.cb_can('prepare'), 'You need the Prepare right to sign as preparer.');
    perform private.require(r.prepared_at is null, 'This sub-step is already signed as prepared.');
    insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (p_file, p_sub, (select auth.uid()), now())
    on conflict (file_id, substep) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, reviewed_by = null, reviewed_at = null;
    perform private.cb_log(p_file, 'prepared', 'records', 'Sub-step ' || p_sub);
  else
    perform private.require(private.cb_can('review'), 'You need the Review right to sign as reviewer.');
    perform private.require(r.reviewed_at is null, 'This sub-step is already reviewed.');
    update public.cb_substep_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'reviewed', 'records', 'Sub-step ' || p_sub || case when r.prepared_by = (select auth.uid()) then ': prepared and reviewed by the same person' else '' end);
  end if;
  perform private.cb_records_follow(p_file);
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sign_opening(p_file uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_problem text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  v_problem := private.cb_opening_problem(p_file);
  update public.cb_files set opening_signed_by = (select auth.uid()), opening_signed_at = now(), updated_at = now() where id = p_file;
  -- Round 8: this is step 2's "Prepared by".
  insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, 'opening', (select auth.uid()), now())
  on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, reviewed_by = null, reviewed_at = null;
  perform private.cb_log(p_file, 'prepared', 'opening', '');
end;
$function$;

-- Lock: what is still open is a warning on step 10; the lock itself is the person's decision.
CREATE OR REPLACE FUNCTION public.cb_lock_file(p_file uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_list text[];
begin
  perform private.require(private.cb_can('lock'), 'You need the Lock and unlock right to lock a file.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'This file is missing.');
  perform private.require(v_file.phase <> 'locked', 'This file is already locked.');
  v_list := private.cb_lock_problems(p_file);
  update public.cb_file_close set locked_at = now(), locked_by = (select auth.uid()), phase_before_lock = v_file.phase where file_id = p_file;
  perform private.cb_log(p_file, 'locked', 'lock', 'File locked: read-only, its documents kept as delivered');
  update public.cb_files set phase = 'locked', updated_at = now() where id = p_file;
end;
$function$;

-- The MAL can be sent before step 9 is reviewed (a warning). The compilation report stays dated after the MAL is signed.
CREATE OR REPLACE FUNCTION public.cb_send_mal(p_file uuid, p_title text, p_html text, p_pdf jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c public.cb_client_fs_fields; v_staff public.staff; v_id uuid; v_first text; v_last text; v_client public.clients;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(not exists (select 1 from public.cb_file_fs where file_id = p_file and mal_quote_id is not null), 'The MAL is already out for signing.');
  -- Management cannot confirm statements for a year that has not ended: the MAL goes out from the day
  -- after the year end (Hashim, Nov 14, 2026).
  select * into c from public.cb_client_fs_fields where client_id = v_file.client_id;
  perform private.require(coalesce(c.officer_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Add the signing officer''s email in step 9.');
  perform private.require(length(coalesce(p_html, '')) > 100 and jsonb_typeof(p_pdf) = 'array', 'The MAL could not be built.');
  select * into v_client from public.clients where id = v_file.client_id;
  v_first := split_part(btrim(c.officer_name), ' ', 1);
  v_last := nullif(btrim(substr(btrim(c.officer_name), length(v_first) + 1)), '');
  select * into v_staff from public.staff where id = (select auth.uid());
  insert into public.quotes (kind, status, title, client_id, company_name, details, sent_at, sent_by, valid_until, sender, signer, wording, created_by)
  values ('letter', 'sent', left(coalesce(p_title, 'Management Responsibility Acknowledgement'), 200), v_file.client_id, v_client.legal_name,
          jsonb_build_object('doc_kind', 'cb_mal', 'file_id', p_file, 'html', p_html, 'pdf', p_pdf, 'position', c.officer_position),
          now(), v_staff.id, (now() at time zone 'America/Toronto')::date + 30,
          jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email), '{}'::jsonb, '{}'::jsonb, v_staff.id)
  returning id into v_id;
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_first, coalesce(v_last, v_first), c.officer_email, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  insert into public.cb_file_fs (file_id, mal_quote_id, mal_sent_at, mal_sent_by) values (p_file, v_id, now(), v_staff.id)
  on conflict (file_id) do update set mal_quote_id = excluded.mal_quote_id, mal_sent_at = excluded.mal_sent_at, mal_sent_by = excluded.mal_sent_by;
  perform private.cb_log(p_file, 'mal_sent', 'statements', format('MAL sent for signing to %s', c.officer_name));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_record_delivery(p_file uuid, p_path text, p_sha256 text, p_email jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c public.cb_file_close;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into c from public.cb_file_close where file_id = p_file;
  perform private.require(c.delivered_at is null, 'The documents are already recorded as delivered.');
  perform private.require(coalesce(p_path, '') like 'closebook/' || p_file::text || '/delivered/%' and coalesce(p_sha256, '') ~ '^[0-9a-f]{64}$', 'The documents could not be stored.');
  perform private.require(jsonb_typeof(p_email) = 'object' and length(coalesce(p_email ->> 'subject', '')) > 0, 'The email could not be kept.');
  update public.cb_file_close set delivered_at = now(), delivered_by = (select auth.uid()), delivered_path = p_path, delivered_sha256 = p_sha256, delivered_email = p_email,
    updated_by = (select auth.uid()), updated_at = now() where file_id = p_file;
  perform private.cb_log(p_file, 'delivered', 'lock', 'Uploaded to TaxDome and email sent');
end;
$function$;

-- Booking in QuickBooks does not wait for a review (Q7).
CREATE OR REPLACE FUNCTION public.cb_mark_booked(p_entry uuid, p_booked boolean)
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
  v_by := coalesce((select full_name from public.staff where id = v_sign.reviewed_by), '');
  perform set_config('cb.booked_mark', 'on', true);
  update public.cb_entries set booked_at = case when p_booked then now() end, booked_by = case when p_booked then (select auth.uid()) end where id = p_entry;
  perform set_config('cb.booked_mark', 'off', true);
  perform private.cb_log_event(e.file_id, 'entry_booked', 'entries', format('%s %s %s', e.kind, e.number, case when p_booked then case when v_sign.reviewed_at is null then format('marked Booked in QuickBooks; step %s not reviewed yet', case when v_step = 't2' then 8 else 5 end) else format('marked Booked in QuickBooks, under step %s Reviewed by %s, %s', case when v_step = 't2' then 8 else 5 end, v_by, to_char(v_sign.reviewed_at, 'Mon FMDD, YYYY')) end else 'no longer marked Booked in QuickBooks' end),
    null, null, null, null, null, null, null);
end;
$function$;

-- A booked entry can change (Q7); History records it.
CREATE OR REPLACE FUNCTION private.cb_booked_guard()
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
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

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
  -- History (CB2-0 step 2): one row for the delete, with the whole entry inside (every line, sales tax lines included).
  v_label := private.cb_entry_label(p_entry);
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, entry_id, ref_label, reason, old_value, new_value)
  values (v_e.file_id, (select auth.uid()), 'entry_deleted', 'entries',
          left(format('Entry %s deleted (%s, %s): %s', v_label, v_e.kind, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), v_e.note), 500), p_entry, left(v_label, 300), 'Entry',
          format('W/P ref %s; %s', coalesce(nullif(v_e.wp_ref, ''), 'none'), private.cb_entry_snapshot(p_entry)), '');
  delete from public.cb_entries where id = p_entry;
end;
$function$;

-- Mapping does not lock when step 4 is signed, and does not wait for the reviewer.
CREATE OR REPLACE FUNCTION public.cb_assign(p_file uuid, p_items jsonb, p_label text, p_source text DEFAULT 'manual'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v jsonb; a public.cb_accounts; v_chart public.cb_chart_accounts; v_items jsonb := '[]'::jsonb; v_id uuid; v_n int := 0; v_list text[] := '{}';
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to assign accounts.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Bank-statement files use the master chart already.');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Choose at least one account.');
  perform private.require(coalesce(p_source, 'manual') in ('last_year', 'type', 'name', 'manual'), 'Unknown source.');
  perform private.require(length(btrim(coalesce(p_label, ''))) between 3 and 300, 'Name the action.');
  for v in select * from jsonb_array_elements(p_items) loop
    select * into a from public.cb_accounts where id = (v ->> 'account')::uuid and file_id = p_file for update;
    perform private.require(a.id is not null, 'An account is not in this file.');
    perform private.require(a.account_key not in ('opening', 'uncoded'), 'This row takes no master account.');
    perform private.require(not a.client_new or nullif(v ->> 'chart', '') is not null, 'This row cannot be unassigned.');
    if nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose a master account.');
    end if;
    if a.chart_account is not distinct from nullif(v ->> 'chart', '') then continue; end if;
    -- An account sent to the reviewer is the reviewer's to decide (as cb_set_gifi_override).
    -- Undo puts back everything this changes: the master account, the step 8 override and decisions, the reviewer flag.
    v_items := v_items || jsonb_build_array(jsonb_build_object('account', a.id, 'before', a.chart_account, 'after', nullif(v ->> 'chart', ''),
      'before_source', a.assign_source, 'before_override', a.gifi_override, 'before_move_ok', a.line_move_ok,
      'before_reviewer', a.needs_reviewer, 'before_mapping', a.mapping_source));
    v_list := v_list || format('%s (%s to %s)', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), coalesce(a.chart_account, 'none'), coalesce(nullif(v ->> 'chart', ''), 'none'));
    update public.cb_accounts set chart_account = nullif(v ->> 'chart', ''), line_no = v_chart.line_no,
           assign_source = case when nullif(v ->> 'chart', '') is null then null else coalesce(p_source, 'manual') end,
           mapping_source = case when nullif(v ->> 'chart', '') is null then null else 'preparer' end,
           needs_reviewer = false, mapped_by = (select auth.uid()), mapped_at = now()
     where id = a.id;
    if nullif(v ->> 'chart', '') is not null then
      insert into public.cb_client_mappings (client_id, account_key, line_no, chart_account, name, tax_code, decided_by)
      values (v_file.client_id, a.account_key, v_chart.line_no, v_chart.number, a.name, a.tax_code, (select auth.uid()))
      on conflict (client_id, account_key) do update set line_no = excluded.line_no, chart_account = excluded.chart_account, name = excluded.name,
        decided_by = excluded.decided_by, decided_at = now();
    end if;
    -- Unassigning leaves the client's record of matches as it is (T1c): last year's match returns as a suggestion.
    v_chart := null;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then return jsonb_build_object('action', null, 'n', 0); end if;
  insert into public.cb_assign_actions (file_id, label, items, done_by) values (p_file, left(btrim(p_label), 300), v_items, (select auth.uid())) returning id into v_id;
  -- History names every account and its old and new master account (written here, not taken from the screen).
  perform private.cb_log_event(p_file, 'assign', 'code', left(format('%s: %s', btrim(p_label), array_to_string(v_list, '; ')), 4000), null, null, null, null, null, null, null);
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('action', v_id, 'n', v_n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_undo_assign(p_action uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.cb_assign_actions; v_file public.cb_files; v jsonb; v_names text; v_chart text; v_acct public.cb_accounts;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to assign accounts.');
  select * into r from public.cb_assign_actions where id = p_action;
  perform private.require(r.id is not null, 'Nothing to undo.');
  select * into v_file from public.cb_files where id = r.file_id for update;
  select * into r from public.cb_assign_actions where id = p_action for update;
  perform private.require(r.undone_at is null, 'This action is already undone.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select string_agg(btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), ', ' order by a.number, a.name) into v_names
    from jsonb_array_elements(r.items) i join public.cb_accounts a on a.id = (i ->> 'account')::uuid
   where a.chart_account is distinct from nullif(i ->> 'after', '');
  perform private.require(v_names is null, format('Cannot undo: changed since by another action: %s.', v_names));
  for v in select * from jsonb_array_elements(r.items) loop
    v_chart := nullif(v ->> 'before', '');
    update public.cb_accounts set chart_account = v_chart, line_no = (select line_no from public.cb_chart_accounts where number = v_chart),
           assign_source = nullif(v ->> 'before_source', ''),
           mapping_source = case when v ? 'before_mapping' then nullif(v ->> 'before_mapping', '') when v_chart is null then null else 'preparer' end,
           gifi_override = nullif(v ->> 'before_override', ''), line_move_ok = nullif(v ->> 'before_move_ok', ''),
           needs_reviewer = coalesce((v ->> 'before_reviewer')::boolean, needs_reviewer),
           mapped_by = (select auth.uid()), mapped_at = now()
     where id = (v ->> 'account')::uuid;
    select * into v_acct from public.cb_accounts where id = (v ->> 'account')::uuid;
    if v_chart is not null then
      insert into public.cb_client_mappings (client_id, account_key, line_no, chart_account, name, tax_code, decided_by)
      values (v_file.client_id, v_acct.account_key, v_acct.line_no, v_chart, v_acct.name, v_acct.tax_code, (select auth.uid()))
      on conflict (client_id, account_key) do update set line_no = excluded.line_no, chart_account = excluded.chart_account, name = excluded.name,
        decided_by = excluded.decided_by, decided_at = now();
    end if;
    -- The override that Unassign dropped (logged then) is logged again when Undo puts it back.
    if nullif(v ->> 'before_override', '') is not null then
      perform private.cb_log_event(r.file_id, 'gifi_override', 't2', format('%s: GIFI override %s restored (Undo)', btrim(coalesce(nullif(v_acct.number, '') || ' ', '') || v_acct.name),
        replace(v ->> 'before_override', '.00', '')), null, null, null, null, null, null, null);
    end if;
  end loop;
  update public.cb_assign_actions set undone_at = now() where id = r.id;
  perform private.cb_log_event(r.file_id, 'assign', 'code', left('Undo: ' || r.label || ': ' || (select string_agg(format('%s (%s to %s)', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name),
    coalesce(nullif(i ->> 'after', ''), 'none'), coalesce(nullif(i ->> 'before', ''), 'none')), '; ') from jsonb_array_elements(r.items) i join public.cb_accounts a on a.id = (i ->> 'account')::uuid), 4000),
    null, null, null, null, null, null, null);
  return jsonb_build_object('undone', r.id);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_map_account(p_account uuid, p_line text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_acc public.cb_accounts;
  v_reviewer boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to match accounts.');
  select * into v_acc from public.cb_accounts where id = p_account for update;
  perform private.require(v_acc.id is not null, 'Account not found.');
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(exists (select 1 from public.cb_master_lines where line_no = p_line and mappable), 'Choose a GIFI line staff can match to (totals are calculated).');
  perform private.require(not private.cb_line_locked(p_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
  v_reviewer := (select auth.uid()) = v_file.reviewer_id;
  update public.cb_accounts set line_no = p_line, mapping_source = case when v_reviewer then 'reviewer' else 'preparer' end,
         needs_reviewer = false, mapped_by = (select auth.uid()), mapped_at = now()
   where id = p_account;
  insert into public.cb_client_mappings (client_id, account_key, line_no, tax_code, decided_by)
  values (v_file.client_id, v_acc.account_key, p_line, v_acc.tax_code, (select auth.uid()))
  on conflict (client_id, account_key) do update set line_no = excluded.line_no, decided_by = excluded.decided_by, decided_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_gifi_override(p_account uuid, p_line text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cb_accounts; v_file public.cb_files; v_line text := nullif(btrim(coalesce(p_line, '')), ''); v_group_type text; v_type text;
  v_label text; v_old text; v_new text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  -- The file first, then the account, as cb_confirm_type does (security finding 3: one lock order).
  select * into v_file from public.cb_files where id = (select file_id from public.cb_accounts where id = p_account) for update;
  select * into a from public.cb_accounts where id = p_account for update;
  perform private.require(a.id is not null, 'Account not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(a.account_key not in ('opening', 'uncoded') and not private.cb_clearing(a.account_key, a.chart_account),
    'Clearing and the system rows take no GIFI line. Clear the balance with an entry or in the step that made it.');
  perform private.require(a.line_no is not null, case when v_file.books in ('statements', 'paper') then 'Choose a group for the account first.' else 'Assign a master account in step 4 first.' end);
  if v_line = a.line_no then v_line := null; end if;
  if v_line is not null then
    perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Choose a GIFI line staff can match to (totals are calculated).');
    perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
    select line_type into v_group_type from public.cb_master_lines where line_no = a.line_no;
    select line_type into v_type from public.cb_master_lines where line_no = v_line;
    -- Retained earnings, dividends and prior period adjustments (3600 to 3849) move only through entries.
  end if;
  v_label := btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name);
  if a.mapping_source = 'suggested' then
    update public.cb_accounts set mapping_source = case when private.cb_is_reviewer(v_file) then 'reviewer' else 'preparer' end, mapped_by = (select auth.uid()), mapped_at = now() where id = a.id;
  end if;
  if a.needs_reviewer and private.cb_is_reviewer(v_file) then
    update public.cb_accounts set needs_reviewer = false, review_note = format('Decided in step 8: GIFI %s', replace(coalesce(v_line, a.line_no), '.00', '')),
           review_by = (select auth.uid()), review_at = now(), review_cents = round(this_year * 100) where id = a.id;
    perform private.cb_log_event(a.file_id, 'account_reviewed', 't2', 'Account decided in step 8', null, null, v_label,
      format('GIFI %s', replace(coalesce(v_line, a.line_no), '.00', '')), a.reviewer_reason, 'Reviewed');
  end if;
  if v_line is not distinct from a.gifi_override then return; end if;
  update public.cb_accounts set gifi_override = v_line where id = a.id;
  v_old := replace(coalesce(a.gifi_override, a.line_no), '.00', '');
  v_new := replace(coalesce(v_line, a.line_no), '.00', '');
  perform private.cb_log_event(a.file_id, 'gifi_override', 't2', format('%s: GIFI %s to %s', v_label, v_old, v_new), null, null, v_label, null, 'GIFI ' || v_old, 'GIFI ' || v_new);
  perform private.cb_clear_step(a.file_id, 't2', format('%s: GIFI %s to %s', v_label, v_old, v_new));
  update public.cb_files set updated_at = now() where id = a.file_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_clear_typed_step(p_file uuid, p_step text)
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
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_t2_difference(p_file uuid, p_item text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; i jsonb;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer accepts a difference. Reviewers need the Review right.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Say why the difference is accepted.');
  v := private.cb_t2_state(p_file);
  select x into i from jsonb_array_elements(v -> 'items') x where x ->> 'key' = p_item;
  perform private.require(i is not null and (i ->> 'open')::boolean, 'Nothing to accept on this line.');
  update public.cb_t2_tieouts set accepted = accepted || jsonb_build_object(p_item, jsonb_build_object('diff', (i ->> 'diff')::numeric, 'by', (select auth.uid()), 'at', now(), 'reason', btrim(p_reason)))
   where file_id = p_file;
  perform private.cb_log(p_file, 't2_accepted', 't2', format('%s difference %s accepted: %s',
    case p_item when 'ni' then 'Net income' when 'assets' then 'Total assets' when 'cca' then 'CCA' else 'Income tax' end, private.cb_money((i ->> 'diff')::numeric), btrim(p_reason)));
end;
$function$;

-- The GIFI export refuses only an unbalanced trial balance; failed checks and unmatched accounts are warnings.
CREATE OR REPLACE FUNCTION public.cb_record_gifi_export(p_file uuid, p_kind text, p_file_name text, p_content text, p_totals jsonb, p_checks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_id uuid; v_failed text; v_out numeric; v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.file_type = 'full', 'Monthly files have no T2 tie-out.');
  perform private.require(p_kind in ('before_tax', 'final'), 'Choose the export: before tax entries or final.');
  perform private.require(jsonb_typeof(p_checks) = 'array' and jsonb_array_length(p_checks) >= 5, 'The checks did not run. Nothing was exported.');
  select string_agg(c ->> 'title', '; ') into v_failed from jsonb_array_elements(p_checks) c where not (c ->> 'ok')::boolean;
  -- Checked again here: the trial balance balances and every account with a balance is matched.
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out from public.cb_accounts where file_id = p_file;
  perform private.require(v_out = 0, format('Export refused. The trial balance is out by %s.', v_out));
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0
     and (a.line_no is null or a.needs_reviewer) and not private.cb_clearing(a.account_key, a.chart_account);
  -- Piece R1: on bank-statement files, Match accounts to GIFI must be done (the box empty, the ties met).
  select string_agg(x, ' ') into v_failed from unnest(private.cb_match_problems(p_file)) x;
  perform private.require(p_content like '"GIFI01",%', 'The file is not a GIFI file.');
  insert into public.cb_gifi_exports (file_id, kind, file_name, content, totals, checks, fingerprint, created_by)
  values (p_file, p_kind, btrim(p_file_name), p_content, p_totals, p_checks, private.cb_gifi_fingerprint(p_file), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'gifi_exported', 't2', btrim(p_file_name));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_require_gst_answers(p_file uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- CB2-0 step 4: bank lines post before the GST/HST questions are answered (a warning on step 1).
  return;
end;
$function$;

-- Anyone with Edit changes a tax code; History records it.
CREATE OR REPLACE FUNCTION public.cb_set_tax_code(p_account uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_acc public.cb_accounts;
begin
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.id is not null, 'Account not found.');
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_code is null or exists (select 1 from public.cb_tax_codes where code = p_code), 'Unknown tax code.');
  update public.cb_accounts set tax_code = p_code where id = p_account returning * into v_acc;
  if v_acc.line_no is not null then
    insert into public.cb_client_mappings (client_id, account_key, line_no, tax_code, decided_by)
    values (v_file.client_id, v_acc.account_key, v_acc.line_no, p_code, (select auth.uid()))
    on conflict (client_id, account_key) do update set tax_code = excluded.tax_code, decided_by = excluded.decided_by, decided_at = now();
  end if;
end;
$function$;

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
$function$;

-- Entries to retained earnings need not go to 3720 or carry the reason "Prior period adjustment".
CREATE OR REPLACE FUNCTION private.cb_entry_write_lines(p_entry uuid, p_file cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fid uuid := p_file.id;
  -- Piece R2 (D12a): every trial balance file posts to the client's own accounts (monthly QuickBooks files included).
  v_own boolean := p_file.books not in ('statements', 'paper');
  v_cn text;
  v_cnt int;
  v_obe boolean := false;
  v_obe_acc uuid;
  v_div boolean := false;
  v_div_acc uuid;
  v_div_amt numeric;
  v_div_last numeric;
  v_div_name text;
  v_pend numeric;
  v_re_now numeric;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_key text;
  v_name text;
  v_type text;
  v_chart public.cb_chart_accounts;
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
  v_ppa_line boolean := false;
  v_plain jsonb := '[]'::jsonb;
  v_n_re int;
begin
  -- Hashim (Nov 19, 2026): QuickBooks Opening Balance Equity is cleared by one RJE to retained earnings at the start of the
  -- year, the only exception to "retained earnings only through prior period adjustments": two lines, one on that account
  -- and one on retained earnings.
  if v_own and p_kind = 'RJE' and jsonb_array_length(p_lines) = 2 then
    select max(a.id::text) filter (where private.cb_obe(a))::uuid, count(*) filter (where private.cb_obe(a)), count(*) filter (where a.line_no like '3600.%')
      into v_obe_acc, v_cnt, v_n_re from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid;
    v_obe := v_cnt = 1 and v_n_re = 1;
    -- Hashim (Nov 19, 2026, dividends option A): QuickBooks never closes a dividends account (or one assigned to 31500 Prior
    -- period adjustments), so it carries last year's balance into this year. One RJE per such account, at the start of the
    -- year, moves exactly last year's balance to retained earnings: two lines, that account and retained earnings.
    if not v_obe then
      select max(a.id::text) filter (where c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0)::uuid,
             count(*) filter (where c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0)
        into v_div_acc, v_cnt from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid
        left join public.cb_chart_accounts c on c.number = a.chart_account;
      v_div := v_cnt = 1 and v_n_re = 1;
    end if;
  end if;
  for v in select * from jsonb_array_elements(p_lines) loop
    v_chart := null; v_cn := null;
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key, a.chart_account into v_acc, v_line, v_key, v_cn from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no group by design; the reviewer clears it with an entry (round 4 item 3; piece R2 D2).
      perform private.require(v_line is not null or private.cb_clearing(v_key, v_cn),
        case when v_own then 'Assign this account to a master account in step 4 first.' else 'Choose an account from the chart first.' end);
      -- Piece R2 (D12b): never a QuickBooks parent that has sub-accounts.
      perform private.require(not v_own or not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = v_key),
        'Post to a sub-account, not to its parent.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own and v_name is null then
        -- Piece R2 (D12b): the client's account assigned to that master account; with several, the one the preparer picked
        -- (cb_client_chart_picks, rolled forward); never a parent with sub-accounts. For the sales tax line only, a new
        -- "GST/HST payable" when the client has none.
        select count(*) into v_cnt from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
           and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
           and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        if v_cnt = 1 then
          select a.id into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
             and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        elsif v_cnt > 1 then
          select a.id into v_acc from public.cb_accounts a join public.cb_client_chart_picks p on p.client_id = p_file.client_id
             and p.chart_account = v_chart.number and p.account_key = a.account_key where a.file_id = v_fid and a.chart_account = v_chart.number
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
          perform private.require(v_acc is not null, format('Several of the client''s accounts are on master account %s %s: choose the one entries take (step 4, open the master account).', v_chart.number, v_chart.name));
        end if;
        if v_acc is null and coalesce((v ->> 'is_tax')::boolean, false) and v_chart.number = '21500' and v_cnt = 0 then
          -- The client's GST/HST account may sit on 12250 GST/HST receivable (a debit balance): the tax line takes it.
          select min(a.id::text)::uuid into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = '12250'
             and (select count(*) from public.cb_accounts b where b.file_id = v_fid and b.chart_account = '12250') = 1;
        end if;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      elsif v_own then
        null;   -- a new client account named on this master account (created below, with the master account)
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re and not v_obe and not v_div then
      v_line := '3720.00'; v_acc := null;
      if v_own then v_name := 'Prior period adjustments'; v_type := 'Equity'; end if;
    end if;
    if v_line like '3720.%' then
      -- Dividends option A: the opening RJE that moves a 31500 account's balance from last year closes that figure; it is not
      -- a prior period adjustment, so it may take the reason "correction".
      v_ppa_line := true;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        -- Piece R2 (item 5): a new client account is created with a master account.
        perform private.require(v_line like '3720.%' or coalesce(v_chart.number, private.cb_chart_for_line(v_line)) is not null,
          'Choose the master account for the new account.');
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, chart_account, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, case when v_line like '3720.%' then '31500' else coalesce(v_chart.number, private.cb_chart_for_line(v_line)) end,
                'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select v_fid, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    -- Piece 3: a line from a schedule keeps its part (the Schedule tag). Only the schedule writes a new one; an edit of a
    -- schedule entry may keep them, after cb_edit_entry checked the amounts are the schedule's.
    perform private.require(nullif(v ->> 'schedule_part', '') is null or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
      or (select origin from public.cb_entries where id = p_entry) = 'schedule', 'Change this amount in its schedule: click the Schedule tag.');
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax, schedule_part)
    values (p_entry, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false),
            nullif(v ->> 'schedule_part', ''));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  if v_obe then
    -- Option A (Hashim, Nov 19): only against step 2's closing retained earnings typed from the T2, and it must tie.
    perform private.require(p_file.opening_re_stated is not null, 'Enter last year''s closing retained earnings in step 2 first.');
    perform private.require(private.cb_account_final(v_obe_acc) = 0, 'The entry must clear Opening Balance Equity to nil.');
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    v_pend := private.cb_opening_pending(v_fid);
    perform private.require(v_re_now - v_pend = p_file.opening_re_stated, case when v_pend = 0
      then format('After this entry, retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_re_now), private.cb_money(p_file.opening_re_stated))
      else format('After this entry and the opening balances still to move (%s), retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_pend), private.cb_money(v_re_now - v_pend), private.cb_money(p_file.opening_re_stated)) end);
    -- Decision 1A: the entry is dated the first day of the year.
    update public.cb_entries set entry_date = p_file.year_start where id = p_entry and entry_date is distinct from p_file.year_start;
    perform private.cb_log_event(v_fid, 'entry_obe', 'entries', 'Opening Balance Equity cleared to retained earnings (RJE), checked against step 2',
      null, null, null, null, null, null, null);
  end if;
  if v_div then
    select a.last_year, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_div_last, v_div_name from public.cb_accounts a where a.id = v_div_acc;
    select coalesce(sum(amount), 0) into v_div_amt from public.cb_entry_lines where entry_id = p_entry and account_id = v_div_acc;
    perform private.require(p_file.opening_re_stated is not null, 'Enter last year''s closing retained earnings in step 2 first.');
    perform private.require(not exists (select 1 from public.cb_entries e join public.cb_entry_lines l on l.entry_id = e.id
        where e.file_id = v_fid and e.id <> p_entry and e.kind = 'RJE' and l.account_id = v_div_acc
          and exists (select 1 from public.cb_entry_lines r join public.cb_accounts ra on ra.id = r.account_id where r.entry_id = e.id and ra.line_no like '3600.%')),
      format('%s: last year''s balance is already moved to retained earnings by another entry.', v_div_name));
    perform private.require(v_div_amt = -v_div_last,
      format('The entry must move %s''s balance from last year exactly: last year %s, this entry %s.', v_div_name, private.cb_money(v_div_last), private.cb_money(-v_div_amt)));
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    v_pend := private.cb_opening_pending(v_fid);
    perform private.require(v_re_now - v_pend = p_file.opening_re_stated, case when v_pend = 0
      then format('After this entry, retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_re_now), private.cb_money(p_file.opening_re_stated))
      else format('After this entry and the opening balances still to move (%s), retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_pend), private.cb_money(v_re_now - v_pend), private.cb_money(p_file.opening_re_stated)) end);
    update public.cb_entries set entry_date = p_file.year_start where id = p_entry and entry_date is distinct from p_file.year_start;
    perform private.cb_log_event(v_fid, 'entry_dividends', 'entries', format('%s: last year''s balance %s moved to retained earnings (RJE), checked against step 2',
      v_div_name, private.cb_money(v_div_last)), null, null, null, null, null, null, null);
  end if;
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  return v_plain;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_checklist(p_file uuid, p_answers jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v jsonb; v_order int; v_changed int := 0; s record;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into s from private.cb_mal_signed_row(p_file) as (signed_at timestamptz, signed_name text, signed_title text);
  perform private.require(jsonb_typeof(p_answers) = 'array', 'Answers are missing.');
  for v in select * from jsonb_array_elements(p_answers) loop
    select sort_order into v_order from public.cb_checklist_questions where key = v ->> 'question' and active;
    perform private.require(v_order is not null, 'Unknown checklist question.');
    continue when v_order in (6, 10, 11, 12);   -- filled by Closebook
    perform private.require(v ->> 'answer' in ('yes', 'no', 'na'), 'Answer Yes, No or Not applicable.');
    perform private.require(v ->> 'answer' <> 'na' or v_order in (8, 9), format('Question %s cannot be Not applicable: only questions 8 and 9 can.', v_order));
    -- Round 16: question 9 cannot be Not applicable when we are not independent (step 1, acceptance question 5).
    perform private.require(not (v_order = 9 and v ->> 'answer' = 'na' and exists (select 1 from public.cb_acceptance where file_id = p_file and q5 = 'no')),
      'Question 9 cannot be Not applicable: step 1 says we are not independent of the client.');
    insert into public.cb_checklist_answers (file_id, question, answer, note, answered_by)
    values (p_file, v ->> 'question', v ->> 'answer', left(btrim(coalesce(v ->> 'note', '')), 1000), (select auth.uid()))
    on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by, answered_at = now()
     where public.cb_checklist_answers.answer is distinct from excluded.answer or public.cb_checklist_answers.note is distinct from excluded.note;
    if found then v_changed := v_changed + 1; end if;
  end loop;
  if v_changed > 0 then
    perform private.cb_log(p_file, 'checklist_saved', 'lock', format('%s answer%s', v_changed, case when v_changed = 1 then '' else 's' end));
    perform private.cb_clear_step(p_file, 'lock', 'The checklist changed');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_answer_year_change(p_file uuid, p_question text, p_answer boolean, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_question in ('assets', 'loans', 'shareholders', 'related', 'revenue', 'equity'), 'Unknown question.');
  if p_answer is null then
    delete from public.cb_year_changes where file_id = p_file and question = p_question;
    if found then perform private.cb_log(p_file, 'year_change', 'compare', private.cb_year_question(p_question) || ': answer removed'); end if;
    return;
  end if;
  if not p_answer then v_note := ''; end if;
  perform private.require(length(v_note) <= 300, 'Keep the note to 300 characters.');
  insert into public.cb_year_changes (file_id, question, answer, note, answered_by) values (p_file, p_question, p_answer, v_note, (select auth.uid()))
  on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by, answered_at = now(),
    reviewed_by = null, reviewed_at = null
   where public.cb_year_changes.answer is distinct from excluded.answer or public.cb_year_changes.note is distinct from excluded.note;
  if found then perform private.cb_log(p_file, 'year_change', 'compare', private.cb_year_question(p_question) || ': '
    || case when p_answer then 'Yes. ' || v_note else 'No' end); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_revenue_difference(p_file uuid, p_check text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; v_diff numeric; v_name text;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer accepts a revenue difference. Reviewers need the Review right.');
  perform private.require(p_check in ('revenue', 'gst', 't4a'), 'Unknown check.');
  v := private.cb_revenue_state(p_file);
  v_diff := (v ->> case p_check when 'revenue' then 'diff' when 'gst' then 'gst_diff' else 't4a_diff' end)::numeric;
  v_name := case p_check when 'revenue' then 'Revenue difference' when 'gst' then 'GST/HST returns difference' else 'T4A difference' end;
  perform private.require((v ->> case p_check when 'revenue' then 'waiting' when 'gst' then 'gst_waiting' else 't4a_waiting' end)::boolean,
    'Nothing to accept: the difference is within the review threshold, already accepted, or has no source yet.');
  insert into public.cb_revenue_checks (file_id) values (p_file) on conflict (file_id) do nothing;
  if p_check = 'revenue' then update public.cb_revenue_checks set accepted_by = (select auth.uid()), accepted_at = now(), accepted_diff = v_diff where file_id = p_file;
  elsif p_check = 'gst' then update public.cb_revenue_checks set gst_accepted_by = (select auth.uid()), gst_accepted_at = now(), gst_accepted_diff = v_diff where file_id = p_file;
  else update public.cb_revenue_checks set t4a_accepted_by = (select auth.uid()), t4a_accepted_at = now(), t4a_accepted_diff = v_diff where file_id = p_file;
  end if;
  perform private.cb_log(p_file, 'revenue_accepted', case when p_check = 'gst' then 't2' else 'entries' end, format('%s %s accepted', v_name, private.cb_money(v_diff)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_review_new_account(p_file uuid, p_account text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c record;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer marks it reviewed. Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into c from private.cb_compare_accounts(p_file) x where x.kind = 'new' and x.account_key = p_account;
  perform private.require(c.account_key is not null, 'This account is not new this year.');
  update public.cb_new_accounts set reviewed_line = case when p_on then c.line_no end, reviewed_by = case when p_on then (select auth.uid()) end,
    reviewed_at = case when p_on then now() end
   where file_id = p_file and account_key = p_account
     and (reviewed_at is null) = p_on;
  if found then perform private.cb_log(p_file, case when p_on then 'new_account_reviewed' else 'new_account_unreviewed' end, 'review', p_account); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_confirm_type(p_account uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_acc public.cb_accounts;
  v_file public.cb_files;
  v_line_type text;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_accounts where id = p_account;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select line_type into v_line_type from public.cb_master_lines where line_no = coalesce(v_acc.gifi_override, v_acc.line_no);
  perform private.require(v_acc.account_type is not null and v_line_type is not null and v_line_type <> v_acc.account_type,
    'This account''s type matches its GIFI line: there is nothing to confirm.');
  perform private.require(v_reason <> '', 'Type the reason for keeping this account on a line of another type.');
  perform private.require(length(v_reason) <= 300, 'Keep the reason to 300 characters.');
  update public.cb_accounts set type_confirm_reason = v_reason, type_confirmed_by = (select auth.uid()), type_confirmed_at = now(),
         type_confirmed_line = coalesce(v_acc.gifi_override, v_acc.line_no)
   where id = p_account;
  update public.cb_files set updated_at = now() where id = v_file.id;
end;
$function$;

-- The "amortization = CCA" rule is gone: CCA is never compared with amortization, and "Set book amortization" is retired.
CREATE OR REPLACE FUNCTION private.cb_t2_state(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files; e public.cb_gifi_exports; t public.cb_t2_tieouts; v_book boolean; v_items jsonb := '[]'; v_stale boolean;
  k text; v_cb numeric; v_pf numeric; v_diff numeric; v_acc jsonb; v_compared boolean; v_round numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  select * into e from public.cb_gifi_exports where file_id = p_file and kind = 'final' order by created_at desc limit 1;
  select * into t from public.cb_t2_tieouts where file_id = p_file;
  select coalesce(book_amortization, false) into v_book from public.cb_client_tax_settings where client_id = v_file.client_id;
  v_book := coalesce(v_book, false);
  select coalesce(t2_rounding, 5) into v_round from public.cb_settings limit 1;
  v_round := coalesce(v_round, 5);
  v_stale := e.id is not null and e.fingerprint <> private.cb_gifi_fingerprint(p_file);
  if e.id is not null then
    foreach k in array array['ni', 'assets', 'cca', 'tax'] loop
      v_cb := coalesce((e.totals ->> case k when 'ni' then '9999' when 'assets' then '2599' when 'cca' then 'amort' else 'inctax' end)::numeric, 0);
      v_pf := case k when 'ni' then t.net_income when 'assets' then t.total_assets when 'cca' then t.cca else t.income_tax end;
      -- Closebook less ProFile (round 10 fix 6).
      v_diff := case when v_pf is null then null else v_cb - v_pf end;
      v_acc := t.accepted -> k;
      v_compared := k <> 'cca';   -- CB2-0 step 4: amortization = CCA is gone; CCA is never compared
      v_items := v_items || jsonb_build_object('key', k, 'closebook', v_cb, 'profile', v_pf, 'diff', v_diff, 'compared', v_compared,
        -- ProFile rounds the GIFI lines to whole dollars, so net income (9999) and total assets (2599) may
        -- differ by the rounding allowed. CCA and income tax are typed from ProFile and booked to the cent:
        -- they tie exactly.
        'rounding', v_compared and k in ('ni', 'assets') and v_diff is not null and v_diff <> 0 and abs(v_diff) <= v_round,
        'open', v_compared and v_diff is not null and abs(v_diff) > (case when k in ('ni', 'assets') then v_round else 0 end)
          and (v_acc is null or (v_acc ->> 'diff')::numeric is distinct from v_diff));
    end loop;
  end if;
  return jsonb_build_object('rounding', v_round, 'final_id', e.id, 'final_at', e.created_at, 'stale', v_stale, 'book_amortization', v_book,
    'entered', t.file_id is not null and t.net_income is not null and t.total_assets is not null and t.cca is not null and t.income_tax is not null,
    't2_pdf', t.t2_pdf, 'items', v_items);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_book_amortization(p_file uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'Retired: amortization is whatever entry is posted; CCA is not compared (CloseBook2, Nov 21, 2026).' using errcode = '42501';
end;
$function$;

-- Review fixes (test round, Nov 21, 2026). The tables still held two of the removed rules as CHECK constraints: a "yes"
-- in "What changed this year" needed a note, and a "No" on the checklist needed a note. Both are warnings now.
alter table public.cb_year_changes drop constraint if exists cb_year_changes_check;
alter table public.cb_checklist_answers drop constraint if exists cb_checklist_answers_check;

-- Step 2 signed with open items records them, as every other step does. Signing again as preparer is refused, as on
-- every other step: a person takes back their own sign-off first, and the reviewer's sign-off is never cleared (rule 14.3).
create or replace function public.cb_sign_opening(p_file uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare
  v_file public.cb_files;
  v_problem text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'opening' and prepared_at is not null),
    'This step is already signed as prepared.');
  v_problem := private.cb_opening_problem(p_file);
  update public.cb_files set opening_signed_by = (select auth.uid()), opening_signed_at = now(), updated_at = now() where id = p_file;
  -- Round 8: this is step 2's "Prepared by".
  insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, 'opening', (select auth.uid()), now())
  on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
  perform private.cb_log(p_file, 'prepared', 'opening', case when coalesce(v_problem, '') <> '' then 'Signed with open items: ' || v_problem else '' end);
end;
$function$;

-- CB2-0 review round (Nov 21, 2026; spec-checker, workpaper and security reviews). The step 4 items still refusing are
-- warnings: schedule locks, retained earnings forced to 3720, a master account before a new account, the clearing line's
-- amount. Warnings shown on lock, MAL and delivery are written to History (rule 14.1). A tax code change writes its own
-- row. Accepting a difference is refused on a locked file. The change queue gets row-level security.
alter table private.cb_change_queue enable row level security;

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
  -- CB2-0 review round (spec step 4, schedule locks): an amount from a schedule or the Expenses paid personally paper can be
  -- changed on the entry; History records it and the schedule shows the difference.
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  -- Piece E1: no entry approval; an entry changes until the file is locked (booked entries: the booked guard).
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

CREATE OR REPLACE FUNCTION private.cb_entry_write_lines(p_entry uuid, p_file cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_fid uuid := p_file.id;
  -- Piece R2 (D12a): every trial balance file posts to the client's own accounts (monthly QuickBooks files included).
  v_own boolean := p_file.books not in ('statements', 'paper');
  v_cn text;
  v_cnt int;
  v_obe boolean := false;
  v_obe_acc uuid;
  v_div boolean := false;
  v_div_acc uuid;
  v_div_amt numeric;
  v_div_last numeric;
  v_div_name text;
  v_pend numeric;
  v_re_now numeric;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_key text;
  v_name text;
  v_type text;
  v_chart public.cb_chart_accounts;
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
  v_ppa_line boolean := false;
  v_plain jsonb := '[]'::jsonb;
  v_n_re int;
begin
  -- Hashim (Nov 19, 2026): QuickBooks Opening Balance Equity is cleared by one RJE to retained earnings at the start of the
  -- year, the only exception to "retained earnings only through prior period adjustments": two lines, one on that account
  -- and one on retained earnings.
  if v_own and p_kind = 'RJE' and jsonb_array_length(p_lines) = 2 then
    select max(a.id::text) filter (where private.cb_obe(a))::uuid, count(*) filter (where private.cb_obe(a)), count(*) filter (where a.line_no like '3600.%')
      into v_obe_acc, v_cnt, v_n_re from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid;
    v_obe := v_cnt = 1 and v_n_re = 1;
    -- Hashim (Nov 19, 2026, dividends option A): QuickBooks never closes a dividends account (or one assigned to 31500 Prior
    -- period adjustments), so it carries last year's balance into this year. One RJE per such account, at the start of the
    -- year, moves exactly last year's balance to retained earnings: two lines, that account and retained earnings.
    if not v_obe then
      select max(a.id::text) filter (where c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0)::uuid,
             count(*) filter (where c.line_no >= '3700' and c.line_no < '3750' and a.last_year <> 0)
        into v_div_acc, v_cnt from jsonb_array_elements(p_lines) l join public.cb_accounts a on a.id = nullif(l ->> 'account', '')::uuid and a.file_id = v_fid
        left join public.cb_chart_accounts c on c.number = a.chart_account;
      v_div := v_cnt = 1 and v_n_re = 1;
    end if;
  end if;
  for v in select * from jsonb_array_elements(p_lines) loop
    v_chart := null; v_cn := null;
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key, a.chart_account into v_acc, v_line, v_key, v_cn from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no group by design; the reviewer clears it with an entry (round 4 item 3; piece R2 D2).
      perform private.require(v_line is not null or private.cb_clearing(v_key, v_cn),
        case when v_own then 'Assign this account to a master account in step 4 first.' else 'Choose an account from the chart first.' end);
      -- Piece R2 (D12b): never a QuickBooks parent that has sub-accounts.
      perform private.require(not v_own or not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = v_key),
        'Post to a sub-account, not to its parent.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own and v_name is null then
        -- Piece R2 (D12b): the client's account assigned to that master account; with several, the one the preparer picked
        -- (cb_client_chart_picks, rolled forward); never a parent with sub-accounts. For the sales tax line only, a new
        -- "GST/HST payable" when the client has none.
        select count(*) into v_cnt from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
           and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
           and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        if v_cnt = 1 then
          select a.id into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = v_chart.number
             and a.account_key not like 'line:%' and a.account_key not like 'gifi:%' and a.account_key not like 'chart:%'
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
        elsif v_cnt > 1 then
          select a.id into v_acc from public.cb_accounts a join public.cb_client_chart_picks p on p.client_id = p_file.client_id
             and p.chart_account = v_chart.number and p.account_key = a.account_key where a.file_id = v_fid and a.chart_account = v_chart.number
             and not exists (select 1 from public.cb_accounts c where c.file_id = v_fid and c.parent_key = a.account_key);
          perform private.require(v_acc is not null, format('Several of the client''s accounts are on master account %s %s: choose the one entries take (step 4, open the master account).', v_chart.number, v_chart.name));
        end if;
        if v_acc is null and coalesce((v ->> 'is_tax')::boolean, false) and v_chart.number = '21500' and v_cnt = 0 then
          -- The client's GST/HST account may sit on 12250 GST/HST receivable (a debit balance): the tax line takes it.
          select min(a.id::text)::uuid into v_acc from public.cb_accounts a where a.file_id = v_fid and a.chart_account = '12250'
             and (select count(*) from public.cb_accounts b where b.file_id = v_fid and b.chart_account = '12250') = 1;
        end if;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      elsif v_own then
        null;   -- a new client account named on this master account (created below, with the master account)
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- CB2-0 review round (spec step 4): a line on retained earnings posts where it was coded; it is no longer moved to 3720.
    if v_line like '3720.%' then
      -- Dividends option A: the opening RJE that moves a 31500 account's balance from last year closes that figure; it is not
      -- a prior period adjustment, so it may take the reason "correction".
      v_ppa_line := true;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        -- Piece R2 (item 5): a new client account is created with a master account.
        -- CB2-0 review round (spec step 4): a new account needs no master account first; step 4 lists it to assign.
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, chart_account, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, case when v_line like '3720.%' then '31500' else coalesce(v_chart.number, private.cb_chart_for_line(v_line)) end,
                'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select v_fid, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    -- Piece 3: a line from a schedule keeps its part (the Schedule tag). Only the schedule writes a new one; an edit of a
    -- schedule entry may keep them, after cb_edit_entry checked the amounts are the schedule's.
    perform private.require(nullif(v ->> 'schedule_part', '') is null or coalesce(current_setting('cb.schedule_save', true), '') = 'on'
      or (select origin from public.cb_entries where id = p_entry) = 'schedule', 'Change this amount in its schedule: click the Schedule tag.');
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax, schedule_part)
    values (p_entry, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false),
            nullif(v ->> 'schedule_part', ''));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  if v_obe then
    -- Option A (Hashim, Nov 19): only against step 2's closing retained earnings typed from the T2, and it must tie.
    perform private.require(p_file.opening_re_stated is not null, 'Enter last year''s closing retained earnings in step 2 first.');
    perform private.require(private.cb_account_final(v_obe_acc) = 0, 'The entry must clear Opening Balance Equity to nil.');
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    v_pend := private.cb_opening_pending(v_fid);
    perform private.require(v_re_now - v_pend = p_file.opening_re_stated, case when v_pend = 0
      then format('After this entry, retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_re_now), private.cb_money(p_file.opening_re_stated))
      else format('After this entry and the opening balances still to move (%s), retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_pend), private.cb_money(v_re_now - v_pend), private.cb_money(p_file.opening_re_stated)) end);
    -- Decision 1A: the entry is dated the first day of the year.
    update public.cb_entries set entry_date = p_file.year_start where id = p_entry and entry_date is distinct from p_file.year_start;
    perform private.cb_log_event(v_fid, 'entry_obe', 'entries', 'Opening Balance Equity cleared to retained earnings (RJE), checked against step 2',
      null, null, null, null, null, null, null);
  end if;
  if v_div then
    select a.last_year, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_div_last, v_div_name from public.cb_accounts a where a.id = v_div_acc;
    select coalesce(sum(amount), 0) into v_div_amt from public.cb_entry_lines where entry_id = p_entry and account_id = v_div_acc;
    perform private.require(p_file.opening_re_stated is not null, 'Enter last year''s closing retained earnings in step 2 first.');
    perform private.require(not exists (select 1 from public.cb_entries e join public.cb_entry_lines l on l.entry_id = e.id
        where e.file_id = v_fid and e.id <> p_entry and e.kind = 'RJE' and l.account_id = v_div_acc
          and exists (select 1 from public.cb_entry_lines r join public.cb_accounts ra on ra.id = r.account_id where r.entry_id = e.id and ra.line_no like '3600.%')),
      format('%s: last year''s balance is already moved to retained earnings by another entry.', v_div_name));
    perform private.require(v_div_amt = -v_div_last,
      format('The entry must move %s''s balance from last year exactly: last year %s, this entry %s.', v_div_name, private.cb_money(v_div_last), private.cb_money(-v_div_amt)));
    select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_re_now from public.cb_accounts a where a.file_id = v_fid and a.line_no like '3600.%';
    v_pend := private.cb_opening_pending(v_fid);
    perform private.require(v_re_now - v_pend = p_file.opening_re_stated, case when v_pend = 0
      then format('After this entry, retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_re_now), private.cb_money(p_file.opening_re_stated))
      else format('After this entry and the opening balances still to move (%s), retained earnings at the start must equal last year''s closing retained earnings in step 2: %s and %s.',
        private.cb_money(v_pend), private.cb_money(v_re_now - v_pend), private.cb_money(p_file.opening_re_stated)) end);
    update public.cb_entries set entry_date = p_file.year_start where id = p_entry and entry_date is distinct from p_file.year_start;
    perform private.cb_log_event(v_fid, 'entry_dividends', 'entries', format('%s: last year''s balance %s moved to retained earnings (RJE), checked against step 2',
      v_div_name, private.cb_money(v_div_last)), null, null, null, null, null, null, null);
  end if;
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  return v_plain;
end;
$function$;

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
    perform private.require(v_left is not null and v_left <> 0 and abs(v_left) < 1, 'Rounding is only for a difference left under 1.00.');
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
    select * into v_line from public.cb_bank_lines where id = p_cleared_line and account_id = p_account;
    perform private.require(v_line.id is not null, 'The line that cleared it must be on this account.');
    perform private.require(p_edge = 'start', 'Only an item at the start of the year is cleared by a line in the year.');
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

CREATE OR REPLACE FUNCTION public.cb_lock_file(p_file uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_list text[];
begin
  perform private.require(private.cb_can('lock'), 'You need the Lock and unlock right to lock a file.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'This file is missing.');
  perform private.require(v_file.phase <> 'locked', 'This file is already locked.');
  v_list := private.cb_lock_problems(p_file);
  update public.cb_file_close set locked_at = now(), locked_by = (select auth.uid()), phase_before_lock = v_file.phase where file_id = p_file;
  perform private.cb_log(p_file, 'locked', 'lock', 'File locked: read-only, its documents kept as delivered' || case when cardinality(coalesce(v_list, '{}')) > 0 then '. Locked with open items: ' || array_to_string(v_list, ' ') else '' end);
  update public.cb_files set phase = 'locked', updated_at = now() where id = p_file;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_send_mal(p_file uuid, p_title text, p_html text, p_pdf jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c public.cb_client_fs_fields; v_staff public.staff; v_id uuid; v_first text; v_last text; v_client public.clients;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(not exists (select 1 from public.cb_file_fs where file_id = p_file and mal_quote_id is not null), 'The MAL is already out for signing.');
  -- Management cannot confirm statements for a year that has not ended: the MAL goes out from the day
  -- after the year end (Hashim, Nov 14, 2026).
  select * into c from public.cb_client_fs_fields where client_id = v_file.client_id;
  perform private.require(coalesce(c.officer_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Add the signing officer''s email in step 9.');
  perform private.require(length(coalesce(p_html, '')) > 100 and jsonb_typeof(p_pdf) = 'array', 'The MAL could not be built.');
  select * into v_client from public.clients where id = v_file.client_id;
  v_first := split_part(btrim(c.officer_name), ' ', 1);
  v_last := nullif(btrim(substr(btrim(c.officer_name), length(v_first) + 1)), '');
  select * into v_staff from public.staff where id = (select auth.uid());
  insert into public.quotes (kind, status, title, client_id, company_name, details, sent_at, sent_by, valid_until, sender, signer, wording, created_by)
  values ('letter', 'sent', left(coalesce(p_title, 'Management Responsibility Acknowledgement'), 200), v_file.client_id, v_client.legal_name,
          jsonb_build_object('doc_kind', 'cb_mal', 'file_id', p_file, 'html', p_html, 'pdf', p_pdf, 'position', c.officer_position),
          now(), v_staff.id, (now() at time zone 'America/Toronto')::date + 30,
          jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email), '{}'::jsonb, '{}'::jsonb, v_staff.id)
  returning id into v_id;
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_first, coalesce(v_last, v_first), c.officer_email, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  insert into public.cb_file_fs (file_id, mal_quote_id, mal_sent_at, mal_sent_by) values (p_file, v_id, now(), v_staff.id)
  on conflict (file_id) do update set mal_quote_id = excluded.mal_quote_id, mal_sent_at = excluded.mal_sent_at, mal_sent_by = excluded.mal_sent_by;
  perform private.cb_log(p_file, 'mal_sent', 'statements', format('MAL sent for signing to %s', c.officer_name)
    || case when not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'statements' and reviewed_at is not null) then '. Sent before step 9 was reviewed' else '' end
    || case when (now() at time zone 'America/Toronto')::date <= v_file.year_end then '. Sent on or before the year end' else '' end);
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_record_delivery(p_file uuid, p_path text, p_sha256 text, p_email jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c public.cb_file_close;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into c from public.cb_file_close where file_id = p_file;
  perform private.require(c.delivered_at is null, 'The documents are already recorded as delivered.');
  perform private.require(coalesce(p_path, '') like 'closebook/' || p_file::text || '/delivered/%' and coalesce(p_sha256, '') ~ '^[0-9a-f]{64}$', 'The documents could not be stored.');
  perform private.require(jsonb_typeof(p_email) = 'object' and length(coalesce(p_email ->> 'subject', '')) > 0, 'The email could not be kept.');
  update public.cb_file_close set delivered_at = now(), delivered_by = (select auth.uid()), delivered_path = p_path, delivered_sha256 = p_sha256, delivered_email = p_email,
    updated_by = (select auth.uid()), updated_at = now() where file_id = p_file;
  perform private.cb_log(p_file, 'delivered', 'lock', 'Uploaded to TaxDome and email sent'
    || case when not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'lock' and reviewed_at is not null) then '. Delivered before step 10 was reviewed' else '' end
    || case when not exists (select 1 from private.cb_mal_signed_row(p_file) as m(signed_at timestamptz, signed_name text, signed_title text) where m.signed_at is not null) then '. Delivered with the MAL not signed' else '' end);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_tax_code(p_account uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_acc public.cb_accounts;
  v_old text;
begin
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.id is not null, 'Account not found.');
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_code is null or exists (select 1 from public.cb_tax_codes where code = p_code), 'Unknown tax code.');
  select tax_code into v_old from public.cb_accounts where id = p_account;
  update public.cb_accounts set tax_code = p_code where id = p_account returning * into v_acc;
  if v_old is distinct from p_code then
    perform private.cb_log(v_file.id, 'tax_code_changed', 'code', format('Tax code on %s %s: %s to %s', v_acc.number, v_acc.name, coalesce(v_old, 'default'), coalesce(p_code, 'default')));
  end if;
  if v_acc.line_no is not null then
    insert into public.cb_client_mappings (client_id, account_key, line_no, tax_code, decided_by)
    values (v_file.client_id, v_acc.account_key, v_acc.line_no, p_code, (select auth.uid()))
    on conflict (client_id, account_key) do update set tax_code = excluded.tax_code, decided_by = excluded.decided_by, decided_at = now();
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_t2_difference(p_file uuid, p_item text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; i jsonb;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer accepts a difference. Reviewers need the Review right.');
  perform private.require(exists (select 1 from public.cb_files where id = p_file and phase <> 'locked'), 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Say why the difference is accepted.');
  v := private.cb_t2_state(p_file);
  select x into i from jsonb_array_elements(v -> 'items') x where x ->> 'key' = p_item;
  perform private.require(i is not null and (i ->> 'open')::boolean, 'Nothing to accept on this line.');
  update public.cb_t2_tieouts set accepted = accepted || jsonb_build_object(p_item, jsonb_build_object('diff', (i ->> 'diff')::numeric, 'by', (select auth.uid()), 'at', now(), 'reason', btrim(p_reason)))
   where file_id = p_file;
  perform private.cb_log(p_file, 't2_accepted', 't2', format('%s difference %s accepted: %s',
    case p_item when 'ni' then 'Net income' when 'assets' then 'Total assets' when 'cca' then 'CCA' else 'Income tax' end, private.cb_money((i ->> 'diff')::numeric), btrim(p_reason)));
end;
$function$;
