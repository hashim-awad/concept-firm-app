-- Round 20 (Hashim, Nov 15, 2026): transfers between two of the file's own bank or card accounts, matched in
-- step 4 as the QuickBooks Online bank feed does ("Record as transfer"). Safe to run twice.
--
-- - A money-out line in one account and an equal money-in line in another (same amount to the cent, dates
--   within 5 days, both still to code) is one transfer. Paying a card from the bank is one too: the card's
--   payment line is its money in.
-- - Accepting records it once: the money-out line is coded to the other account's chart account and posts
--   Dr other account, Cr this account; the money-in line is "matched" and posts nothing. Undo removes both.
-- - Each line is in one transfer at most. A line in a transfer cannot be recoded or sent to the client until
--   the transfer is undone. Removing a statement removes its transfers and puts the other line back to code.
-- - Coding both sides to 10900 Clearing (round 4) still works and stays.

-- 1. The new status ("matched") and source ("transfer"). Built from the constraint in place, so a value
--    another migration adds is kept.
do $$
declare d text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conrelid = 'public.cb_bank_lines'::regclass and conname = 'cb_bank_lines_status_check';
  if d is not null and d not like '%''matched''%' then
    execute 'alter table public.cb_bank_lines drop constraint cb_bank_lines_status_check';
    execute 'alter table public.cb_bank_lines add constraint cb_bank_lines_status_check ' || replace(d, '''reviewer''::text', '''reviewer''::text, ''matched''::text');
  end if;
  select pg_get_constraintdef(oid) into d from pg_constraint where conrelid = 'public.cb_bank_lines'::regclass and conname = 'cb_bank_lines_source_check';
  if d is not null and d not like '%''transfer''%' then
    execute 'alter table public.cb_bank_lines drop constraint cb_bank_lines_source_check';
    execute 'alter table public.cb_bank_lines add constraint cb_bank_lines_source_check ' || replace(d, '''manual''::text', '''manual''::text, ''transfer''::text');
  end if;
end $$;

-- 2. One row per transfer: the money-out line (coded, posts once) and the money-in line (matched, posts nothing).
create table if not exists public.cb_bank_transfers (
  id         uuid primary key default gen_random_uuid(),
  file_id    uuid not null references public.cb_files (id) on delete cascade,
  out_line   uuid not null unique references public.cb_bank_lines (id) on delete cascade,
  in_line    uuid not null unique references public.cb_bank_lines (id) on delete cascade,
  created_by uuid references public.staff (id),
  created_at timestamptz not null default now(),
  check (out_line <> in_line)
);
create index if not exists cb_bank_transfers_file on public.cb_bank_transfers (file_id);
alter table public.cb_bank_transfers enable row level security;
alter table public.cb_bank_transfers force row level security;
drop policy if exists "Closebook viewers read transfers" on public.cb_bank_transfers;
create policy "Closebook viewers read transfers" on public.cb_bank_transfers for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_bank_transfers to authenticated;
-- A locked file's transfers cannot change (round 12).
drop trigger if exists cb_locked_guard on public.cb_bank_transfers;
create trigger cb_locked_guard before insert or update or delete on public.cb_bank_transfers for each row execute function private.cb_locked_guard();

-- A line is in one transfer only, on either side.
create or replace function private.cb_transfer_one_each() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.cb_bank_transfers t where t.id <> new.id
              and (t.out_line in (new.out_line, new.in_line) or t.in_line in (new.out_line, new.in_line))) then
    raise exception 'This line is already in a transfer.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.cb_transfer_one_each() from public, anon, authenticated;
drop trigger if exists cb_transfer_one_each on public.cb_bank_transfers;
create trigger cb_transfer_one_each before insert or update on public.cb_bank_transfers for each row execute function private.cb_transfer_one_each();

-- A transfer removed (Undo, or a statement removed): the lines still there go back to code.
create or replace function private.cb_transfer_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null
   where id in (old.out_line, old.in_line);
  perform set_config('cb.transfer', '', true);
  return null;
end;
$$;
revoke all on function private.cb_transfer_removed() from public, anon, authenticated;
drop trigger if exists cb_transfer_removed on public.cb_bank_transfers;
create trigger cb_transfer_removed after delete on public.cb_bank_transfers for each row execute function private.cb_transfer_removed();

-- A line in a transfer keeps its coding until the transfer is undone; only a transfer marks a line matched.
create or replace function private.cb_transfer_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('cb.transfer', true), '') = 'on' then return new; end if;
  if old.status is not distinct from new.status and old.chart_account is not distinct from new.chart_account
     and old.tax_code is not distinct from new.tax_code and old.source is not distinct from new.source then
    return new;
  end if;
  if exists (select 1 from public.cb_bank_transfers t where t.out_line = old.id or t.in_line = old.id) then
    raise exception 'This line is part of a transfer. Undo the transfer first.' using errcode = '42501';
  end if;
  if new.status = 'matched' or (new.source = 'transfer' and old.source is distinct from 'transfer') then
    raise exception 'Only a transfer match marks a line as matched.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.cb_transfer_guard() from public, anon, authenticated;
drop trigger if exists cb_transfer_guard on public.cb_bank_lines;
create trigger cb_transfer_guard before update on public.cb_bank_lines for each row execute function private.cb_transfer_guard();

-- 3. Accept a transfer: p_line and p_other, in either order. The money-out line is coded to the other
--    account's chart account, with no sales tax code (a transfer has none, as in QuickBooks Online, so the
--    GST/HST return leaves it out); the money-in line is matched and posts nothing.
create or replace function public.cb_accept_transfer(p_file uuid, p_line uuid, p_other uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  a public.cb_bank_lines;
  b public.cb_bank_lines;
  v_out public.cb_bank_lines;
  v_in public.cb_bank_lines;
  v_acc_a public.cb_bank_accounts;
  v_acc_b public.cb_bank_accounts;
  v_from public.cb_bank_accounts;
  v_to public.cb_bank_accounts;
  v_a_out boolean;
  v_b_out boolean;
  v_id uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_line is not null and p_other is not null and p_line <> p_other, 'Choose two lines.');
  -- Both rows locked in one order, so two people matching at once cannot both win.
  perform 1 from public.cb_bank_lines where id in (p_line, p_other) and file_id = p_file order by id for update;
  select * into a from public.cb_bank_lines where id = p_line and file_id = p_file;
  select * into b from public.cb_bank_lines where id = p_other and file_id = p_file;
  perform private.require(a.id is not null and b.id is not null, 'Line not found.');
  perform private.require(a.status = 'new' and b.status = 'new', 'Both lines must still be to code. Undo the other line first.');
  perform private.require(a.account_id <> b.account_id, 'A transfer is between two different accounts.');
  select * into v_acc_a from public.cb_bank_accounts where id = a.account_id;
  select * into v_acc_b from public.cb_bank_accounts where id = b.account_id;
  -- Money out: a payment from a bank account, a charge on a card. Money in: a deposit, a card payment.
  v_a_out := case when v_acc_a.kind = 'card' then a.amount > 0 else a.amount < 0 end;
  v_b_out := case when v_acc_b.kind = 'card' then b.amount > 0 else b.amount < 0 end;
  perform private.require(a.amount <> 0 and abs(a.amount) = abs(b.amount), 'The two amounts must be the same to the cent.');
  perform private.require(v_a_out <> v_b_out, 'One line must be money out and the other money in.');
  perform private.require(abs(a.txn_date - b.txn_date) <= 5, 'The dates must be within 5 days of each other.');
  if v_a_out then v_out := a; v_in := b; v_from := v_acc_a; v_to := v_acc_b;
  else v_out := b; v_in := a; v_from := v_acc_b; v_to := v_acc_a; end if;

  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set status = 'done', chart_account = v_to.chart_account, tax_code = null, reviewer_reason = '',
         source = 'transfer', coded_by = (select auth.uid()), coded_at = now()
   where id = v_out.id;
  update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, reviewer_reason = '',
         source = 'transfer', coded_by = (select auth.uid()), coded_at = now()
   where id = v_in.id;
  perform set_config('cb.transfer', '', true);
  insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by)
  values (p_file, v_out.id, v_in.id, (select auth.uid())) returning id into v_id;
  perform private.cb_log(p_file, 'transfer_matched', 'code', format('Transfer of %s from %s on %s to %s on %s',
    private.cb_money(abs(v_out.amount)), v_from.name, to_char(v_out.txn_date, 'Mon FMDD'), v_to.name, to_char(v_in.txn_date, 'Mon FMDD')));
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
revoke all on function public.cb_accept_transfer(uuid, uuid, uuid) from public, anon;
grant execute on function public.cb_accept_transfer(uuid, uuid, uuid) to authenticated;

-- 4. Undo a transfer from either of its lines: both go back to code.
create or replace function public.cb_undo_transfer(p_file uuid, p_line uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  t public.cb_bank_transfers;
  v_label text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  select * into t from public.cb_bank_transfers where file_id = p_file and (out_line = p_line or in_line = p_line) for update;
  perform private.require(t.id is not null, 'This line is not part of a transfer.');
  select format('Transfer of %s from %s on %s to %s on %s', private.cb_money(abs(o.amount)), fa.name, to_char(o.txn_date, 'Mon FMDD'), ta.name, to_char(i.txn_date, 'Mon FMDD'))
    into v_label
    from public.cb_bank_lines o join public.cb_bank_accounts fa on fa.id = o.account_id,
         public.cb_bank_lines i join public.cb_bank_accounts ta on ta.id = i.account_id
   where o.id = t.out_line and i.id = t.in_line;
  delete from public.cb_bank_transfers where id = t.id;
  perform private.cb_log(p_file, 'transfer_undone', 'code', coalesce(v_label, 'Transfer undone'));
  update public.cb_files set updated_at = now() where id = p_file;
  return 2;
end;
$$;
revoke all on function public.cb_undo_transfer(uuid, uuid) from public, anon;
grant execute on function public.cb_undo_transfer(uuid, uuid) to authenticated;

-- 5. Undo on a line (round 2) also undoes its transfer, so both lines go back to code together.
create or replace function public.cb_uncode_lines(p_file uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int; v_t int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  with gone as (delete from public.cb_bank_transfers where file_id = p_file and (out_line = any (p_ids) or in_line = any (p_ids)) returning id)
  select count(*) into v_t from gone;
  if v_t > 0 then perform private.cb_log(p_file, 'transfer_undone', 'code', format('%s transfer%s undone', v_t, case when v_t = 1 then '' else 's' end)); end if;
  update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null
   where file_id = p_file and id = any (p_ids) and status in ('done', 'ask_client', 'reviewer');
  get diagnostics v_n = row_count;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n + v_t;
end;
$$;
revoke all on function public.cb_uncode_lines(uuid, uuid[]) from public, anon;
grant execute on function public.cb_uncode_lines(uuid, uuid[]) to authenticated;

-- 6. The review history says "matched to a transfer" (round 8b's wording, with the new status).
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
          case old.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' else 'for the reviewer' end,
          case new.status when 'new' then 'to code' when 'done' then 'coded' when 'ask_client' then 'with the client' when 'matched' then 'matched to a transfer' else 'for the reviewer' end) end));
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
