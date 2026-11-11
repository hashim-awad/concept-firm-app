-- Closebook (Hashim, Nov 11, 2026, borrowed from QuickBooks' locked parent accounts): a locked GIFI
-- line stays visible, with a lock, but nobody can match an account or post an entry to it; staff choose
-- one of its sub-lines. Locked: the lines whose sub-lines replace them (shareholder 1 or 2, eligible or
-- non-eligible dividends). Not locked: lines whose sub-lines are exceptions to a normal parent (meals,
-- donations, other expenses). Owners change it per line in Settings, with a reason. Enforced here, so
-- matching, last year's history and entries all respect it.

alter table public.cb_master_lines add column locked boolean not null default false;
alter table public.cb_master_lines add constraint cb_master_lines_locked_has_subs check (not locked or line_no like '%.00');
update public.cb_master_lines set locked = true where line_no in ('1301.00', '2781.00', '3701.00');

create or replace function private.cb_line_locked(p_line text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select locked from public.cb_master_lines where line_no = p_line), false)
$$;
revoke all on function private.cb_line_locked(text) from public, anon, authenticated;

-- Owners: lock or unlock a line that has sub-lines, with a reason (logged like any line change).
create or replace function public.cb_set_line_locked(p_line text, p_locked boolean, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.cb_master_lines;
begin
  perform private.require(private.is_owner(), 'Only an owner can change GIFI lines.');
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
$$;
revoke all on function public.cb_set_line_locked(text, boolean, text) from public, anon;
grant execute on function public.cb_set_line_locked(text, boolean, text) to authenticated;

create or replace function public.cb_map_account(p_account uuid, p_line text)
returns void language plpgsql security definer set search_path = '' as $$
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
  perform private.require(not v_acc.needs_reviewer or v_reviewer, 'This account waits for the reviewer''s decision.');
  update public.cb_accounts set line_no = p_line, mapping_source = case when v_reviewer then 'reviewer' else 'preparer' end,
         needs_reviewer = false, mapped_by = (select auth.uid()), mapped_at = now()
   where id = p_account;
  insert into public.cb_client_mappings (client_id, account_key, line_no, tax_code, decided_by)
  values (v_file.client_id, v_acc.account_key, p_line, v_acc.tax_code, (select auth.uid()))
  on conflict (client_id, account_key) do update set line_no = excluded.line_no, decided_by = excluded.decided_by, decided_at = now();
end;
$$;

create or replace function public.cb_apply_matching(p_file uuid, p_suggestions jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_hist int := 0;
  v_sugg int := 0;
  v_rev int := 0;
  v jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to match accounts.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  with h as (
    update public.cb_accounts a set line_no = m.line_no, tax_code = m.tax_code, mapping_source = 'history', mapped_at = now()
      from public.cb_client_mappings m
     where a.file_id = p_file and a.line_no is null and not a.needs_reviewer and m.client_id = v_file.client_id and m.account_key = a.account_key
       and not private.cb_line_locked(m.line_no)
    returning 1)
  select count(*) into v_hist from h;
  for v in select * from jsonb_array_elements(coalesce(p_suggestions, '[]')) loop
    if nullif(v ->> 'line', '') is not null and exists (select 1 from public.cb_master_lines where line_no = v ->> 'line' and mappable) and not private.cb_line_locked(v ->> 'line') then
      update public.cb_accounts set line_no = v ->> 'line', mapping_source = 'suggested', mapped_at = now()
       where id = (v ->> 'account')::uuid and file_id = p_file and line_no is null and not needs_reviewer;
      if found then v_sugg := v_sugg + 1; end if;
    else
      update public.cb_accounts set needs_reviewer = true, reviewer_reason = left(coalesce(v ->> 'reason', 'No clear match'), 300)
       where id = (v ->> 'account')::uuid and file_id = p_file and line_no is null and not needs_reviewer;
      if found then v_rev := v_rev + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('history', v_hist, 'suggested', v_sugg, 'reviewer', v_rev);
end;
$$;

create or replace function public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_id uuid;
  v_n int;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_sum numeric := 0;
  v_income numeric := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  insert into public.cb_entries (file_id, kind, number, reason, note, reverse_next_year, created_by)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          p_reason, btrim(coalesce(p_note, '')), coalesce(p_reverse, false), (select auth.uid()))
  returning id, number into v_id, v_n;
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    if v ? 'account' and nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no into v_acc, v_line from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = p_file;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      perform private.require(v_line is not null, 'Match every account in the entry to a GIFI line first.');
    else
      v_line := v ->> 'line';
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
      select p_file, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
      on conflict (file_id, account_key) do nothing;
      select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'line:' || v_line;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo) values (v_id, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200));
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  -- Every entry made here is a free entry, so it goes to the reviewer (needs_review defaults to true).
  -- Standard entries (Settings, Closebook) will skip review when under the entry threshold.
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
