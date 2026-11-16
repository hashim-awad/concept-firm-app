-- Round 21 fix (Nov 16, 2026): clearing step 9 no longer blanks the first-year answer. That answer now
-- belongs to step 2 ("Is this the first year of filing after incorporation?", stored in cb_file_fs.first_year
-- by cb_set_first_year), so clearing step 9 must leave it. Only this line of cb_clear_typed_step changes.
-- Safe to run twice.

create or replace function public.cb_clear_typed_step(p_file uuid, p_step text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_n int;
  v_bank boolean;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked. Nothing was cleared.');
  v_n := array_position(array['setup', 'opening', 'records', 'code', 'entries', 'mapping', 'review', 't2', 'statements', 'lock'], p_step);
  perform private.require(v_n is not null, 'Unknown step.');
  perform private.require(not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = p_step
                                       and (s.prepared_at is not null or s.reviewed_at is not null)),
    format('Step %s is signed. Take back the sign-off first.', v_n));
  perform private.require(p_step not in ('records', 'review'), format('Nothing is typed on step %s. Imports and uploads are removed where they are listed.', v_n));
  v_bank := v_file.books in ('statements', 'paper');

  if p_step = 'setup' then
    v_new := '{}'::jsonb;
    update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
    -- As cb_save_setup: GST/HST answers that change how tax is worked out send the taxed work back to the reviewer.
    if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from true
       or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from false then
      update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
       where l.file_id = p_file and l.status = 'done'
         and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
      update public.cb_entries e set needs_review = true, reviewed_at = null, reviewed_by = null
       where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
    end if;
    delete from public.cb_acceptance where file_id = p_file;
  elsif p_step = 'opening' then
    delete from public.cb_opening_balances where file_id = p_file;
    delete from public.cb_opening_s125 where file_id = p_file;
    update public.cb_files set opening_source = null, opening_re_stated = null, opening_ni_typed = null, opening_note = '',
      opening_set_by = null, opening_set_at = null, first_year = false, updated_at = now() where id = p_file;
  elsif p_step = 'code' then
    if v_bank then
      delete from public.cb_bank_transfers where file_id = p_file;
      update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null
       where file_id = p_file and status in ('done', 'ask_client', 'reviewer');
    else
      update public.cb_accounts set line_no = null, mapping_source = null, mapped_by = null, mapped_at = null
       where file_id = p_file and mapping_source = 'preparer';
    end if;
  elsif p_step = 'entries' then
    delete from public.cb_revenue_sources where file_id = p_file;
    delete from public.cb_revenue_checks where file_id = p_file;
    update public.cb_sh_flags set note = '', noted_by = null, noted_at = null where file_id = p_file and (note <> '' or noted_at is not null);
    delete from public.cb_sh_repaid where file_id = p_file;
  elsif p_step = 'mapping' then
    update public.cb_accounts set type_confirm_reason = null, type_confirmed_line = null, type_confirmed_by = null, type_confirmed_at = null,
      side_confirm_reason = null, side_confirmed_line = null, side_confirmed_by = null, side_confirmed_at = null
     where file_id = p_file and (type_confirmed_at is not null or side_confirmed_at is not null or type_confirm_reason is not null or side_confirm_reason is not null);
  elsif p_step = 't2' then
    delete from public.cb_t2_tieouts where file_id = p_file;
  elsif p_step = 'statements' then
    perform private.require(not exists (select 1 from public.cb_file_fs where file_id = p_file and mal_quote_id is not null),
      'The MAL is out for signature. Withdraw it first.');
    update public.cb_file_fs set dividends = '[]'::jsonb, updated_by = null, updated_at = now() where file_id = p_file;
  elsif p_step = 'lock' then
    delete from public.cb_checklist_answers where file_id = p_file;
    update public.cb_file_close set tax_balance = null, tax_due = null, noa_issued = null, noa_penalty = 0, noa_interest = 0,
      hst_filed = false, hst_balance = null, hst_due = null, fed_tax = null, prov_tax = null, fed_tax_prior = null, prov_tax_prior = null,
      instalments = '[]'::jsonb, updated_at = now()
     where file_id = p_file;
  end if;

  perform private.cb_log(p_file, 'step_cleared', p_step, format('Everything typed in step %s cleared', v_n));
  -- The review rests on every step.
  perform private.cb_clear_step(p_file, 'review', format('Step %s was cleared', v_n));
end;
$$;
