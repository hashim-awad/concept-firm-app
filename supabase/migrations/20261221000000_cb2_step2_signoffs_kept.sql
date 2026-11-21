-- CloseBook2 piece CB2-0, step 2 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md): sign-offs are never cleared.
-- A change no longer removes a sign-off. The sign-off is stamped "Changed since review" (when, who, why) and stays.
-- Signing the step again clears the stamp; nothing else does. The stamp goes on the step where the change was made, and,
-- when trial balance figures move (steps 2 to 5), on 6 Compare, 8 Tax returns and 9 Statements (Q2 A). Step 7 and step 10
-- are never stamped by a change, and the MAL is never withdrawn by a change (step 9 shows a warning).
-- Taking back a sign-off (unsign, reopen) stays a person's own act and still removes it. No sign-off on Live is removed.

alter table public.cb_step_signoffs add column if not exists changed_at timestamptz;
alter table public.cb_step_signoffs add column if not exists changed_by uuid;
alter table public.cb_step_signoffs add column if not exists changed_why text not null default '';
alter table public.cb_substep_signoffs add column if not exists changed_at timestamptz;
alter table public.cb_substep_signoffs add column if not exists changed_by uuid;
alter table public.cb_substep_signoffs add column if not exists changed_why text not null default '';

-- Stamp a signed step "Changed since review". The first change sets the stamp (when, who, why); every change to a signed
-- step is a History row, so the step lists what changed since its sign-off.
create or replace function private.cb_mark_changed(p_file uuid, p_step text, p_why text)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = p_step and (prepared_at is not null or reviewed_at is not null)) then return; end if;
  update public.cb_step_signoffs set changed_at = now(), changed_by = (select auth.uid()), changed_why = left(coalesce(p_why, ''), 300)
   where file_id = p_file and step = p_step and changed_at is null;
  -- One row per change: an entry and its lines fire several triggers in one save.
  if not exists (select 1 from public.cb_file_history where file_id = p_file and action = 'signoff_changed' and step = p_step and at = now()
      and detail = coalesce(nullif(p_why, ''), 'Changed since review')) then
    perform private.cb_log(p_file, 'signoff_changed', p_step, coalesce(nullif(p_why, ''), 'Changed since review'));
  end if;
end;
$function$;
revoke all on function private.cb_mark_changed(uuid, text, text) from public, anon, authenticated;


-- The one place that used to remove sign-offs: it now stamps them.
CREATE OR REPLACE FUNCTION private.cb_clear_step(p_file uuid, p_step text, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.cb_files where id = p_file) then return; end if;
  perform private.cb_mark_changed(p_file, p_step, p_why);
  -- Trial balance figures moved (steps 2 to 5): steps 6, 8 and 9 rest on them.
  if p_step in ('opening', 'records', 'code', 'entries') then
    perform private.cb_mark_changed(p_file, 'compare', p_why);
    perform private.cb_mark_changed(p_file, 't2', 'The trial balance changed');
    perform private.cb_mark_changed(p_file, 'statements', 'The trial balance changed');
  elsif p_step = 't2' then
    perform private.cb_mark_changed(p_file, 'statements', p_why);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_clear_substeps(p_file uuid, p_subs text[], p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_gone text[]; v_why text := btrim(coalesce(p_why, ''));
begin
  with d as (update public.cb_substep_signoffs set changed_at = now(), changed_by = (select auth.uid()), changed_why = left(v_why, 300)
    where file_id = p_file and substep = any (p_subs) and changed_at is null and (prepared_at is not null or reviewed_at is not null) returning substep)
  select array_agg(substep order by substep) into v_gone from d;
  if v_gone is not null then
    if substr(v_why, 2, 1) ~ '[a-z]' then v_why := lower(left(v_why, 1)) || substr(v_why, 2); end if;
    perform private.cb_log_event(p_file, 'signoff_changed', 'records', format('%s changed since review: %s', private.cb_substep_label(v_gone), v_why),
      null, null, '', v_why, '', '');
    perform private.cb_clear_step(p_file, 'records', v_why);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_substep_guard(p_file uuid, p_subs text[], p_confirm boolean, p_what text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_subs text[];
begin
  select array_agg(substep order by substep) into v_subs
    from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) and prepared_at is not null;
  if v_subs is null then return; end if;
  perform private.cb_clear_substeps(p_file, v_subs, p_what);
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
    -- Every sub-step signed again: the stamp on step 3 goes too.
    if not exists (select 1 from public.cb_substep_signoffs where file_id = p_file and changed_at is not null) then
      update public.cb_step_signoffs set changed_at = null, changed_by = null, changed_why = '' where file_id = p_file and step = 'records';
    end if;
  elsif exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 'records') then
    -- Only a person taking back a sub-step sign-off gets here: step 3 is no longer fully prepared.
    delete from public.cb_step_signoffs where file_id = p_file and step = 'records';
    perform private.cb_log(p_file, 'signoff_removed', 'records', 'A Banking sub-step sign-off was taken back');
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_assign_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.line_no is distinct from old.line_no then return null; end if;
  -- Step 4 only: nothing that rests on it moves (cb_clear_step would also clear steps 6 to 8).
  if exists (select 1 from public.cb_step_signoffs where file_id = new.file_id and step = 'code') then
    perform private.cb_mark_changed(new.file_id, 'code', format('%s: master account %s to %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')));
  end if;
  return null;
end;
$function$;

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
    perform private.require(r.prepared_at is null or r.changed_at is not null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) when p_step = 'statements' then private.cb_step9_problems(p_file)
      when p_step = 'lock' then private.cb_step10_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, changed_at = null, changed_by = null, changed_why = '';
    perform private.cb_log(p_file, 'prepared', p_step, case when r.changed_at is not null then 'Signed again after a change' else '' end);
  else
    perform private.require(private.cb_can('review'), 'You need the Review right to sign as reviewer.');
    perform private.require(r.reviewed_at is null or r.changed_at is not null, 'This step is already reviewed.');
    -- Piece E1 (D5 B): while entries wait to be looked at, the person who prepared step 5 does not also sign it Reviewed,
    -- unless they have Partner sign-off; then the same-person line and History give the reason.
    if p_step = 'entries' then
      select count(*) into v_look from public.cb_entries where file_id = p_file and needs_review and kind <> 'TJE';
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
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, changed_at = null, changed_by = null, changed_why = '';
    else
      perform private.require(r.prepared_at is not null, 'The preparer signs first.');
      v_list := case when p_step = 't2' then coalesce((select array_agg(x) from unnest(private.cb_step8_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'statements' then coalesce((select array_agg(x) from unnest(private.cb_step9_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'lock' then coalesce((select array_agg(x) from unnest(private.cb_step10_problems(p_file)) x where x not like '%review note%'), '{}')
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now(), changed_at = null, changed_by = null, changed_why = '' where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' || v_same else '' end);
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
    perform private.require(r.prepared_at is null or r.changed_at is not null, 'This sub-step is already signed as prepared.');
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (p_file, p_sub, (select auth.uid()), now())
    on conflict (file_id, substep) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, changed_at = null, changed_by = null, changed_why = '';
    perform private.cb_log(p_file, 'prepared', 'records', 'Sub-step ' || p_sub);
  else
    perform private.require(private.cb_can('review'), 'You need the Review right to sign as reviewer.');
    perform private.require(r.prepared_at is not null, 'The preparer signs first.');
    perform private.require(r.reviewed_at is null or r.changed_at is not null, 'This sub-step is already reviewed.');
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    update public.cb_substep_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now(), changed_at = null, changed_by = null, changed_why = '' where file_id = p_file and substep = p_sub;
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
  perform private.require(v_problem is null, coalesce(v_problem, ''));
  update public.cb_files set opening_signed_by = (select auth.uid()), opening_signed_at = now(), updated_at = now() where id = p_file;
  -- Round 8: this is step 2's "Prepared by".
  insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, 'opening', (select auth.uid()), now())
  on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, changed_at = null, changed_by = null, changed_why = '';
  perform private.cb_log(p_file, 'prepared', 'opening', '');
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.cb_step_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_step_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['setup', 'opening', 'records', 'code', 'entries', 'compare', 'review', 't2', 'statements', 'lock'] loop
    select * into r from public.cb_step_signoffs where file_id = p_file and step = s;
    v := v || jsonb_build_object(s, jsonb_build_object(
      'prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by, 'reviewed_at', r.reviewed_at,
      'changed_at', r.changed_at, 'changed_by', r.changed_by, 'changed_why', r.changed_why,
      'problems', to_jsonb(case when s = 'review' then private.cb_review_problems(p_file) when s = 't2' then private.cb_step8_problems(p_file)
        when s = 'statements' then private.cb_step9_problems(p_file) when s = 'lock' then private.cb_step10_problems(p_file) else private.cb_step_problems(p_file, s) end),
      'waiting', to_jsonb(case when s in ('review', 't2', 'statements', 'lock') then '{}'::text[] else private.cb_step_waiting_shown(p_file, s) end),
      'notes', (select count(*) from public.cb_review_notes n where n.file_id = p_file and n.step = s and n.status <> 'cleared')));
  end loop;
  return v || jsonb_build_object('checklist', to_jsonb(private.cb_checklist_problems(p_file)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_substep_status(p_file uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb := '{}'::jsonb; s text; r public.cb_substep_signoffs;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  foreach s in array array['3.1', '3.2', '3.3'] loop
    select * into r from public.cb_substep_signoffs where file_id = p_file and substep = s;
    v := v || jsonb_build_object(s, jsonb_build_object('prepared_by', r.prepared_by, 'prepared_at', r.prepared_at, 'reviewed_by', r.reviewed_by,
      'reviewed_at', r.reviewed_at, 'changed_at', r.changed_at, 'changed_by', r.changed_by, 'changed_why', r.changed_why, 'problems', to_jsonb(private.cb_banking_problems(p_file, s))));
  end loop;
  return v;
end;
$function$;
