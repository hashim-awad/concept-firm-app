-- Piece R3a-1 (Hashim, Nov 19, 2026; benchmark CaseWare Cloud, where Admin is a right and roles are titles): there is no
-- Owner role. Roles are titles (Partner, Manager, Senior accountant, Accountant). Admin means Edit on both Staff accounts and
-- Settings; at least one active person always keeps it. Every owner check is replaced by the right it protects (the PR lists
-- each one). Closebook switches on every role: Prepare, Review, Partner sign-off, Lock and unlock, Remove others' sign-offs.
-- Letters box "Can issue Final and send for signing". Nothing is dropped: roles.is_owner and its index stay, always false.
set check_function_bodies = off;

-- 1. The rights on a role.
alter table public.roles add column if not exists can_final_letters boolean not null default false;
alter table public.roles add column if not exists cb_prepare boolean not null default false;
alter table public.roles add column if not exists cb_review boolean not null default false;
alter table public.roles add column if not exists cb_partner boolean not null default false;
alter table public.roles add column if not exists cb_lock boolean not null default false;
alter table public.roles add column if not exists cb_remove_signoffs boolean not null default false;
comment on column public.roles.is_owner is 'Retired by piece R3a-1: there is no Owner role. Always false; a trigger refuses true.';
comment on column public.roles.can_final_letters is 'Letters box: can issue a Final letter and send a proposal for signing (piece R3a-1).';

-- 2. Helpers. Every one returns false, never null, and is false for a switched-off account (default deny).
create or replace function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.can_edit('staff_accounts') and private.can_edit('settings'), false)
$$;
create or replace function private.role_switch(p_role uuid, p_switch text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select case p_switch when 'prepare' then r.cb_prepare when 'review' then r.cb_review when 'partner' then r.cb_partner
      when 'lock' then r.cb_lock when 'remove_signoffs' then r.cb_remove_signoffs else false end from public.roles r where r.id = p_role
      -- Security review: a Closebook switch works only on a role with Edit on Closebook.
      and exists (select 1 from public.role_permissions rp where rp.role_id = r.id and rp.area_key = 'closebook' and rp.level = 'edit')), false)
$$;
create or replace function private.cb_can(p_switch text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.role_switch(s.role_id, p_switch) from public.staff s where s.id = (select auth.uid()) and s.is_active), false)
$$;
create or replace function private.cb_staff_has(p_staff uuid, p_switch text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select private.role_switch(s.role_id, p_switch) from public.staff s where s.id = p_staff and s.is_active), false)
$$;
create or replace function private.can_final_letter() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.can_final_letters from public.staff s join public.roles r on r.id = s.role_id
                    where s.id = (select auth.uid()) and s.is_active), false)
$$;
create or replace function private.role_is_admin(p_role uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select count(*) = 2 from public.role_permissions rp
                    where rp.role_id = p_role and rp.area_key in ('staff_accounts', 'settings') and rp.level = 'edit'), false)
$$;

-- 3. The safety rule: at least one active person, with a usable login, keeps Edit on Staff accounts and Settings. One lock
-- serialises every change that can remove an Admin, so two Admins cannot remove each other at the same time.
create or replace function private.admin_lock() returns void language sql volatile security definer set search_path = '' as $$
  select pg_advisory_xact_lock(733101)
$$;
create or replace function private.admin_check() returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_lock();
  if exists (select 1 from public.staff)
     and not exists (
       select 1 from public.staff s join auth.users u on u.id = s.id
        where s.is_active and private.role_is_admin(s.role_id) and (to_jsonb(u) ->> 'deleted_at') is null and coalesce((to_jsonb(u) ->> 'banned_until')::timestamptz, '-infinity') < now()) then
    raise exception 'Not saved. At least one active person must keep Edit on Staff accounts and Settings (Admin). Give another active person that access first.'
      using errcode = '42501';
  end if;
end;
$$;
create or replace function private.admin_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  return null;
end;
$$;

-- 4. Every function that checked is_owner, with the right it protects (latest definition of each).
CREATE OR REPLACE FUNCTION private.block_price_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' and current_setting('app.catalogue_cleanup', true) = 'on' and (private.is_admin() and private.can_edit('pricing')) then
    return old;
  end if;
  raise exception 'Prices are never changed or deleted. Add a new price with a start date.' using errcode = '42501';
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_changed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file uuid;
  v_step text := tg_argv[0];
  v_why text := tg_argv[1];
  v_bank boolean;
  v_row record;
  v_txt text;
  v_verb text := case tg_op when 'INSERT' then 'added' when 'DELETE' then 'removed' else 'changed' end;
  v_tje boolean := false;   -- piece 6
  v_moved boolean := false;   -- piece 10b
begin
  if tg_table_name = 'cb_bank_lines' and coalesce(current_setting('cb.review', true), '') = 'on' then return null; end if;   -- round 35
  if tg_table_name = 'cb_entries' and coalesce(current_setting('cb.booked_mark', true), '') = 'on' then return null; end if;   -- piece R2
  v_row := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'cb_entry_lines' then
    select e.file_id, format('Entry %s-%s lines %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), v_verb), e.kind = 'TJE' into v_file, v_txt, v_tje
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
    if old.status = 'reviewer' and private.cb_can('review') then return null; end if;
    v_txt := format('%s %s: %s', to_char(new.txn_date, 'Mon FMDD'), left(new.description, 40),
      concat_ws(', ',
        case when old.chart_account is distinct from new.chart_account then format('account %s to %s', coalesce(old.chart_account, 'none'), coalesce(new.chart_account, 'none')) end,
        case when old.acct_date is distinct from new.acct_date then format('date %s to %s', to_char(old.acct_date, 'Mon FMDD'), to_char(new.acct_date, 'Mon FMDD')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax %s to %s', coalesce(old.tax_code, 'none'), coalesce(new.tax_code, 'none')) end,
        case when old.status is distinct from new.status then format('%s to %s',
          case old.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end,
          case new.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end) end));
  elsif tg_table_name = 'cb_bank_lines' then
    v_txt := format('Statement line %s: %s %s', v_verb, to_char(v_row.txn_date, 'Mon FMDD'), left(v_row.description, 40));
  elsif tg_table_name = 'cb_accounts' then
    -- The reviewer's decision on an account waiting for it, or on a line of another type: the sign-off stays.
    if private.cb_can('review') and (old.needs_reviewer or private.cb_flag_open(old.account_type, coalesce(old.gifi_override, old.line_no), old.type_confirm_reason, old.type_confirmed_line)) then
      return null;
    end if;
    v_txt := format('%s: %s', btrim(coalesce(nullif(new.number, '') || ' ', '') || new.name),
      concat_ws(', ',
        case when old.line_no is distinct from new.line_no then
          format('%s to %s', coalesce((select name from public.cb_master_lines where line_no = old.line_no), 'no group'), coalesce((select name from public.cb_master_lines where line_no = new.line_no), 'no group')) end,
        case when old.tax_code is distinct from new.tax_code then format('tax code %s to %s', coalesce(old.tax_code, 'the line''s default'), coalesce(new.tax_code, 'the line''s default')) end,
        case when old.type_confirm_reason is distinct from new.type_confirm_reason then 'kept on a line of another type' end));
    select books in ('statements', 'paper') into v_bank from public.cb_files where id = v_file;
    -- Piece R2 (D7): on a trial balance file a group change (a master account on another line) also clears step 4; a tax
    -- code, type or override change clears what it clears on bank files.
    if not v_bank and old.line_no is distinct from new.line_no then perform private.cb_clear_step(v_file, 'code', v_txt); end if;
    -- Piece 10: step 6 no longer chains to step 8, so a GIFI line, tax code or type change clears step 8 here, as before.
    perform private.cb_clear_step(v_file, 't2', v_txt);
  elsif tg_table_name = 'cb_imports' then
    v_step := case v_row.target when 'account_list' then 'compare' when 'last_year' then 'opening' else 'records' end;
    v_txt := format('%s %s (%s)', case v_row.target when 'account_list' then 'QuickBooks Account List' when 'last_year' then 'Last year''s trial balance' else 'Trial balance' end,
      case tg_op when 'INSERT' then 'imported' else 'removed' end, v_row.file_name);
    if v_row.target = 'account_list' then
      perform private.cb_clear_step(v_file, 'code', v_txt);
      perform private.cb_clear_step(v_file, 't2', v_txt);   -- piece 10, as above
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    select format('Statement %s: %s, %s to %s', v_verb, b.name, to_char(v_row.period_start, 'Mon FMDD, YYYY'), to_char(v_row.period_end, 'Mon FMDD, YYYY')) into v_txt
      from public.cb_bank_accounts b where b.id = v_row.account_id;
  elsif tg_table_name = 'cb_opening_balances' then
    v_txt := format('Last year''s balance sheet: GIFI %s %s', v_row.code, v_verb);
  elsif tg_table_name = 'cb_entries' then
    v_txt := format('Entry %s-%s %s', (select to_char(year_end, 'YYYY') from public.cb_files where id = v_file), lpad(v_row.seq::text, 3, '0'), v_verb);
    -- Piece 6: a TJE added, deleted or changed while it stays a TJE. A change of type to or from TJE is an AJE change.
    v_tje := case when tg_op = 'UPDATE' then old.kind = 'TJE' and new.kind = 'TJE' else v_row.kind = 'TJE' end;
  elsif tg_table_name = 'cb_flag_notes' then
    select format('Lead sheet explanation %s: %s', v_verb, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name)) into v_txt
      from public.cb_accounts a where a.id = v_row.account_id;
  -- Piece 10: step 6's ticks and answers (step 6), and the reviewer's "Mark reviewed" on them (step 7, by the trigger's step).
  elsif tg_table_name = 'cb_new_accounts' then
    select btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name) into v_txt
      from public.cb_accounts a where a.file_id = v_file and a.account_key = v_row.account_key limit 1;
    v_txt := coalesce(v_txt, v_row.account_key) || case when tg_op = 'INSERT' then ': confirmed as a new account'
      when tg_op = 'DELETE' then ': new account tick removed' when v_step = 'review' then ': review mark changed' else ': confirmed again' end;
  elsif tg_table_name = 'cb_year_changes' then
    v_txt := private.cb_year_question(v_row.question) || case when tg_op = 'DELETE' then ': answer removed' when v_step = 'review' then ': review mark changed' else ': answered' end;
  elsif tg_table_name = 'cb_compare_seen' then
    v_txt := case when tg_op = 'DELETE' then 'Accounts not used this year: Seen removed' else 'Accounts not used this year: Seen ticked' end;
  end if;
  -- Piece 7 (Hashim, Nov 18, 2026): the GST/HST returns figure and its note belong to step 8. A change to them clears step 8,
  -- not step 5. The revenue check itself (step 5) clears step 5 as before.
  -- (Nested: v_row is another table's row on other triggers, so its kind is read only here.)
  if tg_table_name = 'cb_revenue_sources' then
    if v_row.kind = 'gst_returns' then
      perform private.cb_clear_step(v_file, 't2', 'The revenue on the GST/HST returns changed');
      return null;
    end if;
  end if;
  if tg_table_name = 'cb_revenue_checks' then
    if tg_op = 'UPDATE' then
      if old.gst_explanation is distinct from new.gst_explanation then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if old.explanation is not distinct from new.explanation and old.t4a_explanation is not distinct from new.t4a_explanation
         and old.t4a_none is not distinct from new.t4a_none then
        return null;
      end if;
    elsif tg_op = 'INSERT' then
      if new.gst_explanation <> '' then
        perform private.cb_clear_step(v_file, 't2', 'The GST/HST revenue note changed');
      end if;
      if new.explanation = '' and new.t4a_explanation = '' and not new.t4a_none and new.added_at is null then
        return null;
      end if;
    end if;
  end if;
  -- Piece 6 (Hashim, Nov 18, 2026): a tax entry leaves steps 5, 6 and 7 signed. The final GIFI export is stale, so
  -- step 8 is cleared (and steps 9 and 10 follow), as when step 5's chain cleared it.
  if v_tje and v_step = 'entries' then
    perform private.cb_clear_step(v_file, 't2', coalesce(nullif(v_txt, ''), v_why));
    return null;
  end if;
  if v_step = 'records' and exists (select 1 from public.cb_files where id = v_file and books in ('statements', 'paper')) then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], coalesce(nullif(v_txt, ''), v_why));   -- round 34
    -- Piece 10b: statement lines or statements added or removed move the balances: step 6 reopens even when step 3 is not
    -- fully signed. A statement changed in place (its file replaced, its source) moves nothing.
    if tg_op <> 'UPDATE' then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  else
    perform private.cb_clear_step(v_file, v_step, coalesce(nullif(v_txt, ''), v_why));
    -- Piece R2, decision 1A: a trial balance import (this year or last year) moves the balances the step 6 tie reads, so
    -- step 6 reopens, as statement changes do on bank files.
    if tg_table_name = 'cb_imports' then
      if v_row.target <> 'account_list' then perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why)); end if;
    end if;
  end if;
  -- Piece 10b (Hashim, Nov 19, 2026): an AJE or RJE that moves a balance reopens step 6: added or deleted, its lines changed,
  -- or its type or date changed. Its note, reason, W/P ref or attachments, and the revenue check, leave step 6 signed.
  -- (Nested: old and new are read only for cb_entries.)
  if v_step = 'entries' then
    if tg_table_name = 'cb_entry_lines' then
      -- cb_edit_entry writes every line again; it clears step 6 itself, only when the lines differ.
      v_moved := coalesce(current_setting('cb.lines_rewrite', true), '') <> 'on';
    elsif tg_table_name = 'cb_entries' then
      if tg_op <> 'UPDATE' then
        v_moved := true;
      elsif old.kind is distinct from new.kind or old.entry_date is distinct from new.entry_date then
        v_moved := true;
      end if;
    end if;
    if v_moved then
      perform private.cb_clear_step(v_file, 'compare', coalesce(nullif(v_txt, ''), v_why));
    end if;
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_is_reviewer(p_file cb_files)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select (select auth.uid()) = p_file.reviewer_id or private.cb_can('review');
$function$;

CREATE OR REPLACE FUNCTION private.cb_quick_rate_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'New rates start as pending. An Admin approves them.' using errcode = '42501'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Quick method rates are kept as a record. Retire a rate instead of deleting it.' using errcode = '42501';
  end if;
  if old.status <> 'pending' and (new.province, new.services_rate, new.goods_rate, new.effective_from, new.source_url, new.checked_on, new.checked_by)
     is distinct from (old.province, old.services_rate, old.goods_rate, old.effective_from, old.source_url, old.checked_on, old.checked_by) then
    raise exception 'An approved rate cannot be changed. Add a new rate and retire this one.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not (private.is_admin() and private.can_edit('closebook')) then raise exception 'Only an Admin can approve or retire a quick method rate.' using errcode = '42501'; end if;
    if old.status = 'retired' or (old.status = 'approved' and new.status = 'pending') then
      raise exception 'A retired rate stays retired; an approved rate can only be retired.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_substep_guard(p_file uuid, p_subs text[], p_confirm boolean, p_what text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_subs text[]; v_rev boolean; v_label text; v_file public.cb_files; v_me uuid := (select auth.uid());
begin
  select array_agg(substep order by substep), bool_or(reviewed_at is not null) into v_subs, v_rev
    from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) and prepared_at is not null;
  if v_subs is null then return; end if;
  v_label := case array_length(v_subs, 1) when 1 then v_subs[1] when 2 then v_subs[1] || ' and ' || v_subs[2] else v_subs[1] || ', ' || v_subs[2] || ' and ' || v_subs[3] end;
  select * into v_file from public.cb_files where id = p_file;
  if v_rev and not (private.cb_can('remove_signoffs') or v_me = v_file.reviewer_id
      or exists (select 1 from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs) and reviewed_by = v_me)) then
    raise exception 'Ask the reviewer to remove the % sign-off.', v_label using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'This removes the sign-off on %. Continue?', v_label using errcode = '42501';
  end if;
  delete from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs);
  perform private.cb_log_event(p_file, 'signoff_removed', 'records', format('%s removed: %s', private.cb_substep_label(v_subs), p_what),
    null, null, '', p_what, v_label || ' signed', 'not signed');
  perform private.cb_records_follow(p_file);
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_draft_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if current_setting('app.catalogue_cleanup', true) = 'on' and tg_table_name = 'rules' and tg_op = 'UPDATE'
     and (private.is_admin() and private.can_edit('pricing')) and (to_jsonb(new) - 'item_code') = (to_jsonb(old) - 'item_code') then
    return new; -- only the item a rule adds is changed
  end if;
  if exists (
    select 1 from public.questionnaires
    where id in (case when tg_op <> 'INSERT' then old.questionnaire_id end,
                 case when tg_op <> 'DELETE' then new.questionnaire_id end)
      and status <> 'draft'
  ) then
    raise exception 'Only a draft can be changed. Create a new draft from the published version.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_tax_rate()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Tax rates are kept as a record. Retire a rate instead of deleting it.' using errcode = '42501';
  end if;
  if old.status = 'approved' and (new.rate_percent, new.province, new.tax, new.effective_from, new.source_url, new.checked_on)
     is distinct from (old.rate_percent, old.province, old.tax, old.effective_from, old.source_url, old.checked_on) then
    raise exception 'An approved rate cannot be changed. Add a new rate and retire this one.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (private.is_admin() and private.can_edit('tax_rates')) then
    raise exception 'Only an Admin can approve or retire a tax rate.' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_wording_version()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'An approved wording version is kept as a record.' using errcode = '42501'; end if;
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' or new.is_current then raise exception 'A new wording version starts as a draft.' using errcode = '42501'; end if;
    return new;
  end if;
  if current_setting('app.wording_owner_action', true) = 'on' and not (private.is_admin() and private.can_edit('engagement_terms')) then
    raise exception 'Only an Admin approves wording or makes a version current.' using errcode = '42501';
  end if;
  if current_setting('app.wording_owner_action', true) is distinct from 'on' then
    if old.status <> 'draft' then raise exception 'An approved wording version cannot be changed.' using errcode = '42501'; end if;
    if new.status <> old.status or new.is_current <> old.is_current or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at then
      raise exception 'Only an Admin approves wording or makes a version current.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.lead_rules()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status in ('lost', 'out_of_scope', 'signed') and (tg_op = 'INSERT' or old.status is distinct from new.status) then new.closed_at := now(); end if;
  if new.status not in ('lost', 'out_of_scope', 'signed') then new.closed_at := null; end if;
  if tg_op = 'UPDATE' and new.assigned_to is distinct from old.assigned_to and (select auth.uid()) is not null and not (private.can_edit('leads') and private.can_edit('settings')) then
    raise exception 'You need Edit on Leads and Settings to reassign a lead.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and current_setting('app.lead_complete', true) is distinct from 'on'
     and (new.route, new.first_name, new.last_name, new.email, new.phone, new.province, new.answers, new.ip_hash, new.created_at)
     is distinct from (old.route, old.first_name, old.last_name, old.email, old.phone, old.province, old.answers, old.ip_hash, old.created_at) then
    raise exception 'What the client entered cannot be changed. Add a note instead.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_catalogue_cleanup(p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_op jsonb;
  v_item uuid;
  v_line uuid;
  v_done int := 0;
begin
  perform private.require((private.is_admin() and private.can_edit('pricing')), 'Only an Admin can apply the price book clean-up.');
  perform private.require(jsonb_typeof(p_plan) = 'array', 'The plan is not valid.');
  perform set_config('app.catalogue_cleanup', 'on', true);
  for v_op in select * from jsonb_array_elements(p_plan) loop
    case v_op ->> 'op'
    when 'set_line' then
      select id into v_line from public.service_lines where key = v_op ->> 'line';
      perform private.require(v_line is not null, 'Unknown service line ' || coalesce(v_op ->> 'line', ''));
      update public.catalogue_items set service_line_id = v_line where code = v_op ->> 'code';
    when 'set_fields' then
      perform private.require(v_op ->> 'name' is null or length(btrim(v_op ->> 'name')) > 0, 'A name cannot be blank.');
      update public.catalogue_items set
        name = coalesce(v_op ->> 'name', name),
        unit_label = coalesce(v_op ->> 'unit_label', unit_label),
        internal_note = coalesce(v_op ->> 'internal_note', internal_note),
        per_spouse = coalesce((v_op ->> 'per_spouse')::boolean, per_spouse)
      where code = v_op ->> 'code';
    when 'add_item' then
      select id into v_line from public.service_lines where key = v_op ->> 'line';
      perform private.require(v_line is not null, 'Unknown service line');
      perform private.require(not exists (select 1 from public.catalogue_items where code = v_op ->> 'code'), 'Item ' || (v_op ->> 'code') || ' already exists.');
      insert into public.catalogue_items (service_line_id, code, name, description, unit_label, per_spouse, sort_order, category, income_account, price_type, studio_source)
      values (v_line, v_op ->> 'code', v_op ->> 'name', coalesce(v_op ->> 'description', ''), v_op ->> 'unit_label', (v_op ->> 'per_spouse')::boolean,
              (v_op ->> 'sort_order')::numeric, 'T1 personal', v_op ->> 'income_account', v_op ->> 'price_type', 'Brief')
      returning id into v_item;
      insert into public.item_prices (item_id, amount_cents, effective_from, note)
      values (v_item, (v_op ->> 'price_cents')::int, private.today(), 'From the build brief');
    when 'replace_item' then
      perform private.require(exists (select 1 from public.catalogue_items where code = v_op ->> 'to'), 'Replacement item ' || (v_op ->> 'to') || ' is not in the price book.');
      update public.rules set item_code = v_op ->> 'to' where item_code = v_op ->> 'from';
      delete from public.item_prices where item_id = (select id from public.catalogue_items where code = v_op ->> 'from');
      delete from public.catalogue_items where code = v_op ->> 'from';
    when 'remove_t1_offers' then
      delete from public.offers where segment = 'T1 personal';
    when 'remove_empty_line' then
      delete from public.service_lines sl where sl.key = v_op ->> 'line'
        and not exists (select 1 from public.catalogue_items i where i.service_line_id = sl.id);
    else
      perform private.require(false, 'Unknown change: ' || coalesce(v_op ->> 'op', ''));
    end case;
    v_done := v_done + 1;
  end loop;
  perform set_config('app.catalogue_cleanup', 'off', true);
  return jsonb_build_object('applied', v_done);
end;
$function$;

CREATE OR REPLACE FUNCTION public.apply_taxdome_import(p_plan jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_op jsonb;
  v_ins int := 0;
  v_upd int := 0;
  v_tags text[];
begin
  perform private.require((private.is_admin() and private.can_edit('clients')), 'Only an Admin can import from TaxDome.');
  perform private.require(jsonb_typeof(p_plan) = 'array', 'The import list is not valid.');
  perform set_config('app.taxdome_import', 'on', true);
  for v_op in select * from jsonb_array_elements(p_plan) loop
    perform private.require(coalesce(v_op ->> 'taxdome_id', '') <> '', 'Every account needs its TaxDome id.');
    perform private.require(length(btrim(coalesce(v_op ->> 'legal_name', ''))) between 1 and 200, 'Every account needs a legal name.');
    perform private.require(coalesce(v_op ->> 'bn', '') = '' or (v_op ->> 'bn') ~ '^\d{9}$', 'Business Number must be 9 digits.');
    perform private.require(coalesce(v_op ->> 'fye', '') = '' or (v_op ->> 'fye') ~ '^\d{2}-\d{2}$', 'Year-end must be MM-DD.');
    v_tags := array(select jsonb_array_elements_text(coalesce(v_op -> 'tags', '[]'::jsonb)));
    if v_op ->> 'op' = 'insert' then
      insert into public.clients (kind, legal_name, entity_type, province, year_end_md, business_number, taxdome_account_id, taxdome_tags, taxdome_synced_at, source)
      values ('corporation', btrim(v_op ->> 'legal_name'), 'Other',
              case when v_op ->> 'province' in ('ON', 'AB', 'BC', 'OTHER') then v_op ->> 'province' else 'OTHER' end,
              coalesce(v_op ->> 'fye', ''), coalesce(v_op ->> 'bn', ''), v_op ->> 'taxdome_id', v_tags, now(), jsonb_build_object('from', 'TaxDome'));
      v_ins := v_ins + 1;
    elsif v_op ->> 'op' = 'update' then
      perform private.require(exists (select 1 from public.clients c where c.id = (v_op ->> 'client_id')::uuid and (c.taxdome_account_id is null or c.taxdome_account_id = v_op ->> 'taxdome_id')),
        'A matched client changed since the preview. Check the list again.');
      update public.clients set
        legal_name = btrim(v_op ->> 'legal_name'),
        business_number = case when coalesce(v_op ->> 'bn', '') <> '' then v_op ->> 'bn' else business_number end,
        year_end_md = case when coalesce(v_op ->> 'fye', '') <> '' then v_op ->> 'fye' else year_end_md end,
        taxdome_account_id = v_op ->> 'taxdome_id', taxdome_tags = v_tags, taxdome_synced_at = now()
      where id = (v_op ->> 'client_id')::uuid;
      v_upd := v_upd + 1;
    else
      perform private.require(false, 'Unknown import step.');
    end if;
  end loop;
  perform set_config('app.taxdome_import', 'off', true);
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'taxdome_import', 'clients', jsonb_build_object('added', v_ins, 'updated', v_upd));
  return jsonb_build_object('added', v_ins, 'updated', v_upd);
end;
$function$;

CREATE OR REPLACE FUNCTION public.approve_wording(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('engagement_terms')), 'Only an Admin can approve wording.');
  perform private.require(exists (select 1 from public.wording_versions where id = p_id and status = 'draft'), 'Only a draft can be approved.');
  perform set_config('app.wording_owner_action', 'on', true);
  update public.wording_versions set is_current = false where is_current;
  update public.wording_versions set status = 'approved', is_current = true, approved_by = (select auth.uid()), approved_at = now(), current_reason = 'Approved' where id = p_id;
  perform set_config('app.wording_owner_action', 'off', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_gst_check(p_file uuid, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c public.cb_gst_check;
begin
  perform private.require(private.cb_can('review'), 'Only the reviewer accepts a GST/HST difference. Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_why, ''))) >= 3, 'Say why the difference is accepted.');
  select * into c from public.cb_gst_check where file_id = p_file;
  perform private.require(c.file_id is not null and c.diff <> 0, 'There is no GST/HST difference to accept.');
  update public.cb_gst_check set accepted_by = (select auth.uid()), accepted_at = now(), accepted_why = btrim(p_why) where file_id = p_file;
  perform private.cb_log(p_file, 'gst_check_accepted', 't2', format('%s accepted: %s', private.cb_money(c.diff), btrim(p_why)));
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
  perform private.require((v ->> case p_check when 'revenue' then 'explained' when 'gst' then 'gst_explained' else 't4a_explained' end)::boolean,
    'The preparer explains this difference first.');
  insert into public.cb_revenue_checks (file_id) values (p_file) on conflict (file_id) do nothing;
  if p_check = 'revenue' then update public.cb_revenue_checks set accepted_by = (select auth.uid()), accepted_at = now(), accepted_diff = v_diff where file_id = p_file;
  elsif p_check = 'gst' then update public.cb_revenue_checks set gst_accepted_by = (select auth.uid()), gst_accepted_at = now(), gst_accepted_diff = v_diff where file_id = p_file;
  else update public.cb_revenue_checks set t4a_accepted_by = (select auth.uid()), t4a_accepted_at = now(), t4a_accepted_diff = v_diff where file_id = p_file;
  end if;
  perform private.cb_log(p_file, 'revenue_accepted', case when p_check = 'gst' then 't2' else 'entries' end, format('%s %s accepted', v_name, private.cb_money(v_diff)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_accept_sh_flag(p_file uuid, p_account text, p_flag text, p_why text, p_kind text DEFAULT ''::text, p_year integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; g public.cb_sh_flags; v_why text := btrim(coalesce(p_why, '')); v_kind text := coalesce(p_kind, '');
begin
  perform private.require(private.cb_can('review'), 'Only the reviewer accepts a shareholder loan flag. Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into g from public.cb_sh_flags where file_id = p_file and account_key = p_account and flag = p_flag;
  -- Piece 8: the reviewer answers the flag in step 7; no preparer's answer is needed first.
  perform private.require(g.file_id is not null, 'There is no such flag. Click Update first.');
  if p_flag = 'earlier_debit' then
    perform private.require(v_kind in ('included', 'not_included'), 'Pick the decision: included in the shareholder''s income, or not included.');
    if v_kind = 'included' then
      perform private.require(p_year between 1990 and extract(year from v_file.year_end)::int, 'Pick the year the amount is included in the shareholder''s income.');
      v_why := format('Included in the shareholder''s income for %s', p_year);
    else
      perform private.require(length(v_why) >= 3, 'Say why the amount is not included.');
    end if;
  else
    perform private.require(length(v_why) >= 3, 'Say why the flag is accepted.');
    v_kind := '';
  end if;
  update public.cb_sh_flags set accepted_by = (select auth.uid()), accepted_at = now(), accepted_why = v_why, accepted_kind = v_kind,
         accepted_year = case when v_kind = 'included' then p_year end
   where file_id = p_file and account_key = p_account and flag = p_flag;
  perform private.cb_log(p_file, 'sh_flag_accepted', 'review', format('%s accepted: %s', p_account,
    case when v_kind = 'not_included' then 'Not included: ' || v_why else v_why end));
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
  perform private.require(not (v ->> 'stale')::boolean, 'Export the final GIFI file again first.');
  update public.cb_t2_tieouts set accepted = accepted || jsonb_build_object(p_item, jsonb_build_object('diff', (i ->> 'diff')::numeric, 'by', (select auth.uid()), 'at', now(), 'reason', btrim(p_reason)))
   where file_id = p_file;
  perform private.cb_log(p_file, 't2_accepted', 't2', format('%s difference %s accepted: %s',
    case p_item when 'ni' then 'Net income' when 'assets' then 'Total assets' when 'cca' then 'CCA' else 'Income tax' end, private.cb_money((i ->> 'diff')::numeric), btrim(p_reason)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_add_note(p_file uuid, p_step text, p_target_type text, p_target uuid, p_body text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_label text := '';
  v_id uuid;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer adds review notes. Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'compare', 'review'), 'Choose a step.');
  perform private.require(length(btrim(coalesce(p_body, ''))) between 1 and 2000, 'Type the note (up to 2,000 characters).');
  if p_target_type = 'account' then
    select btrim(coalesce(nullif(number, '') || ' ', '') || name) into v_label from public.cb_accounts where id = p_target and file_id = p_file;
  elsif p_target_type = 'entry' then
    select format('Entry %s-%s', to_char(v_file.year_end, 'YYYY'), lpad(seq::text, 3, '0')) into v_label from public.cb_entries where id = p_target and file_id = p_file;
  elsif p_target_type = 'bank_line' then
    select format('%s %s %s', to_char(txn_date, 'Mon FMDD'), left(description, 80), to_char(amount, 'FM999,999,990.00')) into v_label from public.cb_bank_lines where id = p_target and file_id = p_file;
  else
    perform private.require(p_target_type = 'step' and p_target is null, 'Unknown note target.');
  end if;
  perform private.require(p_target_type = 'step' or v_label is not null, 'That item is not in this file.');
  insert into public.cb_review_notes (file_id, step, target_type, target_id, target_label, body, created_by)
  values (p_file, p_step, p_target_type, case when p_target_type = 'step' then null else p_target end, coalesce(v_label, ''), btrim(p_body), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'note_added', p_step, left(btrim(p_body), 200));
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_add_quick_province(p_province text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin adds a province.');
  perform private.require(coalesce(p_province, '') in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'), 'Choose a province.');
  insert into public.cb_quick_provinces (province, added_by) values (p_province, (select auth.uid())) on conflict (province) do nothing;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_add_quick_rates(p_rows jsonb, p_from date, p_source text, p_checked_on date, p_notes text DEFAULT ''::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x jsonb; v_s numeric; v_g numeric; v_n int := 0; o public.cb_quick_rates;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin adds quick method rates.');
  perform private.require(jsonb_typeof(coalesce(p_rows, '[]')) = 'array' and jsonb_array_length(coalesce(p_rows, '[]')) > 0, 'No rates to add.');
  perform private.require(coalesce(p_source, '') ~ '^https://www\.canada\.ca/', 'The source must be a canada.ca page.');
  perform private.require(p_checked_on is not null and p_checked_on <= private.today(), 'Enter the date you read the rates on the CRA page (today or before).');
  for x in select * from jsonb_array_elements(p_rows) loop
    perform private.require(coalesce(x ->> 'province', '') in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'), 'Each rate needs its province (two letters, for example ON).');
    v_s := nullif(x ->> 'services', '')::numeric;
    v_g := nullif(x ->> 'goods', '')::numeric;
    perform private.require(v_s is not null or v_g is not null, format('%s: enter the services rate, the goods for resale rate, or both.', x ->> 'province'));
    perform private.require((v_s is null or v_s between 0 and 1) and (v_g is null or v_g between 0 and 1), 'A quick method rate is from 0 to 100%.');
    if exists (select 1 from public.cb_quick_rates r where r.province = x ->> 'province' and r.effective_from is not distinct from p_from
                 and r.status <> 'retired' and r.services_rate is not distinct from v_s and r.goods_rate is not distinct from v_g) then
      continue;
    end if;
    select * into o from public.cb_quick_rates r where r.province = x ->> 'province' and r.effective_from is not distinct from p_from and r.status = 'pending';
    perform private.require(o.id is null, format('%s already has rates waiting for approval%s. Reject them first.', x ->> 'province',
      case when p_from is null then '' else ' from ' || to_char(p_from, 'Mon FMDD, YYYY') end));
    insert into public.cb_quick_rates (province, services_rate, goods_rate, effective_from, source_url, source_name, checked_on, checked_by, notes)
    values (x ->> 'province', v_s, v_g, p_from, p_source,
            case when p_source ~ 'rc4058' then 'CRA guide RC4058, Quick Method of Accounting for GST/HST' else 'CRA page' end,
            p_checked_on, (select auth.uid()), left(coalesce(p_notes, ''), 300));
    insert into public.cb_quick_provinces (province, added_by) values (x ->> 'province', (select auth.uid())) on conflict (province) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_add_sub_line(p_parent text, p_name text, p_statement_line text, p_tax_code text, p_note text, p_reason text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.cb_master_lines;
  v_next int;
  v_line text;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can add GIFI lines.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 3, 'Give a reason for the new line.');
  perform private.require(length(btrim(coalesce(p_name, ''))) >= 2, 'Give the new line a name.');
  select * into v from public.cb_master_lines where line_no = p_parent;
  perform private.require(v.line_no is not null and v.mappable, 'Choose a line staff can map to.');
  select coalesce(max(split_part(line_no, '.', 2)::int), 0) + 10 into v_next from public.cb_master_lines where gifi_code = v.gifi_code;
  perform private.require(v_next <= 90, 'This GIFI code already has nine sub-lines.');
  v_line := v.gifi_code || '.' || lpad(v_next::text, 2, '0');
  insert into public.cb_master_lines (line_no, name, gifi_code, gifi_name, section, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, required_gifi, note, sort_order, updated_by)
  values (v_line, btrim(p_name), v.gifi_code, v.gifi_name, v.section, v.line_type, v.lead_sheet,
          coalesce(nullif(btrim(p_statement_line), ''), v.statement_line), coalesce(p_tax_code, v.default_tax_code), true, v.pair_line, false,
          btrim(coalesce(p_note, '')), v.sort_order + v_next / 1000.0, (select auth.uid()));
  insert into public.cb_master_line_log (line_no, action, changes, reason, changed_by)
  values (v_line, 'add', jsonb_build_object('from', p_parent, 'name', btrim(p_name)), btrim(p_reason), (select auth.uid()));
  return v_line;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_approve_quick_rates()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; v_n int := 0;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can approve quick method rates.');
  for r in select id from public.cb_quick_rates where status = 'pending' order by province loop
    perform private.cb_quick_rate_approve(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n + private.cb_quick_credit_approve();
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_clear_note(p_note uuid, p_reopen_with text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  n public.cb_review_notes;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer clears or reopens a review note.');
  select * into n from public.cb_review_notes where id = p_note for update;
  perform private.require(n.id is not null and n.status <> 'cleared', 'This note is cleared or missing.');
  if p_reopen_with is null then
    update public.cb_review_notes set status = 'cleared', cleared_by = (select auth.uid()), cleared_at = now() where id = p_note;
    perform private.cb_log(n.file_id, 'note_cleared', n.step, '');
  else
    perform private.require(length(btrim(p_reopen_with)) between 1 and 2000, 'Say what is still needed.');
    insert into public.cb_review_note_replies (note_id, body, created_by) values (p_note, btrim(p_reopen_with), (select auth.uid()));
    update public.cb_review_notes set status = 'open', fixed_by = null, fixed_at = null where id = p_note;
    perform private.cb_log(n.file_id, 'note_reopened', n.step, left(btrim(p_reopen_with), 200));
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_code_lines(p_file uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_item jsonb;
  v_acc public.cb_chart_accounts;
  v_tax text;
  v_reviewer boolean;
  v_line public.cb_bank_lines;
  v_kind text;
  v_in boolean;
  v_reason text;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.cb_require_gst_answers(p_file);
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or private.cb_can('review');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to code.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_acc from public.cb_chart_accounts where number = v_item ->> 'account';
    perform private.require(v_acc.number is not null, 'Choose an account from the standard chart.');
    v_tax := nullif(v_item ->> 'tax', '');
    perform private.require(v_tax is not null, 'Choose a sales tax code for every line. Nothing was saved.');
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Unknown sales tax code.');
    select * into v_line from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file;
    perform private.require(v_line.id is not null, 'Line not found.');
    select kind into v_kind from public.cb_bank_accounts where id = v_line.account_id;
    -- Money in: a deposit on a bank account, a payment or refund on a card.
    v_in := case when v_kind = 'card' then v_line.amount < 0 else v_line.amount > 0 end;
    v_reason := case
      when v_reviewer and v_line.status = 'reviewer' then ''
      -- A line uploaded although already in the file stays with the reviewer whoever codes it.
      when v_line.dup_confirmed and v_line.status = 'reviewer' then v_line.reviewer_reason
      when v_acc.account_type = 'Expense' and v_in then 'An expense coded to money in: check it is a refund, or choose another account.'
      when v_acc.account_type = 'Revenue' and not v_in then 'Revenue coded to money out: check it is a refund to a customer, or choose another account.'
      when v_acc.tax_default = 'Check' and not v_reviewer then 'The sales tax on this account is the reviewer''s call.'
      when v_acc.number = '60200' and coalesce(v_tax, '') not like 'MEALS%' then 'Meals coded at the full rate: only 50% of the tax is claimable.'
      else '' end;
    update public.cb_bank_lines set chart_account = v_acc.number, tax_code = v_tax,
      status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason,
      source = coalesce(nullif(v_item ->> 'source', ''), 'manual'), coded_by = (select auth.uid()), coded_at = now()
     where id = (v_item ->> 'id')::uuid and file_id = p_file;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_confirm_sh_repaid(p_file uuid, p_group text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; g public.cb_sh_groups;
begin
  perform private.require(private.cb_can('review'), 'Only the reviewer confirms "Repaid by". Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(not exists (select 1 from public.cb_sh_prepared p where p.file_id = p_file and p.fingerprint <> private.cb_sh_fingerprint(p_file)),
    'The books changed. Click Update first.');
  select * into g from public.cb_sh_groups where file_id = p_file and group_key = p_group;
  perform private.require(g.prior_due_on is not null, 'There is no balance owed at the start of the year to confirm.');
  insert into public.cb_sh_repaid (file_id, account_key, due_on, opening, repaid, unpaid, answered_by)
  values (p_file, p_group, g.prior_due_on, g.prior_opening, g.prior_repaid, g.prior_unpaid, (select auth.uid()))
  on conflict (file_id, account_key) do update set due_on = excluded.due_on, opening = excluded.opening, repaid = excluded.repaid, unpaid = excluded.unpaid,
    answered_by = excluded.answered_by, answered_at = now();
  perform private.cb_log(p_file, 'sh_repaid_confirmed', 'review', format('%s: owed %s at the start of the year; repaid by %s: %s; not repaid: %s',
    private.cb_sh_label(p_group), private.cb_money(g.prior_opening), to_char(g.prior_due_on, 'Mon FMDD, YYYY'), private.cb_money(g.prior_repaid), private.cb_money(g.prior_unpaid)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_confirm_side(p_account uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cb_accounts;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer keeps a balance on this side. Reviewers need the Review right.');
  select * into a from public.cb_accounts where id = p_account;
  perform private.require(a.id is not null and (select phase from public.cb_files where id = a.file_id) <> 'locked', 'This file is locked or the account is gone.');
  perform private.require(private.cb_side_open(p_account), 'This balance is not on the wrong side of its line.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) between 3 and 300, 'Type the reason for keeping it on this line.');
  update public.cb_accounts set side_confirm_reason = btrim(p_reason), side_confirmed_line = coalesce(gifi_override, line_no), side_confirmed_by = (select auth.uid()), side_confirmed_at = now() where id = p_account;
  perform private.cb_log(a.file_id, 'side_confirmed', 'review', format('%s kept on GIFI %s: %s', btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), replace(coalesce(a.gifi_override, a.line_no), '.00', ''), btrim(p_reason)));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_decide_quick_credit(p_approve boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can approve the quick method credit.');
  perform private.require(exists (select 1 from public.cb_settings where quick_credit_draft is not null), 'No credit is waiting for approval.');
  if p_approve then
    perform private.cb_quick_credit_approve();
  else
    update public.cb_settings set quick_credit_draft = null, updated_at = now(), updated_by = (select auth.uid());
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_delete_firm_vendor_rule(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change firm vendor rules.');
  delete from public.cb_firm_vendor_rules where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_delete_standard_entry(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change standard entries.');
  delete from public.cb_standard_entries where id = p_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_excluded_reviewed(p_file uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files := private.cb_file_open(p_file);
begin
  perform private.require((select auth.uid()) = v_file.reviewer_id or private.cb_can('review'), 'Only the reviewer ticks this.');
  update public.cb_files set excluded_reviewed_key = case when p_on then private.cb_excluded_key(p_file) end,
         excluded_reviewed_by = case when p_on then (select auth.uid()) end, excluded_reviewed_at = case when p_on then now() end
   where id = p_file;
  perform private.cb_log_event(p_file, 'excluded_reviewed', 'code', case when p_on then 'Excluded lines reviewed' else 'Excluded lines review removed' end, null, null, '', '', '', '');
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
  perform private.require(cardinality(v_list) = 0, 'The file cannot be locked yet: ' || array_to_string(v_list, ' '));
  update public.cb_file_close set locked_at = now(), locked_by = (select auth.uid()), phase_before_lock = v_file.phase where file_id = p_file;
  perform private.cb_log(p_file, 'locked', 'lock', 'File locked: read-only, its documents kept as delivered');
  update public.cb_files set phase = 'locked', updated_at = now() where id = p_file;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_note_sh_due(p_file uuid, p_account text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; s public.cb_sh_schedules; v_due date;
begin
  perform private.require(private.cb_can('review'), 'Only the reviewer notes the repay-by date. Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_sh_prepared p where p.file_id = p_file and p.fingerprint = private.cb_sh_fingerprint(p_file)),
    'The books changed. Click Update first.');
  select * into s from public.cb_sh_schedules where file_id = p_file and account_key = p_account;
  perform private.require(s.file_id is not null and s.closing > 0, 'This account is not owed by the shareholder at year-end.');
  v_due := (v_file.year_end + interval '1 year')::date;
  insert into public.cb_sh_noted (file_id, account_key, closing, due_on, noted_by) values (p_file, p_account, s.closing, v_due, (select auth.uid()))
  on conflict (file_id, account_key) do update set closing = excluded.closing, due_on = excluded.due_on, noted_by = excluded.noted_by, noted_at = now();
  perform private.cb_log(p_file, 'sh_due_noted', 'review', format('%s %s: owed by the shareholder at year-end %s; repay by %s',
    s.number, s.name, private.cb_money(s.closing), to_char(v_due, 'Mon FMDD, YYYY')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_post_lines(p_file uuid, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  v_item jsonb; l public.cb_bank_lines; o public.cb_bank_lines; v_out public.cb_bank_lines; v_in public.cb_bank_lines;
  v_kind text; v_acc text; v_tax text; v_reason text; v_src text; v_reviewer boolean; v_tr public.cb_bank_accounts; v_sum numeric; v_n int := 0; v_rule uuid;
begin
  perform private.cb_require_gst_answers(p_file);
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or private.cb_can('review');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to post.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into l from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file for update;
    perform private.require(l.id is not null, 'Line not found.');
    if not private.cb_line_pending(l) then continue; end if;   -- posted already (the other side of a pair in the same batch)
    v_kind := coalesce(v_item ->> 'kind', 'code');
    v_src := coalesce(nullif(v_item ->> 'source', ''), 'manual');
    perform private.require(v_src in ('manual', 'rule', 'auto', 'history', 'firm'), 'Unknown source.');
    v_rule := nullif(v_item ->> 'rule_id', '')::uuid;
    if v_kind = 'code' then
      v_acc := v_item ->> 'account'; v_tax := nullif(v_item ->> 'tax', '');
      perform private.require(exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account for every line. Nothing was posted.');
      perform private.require(v_tax is not null and exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code for every line. Nothing was posted.');
      v_reason := private.cb_reviewer_reason(l, v_acc, v_tax, v_reviewer);
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_acc, tax_code = v_tax, transfer_account = null, is_split = false,
             status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason, source = v_src, rule_id = v_rule,
             coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind = 'split' then
      perform private.require(l.is_split, 'Split the line first.');
      select coalesce(sum(amount), 0) into v_sum from public.cb_line_splits where line_id = l.id;
      perform private.require(v_sum = abs(l.amount), 'The split rows must add up to the line. Nothing was posted.');
      select coalesce(max(r), '') into v_reason from (select private.cb_reviewer_reason(l, s.chart_account, s.tax_code, v_reviewer) r from public.cb_line_splits s where s.line_id = l.id) x;
      update public.cb_bank_lines set chart_account = null, tax_code = null, transfer_account = null,
             status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason, source = v_src, rule_id = v_rule,
             coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind = 'transfer' then
      select * into v_tr from public.cb_bank_accounts where id = nullif(v_item ->> 'transfer_account', '')::uuid and file_id = p_file;
      perform private.require(v_tr.id is not null and v_tr.id <> l.account_id, 'Choose another of this file''s accounts.');
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_tr.chart_account, tax_code = null, transfer_account = v_tr.id, is_split = false,
             status = 'done', reviewer_reason = '', source = v_src, rule_id = v_rule, coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind in ('pair', 'already') then
      select * into o from public.cb_bank_lines where id = nullif(v_item ->> 'other', '')::uuid and file_id = p_file for update;
      perform private.require(o.id is not null and o.account_id <> l.account_id, 'The other line was not found.');
      perform private.require(l.amount <> 0 and abs(l.amount) = abs(o.amount), 'The two amounts must be the same to the cent.');
      perform private.require(private.cb_line_out(l) <> private.cb_line_out(o), 'One line must be money out and the other money in.');
      perform private.require(private.cb_pair_days(l, o) <= 7, 'The dates must be within 7 days of each other.');
      perform private.require(not exists (select 1 from public.cb_bank_transfers t where t.out_line in (l.id, o.id) or t.in_line in (l.id, o.id)), 'This line is already in a transfer.');
      perform set_config('cb.transfer', 'on', true);
      if v_kind = 'pair' then
        perform private.require(private.cb_line_pending(o), 'The other line is posted or excluded.');
        perform private.require(not exists (select 1 from public.cb_bank_pair_choices c where c.kind = 'rejected' and c.line_a = least(l.id, o.id) and c.line_b = greatest(l.id, o.id)),
          'These two lines were unpaired.');
        if private.cb_line_out(l) then v_out := l; v_in := o; else v_out := o; v_in := l; end if;
        delete from public.cb_line_splits where line_id in (l.id, o.id);
        -- One entry, from the money-out line: debit the other account, credit this one (tb-build.ts).
        update public.cb_bank_lines set status = 'done', chart_account = (select chart_account from public.cb_bank_accounts where id = v_in.account_id), tax_code = null,
               transfer_account = null, is_split = false, reviewer_reason = '', source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = v_out.id;
        update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, transfer_account = null, is_split = false, reviewer_reason = '',
               source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = v_in.id;
        insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by) values (p_file, v_out.id, v_in.id, (select auth.uid()));
      else
        -- The other side was posted to this line's account before this line came in: this one posts nothing.
        perform private.require(o.status in ('done', 'reviewer') and o.transfer_account = l.account_id, 'The other line is not a transfer posted to this account.');
        update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, transfer_account = null, is_split = false, reviewer_reason = '',
               source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = l.id;
        insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by) values (p_file, o.id, l.id, (select auth.uid()));
      end if;
      perform set_config('cb.transfer', '', true);
    else
      perform private.require(false, 'Unknown action.');
    end if;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_purge_statement(p_statement uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare x public.cb_excluded_statements; v_file public.cb_files; v_imports uuid[]; v_docs text[]; v_reads text[]; v_lines uuid[];
begin
  perform private.require(private.is_admin(), 'Only an Admin can purge.');
  select * into x from public.cb_excluded_statements where id = p_statement;
  perform private.require(x.id is not null, 'Excluded statement not found.');
  perform private.require(x.reason = 'wrong_client', 'Only a statement excluded as Wrong client can be purged.');
  select * into v_file from public.cb_files where id = x.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select array_agg(distinct i) into v_imports from (
    select nullif(x.statement ->> 'statement_import_id', '')::uuid as i
    union select statement_import_id from public.cb_statement_files where statement_id = p_statement
    union select id from public.cb_statement_imports where replaces_statement = p_statement) z where i is not null;
  select array_agg(p) into v_docs from (select nullif(x.statement ->> 'attachment_path', '') as p union select attachment_path from public.cb_statement_files where statement_id = p_statement) z where p is not null;
  select array_agg(storage_path) into v_reads from public.cb_statement_imports where id = any (coalesce(v_imports, '{}')) and storage_path is not null;
  select array_agg((e ->> 'id')::uuid) into v_lines from jsonb_array_elements(x.line_rows) e;
  -- Earlier entries about this statement keep who, when and the event; the other client's details are erased.
  perform set_config('cb.purging', p_statement::text, true);
  update public.cb_file_history set detail = 'Erased: the statement was purged (Wrong client).', ref_label = '', old_value = '', new_value = '', erased_at = now()
   where file_id = x.file_id and erased_at is null
     and (statement_id = p_statement or line_id = any (coalesce(v_lines, '{}')) or import_id = any (coalesce(v_imports, '{}'))
          -- The reader's own entries (uploaded, read) name the file only: its name can hold the period.
          or exists (select 1 from (select x.file_name as n union select file_name from public.cb_statement_files where statement_id = p_statement
                                    union select file_name from public.cb_statement_imports where id = any (coalesce(v_imports, '{}'))) names
                      where length(names.n) >= 5 and position(names.n in detail) > 0));
  perform set_config('cb.purging', '', true);
  delete from public.cb_statement_files where statement_id = p_statement;
  delete from public.cb_statement_imports where id = any (coalesce(v_imports, '{}'));
  delete from public.cb_excluded_statements where id = p_statement;
  perform private.cb_log_event(x.file_id, 'statement_purged', 'records', format('Statement purged: %s line%s erased.', x.lines, case when x.lines = 1 then '' else 's' end),
    p_statement, null, '', 'Wrong client', '', '');
  return jsonb_build_object('documents', to_jsonb(coalesce(v_docs, '{}')), 'reads', to_jsonb(coalesce(v_reads, '{}')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_reopen_file(p_file uuid, p_why text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; c public.cb_file_close;
begin
  perform private.require(private.cb_can('lock'), 'You need the Lock and unlock right to reopen a locked file.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase = 'locked', 'This file is not locked.');
  perform private.require(length(btrim(coalesce(p_why, ''))) >= 5, 'Say why the file is reopened.');
  select * into c from public.cb_file_close where file_id = p_file;
  perform set_config('cb.unlock', 'on', true);
  update public.cb_files set phase = coalesce(c.phase_before_lock, 'conclusion'), updated_at = now() where id = p_file;
  update public.cb_file_close set locked_at = null, locked_by = null, phase_before_lock = null where file_id = p_file;
  perform set_config('cb.unlock', 'off', true);
  perform private.cb_log(p_file, 'reopened', 'lock', btrim(p_why));
  perform private.cb_clear_step(p_file, 'lock', 'File reopened: ' || btrim(p_why));
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
  perform private.require(exists (select 1 from public.cb_new_accounts n where n.file_id = p_file and n.account_key = p_account and n.confirmed_line is not distinct from c.line_no),
    'The preparer confirms it in step 6 first.');
  update public.cb_new_accounts set reviewed_line = case when p_on then c.line_no end, reviewed_by = case when p_on then (select auth.uid()) end,
    reviewed_at = case when p_on then now() end
   where file_id = p_file and account_key = p_account
     and (reviewed_at is null) = p_on;
  if found then perform private.cb_log(p_file, case when p_on then 'new_account_reviewed' else 'new_account_unreviewed' end, 'review', p_account); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_review_year_change(p_file uuid, p_question text, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer marks it reviewed. Reviewers need the Review right.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_year_changes where file_id = p_file and question = p_question and answer), 'Only a "yes" answer is marked reviewed.');
  update public.cb_year_changes set reviewed_by = case when p_on then (select auth.uid()) end, reviewed_at = case when p_on then now() end
   where file_id = p_file and question = p_question and (reviewed_at is null) = p_on;
  if found then perform private.cb_log(p_file, case when p_on then 'year_change_reviewed' else 'year_change_unreviewed' end, 'review', private.cb_year_question(p_question)); end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_firm_vendor_rule(p_vendor_key text, p_account text, p_tax_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change firm vendor rules.');
  perform private.require(length(btrim(coalesce(p_vendor_key, ''))) between 2 and 200, 'Type the vendor as it shows on the statement.');
  perform private.require(exists (select 1 from public.cb_chart_accounts where number = p_account), 'Choose an account from the standard chart.');
  perform private.require(p_tax_mode in ('taxable', 'none', 'line'), 'Choose the sales tax: taxable at the client''s rate, no sales tax, or choose on the line.');
  insert into public.cb_firm_vendor_rules (vendor_key, chart_account, tax_mode, created_by)
  values (upper(btrim(p_vendor_key)), p_account, p_tax_mode, (select auth.uid()))
  on conflict (vendor_key) do update set chart_account = excluded.chart_account, tax_mode = excluded.tax_mode, created_by = excluded.created_by, created_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_itc_factor(p_province text, p_factor text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m text[]; v_num int; v_den int; r public.cb_cra_itc_factors;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change the CRA rates.');
  perform private.require(p_province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'), 'Pick a province or territory.');
  m := regexp_match(coalesce(p_factor, ''), '^\s*(\d{1,6})\s*/\s*(\d{1,6})\s*$');
  perform private.require(m is not null, 'Type the factor as two whole numbers with a slash, for example 13/113.');
  v_num := m[1]::int; v_den := m[2]::int;
  perform private.require(v_num > 0 and v_den > v_num, 'The top number must be more than 0 and smaller than the bottom number, for example 13/113.');
  select * into r from public.cb_cra_itc_factors where province = p_province;
  if r.province is null then
    insert into public.cb_cra_itc_factors (province, numerator, denominator, entered_by) values (p_province, v_num, v_den, (select auth.uid()));
  else
    perform private.require(r.numerator <> v_num or r.denominator <> v_den, 'Nothing changed.');
    update public.cb_cra_itc_factors set numerator = v_num, denominator = v_den, updated_by = (select auth.uid()), updated_at = now() where province = p_province;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_km_rates(p_year integer, p_first_prov numeric, p_after_prov numeric, p_first_terr numeric, p_after_terr numeric, p_new boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.cb_cra_km_rates;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change the CRA rates.');
  perform private.require(p_year is not null and p_year between 2000 and 2100, 'Type the year as four digits, for example 2026.');
  perform private.require(p_first_prov is not null and p_after_prov is not null and p_first_terr is not null and p_after_terr is not null,
    'Fill in all four rates.');
  perform private.require(p_first_prov > 0 and p_after_prov > 0 and p_first_terr > 0 and p_after_terr > 0
    and p_first_prov < 10 and p_after_prov < 10 and p_first_terr < 10 and p_after_terr < 10,
    'Each rate is dollars per km, for example 0.73.');
  perform private.require(round(p_first_prov, 2) = p_first_prov and round(p_after_prov, 2) = p_after_prov
    and round(p_first_terr, 2) = p_first_terr and round(p_after_terr, 2) = p_after_terr, 'Rates have at most two decimals, for example 0.73.');
  select * into r from public.cb_cra_km_rates where year = p_year;
  if p_new then
    perform private.require(r.year is null, format('%s is already in the table. Change its rates instead.', p_year));
    insert into public.cb_cra_km_rates (year, first_prov, after_prov, first_terr, after_terr, entered_by)
    values (p_year, p_first_prov, p_after_prov, p_first_terr, p_after_terr, (select auth.uid()));
  else
    perform private.require(r.year is not null, format('%s is not in the table. Add it first.', p_year));
    perform private.require(r.first_prov <> p_first_prov or r.after_prov <> p_after_prov or r.first_terr <> p_first_terr or r.after_terr <> p_after_terr,
      'Nothing changed.');
    update public.cb_cra_km_rates set first_prov = p_first_prov, after_prov = p_after_prov, first_terr = p_first_terr, after_terr = p_after_terr,
      updated_by = (select auth.uid()), updated_at = now() where year = p_year;
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
    perform private.require(v_itc = coalesce(v_s.itc_claim, true) or (select auth.uid()) = v_file.reviewer_id or private.cb_can('review'),
      'Only the file''s reviewer or someone with the Review right can change "Claim the ITC".');
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

CREATE OR REPLACE FUNCTION public.cb_save_standard_entry(p_id uuid, p_name text, p_kind text, p_reason text, p_debit text, p_credit text, p_memo text, p_wp_ref text, p_reverse boolean, p_tax_mode text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change standard entries.');
  perform private.require(p_debit <> p_credit, 'Choose two different accounts.');
  perform private.require(p_tax_mode in ('taxable', 'none', 'line'), 'Choose the sales tax: taxable at the client''s rate, no sales tax, or choose on the line.');
  if p_id is null then
    insert into public.cb_standard_entries (name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, tax_mode, sort_order)
    values (btrim(p_name), p_kind, p_reason, p_debit, p_credit, btrim(p_memo), btrim(p_wp_ref), coalesce(p_reverse, false), p_tax_mode,
            coalesce((select max(sort_order) from public.cb_standard_entries), 0) + 10)
    returning id into v_id;
  else
    update public.cb_standard_entries set name = btrim(p_name), kind = p_kind, reason = p_reason, debit_account = p_debit, credit_account = p_credit,
      memo = btrim(p_memo), wp_ref = btrim(p_wp_ref), reverse_next_year = coalesce(p_reverse, false), tax_mode = p_tax_mode where id = p_id returning id into v_id;
  end if;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_save_standard_entry_line(p_standard uuid, p_key text, p_account text, p_tax text, p_to_reviewer boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.cb_standard_entry_lines;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only Admins change standard entries.');
  select * into c from public.cb_standard_entry_lines where standard_id = p_standard and key = p_key;
  perform private.require(c.key is not null, 'Unknown line.');
  perform private.require(nullif(p_account, '') is null or exists (select 1 from public.cb_chart_accounts where number = p_account), 'Choose an account from the standard chart.');
  perform private.require(c.pick or nullif(p_account, '') is not null, 'This line needs a default account.');
  perform private.require(nullif(p_account, '') is null or cardinality(c.choices) = 0 or p_account = any (c.choices), format('Choose one of %s.', array_to_string(c.choices, ', ')));
  perform private.require(p_tax in ('taxable', 'meals', 'none', 'auto'), 'Choose the sales tax treatment.');
  update public.cb_standard_entry_lines set account = nullif(p_account, ''), tax = p_tax, to_reviewer = coalesce(p_to_reviewer, false) or capital,
    updated_by = (select auth.uid()), updated_at = now() where standard_id = p_standard and key = p_key;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_book_amortization(p_file uuid, p_on boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_client uuid;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer sets book amortization. Reviewers need the Review right.');
  select client_id into v_client from public.cb_files where id = p_file;
  perform private.require(v_client is not null, 'File not found.');
  insert into public.cb_client_tax_settings (client_id, book_amortization, set_by) values (v_client, coalesce(p_on, false), (select auth.uid()))
  on conflict (client_id) do update set book_amortization = excluded.book_amortization, set_by = excluded.set_by, set_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_line_locked(p_line text, p_locked boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v public.cb_master_lines;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change GIFI lines.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 3, 'Give a reason for the change.');
  select * into v from public.cb_master_lines where line_no = p_line for update;
  perform private.require(v.line_no is not null, 'Line not found.');
  perform private.require(not p_locked or exists (select 1 from public.cb_master_lines s where s.gifi_code = v.gifi_code and s.line_no <> v.line_no and s.mappable),
    'Only a line with sub-lines can be locked: staff need a sub-line to choose instead.');
  perform private.require(v.locked is distinct from p_locked, 'Nothing changed.');
  update public.cb_master_lines set locked = p_locked, updated_at = now(), updated_by = (select auth.uid()) where line_no = p_line;
  insert into public.cb_master_line_log (line_no, action, changes, reason, changed_by)
  values (p_line, 'edit', jsonb_build_object('locked', jsonb_build_array(v.locked, p_locked)), btrim(p_reason), (select auth.uid()));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_quick_credit(p_rate numeric, p_limit numeric, p_source text, p_checked_on date)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin changes the quick method credit.');
  perform private.require(p_rate is not null and p_rate between 0 and 1, 'The credit is a rate from 0 to 100%.');
  perform private.require(p_limit is not null and p_limit >= 0, 'The credit limit is an amount, 0 or more.');
  perform private.require(coalesce(p_source, '') ~ '^https://www\.canada\.ca/', 'The source must be a canada.ca page.');
  perform private.require(p_checked_on is not null and p_checked_on <= private.today(), 'Enter the date you read the credit on the CRA page (today or before).');
  update public.cb_settings set quick_credit_draft = jsonb_build_object('rate', p_rate, 'limit', p_limit, 'source_url', p_source,
           'source_name', case when p_source ~ 'rc4058' then 'CRA guide RC4058, Quick Method of Accounting for GST/HST' else 'CRA page' end,
           'checked_on', p_checked_on), updated_at = now(), updated_by = (select auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_quick_rate_status(p_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare o public.cb_quick_rates;
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can approve or retire a quick method rate.');
  perform private.require(p_status in ('approved', 'retired'), 'Unknown action.');
  select * into o from public.cb_quick_rates where id = p_id for update;
  perform private.require(o.id is not null, 'Rate not found.');
  perform private.require(not (p_status = 'approved' and o.status <> 'pending'), 'Only a pending rate can be approved.');
  perform private.require(not (p_status = 'retired' and o.status = 'retired'), 'This rate is already retired.');
  if p_status = 'approved' then
    perform private.cb_quick_rate_approve(p_id);
  else
    update public.cb_quick_rates set status = 'retired' where id = p_id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_set_review_treatment(p_file uuid, p_line text, p_treatment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_client uuid;
begin
  perform private.require(private.can_edit('closebook') and private.cb_can('review'), 'Only the reviewer sets the treatment. Reviewers need the Review right.');
  select client_id into v_client from public.cb_files where id = p_file;
  perform private.require(v_client is not null, 'File not found.');
  perform private.require(exists (select 1 from public.cb_master_lines where line_no = p_line and default_tax_code = 'REVIEW')
    or exists (select 1 from public.cb_accounts where file_id = p_file and line_no = p_line and tax_code = 'REVIEW'), 'This line is not a REVIEW line.');
  if nullif(p_treatment, '') is null then delete from public.cb_review_treatments where client_id = v_client and line_no = p_line; return; end if;
  perform private.require(p_treatment in ('add100', 'add50', 'deduct100', 'none'), 'Choose the treatment.');
  insert into public.cb_review_treatments (client_id, line_no, treatment, set_by) values (v_client, p_line, p_treatment, (select auth.uid()))
  on conflict (client_id, line_no) do update set treatment = excluded.treatment, set_by = excluded.set_by, set_at = now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sh_due_list()
 RETURNS TABLE(file_id uuid, client_id uuid, client_name text, year_end date, shareholder smallint, accounts text, amount numeric, due_on date, next_file uuid, unpaid numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select g.file_id, f.client_id, c.legal_name, f.year_end, g.shareholder,
         (select string_agg(s.number || ' ' || s.name, ', ' order by s.number) from public.cb_sh_schedules s where s.file_id = g.file_id and s.account_key = any (g.accounts)),
         g.this_part, g.due_on, n.id, r.unpaid
    from public.cb_sh_groups g
    join public.cb_files f on f.id = g.file_id
    join public.clients c on c.id = f.client_id
    left join lateral (select x.id from public.cb_files x where x.client_id = f.client_id and x.year_start > f.year_end order by x.year_start limit 1) n on true
    left join public.cb_sh_repaid r on r.file_id = n.id and r.account_key = g.group_key and r.due_on = g.due_on
   where g.this_part > 0 and g.due_on is not null and private.can_view('closebook')
     and (private.cb_can('review') or f.preparer_id = (select auth.uid()))
     and coalesce(r.unpaid, -1) <> 0
   order by g.due_on, c.legal_name, g.shareholder
$function$;

CREATE OR REPLACE FUNCTION public.cb_update_gst_settings(p_due_annual integer, p_due_period integer, p_credit_rate numeric, p_credit_limit numeric, p_rates jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin changes the GST/HST settings.');
  perform private.require(p_due_annual between 1 and 12 and p_due_period between 1 and 12, 'Due dates: a number of months from 1 to 12.');
  update public.cb_settings set gst_due_months_annual = p_due_annual, gst_due_months_period = p_due_period, updated_at = now(), updated_by = (select auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_update_instalment_threshold(p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin changes thresholds.');
  perform private.require(p_amount is not null and p_amount between 0 and 1000000, 'Instalment threshold: a number from 0 to 1,000,000.');
  update public.cb_settings set instalment_threshold = round(p_amount, 2), updated_at = now(), updated_by = (select auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_update_master_line(p_line text, p_name text, p_statement_line text, p_tax_code text, p_lead_sheet text, p_note text, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v public.cb_master_lines;
  v_changes jsonb := '{}';
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change GIFI lines.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 3, 'Give a reason for the change.');
  select * into v from public.cb_master_lines where line_no = p_line for update;
  perform private.require(v.line_no is not null, 'Line not found.');
  if not v.mappable then
    perform private.require(p_statement_line is not distinct from v.statement_line and p_tax_code is not distinct from v.default_tax_code
      and p_lead_sheet is not distinct from v.lead_sheet, 'A total line is calculated: only its name and note can change.');
  end if;
  if btrim(p_name) is distinct from v.name then v_changes := v_changes || jsonb_build_object('name', jsonb_build_array(v.name, btrim(p_name))); end if;
  if nullif(btrim(p_statement_line), '') is distinct from v.statement_line then v_changes := v_changes || jsonb_build_object('statement_line', jsonb_build_array(v.statement_line, nullif(btrim(p_statement_line), ''))); end if;
  if p_tax_code is distinct from v.default_tax_code then v_changes := v_changes || jsonb_build_object('default_tax_code', jsonb_build_array(v.default_tax_code, p_tax_code)); end if;
  if p_lead_sheet is distinct from v.lead_sheet then v_changes := v_changes || jsonb_build_object('lead_sheet', jsonb_build_array(v.lead_sheet, p_lead_sheet)); end if;
  if btrim(coalesce(p_note, '')) is distinct from v.note then v_changes := v_changes || jsonb_build_object('note', jsonb_build_array(v.note, btrim(coalesce(p_note, '')))); end if;
  perform private.require(v_changes <> '{}', 'Nothing changed.');
  update public.cb_master_lines
     set name = btrim(p_name), statement_line = nullif(btrim(p_statement_line), ''), default_tax_code = p_tax_code,
         lead_sheet = p_lead_sheet, note = btrim(coalesce(p_note, '')), updated_at = now(), updated_by = (select auth.uid())
   where line_no = p_line;
  insert into public.cb_master_line_log (line_no, action, changes, reason, changed_by) values (p_line, 'edit', v_changes, btrim(p_reason), (select auth.uid()));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_update_settings(p_recon numeric, p_flag_amount numeric, p_flag_percent numeric, p_entry_review numeric, p_capital_invoice numeric, p_note1 text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin can change Closebook settings.');
  update public.cb_settings
     set recon_outstanding_max = p_recon, flag_amount = p_flag_amount, flag_percent = p_flag_percent,
         entry_review_amount = p_entry_review, capital_invoice_amount = p_capital_invoice, note1_policy = p_note1,
         updated_at = now(), updated_by = (select auth.uid())
   where id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_update_sh_window(p_days integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin changes thresholds.');
  perform private.require(p_days is not null and p_days between 1 and 365, 'Shareholder loan repayment window: a number of days from 1 to 365.');
  update public.cb_settings set sh_repay_window_days = p_days, updated_at = now(), updated_by = (select auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_update_t2_rounding(p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('closebook')), 'Only an Admin changes thresholds.');
  perform private.require(p_amount is not null and p_amount between 0 and 1000, 'Rounding allowed in the T2 tie-out: a number from 0 to 1,000.');
  update public.cb_settings set t2_rounding = round(p_amount, 2), updated_at = now(), updated_by = (select auth.uid());
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_letter_quote(p_client uuid, p_title text, p_company text, p_details jsonb, p_signers jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_staff public.staff;
  v_ver uuid := (select id from public.wording_versions where is_current);
  v_n int := jsonb_array_length(coalesce(p_signers, '[]'::jsonb));
  v_s jsonb;
  v_i int := 0;
begin
  perform private.require(private.can_final_letter(), 'You need "Can issue Final and send for signing" to issue a Final letter.');
  perform private.require(p_details ->> 'doc_kind' in ('corporate_letter', 't1_letter'), 'Unknown letter.');
  perform private.require(v_n between 1 and 2, 'A letter has one or two signers.');
  for v_s in select * from jsonb_array_elements(p_signers) loop
    perform private.require(length(btrim(coalesce(v_s ->> 'first_name', ''))) between 1 and 80 and length(btrim(coalesce(v_s ->> 'last_name', ''))) between 1 and 80, 'Each signer needs a first and last name.');
    perform private.require(coalesce(v_s ->> 'email', '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$', 'Add the client''s email on the client record: the signing link goes there.');
  end loop;
  select * into v_staff from public.staff where id = (select auth.uid());
  insert into public.quotes (kind, status, title, client_id, company_name, details, sent_at, sent_by, valid_until, sender, signer, wording, wording_label, created_by)
  values ('letter', 'sent', left(btrim(coalesce(p_title, '')), 200), p_client, nullif(left(btrim(coalesce(p_company, '')), 200), ''), p_details,
          now(), v_staff.id, (now() at time zone 'America/Toronto')::date + 21,
          jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
          coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
          coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver), '{}'::jsonb),
          (select label from public.wording_versions where id = v_ver), v_staff.id)
  returning id into v_id;
  for v_s in select * from jsonb_array_elements(p_signers) loop
    insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
    values (v_id, v_i, btrim(v_s ->> 'first_name'), btrim(v_s ->> 'last_name'), lower(btrim(v_s ->> 'email')),
            replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
    v_i := v_i + 1;
  end loop;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_role(p_name text, p_description text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
begin
  perform private.require(private.is_admin(), 'Only an Admin can create roles.');
  -- Piece R3a-1 (12A): a new role starts with Closebook Edit and the Prepare switch, if the creator holds them.
  insert into public.roles (name, description, created_by, cb_prepare)
  values (btrim(p_name), coalesce(btrim(p_description), ''), (select auth.uid()), private.cb_can('prepare'))
  returning id into v_id;
  insert into public.role_permissions (role_id, area_key, level)
  select v_id, a.key, case when a.key = 'closebook' and private.can_edit('closebook') then 'edit' else 'none' end from public.permission_areas a;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.deadlines_mark_done_before(p_before date, p_reason text, p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_batch uuid := gen_random_uuid();
  v_n int;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  perform private.require(private.is_admin(), 'Only an Admin can mark deadlines done in one step.');
  perform private.require(p_before is not null, 'Choose the date.');
  perform private.require(length(v_reason) between 2 and 200, 'Give the reason (2 to 200 characters).');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 2000, 'No deadlines are due before that date.');
  perform private.require(not exists (select 1 from jsonb_array_elements(p_items) i
     where not exists (select 1 from public.clients c where c.id = (i ->> 'client_id')::uuid)
        or not exists (select 1 from public.deadline_kinds k where k.key = i ->> 'kind')
        or (i ->> 'year_end')::date is null), 'A deadline in the list is not valid. Reload My day and try again.');
  insert into public.t2_deadline_done (client_id, year_end, kind, reason, source, batch_id)
  select distinct (i ->> 'client_id')::uuid, (i ->> 'year_end')::date, i ->> 'kind', v_reason, 'batch', v_batch
    from jsonb_array_elements(p_items) i
  on conflict (client_id, year_end, kind) do nothing;
  get diagnostics v_n = row_count;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'deadlines_marked_done_before', 'deadlines', v_batch, jsonb_build_object('before', p_before, 'reason', v_reason, 'count', v_n));
  return jsonb_build_object('batch_id', v_batch, 'count', v_n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.deadlines_undo_batch(p_batch uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_n int;
begin
  perform private.require(private.is_admin(), 'Only an Admin can undo a batch.');
  perform private.require(exists (select 1 from public.t2_deadline_done where batch_id = p_batch), 'That batch is already undone.');
  perform private.require(not exists (select 1 from public.t2_deadline_done where batch_id = p_batch
     and (done_at at time zone 'America/Toronto')::date <> (now() at time zone 'America/Toronto')::date),
     'A batch can be undone in one step only on the day it was made. Reopen the lines one by one.');
  delete from public.t2_deadline_done where batch_id = p_batch;
  get diagnostics v_n = row_count;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'deadlines_batch_undone', 'deadlines', p_batch, jsonb_build_object('count', v_n));
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.delete_role(p_role_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.admin_lock();
  perform private.require(private.is_admin(), 'Only an Admin can delete roles.');
  perform private.require(private.role_within_caller(p_role_id), 'You cannot delete a role with more access than you.');
  perform private.require(not exists (select 1 from public.staff where role_id = p_role_id),
    'This role is still assigned to staff. Move them to another role first.');
  delete from public.roles where id = p_role_id;
  perform private.require(found, 'Role not found.');
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_files()
 RETURNS TABLE(bucket text, name text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('exports')), 'Only an Admin can download the full export.');
  return query select o.bucket_id::text, o.name::text, o.created_at from storage.objects o order by o.bucket_id, o.name;
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_rows(p_table text, p_offset integer, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_order text;
  v_rows jsonb;
begin
  perform private.require((private.is_admin() and private.can_edit('exports')), 'Only an Admin can download the full export.');
  perform private.require(exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table), 'Unknown table.');
  perform private.require(p_offset >= 0 and p_limit between 1 and 2000, 'Bad page.');
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int[], a.attnum::int)) into v_order
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset %s limit %s) t',
    p_table, coalesce(v_order, '1'), p_offset, p_limit) into v_rows;
  return v_rows;
end;
$function$;

CREATE OR REPLACE FUNCTION public.export_tables()
 RETURNS SETOF text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('exports')), 'Only an Admin can download the full export.');
  return query select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname;
end;
$function$;

CREATE OR REPLACE FUNCTION public.make_wording_current(p_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('engagement_terms')), 'Only an Admin can change the current wording.');
  perform private.require(length(btrim(coalesce(p_reason, ''))) >= 5, 'Give the reason.');
  perform private.require(exists (select 1 from public.wording_versions where id = p_id and status = 'approved'), 'Only an approved version can be made current.');
  perform set_config('app.wording_owner_action', 'on', true);
  update public.wording_versions set is_current = false where is_current;
  update public.wording_versions set is_current = true, current_reason = btrim(p_reason) where id = p_id;
  perform set_config('app.wording_owner_action', 'off', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_client_in_taxdome(p_client uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('clients')), 'Only an Admin can mark a client as matched in TaxDome.');
  update public.clients set status = 'active' where id = p_client and status = 'waiting_taxdome';
  perform private.require(found, 'This client is not waiting for TaxDome.');
end;
$function$;

CREATE OR REPLACE FUNCTION public.publish_t1_screening_now()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('price_book')), 'Only an Admin can publish the batch section 4 questions.');
  return private.publish_t1_screening();
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_full_export(p_tables integer, p_rows integer, p_files integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require((private.is_admin() and private.can_edit('exports')), 'Only an Admin can download the full export.');
  insert into public.settings (key, value, updated_at, updated_by)
  values ('last_full_export', jsonb_build_object('at', now(), 'by', (select auth.uid()), 'tables', p_tables, 'rows', p_rows, 'files', p_files), now(), (select auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$function$;

CREATE OR REPLACE FUNCTION public.send_proposal(p_id uuid, p_first text, p_last text, p_email text)
 RETURNS date
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q public.quotes;
  v_staff public.staff;
  v_until date := (now() at time zone 'America/Toronto')::date + 21;
  v_ver uuid := (select id from public.wording_versions where is_current);
begin
  perform private.require(private.can_final_letter(), 'You need "Can issue Final and send for signing" to send a proposal.');
  select * into v_q from public.quotes where id = p_id for update;
  perform private.require(v_q.id is not null and v_q.kind = 'proposal', 'Proposal not found.');
  perform private.require(v_q.status = 'draft', 'This proposal was already sent.');
  perform private.require(length(btrim(coalesce(p_first, ''))) between 1 and 80 and length(btrim(coalesce(p_last, ''))) between 1 and 80, 'Enter the signing officer''s first and last name.');
  perform private.require(coalesce(p_email, '') ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(p_email) <= 200, 'Enter the signing officer''s email.');
  perform private.require(jsonb_array_length(v_q.proposal -> 'opts') between 1 and 3, 'A proposal has one to three options.');
  select * into v_staff from public.staff where id = (select auth.uid());
  update public.quotes set status = 'sent', sent_at = now(), sent_by = v_staff.id, valid_until = v_until,
    sender = jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
    signer = coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
    wording = coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver), '{}'::jsonb),
    wording_label = (select label from public.wording_versions where id = v_ver),
    company_name = nullif(btrim(v_q.proposal -> 'f' ->> 'L_company'), '')
  where id = p_id;
  insert into public.quote_signers (quote_id, person, first_name, last_name, email, token)
  values (p_id, 0, btrim(p_first), btrim(p_last), lower(btrim(p_email)), replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''));
  update public.leads set status = 'sent' where id = v_q.lead_id and status not in ('signed', 'lost');
  return v_until;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_role_permissions(p_role_id uuid, p_levels jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_key text;
  v_level text;
begin
  perform private.admin_lock();
  perform private.require(private.is_admin(), 'Only an Admin can change permissions.');
  perform private.require(private.role_within_caller(p_role_id), 'You cannot change a role with more access than you.');
  perform private.require(exists (select 1 from public.roles where id = p_role_id), 'Role not found.');
  for v_key, v_level in select key, value from jsonb_each_text(p_levels) loop
    perform private.require(exists (select 1 from public.permission_areas where key = v_key), 'Unknown area: ' || v_key);
    perform private.require(v_level in ('none', 'view', 'edit'), 'Level must be none, view or edit.');
    perform private.require(private.level_rank(v_level) <= private.level_rank(private.permission_level(v_key)), 'You can only give a level you have yourself.');
    insert into public.role_permissions (role_id, area_key, level)
    values (p_role_id, v_key, v_level)
    on conflict (role_id, area_key) do update set level = excluded.level
    where public.role_permissions.level is distinct from excluded.level;
  end loop;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_signing_email(p_letters boolean, p_quotes boolean, p_proposals boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require(private.is_admin(), 'Only an Admin can change how signing emails are sent.');
  insert into public.settings (key, value) values ('signing_email', jsonb_build_object('letters', coalesce(p_letters, false), 'quotes', coalesce(p_quotes, false), 'proposals', coalesce(p_proposals, false)))
  on conflict (key) do update set value = excluded.value;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_role(p_staff_id uuid, p_role_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_current_role uuid;
begin
  perform private.admin_lock();
  perform private.require(private.is_admin(), 'Only an Admin can change roles.');
  perform private.require(p_staff_id <> (select auth.uid()), 'You cannot change your own role.');
  select role_id into v_current_role from public.staff where id = p_staff_id;
  perform private.require(v_current_role is not null, 'Staff member not found.');
  perform private.require(private.role_within_caller(v_current_role),
    'You cannot change the role of someone with more access than you.');
  perform private.require(private.role_within_caller(p_role_id),
    'You can only give a role that does not go beyond your own access.');
  update public.staff set role_id = p_role_id where id = p_staff_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_taxdome_type_tags(p jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  perform private.require((private.is_admin() and private.can_edit('clients')), 'Only an Admin changes the TaxDome tag mapping.');
  perform private.require(jsonb_typeof(p) = 'array', 'The mapping could not be read.');
  for r in select * from jsonb_array_elements(p) loop
    perform private.require(length(btrim(coalesce(r ->> 'tag', ''))) between 1 and 60, 'A tag is 1 to 60 characters.');
    perform private.require(r ->> 'entity_type' in ('PREC', 'Holdco', 'Operating co', 'Professional corp'), 'Pick a type for each tag.');
  end loop;
  delete from public.taxdome_type_tags where true;
  insert into public.taxdome_type_tags (tag, entity_type, updated_by)
  select distinct on (upper(btrim(r ->> 'tag'))) btrim(r ->> 'tag'), r ->> 'entity_type', (select auth.uid()) from jsonb_array_elements(p) r;
  perform set_config('app.taxdome_import', 'on', true);
  perform set_config('app.taxdome_retype', 'on', true);
  update public.clients set entity_type = entity_type where kind = 'corporation' and taxdome_account_id is not null and not entity_type_by_hand;
  perform set_config('app.taxdome_retype', '', true);
  perform set_config('app.taxdome_import', '', true);
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'update', 'taxdome_type_tags', 'mapping', jsonb_build_object('new', p));
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_firm_contact(p_address text, p_phone text, p_email text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a text := btrim(coalesce(p_address, '')); ph text := btrim(coalesce(p_phone, '')); em text := lower(btrim(coalesce(p_email, '')));
begin
  perform private.require(private.is_admin(), 'Only an Admin can change the firm''s contact details.');
  perform private.require(length(a) between 5 and 200, 'Enter the firm''s address.');
  perform private.require(ph ~ '^[0-9 ()+.-]{7,25}$', 'Enter the phone number with digits only, for example 226-555-0100.');
  perform private.require(em ~ '^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$', 'Enter the firm''s email address.');
  insert into public.settings (key, value, updated_at, updated_by) values ('firm_contact', jsonb_build_object('address', a, 'phone', ph, 'email', em), now(), (select auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_role(p_role_id uuid, p_name text, p_description text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform private.require(private.is_admin(), 'Only an Admin can change roles.');
  perform private.require(private.role_within_caller(p_role_id), 'You cannot change a role with more access than you.');
  perform private.require(exists (select 1 from public.roles where id = p_role_id), 'Role not found.');
  update public.roles set name = btrim(p_name), description = coalesce(btrim(p_description), '')
  where id = p_role_id
    and (name is distinct from btrim(p_name) or description is distinct from coalesce(btrim(p_description), ''));
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_setting(p_key text, p_value jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_mode text;
  v_ids jsonb;
  v_count int;
begin
  perform private.require(private.can_edit('settings'), 'You do not have permission to change settings.');
  if p_key = 'lead_assignment' then
    v_mode := p_value ->> 'mode';
    v_ids := coalesce(p_value -> 'staff_ids', '[]'::jsonb);
    perform private.require(v_mode in ('single', 'unassigned', 'rotate'),
      'Assignment must be: one person, unassigned queue, or rotate.');
    perform private.require(jsonb_typeof(v_ids) = 'array', 'Staff list is not valid.');
    v_count := jsonb_array_length(v_ids);
    perform private.require(
      (v_mode = 'unassigned' and v_count = 0) or (v_mode = 'single' and v_count = 1) or (v_mode = 'rotate' and v_count >= 2),
      'Choose one person for "one person", two or more for "rotate", none for "unassigned".');
    perform private.require(not exists (
      select 1 from jsonb_array_elements_text(v_ids) e(id)
      where not exists (select 1 from public.staff s where s.id::text = e.id and s.is_active)
    ), 'Every chosen person must be an active staff member.');
    p_value := jsonb_build_object('mode', v_mode, 'staff_ids', v_ids, 'next_index', 0);
  elsif p_key = 'retention_months' then
    perform private.require(jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::int between 1 and 120,
      'Retention must be a whole number of months from 1 to 120.');
  elsif p_key in ('signer_engagement_letter', 'signer_proposal', 'signer_other') then
    perform private.require(private.is_admin(), 'Only an Admin can change signer names.');
    perform private.require(length(btrim(coalesce(p_value ->> 'name', ''))) between 2 and 120, 'Enter the signer name.');
    perform private.require(length(btrim(coalesce(p_value ->> 'title', ''))) between 2 and 60, 'Enter the signer title.');
    p_value := jsonb_build_object('name', btrim(p_value ->> 'name'), 'title', btrim(p_value ->> 'title'));
  elsif p_key = 'lead_sources' then
    perform private.require(jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) between 1 and 30
      and not exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string' or length(btrim(e #>> '{}')) not between 1 and 60),
      'Each lead source needs a name of up to 60 characters; keep at least one.');
    p_value := (select jsonb_agg(btrim(e #>> '{}')) from jsonb_array_elements(p_value) e);
  elsif p_key = 'start_page_open' then
    perform private.require(private.is_admin(), 'Only an Admin can open or close the public start page.');
    perform private.require(jsonb_typeof(p_value) = 'boolean', 'Choose open or closed.');
  elsif p_key = 'business_hours' then
    perform private.require(private.valid_business_hours(p_value), 'Each day needs a start and end time, start before end, or Closed.');
    p_value := jsonb_build_object('mon', p_value -> 'mon', 'tue', p_value -> 'tue', 'wed', p_value -> 'wed', 'thu', p_value -> 'thu', 'fri', p_value -> 'fri', 'sat', p_value -> 'sat', 'sun', p_value -> 'sun');
  elsif p_key = 'booking_link' then
    perform private.require(jsonb_typeof(p_value) = 'string' and ((p_value #>> '{}') = '' or (p_value #>> '{}') ~ '^https://[^ ]+$'),
      'The booking link must start with https://');
  elsif p_key = 't1_rules' then
    perform private.require(private.is_admin(), 'Only an Admin can change the T1 rule values.');
    perform private.require((p_value ->> 'moving_km') ~ '^\d{1,3}$' and (p_value ->> 'moving_km')::int between 1 and 500, 'Enter the moving distance in kilometres.');
    perform private.require((p_value ->> 't1135_simple_over') ~ '^\d{1,9}$' and (p_value ->> 't1135_detailed_from') ~ '^\d{1,9}$'
      and (p_value ->> 't1135_simple_over')::bigint < (p_value ->> 't1135_detailed_from')::bigint, 'The detailed T1135 threshold must be above the simplified one.');
    perform private.require(coalesce(p_value ->> 'checked_on', '') ~ '^\d{4}-\d{2}-\d{2}$', 'Enter the date you checked the values on canada.ca.');
    p_value := jsonb_build_object('moving_km', (p_value ->> 'moving_km')::int, 't1135_simple_over', (p_value ->> 't1135_simple_over')::bigint,
      't1135_detailed_from', (p_value ->> 't1135_detailed_from')::bigint, 'checked_on', p_value ->> 'checked_on', 'source', 'canada.ca');
  elsif p_key = 'taxdome_account_url' then
    perform private.require(private.is_admin(), 'Only an Admin can change the TaxDome link.');
    perform private.require(jsonb_typeof(p_value) = 'string' and ((p_value #>> '{}') = '' or ((p_value #>> '{}') ~ '^https://' and (p_value #>> '{}') like '%{id}%')),
      'The TaxDome link must start with https:// and contain {id} where the account id goes.');
  elsif p_key = 'signature_image' then
    perform private.require(private.is_admin(), 'Only an Admin can change the signature image.');
    p_value := jsonb_build_object('uploaded', coalesce((p_value ->> 'uploaded')::boolean, false), 'uploaded_at', now());
  else
    perform private.require(false, 'Unknown setting: ' || p_key);
  end if;
  update public.settings set value = p_value, updated_by = (select auth.uid()) where key = p_key;
end;
$function$;


-- 5b. Edited from their latest definition: sign-offs, file people, and owner wording.
CREATE OR REPLACE FUNCTION public.cb_set_people(p_file uuid, p_preparer uuid, p_reviewer uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_names text;
begin
  perform private.require(private.is_admin() and private.can_edit('closebook'), 'Only an Admin changes the preparer and reviewer.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.staff where id = p_preparer and is_active), 'Choose an active staff member as preparer.');
  perform private.require(private.cb_staff_has(p_reviewer, 'review'),
    format('%s does not have the Review right.', coalesce((select full_name from public.staff where id = p_reviewer), 'That person')));
  if v_file.preparer_id = p_preparer and v_file.reviewer_id = p_reviewer then return; end if;
  update public.cb_files set preparer_id = p_preparer, reviewer_id = p_reviewer, updated_at = now() where id = p_file;
  select format('Preparer %s, reviewer %s', (select full_name from public.staff where id = p_preparer), (select full_name from public.staff where id = p_reviewer)) into v_names;
  perform private.cb_log(p_file, 'people_changed', null, v_names);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sign_step(p_file uuid, p_step text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; r public.cb_step_signoffs; v_list text[];
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
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' else '' end);
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
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    insert into public.cb_substep_signoffs (file_id, substep, prepared_by, prepared_at) values (p_file, p_sub, (select auth.uid()), now())
    on conflict (file_id, substep) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at, reviewed_by = null, reviewed_at = null;
    perform private.cb_log(p_file, 'prepared', 'records', 'Sub-step ' || p_sub);
  else
    perform private.require(private.cb_can('review'), 'You need the Review right to sign as reviewer.');
    perform private.require(r.prepared_at is not null, 'The preparer signs first.');
    perform private.require(r.reviewed_at is null, 'This sub-step is already reviewed.');
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    update public.cb_substep_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'reviewed', 'records', 'Sub-step ' || p_sub || case when r.prepared_by = (select auth.uid()) then ': prepared and reviewed by the same person' else '' end);
  end if;
  perform private.cb_records_follow(p_file);
  update public.cb_files set updated_at = now() where id = p_file;
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
      perform private.cb_clear_step(p_file, 'review', 'A step it rests on was taken back');
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

CREATE OR REPLACE FUNCTION public.cb_unsign_substep(p_file uuid, p_sub text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; r public.cb_substep_signoffs;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select * into r from public.cb_substep_signoffs where file_id = p_file and substep = p_sub;
  if p_role = 'reviewed' then
    perform private.require(r.reviewed_at is not null and (r.reviewed_by = (select auth.uid()) or private.cb_can('remove_signoffs')), 'There is no reviewer sign-off of yours to take back.');
    update public.cb_substep_signoffs set reviewed_by = null, reviewed_at = null where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'unsigned_reviewed', 'records', 'Sub-step ' || p_sub);
  else
    perform private.require(r.prepared_at is not null and (r.prepared_by = (select auth.uid()) or private.cb_can('remove_signoffs')), 'There is no preparer sign-off of yours to take back.');
    perform private.require(r.reviewed_at is null, 'The sub-step is reviewed: the reviewer takes back their sign-off first.');
    delete from public.cb_substep_signoffs where file_id = p_file and substep = p_sub;
    perform private.cb_log(p_file, 'unsigned_prepared', 'records', 'Sub-step ' || p_sub);
  end if;
  perform private.cb_records_follow(p_file);
end;
$function$;

CREATE OR REPLACE FUNCTION private.new_rate_pending()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status <> 'pending' then
    raise exception 'New rates start as pending. An Admin approves them.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_locked_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file uuid; v_locked boolean;
begin
  if coalesce(current_setting('cb.unlock', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_table_name = 'cb_files' then
    if old.phase = 'locked' then raise exception 'This file is locked. Someone with the Lock and unlock right can reopen it.' using errcode = 'P0001'; end if;
    return coalesce(new, old);
  elsif tg_table_name = 'cb_entry_lines' then
    select e.file_id into v_file from public.cb_entries e where e.id = coalesce(new.entry_id, old.entry_id);
  elsif tg_table_name = 'cb_review_note_replies' then
    select n.file_id into v_file from public.cb_review_notes n where n.id = coalesce(new.note_id, old.note_id);
  else
    v_file := case when tg_op = 'DELETE' then old.file_id else new.file_id end;
    if tg_op = 'UPDATE' and old.file_id is distinct from new.file_id then
      select phase = 'locked' into v_locked from public.cb_files where id = old.file_id;
      if v_locked then raise exception 'This file is locked. Someone with the Lock and unlock right can reopen it.' using errcode = 'P0001'; end if;
    end if;
  end if;
  select phase = 'locked' into v_locked from public.cb_files where id = v_file;
  if coalesce(v_locked, false) then raise exception 'This file is locked. Someone with the Lock and unlock right can reopen it.' using errcode = 'P0001'; end if;
  return coalesce(new, old);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_review_lines(p_file uuid, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files := private.cb_file_open(p_file); l public.cb_bank_lines; v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(private.cb_is_reviewer(v_file), 'Only the file''s reviewer or someone with the Review right marks a line reviewed.');
  perform set_config('cb.review', 'on', true);
  for l in select * from public.cb_bank_lines where file_id = p_file and id = any (p_ids) and status = 'reviewer' for update loop
    update public.cb_bank_lines set status = 'done', reviewed_reason = reviewer_reason, reviewer_reason = '',
           reviewed_by = (select auth.uid()), reviewed_at = now() where id = l.id;
    perform private.cb_log_event(p_file, 'line_reviewed', 'review', 'Marked reviewed', l.statement_id, l.id, private.cb_line_label(l), l.reviewer_reason, 'For the reviewer', 'Reviewed');
    v_n := v_n + 1;
  end loop;
  perform set_config('cb.review', '', true);
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_unreview_lines(p_file uuid, p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files := private.cb_file_open(p_file); l public.cb_bank_lines; v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(private.cb_is_reviewer(v_file), 'Only the file''s reviewer or someone with the Review right puts the flag back.');
  perform set_config('cb.review', 'on', true);
  for l in select * from public.cb_bank_lines where file_id = p_file and id = any (p_ids) and status = 'done' and reviewed_at is not null for update loop
    update public.cb_bank_lines set status = 'reviewer', reviewer_reason = reviewed_reason, reviewed_reason = '',
           reviewed_by = null, reviewed_at = null where id = l.id;
    perform private.cb_log_event(p_file, 'line_unreviewed', 'review', 'Flag put back for the reviewer', l.statement_id, l.id, private.cb_line_label(l), l.reviewed_reason, 'Reviewed', 'For the reviewer');
    v_n := v_n + 1;
  end loop;
  perform set_config('cb.review', '', true);
  return v_n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_review_account(p_account uuid, p_note text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.cb_accounts; v_file public.cb_files; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into a from public.cb_accounts where id = p_account for update;
  perform private.require(a.id is not null, 'Account not found.');
  v_file := private.cb_file_open(a.file_id);
  perform private.require(private.cb_is_reviewer(v_file), 'Only the file''s reviewer or someone with the Review right marks an account reviewed.');
  perform private.require(length(v_note) between 3 and 500, 'Write the decision: 500 characters at most.');
  perform private.require(a.needs_reviewer, 'This account is not waiting for the reviewer.');
  update public.cb_accounts set needs_reviewer = false, review_note = v_note, review_by = (select auth.uid()), review_at = now(),
         review_cents = round(this_year * 100) where id = a.id;
  perform private.cb_log_event(a.file_id, 'account_reviewed', 'review', 'Account marked reviewed', null, null,
    btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), v_note, a.reviewer_reason, 'Reviewed');
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_staff_active(p_staff_id uuid, p_active boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_role uuid;
begin
  perform private.admin_lock();
  perform private.require(private.can_edit('staff_accounts'), 'You do not have permission to switch accounts on or off.');
  perform private.require(p_staff_id <> (select auth.uid()), 'You cannot switch off your own account.');
  select role_id into v_role from public.staff where id = p_staff_id;
  perform private.require(v_role is not null, 'Staff member not found.');
  perform private.require(private.role_within_caller(v_role),
    'You cannot change the account of someone with more access than you.');
  update public.staff set is_active = p_active where id = p_staff_id;
end;
$function$;


-- 5. Core helpers rewritten (names kept: policies and other functions call them).
-- Retired: there is no Owner role. Kept as a trap so a missed call refuses, never allows.
create or replace function private.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select false
$$;
-- No owner shortcut: every level comes from the role's own row.
create or replace function private.permission_level(p_area text) returns text language sql stable security definer set search_path = '' as $$
  select coalesce((
    select rp.level from public.staff s join public.role_permissions rp on rp.role_id = s.role_id
     where s.id = (select auth.uid()) and s.is_active and rp.area_key = p_area
  ), 'none')
$$;
-- Nobody gives a role more than they hold: every area level, every Letters box and every Closebook switch.
create or replace function private.role_within_caller(p_role_id uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
      select 1 from public.role_permissions rp
       where rp.role_id = p_role_id and private.level_rank(rp.level) > private.level_rank(private.permission_level(rp.area_key)))
    and not exists (
      select 1 from public.roles r where r.id = p_role_id and (
        (r.can_t1_letters and not private.can_letter('t1')) or (r.can_corporate_letters and not private.can_letter('corporate'))
        or (r.can_final_letters and not private.can_final_letter())
        or (r.cb_prepare and not private.cb_can('prepare')) or (r.cb_review and not private.cb_can('review'))
        or (r.cb_partner and not private.cb_can('partner')) or (r.cb_lock and not private.cb_can('lock'))
        or (r.cb_remove_signoffs and not private.cb_can('remove_signoffs'))))
$$;
create or replace function private.can_letter(p_type text) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select case p_type when 't1' then r.can_t1_letters when 'corporate' then r.can_corporate_letters else false end
      from public.staff s join public.roles r on r.id = s.role_id
     where s.id = (select auth.uid()) and s.is_active), false)
$$;

-- 6. The old Owner guards, now about Admin.
create or replace function private.guard_owner_role() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('INSERT', 'UPDATE') and new.is_owner then
    raise exception 'There is no Owner role. Give the rights on the role instead.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create or replace function private.guard_owner_permissions() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  return coalesce(new, old);   -- piece R3a-1: no locked role; the Admin safety rule guards these rows.
end;
$$;
create or replace function private.guard_owner_assignment() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_old boolean := false; v_new boolean := false;
begin
  if (select auth.uid()) is null then return new; end if;
  if tg_op = 'UPDATE' then v_old := private.role_is_admin(old.role_id); end if;
  v_new := private.role_is_admin(new.role_id);
  if (v_old or v_new)
     and (tg_op = 'INSERT' or old.role_id is distinct from new.role_id or old.is_active is distinct from new.is_active)
     and not private.is_admin() then
    raise exception 'Only an Admin can give, remove or switch off a role with Admin.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create or replace function private.guard_at_least_one_owner() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.admin_check();
  return null;
end;
$$;

-- The first person on a new database (tests and setup). Name kept; refused once an Admin exists. Gives the Partner role.
create or replace function private.bootstrap_owner(p_email text, p_full_name text) returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid; v_role uuid;
begin
  if exists (select 1 from public.staff s where s.is_active and private.role_is_admin(s.role_id)) then
    raise exception 'An Admin already exists. Add people in the app.';
  end if;
  select u.id into v_user_id from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user_id is null then
    raise exception 'No login found for %. Create it first under Authentication > Users.', p_email;
  end if;
  select r.id into v_role from public.roles r where r.name = 'Partner';
  if v_role is null then
    select r.id into v_role from public.roles r where private.role_is_admin(r.id) order by r.created_at limit 1;
  end if;
  if v_role is null then raise exception 'No role with Admin found.'; end if;
  insert into public.staff (id, full_name, email, role_id) values (v_user_id, btrim(p_full_name), lower(btrim(p_email)), v_role);
  insert into public.activity_log (action, entity_type, entity_id, details) values ('bootstrap_owner', 'staff', v_user_id::text, '{}');
end;
$$;

-- What the app reads. 'is_owner' stays one release for the app being replaced; it now means Admin.
create or replace function public.my_access() returns jsonb language sql stable security definer set search_path = '' as $$
  select case when not private.is_active_staff() then null else jsonb_build_object(
    'staff_id', (select auth.uid()),
    'full_name', (select s.full_name from public.staff s where s.id = (select auth.uid())),
    'role_name', (select r.name from public.staff s join public.roles r on r.id = s.role_id where s.id = (select auth.uid())),
    'is_owner', private.is_admin(),
    'admin', private.is_admin(),
    'permissions', (select jsonb_object_agg(a.key, private.permission_level(a.key)) from public.permission_areas a),
    'letters', jsonb_build_object('t1', private.can_letter('t1'), 'corporate', private.can_letter('corporate'), 'final', private.can_final_letter()),
    'closebook', jsonb_build_object('prepare', private.cb_can('prepare'), 'review', private.cb_can('review'), 'partner', private.cb_can('partner'),
                                    'lock', private.cb_can('lock'), 'remove_signoffs', private.cb_can('remove_signoffs'))
  ) end
$$;

create or replace function public.set_role_letters(p_role_id uuid, p_t1 boolean, p_corporate boolean) returns void language plpgsql security definer set search_path = '' as $$
declare v_role public.roles;
begin
  perform private.admin_lock();
  perform private.require(private.is_admin(), 'Only an Admin can change roles.');
  select * into v_role from public.roles where id = p_role_id;
  perform private.require(v_role.id is not null, 'That role was not found.');
  perform private.require(private.role_within_caller(p_role_id), 'You cannot change a role with more access than you.');
  perform private.require((not coalesce(p_t1, false) or private.can_letter('t1')) and (not coalesce(p_corporate, false) or private.can_letter('corporate')),
    'You can only give a letter type you have yourself.');
  if v_role.can_t1_letters is distinct from coalesce(p_t1, false) or v_role.can_corporate_letters is distinct from coalesce(p_corporate, false) then
    update public.roles set can_t1_letters = coalesce(p_t1, false), can_corporate_letters = coalesce(p_corporate, false) where id = p_role_id;
    insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
    values ((select auth.uid()), 'role_letters_changed', 'roles', p_role_id,
            jsonb_build_object('role', v_role.name, 't1', coalesce(p_t1, false), 'corporate', coalesce(p_corporate, false),
                               'before', jsonb_build_object('t1', v_role.can_t1_letters, 'corporate', v_role.can_corporate_letters)));
  end if;
end;
$$;

-- Save a whole role in one step: name, description, area levels, Letters boxes and Closebook switches. Refused when it gives
-- anything beyond the caller's own rights; the Admin safety rule is checked at the end of the transaction.
create or replace function public.save_role(p_role_id uuid, p_name text, p_description text, p_levels jsonb, p_letters jsonb, p_switches jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_role public.roles; v_key text; v_level text;
  v_new jsonb := coalesce(p_letters, '{}') || coalesce(p_switches, '{}');
begin
  perform private.admin_lock();
  perform private.require(private.is_admin(), 'Only an Admin can change roles.');
  select * into v_role from public.roles where id = p_role_id for update;
  perform private.require(v_role.id is not null, 'Role not found.');
  perform private.require(private.role_within_caller(p_role_id), 'You cannot change a role with more access than you.');
  perform private.require(nullif(btrim(coalesce(p_name, '')), '') is not null, 'Give the role a name.');
  update public.roles set name = btrim(p_name), description = coalesce(btrim(p_description), '')
   where id = p_role_id and (name is distinct from btrim(p_name) or description is distinct from coalesce(btrim(p_description), ''));
  for v_key, v_level in select key, value from jsonb_each_text(coalesce(p_levels, '{}')) loop
    perform private.require(exists (select 1 from public.permission_areas where key = v_key), 'Unknown area: ' || v_key);
    perform private.require(v_level in ('none', 'view', 'edit'), 'Level must be none, view or edit.');
    perform private.require(private.level_rank(v_level) <= private.level_rank(private.permission_level(v_key)),
      'You can only give a level you have yourself.');
    insert into public.role_permissions (role_id, area_key, level) values (p_role_id, v_key, v_level)
    on conflict (role_id, area_key) do update set level = excluded.level where public.role_permissions.level is distinct from excluded.level;
  end loop;
  -- Boxes and switches: only what the caller holds (so on one's own role, a right can only be switched off).
  perform private.require(
    (not coalesce((v_new ->> 't1')::boolean, false) or private.can_letter('t1'))
    and (not coalesce((v_new ->> 'corporate')::boolean, false) or private.can_letter('corporate'))
    and (not coalesce((v_new ->> 'final')::boolean, false) or private.can_final_letter())
    and (not coalesce((v_new ->> 'prepare')::boolean, false) or private.cb_can('prepare'))
    and (not coalesce((v_new ->> 'review')::boolean, false) or private.cb_can('review'))
    and (not coalesce((v_new ->> 'partner')::boolean, false) or private.cb_can('partner'))
    and (not coalesce((v_new ->> 'lock')::boolean, false) or private.cb_can('lock'))
    and (not coalesce((v_new ->> 'remove_signoffs')::boolean, false) or private.cb_can('remove_signoffs')),
    'You can only give a right you have yourself.');
  update public.roles set
    can_t1_letters = coalesce((v_new ->> 't1')::boolean, can_t1_letters),
    can_corporate_letters = coalesce((v_new ->> 'corporate')::boolean, can_corporate_letters),
    can_final_letters = coalesce((v_new ->> 'final')::boolean, can_final_letters),
    cb_prepare = coalesce((v_new ->> 'prepare')::boolean, cb_prepare),
    cb_review = coalesce((v_new ->> 'review')::boolean, cb_review),
    cb_partner = coalesce((v_new ->> 'partner')::boolean, cb_partner),
    cb_lock = coalesce((v_new ->> 'lock')::boolean, cb_lock),
    cb_remove_signoffs = coalesce((v_new ->> 'remove_signoffs')::boolean, cb_remove_signoffs)
  where id = p_role_id;
  insert into public.activity_log (actor_id, action, entity_type, entity_id, details)
  values ((select auth.uid()), 'role_saved', 'roles', p_role_id,
          jsonb_build_object('role', btrim(p_name), 'levels', coalesce(p_levels, '{}'), 'letters', coalesce(p_letters, '{}'), 'switches', coalesce(p_switches, '{}')));
  perform private.admin_check();
end;
$$;

-- Closebook people. The reviewer needs Review; the preparer needs Closebook Edit and Prepare (R3a-2 adds the file team).
create or replace function private.cb_staff_is_owner(p_staff uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.cb_staff_has(p_staff, 'review')
$$;
create or replace function private.cb_staff_can_prepare(p_staff uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select private.cb_staff_has(p_staff, 'prepare') and exists (select 1 from public.staff s join public.role_permissions rp on rp.role_id = s.role_id
    where s.id = p_staff and s.is_active and rp.area_key = 'closebook' and rp.level = 'edit')
$$;
create or replace function private.cb_file_people() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.cb_staff_has(new.reviewer_id, 'review') then
    raise exception 'The reviewer needs the Review right (Settings, Team and roles).' using errcode = 'P0001';
  end if;
  if not private.cb_staff_can_prepare(new.preparer_id) then
    raise exception 'The preparer needs Closebook Edit and the Prepare right (Settings, Team and roles).' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create or replace function public.lead_alert_recipients() returns setof text language sql stable security definer set search_path = '' as $$
  select s.email from public.staff s
  where s.is_active and exists (
    select 1 from public.role_permissions rp where rp.role_id = s.role_id and rp.area_key = 'pricing' and rp.level in ('view', 'edit'))
  order by s.email
$$;

-- 6. Policies that named owners: same names (drift check), new rights. ALTER, never drop.
alter policy "Owners can read the activity log" on public.activity_log using ((select private.is_admin()));
alter policy "Owners read import runs" on public.import_runs using ((select private.is_admin() and private.can_edit('clients')));
alter policy "Owners add import runs" on public.import_runs with check ((select private.is_admin() and private.can_edit('clients')));
-- The signature image: Admin changes it; whoever may issue a Final letter reads it (decision 3A).
alter policy "Owners read the signature" on storage.objects
  using (bucket_id = 'brand-private' and (select private.is_admin() or private.can_final_letter()));
alter policy "Owners upload the signature" on storage.objects with check (bucket_id = 'brand-private' and (select private.is_admin()));
alter policy "Owners replace the signature" on storage.objects
  using (bucket_id = 'brand-private' and (select private.is_admin())) with check (bucket_id = 'brand-private' and (select private.is_admin()));
alter policy "Owners approve templates" on public.template_approvals with check ((select private.is_admin() and private.can_edit('engagement_terms')));
alter policy "Owners read the master line log" on public.cb_master_line_log using ((select private.is_admin() and private.can_edit('closebook')));
alter policy "Owners read file history" on public.cb_file_history using ((select private.cb_can('review')));   -- decision 4A
alter policy "Owners read user conflicts" on public.client_user_conflicts using ((select private.is_admin() and private.can_edit('clients')));
alter policy "Owners read the statement tool log" on public.statement_tool_log using ((select private.is_admin()));

-- 7. Decision 15A: an engagement changed straight through the Data API needs Admin and Documents Edit (the screen already
-- asked for it), or the right to issue Final letters (the letter flow records the engagement). Database functions that update
-- an engagement (the signing flow) run as their owner and are not affected.
-- Runs as the caller (security invoker) so current_user tells a Data API change from a database function's.
create or replace function private.guard_engagement_update() returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user = 'authenticated' and not ((private.is_admin() and private.can_edit('documents')) or private.can_final_letter()) then
    raise exception 'Only an Admin with Edit on Documents can % an engagement.', case tg_op when 'INSERT' then 'add' else 'update' end
      using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists engagements_guard_update on public.engagements;
create trigger engagements_guard_update before insert or update on public.engagements for each row execute function private.guard_engagement_update();

-- 8. The Admin safety rule on every change that can remove an Admin (checked once, at commit).
drop trigger if exists role_permissions_admin_guard on public.role_permissions;
create constraint trigger role_permissions_admin_guard after insert or update or delete on public.role_permissions
  deferrable initially deferred for each row execute function private.admin_guard();
drop trigger if exists roles_admin_guard on public.roles;
create constraint trigger roles_admin_guard after delete on public.roles
  deferrable initially deferred for each row execute function private.admin_guard();

-- 9. Data: Owner becomes Partner and Staff becomes Accountant (same records, so nobody's role id changes); Manager and Senior
-- accountant are added. Live (read-only check, Nov 19): one active person on Owner, no other roles.
-- Runs only while the Owner role still exists, so a second run changes nothing (security review).
do $$
begin
  if not exists (select 1 from public.roles where is_owner) then return; end if;
  perform private.admin_lock();
  update public.roles set name = 'Partner', description = 'Signs the compilation report. Every right.', is_owner = false,
         can_t1_letters = true, can_corporate_letters = true, can_final_letters = true,
         cb_prepare = true, cb_review = true, cb_partner = true, cb_lock = true, cb_remove_signoffs = true
   where is_owner;
  insert into public.role_permissions (role_id, area_key, level)
  select r.id, a.key, 'edit' from public.roles r cross join public.permission_areas a where r.name = 'Partner'
  on conflict (role_id, area_key) do update set level = 'edit';
  update public.roles set name = 'Accountant', description = 'Prepares files.', can_t1_letters = true, can_corporate_letters = true, cb_prepare = true
   where name = 'Staff';
  update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Accountant');
  insert into public.roles (name, description, can_t1_letters, can_corporate_letters, cb_prepare, cb_review)
  values ('Manager', 'Reviews files and manages the team''s work.', true, true, true, true),
         ('Senior accountant', 'Prepares files and reviews juniors'' files.', true, true, true, true)
  on conflict (name) do nothing;
  insert into public.role_permissions (role_id, area_key, level)
  select r.id, rp.area_key, rp.level from public.roles r
    cross join public.role_permissions rp where r.name in ('Manager', 'Senior accountant')
     and rp.role_id = (select id from public.roles where name = 'Accountant')
  on conflict (role_id, area_key) do nothing;
  -- Decision 10A: the full export only with Admin; Exports is No access on every role except Partner.
  update public.role_permissions set level = 'none'
   where area_key = 'exports' and role_id <> (select id from public.roles where name = 'Partner') and level <> 'none';
  -- Decision 13A.
  update public.permission_areas set description =
    'View: see the files. Edit: work in the files. The Closebook switches decide who prepares, reviews, signs as partner, locks and removes sign-offs.'
   where key = 'closebook';
  insert into public.activity_log (action, entity_type, entity_id, details)
  select 'roles_converted', 'roles', null, jsonb_build_object('piece', 'R3a-1', 'roles', jsonb_agg(jsonb_build_object('name', r.name,
    'final_letters', r.can_final_letters, 'prepare', r.cb_prepare, 'review', r.cb_review, 'partner', r.cb_partner, 'lock', r.cb_lock,
    'remove_signoffs', r.cb_remove_signoffs) order by r.name))
    from public.roles r;
end;
$$;
-- Nothing ends up without an Admin who holds every right (rolls the whole migration back otherwise).
do $$
begin
  if exists (select 1 from public.staff) and not exists (
    select 1 from public.staff s join public.roles r on r.id = s.role_id
     where s.is_active and private.role_is_admin(r.id) and r.cb_prepare and r.cb_review and r.cb_partner and r.cb_lock and r.cb_remove_signoffs and r.can_final_letters) then
    raise exception 'R3a-1: no active person would keep every right. Nothing was changed.';
  end if;
end;
$$;

-- 10. Grants. New public function: authenticated only. Private helpers: not callable directly, except those a policy uses.
revoke all on function public.save_role(uuid, text, text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.save_role(uuid, text, text, jsonb, jsonb, jsonb) to authenticated;
revoke all on function private.role_switch(uuid, text), private.cb_staff_has(uuid, text), private.role_is_admin(uuid),
  private.admin_lock(), private.admin_check(), private.admin_guard() from public, anon, authenticated;
-- A trigger needs no EXECUTE right to fire (security review): nobody may call it directly.
revoke all on function private.guard_engagement_update() from public, anon, authenticated;
revoke all on function private.is_admin(), private.cb_can(text), private.can_final_letter() from public, anon;
grant execute on function private.is_admin(), private.cb_can(text), private.can_final_letter() to authenticated;

reset check_function_bodies;
