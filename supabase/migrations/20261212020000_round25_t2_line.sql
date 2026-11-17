-- Round 25 (Hashim, Nov 17, 2026): each bank or card account carries "Last year's T2 line", separate from this
-- year's GIFI line. A prior accountant can have put a line of credit on 2707 with the credit cards: 3.1 compares
-- each T2 line with the accounts that were on it last year. This year's GIFI line does not follow (step 6 maps it).
-- Safe to run twice. No existing account changes: an empty "Last year's T2 line" means the type's usual line.

alter table public.cb_bank_accounts add column if not exists t2_line text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_accounts_t2_line_check') then
    alter table public.cb_bank_accounts add constraint cb_bank_accounts_t2_line_check check (t2_line is null or t2_line ~ '^\d{4}$');
  end if;
end $$;

-- The type's usual line: this year's GIFI line (an account overdrawn at last year end: Bank overdraft, 2600).
create or replace function private.cb_t2_usual(a public.cb_bank_accounts) returns text language sql stable security definer set search_path = '' as $$
  select case when a.kind = 'bank' and a.books_opening < 0 then '2600'
              else left(coalesce(a.gifi_line, (select line_no from public.cb_chart_accounts where number = a.chart_account), ''), 4) end;
$$;
create or replace function private.cb_t2_of(a public.cb_bank_accounts) returns text language sql stable security definer set search_path = '' as $$
  select coalesce(a.t2_line, private.cb_t2_usual(a));
$$;
revoke all on function private.cb_t2_usual(public.cb_bank_accounts), private.cb_t2_of(public.cb_bank_accounts) from public, anon, authenticated;

-- ---------- Add or edit an account: the new field. Empty, or the type's usual line, is stored as empty.
drop function if exists public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean);
create or replace function public.cb_save_bank_account(p_file uuid, p_id uuid, p_type text, p_bank text, p_last4 text,
  p_balance numeric, p_negative boolean, p_long_term boolean, p_confirm boolean default false, p_t2_line text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_acc public.cb_bank_accounts;
  p record;
  v_bank text := btrim(regexp_replace(coalesce(p_bank, ''), '\s+', ' ', 'g'));
  v_last text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
  v_name text;
  v_id uuid;
  v_bal numeric := case when p_negative then -p_balance else p_balance end;
  v_t2 text := nullif(btrim(coalesce(p_t2_line, '')), '');
  v_usual text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select * into p from private.cb_bank_placement(p_type, p_long_term);
  perform private.require(p.std_name is not null, 'Choose the type: chequing, savings, credit card, line of credit or loan.');
  perform private.require(length(v_bank) between 1 and 40, 'Enter the bank, for example RBC.');
  perform private.require(length(v_last) between 2 and 8, 'Enter the last digits of the account or card, as printed on the statement.');
  perform private.require(p_balance is not null and p_balance >= 0 and round(p_balance, 2) = p_balance, 'Enter the balance as a positive number with up to 2 decimals.');
  v_usual := case when p.kind = 'bank' and v_bal < 0 then '2600'
                  else left(coalesce(p.gifi_line, (select line_no from public.cb_chart_accounts where number = p.chart_account), ''), 4) end;
  if v_t2 = v_usual then v_t2 := null; end if;
  -- Last year's T2 line: a balance sheet line in step 2 that holds an amount (or the type's usual line).
  perform private.require(v_t2 is null or (v_t2 ~ '^\d{4}$' and v_t2 between '1000' and '3499'
      and exists (select 1 from public.cb_opening_balances where file_id = p_file and code = v_t2 and amount <> 0)),
    'Choose last year''s T2 line from the balance sheet lines in step 2.');
  v_name := p.std_name || ' · ' || v_bank || ' ••• ' || v_last;
  perform private.require(not exists (select 1 from public.cb_bank_accounts where file_id = p_file and name_key = lower(v_name) and id is distinct from p_id),
    format('%s is already on this file.', v_name));
  if p_id is null then
    insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account, number_base, gifi_line, account_type, bank, last4, long_term, books_opening, origin, created_by, t2_line)
    values (p_file, v_name, lower(v_name), p.kind, p.chart_account, p.number_base, p.gifi_line, p_type, v_bank, v_last, coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
            v_bal, 'added', (select auth.uid()), v_t2)
    returning id into v_id;
    perform private.cb_log_event(p_file, 'bank_account_added', 'records', format('Account added: %s, balance in the books %s.', v_name, to_char(v_bal, 'FM999,999,999,990.00')),
      null, null, v_name, '', '', to_char(v_bal, 'FM999,999,999,990.00'));
  else
    select * into v_acc from public.cb_bank_accounts where id = p_id and file_id = p_file for update;
    perform private.require(v_acc.id is not null, 'Account not found.');
    perform private.require(v_acc.kind = p.kind or not (exists (select 1 from public.cb_bank_statements where account_id = p_id) or exists (select 1 from public.cb_excluded_statements where account_id = p_id)),
      'This account has statements. It can''t change between a bank account and a card, line of credit or loan.');
    if v_acc.books_opening is distinct from v_bal then
      perform private.cb_feed_guard(p_file, p_confirm, 'balance at last year end changed');
    end if;
    update public.cb_bank_accounts set name = v_name, name_key = lower(v_name), kind = p.kind, chart_account = p.chart_account, number_base = p.number_base,
           gifi_line = p.gifi_line, account_type = p_type, bank = v_bank, last4 = v_last, long_term = coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
           books_opening = v_bal, t2_line = v_t2
     where id = p_id;
    v_id := p_id;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
revoke all on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text) to authenticated;

-- ---------- Logged with old and new (shown as the line it resolves to)
do $$
declare d text; k text := $k$  if new.books_opening is distinct from old.books_opening then$k$;
begin
  d := pg_get_functiondef('private.cb_account_log()'::regprocedure);
  if position('cb_t2_of' in d) = 0 and position(k in d) > 0 then
    execute replace(d, k, $r$  if private.cb_t2_of(new) is distinct from private.cb_t2_of(old) then
    perform private.cb_log_event(new.file_id, 'bank_account_changed', 'records', 'Last year''s T2 line changed', null, null, new.name, '',
      'GIFI ' || coalesce(private.cb_t2_of(old), ''), 'GIFI ' || coalesce(private.cb_t2_of(new), ''));
  end if;
$r$ || k);
  end if;
end $$;

-- ---------- The 3.1 sign-off: a change of the field clears 3.1 (and 3.3), as for other account edits
do $$
declare d text; k text := $k$or new.chart_account is distinct from old.chart_account$k$;
begin
  d := pg_get_functiondef('private.cb_banking_changed()'::regprocedure);
  if position('t2_line' in d) = 0 and position(k in d) > 0 then
    execute replace(d, k, k || ' or new.t2_line is distinct from old.t2_line');
  end if;
end $$;

-- ---------- 3.1 compares each of last year's T2 lines with the accounts that were on it. A usual line with a T2
-- amount and no account shows too (an account to add).
create or replace function private.cb_banking31_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_file public.cb_files; v_out text[] := '{}'; a record; g record;
begin
  select * into v_file from public.cb_files where id = p_file;
  if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
    return array['Add the bank and card accounts.'];
  end if;
  for a in select * from public.cb_bank_accounts where file_id = p_file and books_opening is null order by number loop
    v_out := v_out || format('%s %s: enter its balance at last year end.', a.number, a.name);
  end loop;
  if v_file.opening_source is not null or v_file.first_year then
    for g in
      with acc as (select private.cb_t2_of(a2) as code, case when a2.kind = 'bank' and private.cb_t2_of(a2) = '2600' then -coalesce(a2.books_opening, 0) else coalesce(a2.books_opening, 0) end as books
                     from public.cb_bank_accounts a2 where a2.file_id = p_file),
      lines as (select code, sum(books) as books from acc where code <> '' group by code
                union all
                select o.code, 0 from public.cb_opening_balances o
                 where o.file_id = p_file and o.amount <> 0 and o.code in ('1002', '2600', '2707', '2701', '3149', '3143')
                   and not exists (select 1 from acc where acc.code = o.code))
      select l.code, l.books, coalesce((select amount from public.cb_opening_balances where file_id = p_file and code = l.code), 0) as t2 from lines l order by l.code
    loop
      if abs(g.books - g.t2) >= 1 then
        v_out := v_out || format('GIFI %s: the accounts total %s, last year''s T2 has %s (%s %s).', g.code, private.cb_bracket(g.books), private.cb_bracket(g.t2),
          private.cb_bracket(abs(g.books - g.t2)), case when g.books < g.t2 then 'to add' else 'too much' end);
      end if;
    end loop;
  end if;
  return v_out;
end;
$$;
revoke all on function private.cb_banking31_problems(uuid) from public, anon, authenticated;

-- ---------- The trial balance keeps, on each account, the T2 line its last-year figure came from (the review shows
-- "Reclassified from 2707 to 2701" where this year's line differs).
alter table public.cb_accounts add column if not exists last_year_line text;
create or replace function public.cb_build_tb(p_file uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_total numeric := 0;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.books in ('statements', 'paper'), 'Only files built from bank and card statements build their trial balance.');
  perform private.require(jsonb_typeof(p_rows) = 'array', 'Rows are missing.');
  select coalesce(sum((r ->> 'amount')::numeric), 0) into v_total from jsonb_array_elements(p_rows) r;
  perform private.require(v_total = 0, format('The built trial balance does not balance (out by %s).', v_total));

  update public.cb_accounts set this_year = 0, last_year = 0, last_year_line = null,
         needs_reviewer = case when account_key in ('uncoded', 'opening') then false else needs_reviewer end,
         reviewer_reason = case when account_key in ('uncoded', 'opening') then '' else reviewer_reason end
   where file_id = p_file and (account_key like 'chart:%' or account_key like 'bank:%' or account_key like 'gifi:%' or account_key in ('uncoded', 'opening'));
  for v_row in select * from jsonb_array_elements(p_rows) loop
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year, line_no, mapping_source, needs_reviewer, reviewer_reason, mapped_at, last_year_line)
    values (p_file, v_row ->> 'key', coalesce(v_row ->> 'number', ''), v_row ->> 'name', round((v_row ->> 'amount')::numeric, 2), round(coalesce((v_row ->> 'last')::numeric, 0), 2),
            nullif(v_row ->> 'line_no', ''), case when nullif(v_row ->> 'line_no', '') is null then null else 'chart' end,
            coalesce(v_row ->> 'reviewer', '') <> '', coalesce(v_row ->> 'reviewer', ''), now(), nullif(v_row ->> 'last_line', ''))
    on conflict (file_id, account_key) do update
      set this_year = excluded.this_year, last_year = excluded.last_year, name = excluded.name, number = excluded.number,
          needs_reviewer = excluded.needs_reviewer, reviewer_reason = excluded.reviewer_reason, last_year_line = excluded.last_year_line,
          line_no = case when public.cb_accounts.mapping_source in ('preparer', 'reviewer') then public.cb_accounts.line_no else excluded.line_no end,
          mapping_source = case when public.cb_accounts.mapping_source in ('preparer', 'reviewer') then public.cb_accounts.mapping_source else excluded.mapping_source end;
    v_n := v_n + 1;
  end loop;
  -- Built rows with nothing left go, unless an entry or a note points at them.
  delete from public.cb_accounts a
   where a.file_id = p_file and a.this_year = 0 and a.last_year = 0
     and (a.account_key like 'chart:%' or a.account_key like 'bank:%' or a.account_key like 'gifi:%' or a.account_key = 'uncoded' or (a.account_key = 'opening' and not a.needs_reviewer))
     and not exists (select 1 from public.cb_entry_lines l where l.account_id = a.id)
     and not exists (select 1 from public.cb_flag_notes n where n.account_id = a.id);
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

-- ---------- Round 25 follow-up (Hashim, Nov 17, 2026): every account edit that removes a sub-step sign-off asks first
-- (round 24 rule G17). The guard takes the sub-steps the change would clear: signed by the preparer only, it asks
-- ("This removes the sign-off on 3.1. Continue?"); signed by the reviewer, only the reviewer (or an owner) continues
-- ("Ask the reviewer to remove the 3.1 sign-off."). The removal is logged.
create or replace function private.cb_substep_guard(p_file uuid, p_subs text[], p_confirm boolean, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_subs text[]; v_rev boolean; v_label text; v_file public.cb_files; v_me uuid := (select auth.uid());
begin
  select array_agg(substep order by substep), bool_or(reviewed_at is not null) into v_subs, v_rev
    from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) and prepared_at is not null;
  if v_subs is null then return; end if;
  v_label := case array_length(v_subs, 1) when 1 then v_subs[1] when 2 then v_subs[1] || ' and ' || v_subs[2] else v_subs[1] || ', ' || v_subs[2] || ' and ' || v_subs[3] end;
  select * into v_file from public.cb_files where id = p_file;
  if v_rev and not (private.is_owner() or v_me = v_file.reviewer_id
      or exists (select 1 from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs) and reviewed_by = v_me)) then
    raise exception 'Ask the reviewer to remove the % sign-off.', v_label using errcode = '42501';
  end if;
  if not coalesce(p_confirm, false) then
    raise exception 'This removes the sign-off on %. Continue?', v_label using errcode = '42501';
  end if;
  delete from public.cb_substep_signoffs where file_id = p_file and substep = any (v_subs);
  perform private.cb_log_event(p_file, 'signoff_removed', 'records', format('Sign-off on %s removed to make a change.', v_label), null, null, '', p_what, v_label || ' signed', 'not signed');
  perform private.cb_records_follow(p_file);
end;
$$;
revoke all on function private.cb_substep_guard(uuid, text[], boolean, text) from public, anon, authenticated;
create or replace function private.cb_feed_guard(p_file uuid, p_confirm boolean, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.cb_substep_guard(p_file, array['3.2', '3.3'], p_confirm, p_what);
end;
$$;

-- Add or edit an account: the sub-steps its change clears (as the cb_banking_changed trigger does): an account added,
-- or its last digits, type, line or last year's T2 line changed: 3.1 and 3.3; its balance at last year end: 3.1, 3.2
-- and 3.3 (round 24 kept 3.2 too).
do $$
declare d text;
  k1 text := $k$    perform private.cb_log_event(p_file, 'bank_account_added'$k$;
  k2 text := $k$    if v_acc.books_opening is distinct from v_bal then
      perform private.cb_feed_guard(p_file, p_confirm, 'balance at last year end changed');
    end if;$k$;
begin
  d := pg_get_functiondef('public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text)'::regprocedure);
  if position('cb_substep_guard' in d) > 0 then return; end if;
  d := replace(d, $k$  if p_id is null then
    insert into public.cb_bank_accounts$k$, $k$  if p_id is null then
    perform private.cb_substep_guard(p_file, array['3.1', '3.3'], p_confirm, 'account added');
    insert into public.cb_bank_accounts$k$);
  d := replace(d, k2, $r$    if v_acc.books_opening is distinct from v_bal then
      perform private.cb_substep_guard(p_file, array['3.1', '3.2', '3.3'], p_confirm, 'balance at last year end changed');
    elsif v_acc.last4 is distinct from v_last or v_acc.chart_account is distinct from p.chart_account or v_acc.gifi_line is distinct from p.gifi_line
       or v_acc.t2_line is distinct from v_t2 then
      perform private.cb_substep_guard(p_file, array['3.1', '3.3'], p_confirm, case when v_acc.t2_line is distinct from v_t2 then 'last year''s T2 line changed' else 'account changed' end);
    end if;$r$);
  if position('cb_substep_guard' in d) = 0 or position('account added' in d) = 0 then raise exception 'cb_save_bank_account: the guard was not placed.'; end if;
  execute d;
end $$;

drop function if exists public.cb_set_bank_coverage(uuid, date, date, text);
create or replace function public.cb_set_bank_coverage(p_id uuid, p_opened date, p_closed date, p_note text, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts; v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_id;
  perform private.require(v_acc.id is not null, 'Account not found.');
  select * into v_file from public.cb_files where id = v_acc.file_id;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_opened is null or p_opened between v_file.year_start and v_file.year_end, 'The opening date must be inside the year.');
  perform private.require(p_closed is null or p_closed between v_file.year_start and v_file.year_end, 'The closing date must be inside the year.');
  perform private.require(p_opened is null or p_closed is null or p_closed >= p_opened, 'The account cannot close before it opened.');
  perform private.require(length(coalesce(p_note, '')) <= 300, 'Keep the note to 300 characters.');
  if v_acc.opened_on is distinct from p_opened or v_acc.closed_on is distinct from p_closed or v_acc.coverage_note is distinct from btrim(coalesce(p_note, '')) then
    perform private.cb_substep_guard(v_acc.file_id, array['3.2', '3.3'], p_confirm, 'account''s months changed');
  end if;
  update public.cb_bank_accounts set opened_on = p_opened, closed_on = p_closed, coverage_note = btrim(coalesce(p_note, '')),
         coverage_by = case when p_opened is null and p_closed is null and btrim(coalesce(p_note, '')) = '' then null else (select auth.uid()) end,
         coverage_at = case when p_opened is null and p_closed is null and btrim(coalesce(p_note, '')) = '' then null else now() end
   where id = p_id;
  perform private.cb_log(v_acc.file_id, 'bank_coverage', 'records', format('%s: %s.', v_acc.name,
    concat_ws('; ', case when p_opened is not null then 'opened ' || to_char(p_opened, 'Mon FMDD, YYYY') end,
                     case when p_closed is not null then 'closed ' || to_char(p_closed, 'Mon FMDD, YYYY') end,
                     nullif(btrim(coalesce(p_note, '')), ''), case when p_opened is null and p_closed is null and btrim(coalesce(p_note, '')) = '' then 'reason cleared' end)));
end;
$$;
revoke all on function public.cb_set_bank_coverage(uuid, date, date, text, boolean) from public, anon;
grant execute on function public.cb_set_bank_coverage(uuid, date, date, text, boolean) to authenticated;

drop function if exists public.cb_remove_bank_account(uuid);
create or replace function public.cb_remove_bank_account(p_id uuid, p_confirm boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_acc public.cb_bank_accounts;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_acc from public.cb_bank_accounts where id = p_id;
  perform private.require(v_acc.id is not null, 'Account not found.');
  perform private.require((select phase from public.cb_files where id = v_acc.file_id) <> 'locked', 'This file is locked.');
  perform private.require(not exists (select 1 from public.cb_bank_statements where account_id = p_id) and not exists (select 1 from public.cb_excluded_statements where account_id = p_id),
    'This account has statements (imported or excluded). It can''t be deleted.');
  perform private.cb_substep_guard(v_acc.file_id, array['3.1', '3.3'], p_confirm, 'account removed');
  delete from public.cb_bank_accounts where id = p_id;
  perform private.cb_log_event(v_acc.file_id, 'bank_account_removed', 'records', 'Account removed', null, null, v_acc.name, '', '', '');
end;
$$;
revoke all on function public.cb_remove_bank_account(uuid, boolean) from public, anon;
grant execute on function public.cb_remove_bank_account(uuid, boolean) to authenticated;
