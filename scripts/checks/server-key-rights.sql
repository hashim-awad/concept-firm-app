-- Read-only. The server key's rights (round 32 fix, Hashim, Nov 17, 2026): one row per gap, no rows when all is well.
-- Covers every table, view, sequence and function in public, the storage tables and the app's storage buckets.
-- The deploy runs it after the change and stops on any row. Run it by hand in Supabase: SQL Editor, paste, Run.
select * from (
  select 'schema' as kind, s as name, 'usage' as missing from unnest(array['public', 'storage']) s where not has_schema_privilege('service_role', s, 'usage')
  union all
  select case c.relkind when 'v' then 'view' when 'm' then 'view' else 'table' end, n.nspname || '.' || c.relname, p
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    cross join lateral unnest(case when c.relkind in ('v', 'm') then array['select'] else array['select', 'insert', 'update', 'delete'] end) p
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm')
     and not exists (select 1 from pg_depend d where d.objid = c.oid and d.deptype = 'e')
     and not has_table_privilege('service_role', c.oid, p)
  union all
  select 'sequence', n.nspname || '.' || c.relname, 'usage'
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'S' and (case when c.relkind = 'S' then not has_sequence_privilege('service_role', c.oid, 'usage') else false end)
  union all
  select 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', 'execute'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
     and not has_function_privilege('service_role', p.oid, 'execute')
  union all
  select 'storage bucket', b, 'missing' from unnest(array['documents', 'brand-private', 'statement-uploads']) b
   where not exists (select 1 from storage.buckets where id = b)
  union all
  select 'storage table', t, p from unnest(array['storage.objects']) t cross join unnest(array['select', 'insert', 'update', 'delete']) p
   where not has_table_privilege('service_role', t, p)
  union all
  select 'storage table', 'storage.buckets', 'select' where not has_table_privilege('service_role', 'storage.buckets', 'select')
) gaps
order by kind, name, missing;
