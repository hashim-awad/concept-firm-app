-- Piece S1, change a saved schedule (Hashim, Nov 20, 2026). A schedule entry that the reviewer has approved could not be
-- reopened: the app only offered its schedule window before approval, and cb_edit_entry refused every approved entry. Now
-- the schedule window opens any time the file is open, and saving it updates the same entry and number. If the entry was
-- approved, the approval is taken back (the entry needs review again) and History says so. The step 5 sign-offs are taken
-- back by the existing entry triggers, as for any change. Every other change to an approved entry is still refused.
-- Nothing is dropped; one function is replaced from its latest definition (piece R3a-1 state).
set check_function_bodies = off;

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
  -- Piece S1 (Hashim, Nov 20, 2026): a saved schedule can always be changed through its schedule window, approved or not.
  -- The save takes back the approval (the entry goes back to the reviewer) and logs it; every other change of an approved
  -- entry is still refused.
  perform private.require(v_e.reviewed_at is null
    or (coalesce(v_e.origin, '') = 'schedule' and coalesce(current_setting('cb.schedule_save', true), '') = 'on'),
    'An approved entry cannot be deleted. Add a correcting entry instead.');
  select * into v_file from public.cb_files where id = v_e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
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
  if v_e.reviewed_at is not null then
    perform private.cb_log_event(v_e.file_id, 'entry_approval_taken_back', 'entries',
      format('Entry %s: approval taken back because its schedule changed', private.cb_entry_label(p_entry)),
      null, null, private.cb_entry_label(p_entry), 'Approval', 'Approved', 'Needs review');
  end if;
  update public.cb_files set updated_at = now() where id = v_e.file_id;
  return p_entry;
end;
$function$;
