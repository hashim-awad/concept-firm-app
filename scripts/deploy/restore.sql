-- Restore from the backup, in one transaction: every table whose rows differ from the backup is put back
-- exactly as it was, and the migrations this deploy added are taken off the list, so the next deploy runs
-- them again once fixed (migrations are written to run twice safely). Triggers and key checks are off
-- while rows go back, so nothing is renumbered or cascaded. If any step fails, nothing changes.
-- Called with: psql -v bk=<schema> -f scripts/deploy/restore.sql
\set ON_ERROR_STOP on
\i scripts/deploy/lib.sql
begin;
-- SET, not set_config: Supabase lets the postgres role switch this with SET only.
set local session_replication_role = replica;
select set_config('deploy.bk', :'bk', true) \g /dev/null
do $$
declare
  bk text := current_setting('deploy.bk');
  t record;
  c text;
  n bigint;
  v_last text;
begin
  execute format('select last_version from %I._deploy', bk) into v_last;
  for t in select tbl from pg_temp.deploy_changed(bk) loop
    if to_regclass(format('public.%I', t.tbl)) is null then
      raise exception 'public.% is gone: restore it by hand from %.%.', t.tbl, bk, t.tbl;
    end if;
    c := pg_temp.deploy_cols(bk, t.tbl);
    execute format('delete from public.%I', t.tbl);
    execute format('insert into public.%I (%s) overriding system value select %s from %I.%I', t.tbl, c, c, bk, t.tbl);
    get diagnostics n = row_count;
    raise notice 'RESTORE public.%: % rows put back from the backup.', t.tbl, n;
  end loop;
  delete from supabase_migrations.schema_migrations where version > v_last;
  get diagnostics n = row_count;
  raise notice 'RESTORE migration list: % migration(s) after % taken off, to run again after the fix.', n, v_last;
end $$;
commit;
-- Proof: every table now matches the backup.
select set_config('deploy.bk', :'bk', false) \g /dev/null
do $$
declare v int; v_all int;
begin
  select count(*) into v from pg_temp.deploy_changed(current_setting('deploy.bk'));
  execute format('select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = %L and c.relkind = %L and c.relname <> %L', current_setting('deploy.bk'), 'r', '_deploy') into v_all;
  if v > 0 then raise exception 'RESTORE CHECK failed: % table(s) still differ from the backup.', v; end if;
  raise notice 'RESTORE CHECK: all % tables match the backup, row for row.', v_all;
end $$;
