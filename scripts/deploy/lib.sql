-- Helpers for the reversible database deploy (scripts/deploy/db-deploy.sh). Hashim, Nov 20, 2026.
-- Session-only functions (pg_temp): nothing is added to the database. Every name printed is a table
-- name, a file id or a count, never a client, account or bank name.
\set ON_ERROR_STOP on
set client_min_messages = notice;

-- The columns a backup table and its live table share (a column the migration added is left out; it
-- keeps its default on restore). Generated columns are skipped: Postgres works them out.
create or replace function pg_temp.deploy_cols(bk text, tbl text) returns text language sql stable as $$
  select string_agg(quote_ident(b.attname), ', ' order by b.attnum)
    from pg_attribute b
    join pg_attribute p on p.attrelid = format('public.%I', tbl)::regclass and p.attname = b.attname and p.attnum > 0 and not p.attisdropped
   where b.attrelid = format('%I.%I', bk, tbl)::regclass and b.attnum > 0 and not b.attisdropped and p.attgenerated = '';
$$;

-- A checksum of a table's rows, over the given columns, in a fixed order.
create or replace function pg_temp.deploy_sum(sch text, tbl text, cols text) returns text language plpgsql stable as $$
declare v text;
begin
  execute format('select md5(coalesce(string_agg(t::text, %L order by t::text), %L)) from (select %s from %I.%I) t', E'\n', '', cols, sch, tbl) into v;
  return v;
end $$;

-- The tables whose rows differ from the backup.
create or replace function pg_temp.deploy_changed(bk text) returns table (tbl text) language plpgsql stable as $$
declare t record; c text;
begin
  for t in select c2.relname from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
            where n.nspname = bk and c2.relkind = 'r' and c2.relname <> '_deploy' order by 1 loop
    if to_regclass(format('public.%I', t.relname)) is null then
      tbl := t.relname; return next; continue;
    end if;
    c := pg_temp.deploy_cols(bk, t.relname);
    if pg_temp.deploy_sum(bk, t.relname, c) is distinct from pg_temp.deploy_sum('public', t.relname, c) then
      tbl := t.relname; return next;
    end if;
  end loop;
end $$;
