-- READ-ONLY (piece 10 follow-up, Nov 19, 2026). Changes nothing. Run in each project's SQL Editor (Test, then Live).
-- Review notes still on the retired step 6 key 'mapping' that are not cleared. Step 7's gate counts every note that is not
-- cleared, so one of these would block step 7 and show under the raw label "mapping". No rows back = none.
select f.id as file_id, c.legal_name, f.year_end, n.status, n.target_type, n.target_label, n.created_at
  from public.cb_review_notes n
  join public.cb_files f on f.id = n.file_id
  join public.clients c on c.id = f.client_id
 where n.step = 'mapping' and n.status <> 'cleared'
 order by c.legal_name, f.year_end, n.created_at;
