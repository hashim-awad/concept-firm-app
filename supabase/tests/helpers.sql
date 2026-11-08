-- Shared test helpers. Loaded before each *_test.sql file.
create schema test;
grant usage on schema test to authenticated, anon;

-- Runs a statement as the current role and returns the error message, or 'OK'.
create function test.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlerrm;
end $$;
grant execute on function test.try(text) to authenticated, anon;

create function test.check(p_label text, p_ok boolean) returns text language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_label; end if;
  return 'PASS: ' || p_label;
end $$;
grant execute on function test.check(text, boolean) to authenticated, anon;

