-- CloseBook2 piece CB2-0, step 3 (Hashim, Nov 21, 2026; docs/CLOSEBOOK2.md): no gates, no redirects. Every step opens in
-- any order and every save stays on its page. In the database: "Save ProFile figures" saves whatever is filled in.
-- (Sign-off refusals that waited on an earlier step become warnings in step 4's migration.)

CREATE OR REPLACE FUNCTION public.cb_save_t2_tieout(p_file uuid, p_ni numeric, p_assets numeric, p_cca numeric, p_tax numeric, p_pdf text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files;
begin
  -- CB2-0 step 3: whatever is filled in is saved. No field is required and the final GIFI export is not needed first
  -- (step 8's sign-off lists what is still missing as a warning).
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  insert into public.cb_t2_tieouts (file_id, net_income, total_assets, cca, income_tax, t2_pdf, entered_by)
  values (p_file, round(p_ni, 2), round(p_assets, 2), round(p_cca, 2), round(p_tax, 2), nullif(p_pdf, ''), (select auth.uid()))
  on conflict (file_id) do update set net_income = excluded.net_income, total_assets = excluded.total_assets, cca = excluded.cca, income_tax = excluded.income_tax,
    t2_pdf = coalesce(excluded.t2_pdf, public.cb_t2_tieouts.t2_pdf), entered_by = excluded.entered_by, entered_at = now();
end;
$function$;
