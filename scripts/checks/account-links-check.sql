-- READ-ONLY. Run in the Supabase SQL editor of Test or Live (Hashim, Nov 18, 2026, round 4b).
-- Lists every Closebook file with (1) two bank or card accounts on the same standard chart account (they
-- showed as two accounts with one number), (2) two accounts in the file with the same number, and (3) entry
-- lines on a bare GIFI line in a file on the standard chart. Changes nothing. Shows file ids and account
-- names only. Run it before approving "Database deploy - Live" to see which files were affected; after the
-- deploy, (3) is empty, (1) only lists files whose bank accounts now carry their own numbers (shown in
-- cb_bank_accounts.number), and (2) is empty once each listed file's trial balance is rebuilt (opening step 7
-- rebuilds it).

-- 1. Bank or card accounts sharing a chart account.
select 'shared chart account' as problem, b.file_id, b.chart_account as number, string_agg(b.name, ' | ' order by b.created_at) as accounts
  from public.cb_bank_accounts b group by b.file_id, b.chart_account having count(*) > 1
union all
-- 2. Two accounts with the same number in one file.
select 'same number twice', a.file_id, a.number, string_agg(a.name, ' | ' order by a.account_key)
  from public.cb_accounts a where a.number <> '' group by a.file_id, a.number having count(*) > 1
union all
-- 3. Entry lines on a bare GIFI line in a file on the standard chart.
select 'posting on a bare GIFI line', a.file_id, a.line_no, string_agg(distinct a.name, ' | ') || ' (' || count(l.id) || ' entry lines)'
  from public.cb_accounts a join public.cb_files f on f.id = a.file_id join public.cb_entry_lines l on l.account_id = a.id
 where a.account_key like 'line:%' and f.books in ('statements', 'paper')
 group by a.file_id, a.line_no
order by 1, 2;
