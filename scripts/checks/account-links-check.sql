-- READ-ONLY account links check (Hashim, Nov 18 and 19, 2026, rounds 4b and 4c). Changes nothing.
-- Run by the database deploy workflows before and after every change, on Test and on Live; the result is
-- in the workflow's log. Shows file ids and counts only, never a client, account or bank name.
-- Clean = no rows.
--
-- 1. A bank or card account shown under a number other than its own (or on a second row of its own).
-- 2. Two accounts with the same number in one file.
-- 3. Entry lines on a bare GIFI line in a file on the standard chart, where the chart has an account on
--    that line.
select 'bank account not on its own number' as problem, b.file_id, count(*) as how_many
  from public.cb_bank_accounts b
  join public.cb_files f on f.id = b.file_id and f.books in ('statements', 'paper')
 where exists (select 1 from public.cb_accounts a where a.file_id = b.file_id and a.account_key = 'bank:' || b.id
                 and (b.number = b.chart_account or a.number is distinct from b.number))
 group by b.file_id
union all
select 'same number twice', a.file_id, count(*)
  from (select file_id, number from public.cb_accounts where number <> '' group by file_id, number having count(*) > 1) a
 group by a.file_id
union all
select 'posting on a bare GIFI line', a.file_id, count(l.id)
  from public.cb_accounts a
  join public.cb_files f on f.id = a.file_id and f.books in ('statements', 'paper')
  join public.cb_entry_lines l on l.account_id = a.id
 where a.account_key like 'line:%' and exists (select 1 from public.cb_chart_accounts c where c.line_no = a.line_no)
 group by a.file_id
order by 1, 2;
