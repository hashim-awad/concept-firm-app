-- Piece R2, item 4 (Hashim, Nov 19, 2026). READ ONLY: run on Live before the R2 migration reaches it.
-- Per trial balance file (file id only, no names): how many accounts would get a master account automatically
-- (exactly one master account on the account's current line, D3) and how many are left for step 4.
-- The move sets chart_account only, never the line, so no figure changes. Locked files are skipped by the move (D15).
with per_line as (
  select line_no, count(*) as n from public.cb_chart_accounts group by line_no
)
select f.id as file_id,
       f.phase = 'locked'                                                                    as locked,
       exists (select 1 from public.cb_step_signoffs s
               where s.file_id = f.id and s.step = 'code' and s.prepared_at is not null)      as step4_signed,
       count(a.id)                                                                           as accounts,
       count(a.id) filter (where pl.n = 1)                                                   as automatic,
       count(a.id) filter (where pl.n is distinct from 1)                                    as left_for_step4,
       count(a.id) filter (where pl.n > 1)                                                   as left_shared_line,
       count(a.id) filter (where a.line_no is not null and pl.n is null)                     as left_no_master_account,
       count(a.id) filter (where a.line_no is null)                                          as left_no_line
from public.cb_files f
left join public.cb_accounts a on a.file_id = f.id
left join per_line pl on pl.line_no = a.line_no
where f.books not in ('statements', 'paper')
group by f.id, f.phase
order by f.id;
-- No rows = no trial balance files on Live.
