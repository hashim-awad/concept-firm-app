-- Round 32 (Nov 17, 2026): repair on Test only. The Test rehearsal of 20261212110000 made its deliberate bad change
-- (an account number used twice in file 36d07b91-a2fe-495d-98f8-b59d73066d0d), and the restore could not run because an
-- earlier version of that migration had dropped two tables. This puts that one account's number back from the deploy's
-- own backup, deploy_backup_20261117_172447. Where that backup does not exist (Live, local), this does nothing.
-- Safe to run twice.
do $$
declare n int;
begin
  if to_regclass('deploy_backup_20261117_172447.cb_accounts') is null then return; end if;
  execute $q$
    update public.cb_accounts a set number = b.number
      from deploy_backup_20261117_172447.cb_accounts b
     where a.id = b.id and a.file_id = '36d07b91-a2fe-495d-98f8-b59d73066d0d' and a.number is distinct from b.number
       and (select count(*) from public.cb_accounts x where x.file_id = a.file_id and x.number = a.number) > 1
  $q$;
  get diagnostics n = row_count;
  raise notice 'Test repair: % account number(s) put back from deploy_backup_20261117_172447.', n;
end $$;
