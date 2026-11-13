-- TEST ONLY (refused anywhere else by db-deploy.sh): a deliberate bad change, to prove the restore.
-- Gives one account in one file the number of another account in the same file, so the account links
-- check after the change shows "same number twice" and the deploy must restore from the backup.
\set ON_ERROR_STOP on
do $$
declare a record;
begin
  select x.id, x.file_id, y.number into a
    from public.cb_accounts x join public.cb_accounts y on y.file_id = x.file_id and y.id <> x.id and y.number <> '' and x.number <> ''
   order by x.file_id, x.number limit 1;
  if a.id is null then raise exception 'REHEARSAL: no file with two numbered accounts on Test.'; end if;
  update public.cb_accounts set number = a.number where id = a.id;
  raise notice 'REHEARSAL bad change: file % now has number % twice.', a.file_id, a.number;
end $$;
