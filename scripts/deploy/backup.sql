-- Step 1 of the reversible deploy: a dated copy of every table in public, before any change.
-- Kept in its own schema (deploy_backup_YYYYMMDD_HHMMSS), which the app and the API cannot see.
-- Called with: psql -v bk=<schema> -v sha=<git commit> -f scripts/deploy/backup.sql
\set ON_ERROR_STOP on
select set_config('deploy.bk', :'bk', false), set_config('deploy.sha', :'sha', false) \g /dev/null
do $$
declare
  bk text := current_setting('deploy.bk');
  t record;
  n bigint;
  v_rows bigint := 0;
  v_tables int := 0;
  v_last text;
begin
  if bk !~ '^deploy_backup_\d{8}_\d{6}$' then raise exception 'Backup name % is not deploy_backup_YYYYMMDD_HHMMSS.', bk; end if;
  select max(version) into v_last from supabase_migrations.schema_migrations;
  execute format('create schema %I', bk);
  execute format('revoke all on schema %I from public', bk);
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke all on schema %I from anon, authenticated, service_role', bk);
  end if;
  execute format('create table %I._deploy as select %L::text as last_version, now() as taken_at, %L::text as git_sha', bk, v_last, current_setting('deploy.sha'));
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
            where s.nspname = 'public' and c.relkind = 'r' and not c.relispartition order by 1 loop
    execute format('create table %I.%I as table public.%I', bk, t.relname, t.relname);
    get diagnostics n = row_count;
    v_rows := v_rows + n;
    v_tables := v_tables + 1;
  end loop;
  raise notice 'BACKUP taken: %, % tables, % rows, last migration before this deploy %.', bk, v_tables, v_rows, v_last;
end $$;
