-- After a deploy: which Closebook files the change touched, compared row for row with the backup.
-- Prints the count and a Studio link to each file. File ids only, never a client name.
-- Called with: psql -v bk=<schema> -v studio=<https://...> -f scripts/deploy/changed-files.sql
\set ON_ERROR_STOP on
\i scripts/deploy/lib.sql
select set_config('deploy.bk', :'bk', false), set_config('deploy.studio', :'studio', false) \g /dev/null
create temp table deploy_files (file_id uuid, tbl text);
do $$
declare
  bk text := current_setting('deploy.bk');
  t record;
  c text;
  q text;
begin
  for t in select tbl from pg_temp.deploy_changed(bk) loop
    if to_regclass(format('public.%I', t.tbl)) is null then continue; end if;
    c := pg_temp.deploy_cols(bk, t.tbl);
    -- The rows that differ, either way round.
    q := format('(select %s from %I.%I except select %s from public.%I) union all (select %s from public.%I except select %s from %I.%I)',
                c, bk, t.tbl, c, t.tbl, c, t.tbl, c, bk, t.tbl);
    if t.tbl = 'cb_files' then
      execute format('insert into deploy_files select d.id, %L from (%s) d', t.tbl, q);
    elsif t.tbl = 'cb_entry_lines' then
      execute format('insert into deploy_files select e.file_id, %L from (%s) d join (select id, file_id from public.cb_entries union select id, file_id from %I.cb_entries) e on e.id = d.entry_id', t.tbl, q, bk);
    elsif exists (select 1 from pg_attribute where attrelid = format('%I.%I', bk, t.tbl)::regclass and attname = 'file_id') then
      execute format('insert into deploy_files select d.file_id, %L from (%s) d', t.tbl, q);
    else
      raise notice 'CHANGED firm-wide table public.% (not part of one file).', t.tbl;
    end if;
  end loop;
end $$;
\echo
select format('FILES CHANGED by this deploy: %s', count(distinct file_id)) as summary from deploy_files where file_id is not null;
select format('%s/closebook/%s', current_setting('deploy.studio'), file_id) as studio_link,
       string_agg(distinct tbl, ', ' order by tbl) as tables_changed
  from deploy_files where file_id is not null group by file_id order by file_id;
