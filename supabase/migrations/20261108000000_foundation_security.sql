-- Foundation security settings. Applies to every Supabase project this repo deploys to.
--
-- 1. Nothing new in the "public" schema is reachable through the Data API unless a later
--    migration grants it on purpose. ("Automatically expose new tables" = off, in code.)
-- 2. Row level security is switched on automatically for every new table in "public".
--    ("Enable automatic RLS" = on, in code.) Each table still needs its own policies;
--    with RLS on and no policy, nobody but the server can read or write it.

-- 1. Remove default access for the public-facing roles.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- 2. Private schema for internal helpers. Never exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.enable_rls_on_new_tables()
returns event_trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj record;
begin
  for obj in
    select *
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      and schema_name = 'public'
      and object_type = 'table'
  loop
    execute format('alter table %s enable row level security', obj.object_identity);
  end loop;
end;
$$;

drop event trigger if exists enable_rls_on_new_tables;
create event trigger enable_rls_on_new_tables
  on ddl_command_end
  when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  execute function private.enable_rls_on_new_tables();
