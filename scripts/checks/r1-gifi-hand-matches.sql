-- Piece R1, item 3 (Hashim, Nov 19, 2026). READ ONLY: run on Live before the R1 migration reaches it.
-- Accounts on bank-statement files whose group (cb_accounts.line_no) differs from their chart account's line.
-- One row per file, no names: the file id and three counts.
--   by_rule: a bank account the app placed on another line (cb_bank_accounts.gifi_line, e.g. a long-term line of credit on 3149).
--   hand:    a real hand change (the count Hashim decides on). If every row shows hand = 0, no data moves.
--   no_line: a chart account with no line on the file.
select a.file_id,
       count(*) filter (where b.gifi_line is not null and b.gifi_line = a.line_no)                          as by_rule,
       count(*) filter (where a.line_no is not null and (b.gifi_line is null or b.gifi_line <> a.line_no)) as hand,
       count(*) filter (where a.line_no is null)                                                             as no_line
from public.cb_accounts a
join public.cb_files f on f.id = a.file_id and f.books in ('statements', 'paper')
join public.cb_chart_accounts c on a.account_key = 'chart:' || c.number
left join public.cb_bank_accounts b on b.file_id = a.file_id and b.chart_account = c.number and b.number = c.number
where a.line_no is distinct from c.line_no
group by a.file_id
order by a.file_id;
-- No rows at all = 0 accounts differ.
