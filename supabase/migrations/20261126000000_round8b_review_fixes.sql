-- Round 8b (Hashim, Nov 25, 2026): fixes to round 8 before it goes to Live.
--
-- 1. Review by exception (CaseWare: the reviewer works the open points at review, not mid-way). Items
--    waiting for the reviewer no longer hold the preparer's sign-off; they wait on the step 6 list. The
--    reviewer's decision on an item sent to the reviewer (a line "for the reviewer", an account waiting
--    for a decision or on a line of another type) does not clear the preparer's sign-off; any other
--    change still does. The reviewer cannot sign a step, or step 6, while anything on it still waits.
-- 2. The completion checklist belongs to step 10, not step 6: step 6 no longer needs it. Questions 1,
--    10 and 11 must be Yes; only 8 and 9 (conditional) may be Not applicable.
-- 3. Closebook preparer is a permission on any role (Closebook at Edit), not a role of its own: the
--    round 8 role goes, and anyone on it moves back to Staff.
-- 4. The file history names what changed ("Payroll: No to Yes").
-- 5. Standard entry memos in Hashim's words. Step 2 sign-offs from before round 8 carried over.
-- Safe to run twice (round 4d rule).

-- 3.
update public.staff set role_id = (select id from public.roles where name = 'Staff')
 where role_id = (select id from public.roles where name = 'Closebook preparer')
   and exists (select 1 from public.roles where name = 'Staff');
delete from public.roles r where r.name = 'Closebook preparer' and not exists (select 1 from public.staff s where s.role_id = r.id);
update public.permission_areas
   set description = 'View: see the files. Edit: Closebook preparer: work the steps, sign as preparer and reply to review notes. Reviewers are owners.'
 where key = 'closebook';

-- 5. Step 2's old sign-off (before round 8) is its "Prepared by"; the file's preparer when no signer was kept.
insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at)
select id, 'opening', coalesce(opening_signed_by, preparer_id), opening_signed_at from public.cb_files
 where opening_signed_at is not null
on conflict (file_id, step) do nothing;

update public.cb_standard_entries set memo = 'Business share of home office costs the shareholder paid personally.'
 where memo in ('To record the business share of home office costs paid by the shareholder.', 'Business share of home office costs you paid personally.');
update public.cb_standard_entries set memo = 'Business share of vehicle costs the shareholder paid personally.'
 where memo in ('To record the business share of vehicle costs paid by the shareholder.', 'Business share of vehicle costs you paid personally.');
update public.cb_standard_entries set memo = 'Our fee for this year''s financial statements and tax return, owing at year end.'
 where memo = 'To accrue the year-end accounting fee.';
update public.cb_standard_entries set memo = 'Income tax for the year, from the corporate tax return.'
 where memo = 'To record the income tax provision from ProFile.';

-- 1. The preparer is held only by open work on the step.
create or replace function private.cb_prepare_blockers(p_file uuid, p_step text) returns text[]
language sql stable security definer set search_path = '' as $$
  select private.cb_step_problems(p_file, p_step);
$$;

-- 2. Step 6: every step it rests on reviewed, no open note, nothing waiting.
create or replace function private.cb_review_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('mapping', 'step 7', 7)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries', 'mapping']) s) x
   where w not like '%review note%';
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  return v_out;
end;
$$;

-- 2. The checklist's own rule, for step 10 (before the file is locked and the report released).
create or replace function private.cb_checklist_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_n int;
  v_must text;
begin
  select count(*) into v_n from public.cb_checklist_questions q
   where not exists (select 1 from public.cb_checklist_answers a where a.file_id = p_file and a.question = q.key);
  if v_n > 0 then v_out := v_out || format('%s checklist question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select string_agg(q.sort_order::text, ', ' order by q.sort_order) into v_must from public.cb_checklist_questions q
    join public.cb_checklist_answers a on a.file_id = p_file and a.question = q.key
   where q.sort_order in (1, 10, 11) and a.answer <> 'yes';
  if v_must is not null then v_out := v_out || format('Question%s %s must be Yes.', case when position(',' in v_must) > 0 then 's' else '' end, v_must); end if;
  return v_out;
end;
$$;
revoke all on function private.cb_prepare_blockers(uuid, text), private.cb_review_problems(uuid), private.cb_checklist_problems(uuid) from public, anon, authenticated;

create or replace function public.cb_step_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s = 'review' then '{}'::text[] else private.cb_step_waiting(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  -- Step 10's checklist rule, for the screen that shows it.
  return v || jsonb_build_object('checklist', to_jsonb(private.cb_checklist_problems(p_file)));
end;
$$;

-- 2. Saving the checklist: Not applicable only on 8 and 9; a "No" needs a note. It no longer touches step 6.
create or replace function public.cb_save_checklist(p_file uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v jsonb;
  v_order int;
  v_changed int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_answers) = 'array', 'Answers are missing.');
  for v in select * from jsonb_array_elements(p_answers) loop
    select sort_order into v_order from public.cb_checklist_questions where key = v ->> 'question';
    perform private.require(v_order is not null, 'Unknown checklist question.');
    perform private.require(v ->> 'answer' in ('yes', 'no', 'na'), 'Answer Yes, No or Not applicable.');
    perform private.require(v ->> 'answer' <> 'na' or v_order in (8, 9), format('Question %s cannot be Not applicable: only questions 8 and 9 can.', v_order));
    perform private.require(v ->> 'answer' <> 'no' or length(btrim(coalesce(v ->> 'note', ''))) > 0, 'A "No" needs a note: say why, and what was done.');
    insert into public.cb_checklist_answers (file_id, question, answer, note, answered_by)
    values (p_file, v ->> 'question', v ->> 'answer', left(btrim(coalesce(v ->> 'note', '')), 1000), (select auth.uid()))
    on conflict (file_id, question) do update set answer = excluded.answer, note = excluded.note, answered_by = excluded.answered_by, answered_at = now()
     where public.cb_checklist_answers.answer is distinct from excluded.answer or public.cb_checklist_answers.note is distinct from excluded.note;
    if found then v_changed := v_changed + 1; end if;
  end loop;
  if v_changed > 0 then
    perform private.cb_log(p_file, 'checklist_saved', 'lock', format('%s answer%s', v_changed, case when v_changed = 1 then '' else 's' end));
  end if;
end;
$$;

-- 4. An answer in words.
create or replace function private.cb_answer_word(p jsonb) returns text language sql immutable set search_path = '' as $$
  select case when p is null or p = 'null'::jsonb then 'not answered' when p = 'true'::jsonb then 'Yes' when p = 'false'::jsonb then 'No'
    else initcap(p #>> '{}') end;
$$;

-- 4. Setup answers in words, for the history: "Payroll: No to Yes".
create or replace function private.cb_setup_diff(p_old jsonb, p_new jsonb) returns text
language sql immutable set search_path = '' as $$
  select string_agg(format('%s: %s to %s', q.label, private.cb_answer_word(p_old -> q.k), private.cb_answer_word(p_new -> q.k)), '; ' order by q.ord)
    from (values ('realtor', 'Realtor, team or PREC', 1), ('owner_paid', 'Owner paid company expenses', 2), ('dividends', 'Dividends paid', 3),
                 ('payroll', 'Payroll', 4), ('holdco', 'Related company', 5), ('gst_registered', 'GST/HST registered', 6),
                 ('gst_frequency', 'GST/HST filing frequency', 7), ('quick_method', 'Quick method', 8)) q(k, label, ord)
   where (coalesce(p_old, '{}'::jsonb) -> q.k) is distinct from (coalesce(p_new, '{}'::jsonb) -> q.k);
$$;


-- An account's type flag, open, on a given row's values (the round 6 rule).
create or replace function private.cb_flag_open(p_type text, p_line text, p_reason text, p_confirmed_line text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_type is not null and exists (select 1 from public.cb_master_lines m where m.line_no = p_line and m.line_type <> p_type)
     and not (p_confirmed_line is not distinct from p_line and coalesce(p_reason, '') <> '');
$$;
revoke all on function private.cb_setup_diff(jsonb, jsonb), private.cb_answer_word(jsonb), private.cb_flag_open(text, text, text, text) from public, anon, authenticated;

-- 1 and 4. A change to a signed step clears its sign-offs, naming what changed; the reviewer's decision
-- on an item sent to the reviewer does not.
create or replace function private.cb_changed() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
  v_txt text;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
begin
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'cb_entry_lines' then
    select e.file_id, format('Entry %s-%s lines %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), v_verb) into v_file, v_txt
      from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = v_row.entry_id;
  elsif tg_table_name = 'cb_files' then
    v_file := v_row.id;
    if v_step = 'setup' then v_txt := private.cb_setup_diff(old.setup, new.setup); end if;
  else
    v_file := v_row.file_id;
  end if;
  if v_file is null then return null; end if;

  if tg_table_name = 'cb_bank_lines' and tg_op = 'UPDATE' then
    -- The reviewer's decision on a line sent to the reviewer: the preparer's sign-off stays.
    if old.status = 'reviewer' and private.is_owner() then return null; end if;
    v_txt := format('%s %s: %s', to_char(new.txn_date, 'Mon FMDD'), left(new.description, 40),
      concat_ws(', ',
        case when old.chart_account is distinct from new.chart_account then format('account %s to %s', coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax %s to %s', coalesce(old.tax_code, 'none'), coalesce(new.tax_code, 'none')) end,
        case when old.status is distinct from new.status then format('%s to %s',
          case old.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' else 'for the reviewer' end,
          case new.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' else 'for the reviewer' end) end));
  elsif tg_table_name = 'cb_bank_lines' then
    v_txt := format('Statement line %s: %s %s', v_verb, to_char(v_row.txn_date, 'Mon FMDD'), left(v_row.description, 40));
  elsif tg_table_name = 'cb_accounts' then
    -- The reviewer's decision on an account waiting for it, or on a line of another type: the sign-off stays.
    if private.is_owner() and (old.needs_reviewer or private.cb_flag_open(old.account_type, old.line_no, old.type_confirm_reason, old.type_confirmed_line)) then
      return null;
    end if;
    v_txt := format('%s: %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      concat_ws(', ',
        case when old.line_no is distinct from new.line_no then format('GIFI %s to %s', coalesce(replace(old.line_no, '.00', ''), 'none'), coalesce(replace(new.line_no, '.00', ''), 'none')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax code %s to %s', coalesce(old.tax_code, 'the line''s default'), coalesce(new.tax_code, 'the line''s default')) end,
        case when old.type_confirm_reason is distinct from new.type_confirm_reason then 'kept on a line of another type' end));
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    -- A trial balance file matches in step 4 and maps in step 7: a line change touches both.
    if not v_bank then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
  elsif tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'mapping' when 'last_year' then 'opening' else 'records' end;
    v_txt := format('%s %s (%s)', case v_row.target when 'account_list' then 'QuickBooks Account List' when 'last_year' then 'Last year''s trial balance' else 'Trial balance' end,
      case tg_op when 'INSERT' then 'imported' else 'removed' end, v_row.file_name);
    if v_row.target = 'account_list' then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
  elsif tg_table_name = 'cb_bank_statements' then
    select format('Statement %s: %s, %s to %s', v_verb, b.name, to_char(v_row.period_start, 'Mon FMDD, YYYY'), to_char(v_row.period_end, 'Mon FMDD, YYYY')) into v_txt
      from public.cb_bank_accounts b where b.id = v_row.account_id;
  elsif tg_table_name = 'cb_opening_balances' then
    v_txt := format('Last year''s balance sheet: GIFI %s %s', v_row.code, v_verb);
  elsif tg_table_name = 'cb_entries' then
    v_txt := format('Entry %s-%s %s', (select to_char(year_end, 'YYYY') from public.cb_files where id = v_file), lpad(v_row.seq::text, 3, '0'), v_verb);
  elsif tg_table_name = 'cb_flag_notes' then
    select format('Lead sheet explanation %s: %s', v_verb, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name)) into v_txt
      from public.cb_accounts a where a.id = v_row.account_id;
  end if;
  perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
  return null;
end;
$$;
revoke all on function private.cb_changed() from public, anon, authenticated;
