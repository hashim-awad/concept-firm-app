-- Round 4c (Hashim, Nov 19, 2026): the round 4b repair finishes by itself.
--
-- 1. The stored trial balance of a bank-statement file is brought in line with the round 4b rule, here in
--    SQL, so nobody has to open step 7 to finish the job: the bank account holding its chart account's
--    number shows on that chart account's row under its own name (10000 TD chequing, with last year's
--    balance); any other bank account shows on its own row under its own number (10010 TD savings 9999).
--    This is exactly what the trial balance build (src/lib/closebook/tb-build.ts) writes on its next run.
-- 2. A GIFI-line account made in a file on the standard chart (an entry to a line with no chart account)
--    gets a 5-digit number in its type's range at once (round 2 item 7), never a blank or a GIFI code.

-- 1.
create or replace function private.cb_restore_bank_rows(p_file uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  b record;
  v_bank public.cb_accounts;
  v_chart public.cb_accounts;
  v_n int := 0;
begin
  for b in select * from public.cb_bank_accounts where file_id = p_file order by created_at, id loop
    select * into v_bank from public.cb_accounts where file_id = p_file and account_key = 'bank:' || b.id;
    if b.number = b.chart_account then
      select * into v_chart from public.cb_accounts where file_id = p_file and account_key = 'chart:' || b.chart_account;
      if v_bank.id is not null and v_chart.id is not null then
        -- The holder's own row merges into its chart account's row.
        update public.cb_accounts set this_year = this_year + v_bank.this_year, last_year = last_year + v_bank.last_year, name = b.name, number = b.number
         where id = v_chart.id;
        update public.cb_entry_lines set account_id = v_chart.id where account_id = v_bank.id;
        delete from public.cb_flag_notes where account_id = v_bank.id;
        delete from public.cb_accounts where id = v_bank.id;
        v_n := v_n + 1;
      elsif v_bank.id is not null then
        update public.cb_accounts set account_key = 'chart:' || b.chart_account, number = b.number, name = b.name where id = v_bank.id;
        v_n := v_n + 1;
      elsif v_chart.id is not null and (v_chart.name is distinct from b.name) then
        update public.cb_accounts set name = b.name where id = v_chart.id;
        v_n := v_n + 1;
      end if;
    elsif v_bank.id is not null and (v_bank.number is distinct from b.number or v_bank.name is distinct from b.name) then
      update public.cb_accounts set number = b.number, name = b.name where id = v_bank.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.cb_restore_bank_rows(uuid) from public, anon, authenticated;

select private.cb_restore_bank_rows(f.id) from public.cb_files f
 where f.books in ('statements', 'paper') and exists (select 1 from public.cb_bank_accounts b where b.file_id = f.id);

-- 2.
create or replace function private.cb_number_line_account() returns trigger language plpgsql set search_path = '' as $$
declare
  v_type text;
  v_no int;
begin
  if new.account_key like 'line:%' and coalesce(new.number, '') = ''
     and exists (select 1 from public.cb_files f where f.id = new.file_id and f.books in ('statements', 'paper')) then
    select line_type into v_type from public.cb_master_lines where line_no = new.line_no;
    v_no := case v_type when 'Asset' then 19000 when 'Liability' then 29000 when 'Equity' then 39000 when 'Revenue' then 49000 else 79000 end;
    while exists (select 1 from public.cb_chart_accounts where number = v_no::text)
       or exists (select 1 from public.cb_accounts where file_id = new.file_id and number = v_no::text)
       or exists (select 1 from public.cb_bank_accounts where file_id = new.file_id and number = v_no::text) loop
      v_no := v_no + 10;
    end loop;
    new.number := v_no::text;
  end if;
  return new;
end;
$$;
revoke all on function private.cb_number_line_account() from public, anon, authenticated;
-- Safe to run twice (round 4d): the reversible deploy may run this file again after a restore.
drop trigger if exists cb_number_line_account on public.cb_accounts;
create trigger cb_number_line_account before insert on public.cb_accounts for each row execute function private.cb_number_line_account();
