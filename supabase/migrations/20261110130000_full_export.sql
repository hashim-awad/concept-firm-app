-- "Download full export" (decision 9; Phase 2 step 11). Owners only. Database backups do not include
-- stored files, so the export has every table in the public schema and every stored file (the vault
-- PDFs, signed quotes and the signature image). These functions run as the owner who clicks the
-- button, check that they are an owner, and read past row security so nothing is left out.

-- Every table in the public schema, in name order.
create or replace function public.export_tables()
returns setof text language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can download the full export.');
  return query select c.relname::text from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') order by c.relname;
end;
$$;

-- One page of a table's rows as JSON, in a stable order (the table's primary key, else every column).
create or replace function public.export_rows(p_table text, p_offset int, p_limit int)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_order text;
  v_rows jsonb;
begin
  perform private.require(private.is_owner(), 'Only an owner can download the full export.');
  perform private.require(exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = p_table), 'Unknown table.');
  perform private.require(p_offset >= 0 and p_limit between 1 and 2000, 'Bad page.');
  select string_agg(format('%I', a.attname), ', ' order by array_position(i.indkey::int[], a.attnum::int)) into v_order
    from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
    where i.indrelid = format('public.%I', p_table)::regclass and i.indisprimary;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from (select * from public.%I order by %s offset %s limit %s) t',
    p_table, coalesce(v_order, '1'), p_offset, p_limit) into v_rows;
  return v_rows;
end;
$$;

-- Every stored file: the bucket, its path and when it was stored.
create or replace function public.export_files()
returns table (bucket text, name text, created_at timestamptz) language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can download the full export.');
  return query select o.bucket_id::text, o.name::text, o.created_at from storage.objects o order by o.bucket_id, o.name;
end;
$$;

-- When the export was last downloaded, by whom and what it held (saved in Settings, so the
-- activity log records it too).
create or replace function public.record_full_export(p_tables int, p_rows int, p_files int)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can download the full export.');
  insert into public.settings (key, value, updated_at, updated_by)
  values ('last_full_export', jsonb_build_object('at', now(), 'by', (select auth.uid()), 'tables', p_tables, 'rows', p_rows, 'files', p_files), now(), (select auth.uid()))
  on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.export_tables(), public.export_rows(text, int, int), public.export_files(), public.record_full_export(int, int, int) from public, anon;
grant execute on function public.export_tables(), public.export_rows(text, int, int), public.export_files(), public.record_full_export(int, int, int) to authenticated;
