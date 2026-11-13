-- Round 6 (Hashim, Nov 22, 2026): step 7 type check follow-ups.
--
-- 1. The reviewer keeps an account on a line of another type only with a typed reason, shown on the line:
--    "Reviewer confirmed: <reason> (name, date)". A match alone no longer confirms it (round 5 counted the
--    reviewer's match as the confirmation). The confirmation holds for the line it was given on: move the
--    account to another line and it is checked again.
-- 2. The QuickBooks Online Account List export is an optional second upload beside the trial balance:
--    each account takes its type from it (matched by account number when there is one, otherwise by name).
--    It is recorded as an import with target 'account_list'.
-- Safe to run twice (round 4d rule).

-- 1.
alter table public.cb_accounts add column if not exists type_confirm_reason text;
alter table public.cb_accounts add column if not exists type_confirmed_by uuid;
alter table public.cb_accounts add column if not exists type_confirmed_at timestamptz;
alter table public.cb_accounts add column if not exists type_confirmed_line text;
alter table public.cb_accounts drop constraint if exists cb_accounts_type_confirm_reason_check;
alter table public.cb_accounts add constraint cb_accounts_type_confirm_reason_check check (length(type_confirm_reason) <= 300);

create or replace function private.cb_open_type_flags(p_file uuid) returns int
language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
   where a.file_id = p_file and a.account_type is not null and m.line_type <> a.account_type
     and not (a.type_confirmed_line is not distinct from a.line_no and coalesce(a.type_confirm_reason, '') <> '');
$$;
revoke all on function private.cb_open_type_flags(uuid) from public, anon, authenticated;

create or replace function public.cb_confirm_type(p_account uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
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
  perform private.require((select auth.uid()) = v_file.reviewer_id, 'Only the file''s reviewer confirms an account on a line of another type.');
  select line_type into v_line_type from public.cb_master_lines where line_no = v_acc.line_no;
  perform private.require(v_acc.account_type is not null and v_line_type is not null and v_line_type <> v_acc.account_type,
    'This account''s type matches its GIFI line: there is nothing to confirm.');
  perform private.require(v_reason <> '', 'Type the reason for keeping this account on a line of another type.');
  perform private.require(length(v_reason) <= 300, 'Keep the reason to 300 characters.');
  update public.cb_accounts set type_confirm_reason = v_reason, type_confirmed_by = (select auth.uid()), type_confirmed_at = now(),
         type_confirmed_line = v_acc.line_no
   where id = p_account;
  update public.cb_files set updated_at = now() where id = v_file.id;
end;
$$;
revoke all on function public.cb_confirm_type(uuid, text) from public, anon;
grant execute on function public.cb_confirm_type(uuid, text) to authenticated;

-- 2.
alter table public.cb_imports drop constraint if exists cb_imports_target_check;
alter table public.cb_imports add constraint cb_imports_target_check check (target in ('this_year', 'last_year', 'account_list'));

-- p_rows: [{"number": "15000", "name": "Computer equipment", "type": "Fixed Assets"}, ...]
-- Returns {"rows": n, "matched": n, "accounts_without": n}: list rows read, accounts given a type, and
-- client accounts in the file still without one.
create or replace function public.cb_import_account_list(p_file uuid, p_file_name text, p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_n int;
  v_matched int := 0;
  v_left int;
  a record;
  v_type text;
  norm constant text := '\s+';
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to import.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.books not in ('statements', 'paper'), 'Bank-statement files use the standard chart: their accounts already have a type.');
  perform private.require(exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year'), 'Import the trial balance first, then the Account List.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 5000, 'The Account List has no accounts, or too many.');
  v_n := jsonb_array_length(p_rows);
  for a in select id, number, name from public.cb_accounts where file_id = p_file
             and account_key not in ('opening', 'uncoded') and account_key not like 'chart:%' and account_key not like 'bank:%'
             and account_key not like 'line:%' and account_key not like 'gifi:%' and not client_new loop
    v_type := null;
    -- By account number when the account has one; otherwise by name (case and spacing ignored).
    if coalesce(a.number, '') <> '' then
      select left(btrim(r ->> 'type'), 60) into v_type from jsonb_array_elements(p_rows) r where btrim(coalesce(r ->> 'number', '')) = a.number limit 1;
    end if;
    if v_type is null then
      select left(btrim(r ->> 'type'), 60) into v_type from jsonb_array_elements(p_rows) r
       where lower(regexp_replace(btrim(coalesce(r ->> 'name', '')), norm, ' ', 'g')) = lower(regexp_replace(btrim(a.name), norm, ' ', 'g')) limit 1;
    end if;
    if coalesce(v_type, '') <> '' then
      update public.cb_accounts set tb_type = v_type where id = a.id;
      v_matched := v_matched + 1;
    end if;
  end loop;
  select count(*) into v_left from public.cb_accounts where file_id = p_file and account_type is null
     and account_key not in ('opening', 'uncoded') and account_key not like 'line:%' and account_key not like 'gifi:%';
  delete from public.cb_imports where file_id = p_file and target = 'account_list';
  insert into public.cb_imports (file_id, target, source, file_name, rows, debit_total, credit_total, imported_by)
  values (p_file, 'account_list', 'quickbooks', left(coalesce(p_file_name, ''), 200), v_n, 0, 0, (select auth.uid()));
  update public.cb_files set updated_at = now() where id = p_file;
  return jsonb_build_object('rows', v_n, 'matched', v_matched, 'accounts_without', v_left);
end;
$$;
revoke all on function public.cb_import_account_list(uuid, text, jsonb) from public, anon;
grant execute on function public.cb_import_account_list(uuid, text, jsonb) to authenticated;
