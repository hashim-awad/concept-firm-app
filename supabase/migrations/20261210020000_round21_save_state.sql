-- Round 21 (Hashim, Nov 15, 2026): file page fixes, agent P.
--   1. "Clear this step" (QuickBooks Online's Clear): empties what the preparer typed in one step of one file.
--   2. Repair: acceptance questions 6 and 8 confirmed by a key press (Enter submitted the form through
--      question 6's "Confirm"). Files with no earlier file and step 1 not signed by the preparer go back
--      to "Not confirmed"; each is logged in the file history.
-- Safe to run twice.

-- ---------------------------------------------------------------------------------------------------
-- 1. Clear this step.
-- What each step clears (only what the preparer typed; imports, uploads, generated files and entries stay):
--   1 Set up            the setup answers and the acceptance record
--   2 Opening balances  last year's balance sheet and Schedule 125 lines, 3849, 9999, the source and note,
--                       "First year" (the uploaded source PDF stays)
--   3 Records           nothing typed: imports and statements are removed where they are listed (refused)
--   4 Code / Match      bank files: every line's coding and transfer matches; trial balance files: the
--                       accounts the preparer matched to GIFI lines
--   5 Checks            the revenue check (explanations and sources), shareholder loan answers
--                       (journal entries stay: they are removed one by one on the Entries tab)
--   6 GIFI mapping      the reviewer's decisions to keep an account on a line of another type or side
--   7 Review            nothing typed (refused)
--   8 Tax returns       the T2 tie-out figures (GIFI exports are generated and stay)
--   9 Statements        the package fields (dividends, first year); refused while the MAL is out for signature
--  10 Deliver and lock  the completion checklist and the tax and instalment figures of the filing record
--                       (the filing date, T183 date and EFILE confirmation stay: they record what was filed)
-- Refused on a signed step (the sign-off is taken back first), on a locked file, and without Edit.
-- ---------------------------------------------------------------------------------------------------
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
    update public.cb_file_fs set dividends = '[]'::jsonb, first_year = null, updated_by = null, updated_at = now() where file_id = p_file;
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
revoke all on function public.cb_clear_typed_step(uuid, text) from public, anon;
grant execute on function public.cb_clear_typed_step(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2. Repair: questions 6 and 8 confirmed by a key press. Only confirmations made before this fix (Nov 16),
--    on files with no earlier file (nothing rolled forward to confirm against) whose step 1 the preparer
--    has not signed. The users' answers to question 7 stay. A file reset once is never reset again.
-- ---------------------------------------------------------------------------------------------------
do $$
declare r record; v_n int := 0;
begin
  for r in
    select a.file_id from public.cb_acceptance a join public.cb_files f on f.id = a.file_id
     where a.confirmed is not null
       and (a.confirmed ->> 'at')::timestamptz < '2026-11-16T00:00:00-05:00'
       and f.phase <> 'locked'
       and private.cb_prior_file(a.file_id) is null
       and not exists (select 1 from public.cb_step_signoffs s where s.file_id = a.file_id and s.step = 'setup' and s.prepared_at is not null)
       and not exists (select 1 from public.cb_file_history h where h.file_id = a.file_id and h.action = 'acceptance_reset')
  loop
    update public.cb_acceptance set confirmed = null, q8 = null, q8_note = '', answered = answered - 'q6' - 'q8', updated_at = now()
     where file_id = r.file_id;
    insert into public.cb_file_history (file_id, actor_id, action, step, detail)
    values (r.file_id, null, 'acceptance_reset', 'setup', 'Questions 6 and 8 reset: confirmed by a key press, not by the preparer');
    v_n := v_n + 1;
  end loop;
  raise notice 'Round 21: acceptance questions 6 and 8 reset on % file(s).', v_n;
end;
$$;
