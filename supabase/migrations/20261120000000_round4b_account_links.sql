-- Round 4b (Hashim, Nov 18, 2026): account links.
--
-- 1. Account numbers are unique in a file. Each bank or card account added in step 3 gets its own number,
--    as QuickBooks Online gives each bank account its own account in the chart: the first on a standard
--    chart account takes its number (10000 Chequing, 22000 Credit card); another on the same one takes
--    the next free number above it, by 10 (10010, 10020). Before this, two accounts on 10000 both showed
--    as 10000, and last year's 1002 balance sat on a third row, 10000 Chequing.
--    Last year's balance on a bank or card line can be put on one of the file's bank accounts in step 2,
--    so the year-over-year comparison is on one line.
-- 2. A file on the standard chart never posts to a bare GIFI line (round 2 item 7). Entries made before
--    November 16 could post to "line:8670.00" and the like; their lines move to the standard chart account
--    on that line (61500 Amortization for 8670), and the bare line accounts go.

-- 1.
alter table public.cb_bank_accounts add column number text;

create or replace function private.cb_bank_number(p_file uuid, p_chart text, p_self uuid) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_no int;
begin
  if not exists (select 1 from public.cb_bank_accounts where file_id = p_file and number = p_chart and id is distinct from p_self) then return p_chart; end if;
  v_no := p_chart::int + 10;
  while exists (select 1 from public.cb_chart_accounts where number = v_no::text)
     or exists (select 1 from public.cb_bank_accounts where file_id = p_file and number = v_no::text and id is distinct from p_self)
     or exists (select 1 from public.cb_accounts where file_id = p_file and number = v_no::text and account_key not like 'bank:%') loop
    v_no := v_no + 10;
  end loop;
  return v_no::text;
end;
$$;
revoke all on function private.cb_bank_number(uuid, text, uuid) from public, anon, authenticated;

create or replace function private.cb_bank_account_number() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.chart_account is distinct from old.chart_account then
    new.number := private.cb_bank_number(new.file_id, new.chart_account, new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.cb_bank_account_number() from public, anon, authenticated;
-- After the default chart account is set (cb_bank_account_default runs first: triggers fire by name).
create trigger cb_bank_account_number before insert or update of chart_account on public.cb_bank_accounts
  for each row execute function private.cb_bank_account_number();

-- Existing accounts, oldest first in each file.
do $$
declare r record;
begin
  for r in select id, file_id, chart_account from public.cb_bank_accounts order by file_id, created_at, id loop
    update public.cb_bank_accounts set number = private.cb_bank_number(r.file_id, r.chart_account, r.id) where id = r.id;
  end loop;
end $$;
alter table public.cb_bank_accounts alter column number set not null;
create unique index cb_bank_accounts_file_number on public.cb_bank_accounts (file_id, number);

-- Step 2: last year's balance on a bank or card line can name the file's bank account it belongs to.
alter table public.cb_opening_balances add column bank_account uuid references public.cb_bank_accounts (id) on delete set null;

create or replace function public.cb_save_opening(p_file uuid, p_codes jsonb, p_re_stated numeric, p_ni_typed numeric, p_note text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_acc text;
  v_bank uuid;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) <= 1000, 'Lines are missing.');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    perform private.require((v_row ->> 'code') ~ '^\d{4}$' and private.cb_gifi_type(v_row ->> 'code') is not null, format('GIFI %s is not a code Closebook can use.', v_row ->> 'code'));
    perform private.require((v_row ->> 'code') not in ('2599', '3499', '3600', '3620', '3640', '3849', '8299', '9368', '9999'), format('%s is a total: it calculates by itself.', v_row ->> 'code'));
    v_acc := nullif(v_row ->> 'account', ''); v_bank := null;
    if v_acc like 'bank:%' then
      -- One of the file's bank or card accounts, on this GIFI line.
      select b.id into v_bank from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
       where b.id = substr(v_acc, 6)::uuid and b.file_id = p_file and left(c.line_no, 4) = v_row ->> 'code';
      perform private.require(v_bank is not null, format('That bank account is not on GIFI line %s.', v_row ->> 'code'));
      v_acc := null;
    end if;
    perform private.require(v_acc is null or exists (select 1 from public.cb_chart_accounts c join public.cb_master_lines m on m.line_no = c.line_no
      where c.number = v_acc and (m.gifi_code = v_row ->> 'code' or (v_row ->> 'code' = '3660' and m.gifi_code = '3600'))),
      format('Account %s is not on GIFI line %s.', v_acc, v_row ->> 'code'));
    insert into public.cb_opening_balances (file_id, code, amount, chart_account, bank_account)
    values (p_file, v_row ->> 'code', case when (v_row ->> 'code')::int between 3700 and 3740 then -abs(round((v_row ->> 'amount')::numeric, 2)) else round((v_row ->> 'amount')::numeric, 2) end, v_acc, v_bank)
    on conflict (file_id, code) do update set amount = public.cb_opening_balances.amount + excluded.amount;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = coalesce(opening_source, 'manual'), opening_re_stated = p_re_stated, opening_ni_typed = p_ni_typed,
         opening_note = left(coalesce(btrim(p_note), ''), 300), opening_set_by = (select auth.uid()), opening_set_at = now(),
         opening_signed_by = null, opening_signed_at = null, updated_at = now()
   where id = p_file;
  return v_n;
end;
$$;

-- 2. Entry lines on a bare GIFI line in a file on the standard chart move to the chart account on that
-- line. A line with no chart account keeps its account, numbered in its type's range (round 2 item 7).
create or replace function private.cb_repair_line_postings() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := 0;
  r record;
  v_chart public.cb_chart_accounts;
  v_target uuid;
  v_no int;
begin
  for r in select a.*, m.line_type from public.cb_accounts a join public.cb_files f on f.id = a.file_id
           left join public.cb_master_lines m on m.line_no = a.line_no
            where a.account_key like 'line:%' and f.books in ('statements', 'paper') loop
    v_chart := null;
    select * into v_chart from public.cb_chart_accounts c where c.line_no = r.line_no order by c.sort_order limit 1;
    if v_chart.number is not null then
      insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
      values (r.file_id, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
      on conflict (file_id, account_key) do nothing;
      select id into v_target from public.cb_accounts where file_id = r.file_id and account_key = 'chart:' || v_chart.number;
      update public.cb_entry_lines set account_id = v_target where account_id = r.id;
      update public.cb_flag_notes set account_id = v_target where account_id = r.id
        and not exists (select 1 from public.cb_flag_notes n where n.account_id = v_target);
      delete from public.cb_flag_notes where account_id = r.id;
      delete from public.cb_accounts where id = r.id;
      v_n := v_n + 1;
    elsif coalesce(r.number, '') = '' then
      v_no := case r.line_type when 'Asset' then 19000 when 'Liability' then 29000 when 'Equity' then 39000 when 'Revenue' then 49000 else 79000 end;
      while exists (select 1 from public.cb_chart_accounts where number = v_no::text) or exists (select 1 from public.cb_accounts where file_id = r.file_id and number = v_no::text) loop
        v_no := v_no + 10;
      end loop;
      update public.cb_accounts set number = v_no::text where id = r.id;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.cb_repair_line_postings() from public, anon, authenticated;
select private.cb_repair_line_postings();
