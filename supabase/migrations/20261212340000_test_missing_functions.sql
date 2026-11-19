-- Test database repair (Hashim, Nov 19, 2026; option a): the drift check (scripts/checks/drift-check.sql) found two functions
-- missing on Test that the app still calls. Live has both. This adds each one only where it is missing, copied word for word
-- from the migration that created it, with the same rights. On a database that has them (Live), it changes nothing.
--   public.cb_update_t2_rounding(numeric): round 10, 20261129000000_round10_t2_tieout.sql (Settings > Closebook rules, rounding).
--   public.cb_confirm_gst_entry(uuid, uuid, boolean): round 13, 20261202000000_round13_gst_return.sql (step 8, instalment entries).
-- No table or column is dropped. No data is changed. Safe to run twice.

do $repair$
begin
  if to_regprocedure('public.cb_update_t2_rounding(numeric)') is null then
    execute $fn$
create function public.cb_update_t2_rounding(p_amount numeric) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner changes thresholds.');
  perform private.require(p_amount is not null and p_amount between 0 and 1000, 'Rounding allowed in the T2 tie-out: a number from 0 to 1,000.');
  update public.cb_settings set t2_rounding = round(p_amount, 2), updated_at = now(), updated_by = (select auth.uid());
end;
$$;
$fn$;
    revoke all on function public.cb_update_t2_rounding(numeric) from public, anon;
    grant execute on function public.cb_update_t2_rounding(numeric) to authenticated;
  end if;

  if to_regprocedure('public.cb_confirm_gst_entry(uuid, uuid, boolean)') is null then
    execute $fn$
create function public.cb_confirm_gst_entry(p_file uuid, p_entry uuid, p_yes boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_label text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(private.cb_gst_applies(p_file), 'This file has no GST/HST return built in Closebook.');
  select e.kind || ' ' || e.number into v_label from public.cb_entries e where e.id = p_entry and e.file_id = p_file;
  perform private.require(v_label is not null, 'That entry is not in this file.');
  insert into public.cb_gst_check (file_id, owing, book, diff, fingerprint) values (p_file, 0, 0, 0, '') on conflict (file_id) do nothing;
  update public.cb_gst_check set instalment_entries = case when p_yes then array(select distinct unnest(instalment_entries || p_entry)) else array_remove(instalment_entries, p_entry) end
   where file_id = p_file;
  -- The instalments change: the returns are prepared again from the new pre-fill.
  delete from public.cb_gst_returns where file_id = p_file;
  perform private.cb_log(p_file, 'gst_instalment_entry', 't2', format('%s %s an instalment', v_label, case when p_yes then 'counted as' else 'not counted as' end));
  perform private.cb_clear_step(p_file, 't2', 'The GST/HST instalments changed');
end;
$$;
$fn$;
    revoke all on function public.cb_confirm_gst_entry(uuid, uuid, boolean) from public, anon;
    grant execute on function public.cb_confirm_gst_entry(uuid, uuid, boolean) to authenticated;
  end if;
end
$repair$;
