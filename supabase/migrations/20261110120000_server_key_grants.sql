-- The app's server key (role service_role) could not read public.questionnaires on Live
-- ("permission denied for table questionnaires", 42501), although 20261110040000 granted it. The start
-- page's personal form uses that read, so clients saw "This form is not ready yet".
-- Grant again everything the server key uses, then check each one. If a grant does not hold, the
-- deploy stops here and names the table, the role running the deploy and the table's owner.
grant select on public.questionnaires, public.questions, public.rules, public.catalogue_items, public.item_prices,
  public.settings, public.t1_quotes, public.t1_quote_signers to service_role;
grant select, insert on public.lead_quotes to service_role;
grant select, update on public.leads to service_role;
grant select, insert, update on public.lead_alerts to service_role;

do $$
declare
  v_need text[][] := array[
    ['questionnaires', 'select'], ['questions', 'select'], ['rules', 'select'], ['catalogue_items', 'select'], ['item_prices', 'select'],
    ['settings', 'select'], ['t1_quotes', 'select'], ['t1_quote_signers', 'select'], ['lead_quotes', 'select'], ['lead_quotes', 'insert'],
    ['leads', 'select'], ['leads', 'update'], ['lead_alerts', 'select'], ['lead_alerts', 'insert'], ['lead_alerts', 'update']];
  v_missing text[] := '{}';
  i int;
begin
  for i in 1 .. array_length(v_need, 1) loop
    if not has_table_privilege('service_role', 'public.' || v_need[i][1], v_need[i][2]) then
      v_missing := v_missing || format('%s %s (owner %s)', v_need[i][2], v_need[i][1],
        (select tableowner from pg_tables where schemaname = 'public' and tablename = v_need[i][1]));
    end if;
  end loop;
  if array_length(v_missing, 1) > 0 then
    raise exception 'The server key still cannot use: %. The deploy ran as %.', array_to_string(v_missing, '; '), current_user;
  end if;
end;
$$;
