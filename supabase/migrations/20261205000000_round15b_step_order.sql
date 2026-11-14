-- Round 15b (Hashim): GIFI mapping is now step 6 and Review step 7, because Review's sign-off already
-- needs mapping signed. Only the step numbers in these messages change; every rule stays the same.
-- Each function is the current definition with the new numbers. Safe to run twice.

CREATE OR REPLACE FUNCTION private.cb_review_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_out text[] := '{}';
  v_n int;
  v_names text;
begin
  select string_agg(n.label, ', ' order by n.ord) into v_names from (values
    ('setup', 'step 1', 1), ('opening', 'step 2', 2), ('records', 'step 3', 3), ('code', 'step 4', 4), ('entries', 'step 5', 5), ('mapping', 'step 6', 6)) n(step, label, ord)
   where not exists (select 1 from public.cb_step_signoffs s where s.file_id = p_file and s.step = n.step and s.reviewed_at is not null);
  if v_names is not null then v_out := v_out || format('Review %s first.', v_names); end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s still open.', v_n, case when v_n = 1 then '' else 's' end); end if;
  select count(*) into v_n from (select unnest(private.cb_step_waiting(p_file, s)) w from unnest(array['opening', 'code', 'entries', 'mapping']) s) x
   where w not like '%review note%';
  if v_n > 0 then v_out := v_out || 'Items still wait for the reviewer: see the list above.'::text; end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_sign_step(p_file uuid, p_step text, p_role text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; r public.cb_step_signoffs; v_list text[];
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_step in ('setup', 'opening', 'records', 'code', 'entries', 'review', 'mapping', 't2', 'statements', 'lock'), 'Unknown step.');
  perform private.require(p_role in ('prepared', 'reviewed'), 'Unknown sign-off.');
  select * into r from public.cb_step_signoffs where file_id = p_file and step = p_step;
  if p_role = 'prepared' then
    perform private.require(p_step <> 'review', 'Step 7 is the reviewer''s: it has no preparer sign-off.');
    perform private.require(r.prepared_at is null, 'This step is already signed as prepared.');
    v_list := case when p_step = 't2' then private.cb_step8_problems(p_file) when p_step = 'statements' then private.cb_step9_problems(p_file)
      when p_step = 'lock' then private.cb_step10_problems(p_file) else private.cb_prepare_blockers(p_file, p_step) end;
    perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
    if p_step = 'opening' and v_file.books in ('statements', 'paper') then
      perform public.cb_sign_opening(p_file);
      return;
    end if;
    insert into public.cb_step_signoffs (file_id, step, prepared_by, prepared_at) values (p_file, p_step, (select auth.uid()), now())
    on conflict (file_id, step) do update set prepared_by = excluded.prepared_by, prepared_at = excluded.prepared_at;
    perform private.cb_log(p_file, 'prepared', p_step, '');
  else
    perform private.require(private.is_owner(), 'Only the reviewer signs as reviewer. Reviewers are owners.');
    perform private.require(r.reviewed_at is null, 'This step is already reviewed.');
    if p_step = 'review' then
      v_list := private.cb_review_problems(p_file);
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      insert into public.cb_step_signoffs (file_id, step, reviewed_by, reviewed_at) values (p_file, 'review', (select auth.uid()), now())
      on conflict (file_id, step) do update set reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;
    else
      perform private.require(r.prepared_at is not null, 'The preparer signs first.');
      v_list := case when p_step = 't2' then coalesce((select array_agg(x) from unnest(private.cb_step8_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'statements' then coalesce((select array_agg(x) from unnest(private.cb_step9_problems(p_file)) x where x not like '%review note%'), '{}')
        when p_step = 'lock' then coalesce((select array_agg(x) from unnest(private.cb_step10_problems(p_file)) x where x not like '%review note%'), '{}')
        else private.cb_step_waiting(p_file, p_step)
          || coalesce((select array_agg(x) from unnest(private.cb_step_problems(p_file, p_step)) x where x not like '%review note%'), '{}') end;
      perform private.require(cardinality(v_list) = 0, 'Not yet: ' || array_to_string(v_list, ' '));
      update public.cb_step_signoffs set reviewed_by = (select auth.uid()), reviewed_at = now() where file_id = p_file and step = p_step;
    end if;
    perform private.cb_log(p_file, 'reviewed', p_step, case when r.prepared_by = (select auth.uid()) then 'Prepared and reviewed by the same person' else '' end);
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
end;
$function$;

CREATE OR REPLACE FUNCTION private.cb_step9_problems(p_file uuid)
 RETURNS text[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files; c public.cb_client_fs_fields; f public.cb_file_fs; v_out text[] := '{}'; v_n int; v_out_by numeric; r record; v_bank boolean;
begin
  select * into v_file from public.cb_files where id = p_file;
  select * into c from public.cb_client_fs_fields where client_id = v_file.client_id;
  select * into f from public.cb_file_fs where file_id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  if not exists (select 1 from public.cb_step_signoffs where file_id = p_file and step = 't2' and prepared_at is not null) then
    v_out := v_out || 'Step 8 must be signed by the preparer first.'::text;
  end if;
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out_by from public.cb_accounts where file_id = p_file;
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0 and (a.line_no is null or a.needs_reviewer) and a.account_key <> 'chart:10900';
  if v_out_by <> 0 or v_n > 0 then v_out := v_out || 'The trial balance does not balance, or an account is not matched in step 6.'::text; end if;
  -- The fields (Appendix C's intake questions). Each one still empty shows "To fill".
  if coalesce(c.officer_name, '') = '' then v_out := v_out || 'To fill: the signing officer''s name.'::text; end if;
  if coalesce(c.officer_position, '') = '' then v_out := v_out || 'To fill: the signing officer''s position.'::text; end if;
  if coalesce(c.officer_email, '') = '' then v_out := v_out || 'To fill: the signing officer''s email.'::text; end if;
  if f.first_year is null then v_out := v_out || 'To fill: whether this is the corporation''s first year.'::text; end if;
  if f.first_year = false and v_bank and not exists (select 1 from public.cb_opening_s125 where file_id = p_file) then
    v_out := v_out || 'Enter last year''s Schedule 125 in step 2.'::text;
  end if;
  -- A balance due to or from a shareholder needs its terms.
  if coalesce(c.sh_terms, '') = '' and exists (select 1 from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
      where a.file_id = p_file and m.gifi_code in ('1300', '1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263') and private.cb_account_final(a.id) <> 0) then
    v_out := v_out || 'To fill: the shareholder loan terms.'::text;
  end if;
  -- Each related-party line with a balance needs the related party's name.
  for r in select distinct m.gifi_code, m.gifi_name from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
            where a.file_id = p_file and private.cb_account_final(a.id) <> 0 and m.gifi_name ~* 'related (part|corp|canadian|foreign)|affiliat' order by m.gifi_code loop
    if coalesce(c.related ->> r.gifi_code, '') = '' then v_out := v_out || format('To fill: the related party for GIFI %s (%s).', r.gifi_code, r.gifi_name); end if;
  end loop;
  -- Each dividend line with a balance needs its class and dates, for the minute book letter.
  for r in select a.line_no, m.name from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
            where a.file_id = p_file and m.gifi_code between '3700' and '3719' and private.cb_account_final(a.id) <> 0 group by a.line_no, m.name order by a.line_no loop
    if not exists (select 1 from jsonb_array_elements(coalesce(f.dividends, '[]')) d where d ->> 'line' = r.line_no
        and coalesce(d ->> 'cls', '') <> '' and coalesce(d ->> 'declared', '') <> '' and coalesce(d ->> 'paid', '') <> '') then
      v_out := v_out || format('To fill: the class and dates of the dividends on %s (%s).', replace(r.line_no, '.00', ''), r.name);
    end if;
  end loop;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = 'statements' and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_record_gifi_export(p_file uuid, p_kind text, p_file_name text, p_content text, p_totals jsonb, p_checks jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_id uuid; v_failed text; v_out numeric; v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.file_type = 'full', 'Monthly files have no T2 tie-out.');
  perform private.require(p_kind in ('before_tax', 'final'), 'Choose the export: before tax entries or final.');
  perform private.require(jsonb_typeof(p_checks) = 'array' and jsonb_array_length(p_checks) >= 5, 'The checks did not run. Nothing was exported.');
  select string_agg(c ->> 'title', '; ') into v_failed from jsonb_array_elements(p_checks) c where not (c ->> 'ok')::boolean;
  perform private.require(v_failed is null, 'Export refused. Failed: ' || coalesce(v_failed, '') || '.');
  -- Checked again here: the trial balance balances and every account with a balance is matched.
  select coalesce(sum(private.cb_account_final(id)), 0) into v_out from public.cb_accounts where file_id = p_file;
  perform private.require(v_out = 0, format('Export refused. The trial balance is out by %s.', v_out));
  select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and private.cb_account_final(a.id) <> 0
     and (a.line_no is null or a.needs_reviewer) and a.account_key <> 'chart:10900';
  perform private.require(v_n = 0, format('Export refused. %s account%s not matched in step 6 or waiting for the reviewer.', v_n, case when v_n = 1 then ' is' else 's are' end));
  perform private.require(p_content like '"GIFI01",%', 'The file is not a GIFI file.');
  insert into public.cb_gifi_exports (file_id, kind, file_name, content, totals, checks, fingerprint, created_by)
  values (p_file, p_kind, btrim(p_file_name), p_content, p_totals, p_checks, private.cb_tb_fingerprint(p_file), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log(p_file, 'gifi_exported', 't2', btrim(p_file_name));
  return v_id;
end;
$function$;

-- Round 15b, the journal entry dialog (CaseWare Cloud's "Add adjustment"; QuickBooks Online's journal
-- entry). The entry number can be typed; Edit replaces an entry in one step, under the delete rule (an
-- approved entry cannot change), keeping its number and where it came from.
drop function if exists public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[]);
CREATE OR REPLACE FUNCTION public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date DEFAULT NULL::date, p_standard uuid DEFAULT NULL::uuid, p_attachments text[] DEFAULT '{}'::text[], p_seq integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_own boolean;
  v_id uuid;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_key text;
  v_name text;
  v_type text;
  v_chart public.cb_chart_accounts;
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
  v_ppa_line boolean := false;
  v_std public.cb_standard_entries;
  v_limit numeric;
  v_plain jsonb := '[]'::jsonb;   -- the non-tax lines, for the standard entry check
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) between 3 and 120, 'Add the W/P reference: the step or schedule that supports the entry.');
  perform private.require(length(btrim(coalesce(p_note, ''))) between 3 and 500, 'Add the memo: what the entry does and why.');
  perform private.require(not coalesce(p_reverse, false) or p_reason = 'accrual', 'Only an accrual reverses next year.');
  perform private.require(p_date is null or p_date between v_file.year_start and v_file.year_end, 'The entry date must fall in the file''s year.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) <= 10, 'Up to 10 attachments.');
  -- Round 15b: the entry number can be typed (CaseWare's adjustment number); blank takes the next one.
  perform private.require(p_seq is null or (p_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = p_file and seq = p_seq)),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(coalesce(p_seq, 0)::text, 3, '0')));
  v_own := v_file.books in ('client_software', 'bookkeeper');
  insert into public.cb_entries (file_id, kind, number, seq, reason, note, reverse_next_year, wp_ref, created_by, entry_date, attachments)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          coalesce(p_seq, coalesce((select max(seq) from public.cb_entries where file_id = p_file), 0) + 1),
          p_reason, btrim(p_note), coalesce(p_reverse, false), btrim(p_wp_ref), (select auth.uid()), coalesce(p_date, v_file.year_end), coalesce(p_attachments, '{}'))
  returning id into v_id;
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = p_file;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no GIFI line by design; the reviewer clears it with an entry (round 4 item 3).
      perform private.require(v_line is not null or v_key = 'chart:10900', 'Match every account in the entry to a GIFI line first.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own then
        -- The client's own account on that GIFI line; for the sales tax line only, a new "GST/HST payable".
        select id into v_acc from public.cb_accounts where file_id = p_file and line_no = v_line and not client_new
          and account_key not like 'line:%' and account_key not like 'gifi:%' and number <> '' order by number limit 1;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
      end if;
    else
      v_line := v ->> 'line';
      perform private.require(not v_own or v_name is not null, 'Choose one of the client''s accounts, or name a new account for their books.');
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re then
      perform private.require(p_reason = 'prior_period', 'A line on retained earnings needs the reason "Prior period adjustment".');
      v_line := '3720.00'; v_acc := null;
      if v_own then v_name := 'Prior period adjustments'; v_type := 'Equity'; end if;
    end if;
    if v_line like '3720.%' then
      perform private.require(p_reason = 'prior_period', 'A line on 31500 Prior period adjustments needs the reason "Prior period adjustment".');
      v_ppa_line := true;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      if v_own then
        perform private.require(length(v_name) between 3 and 80, 'Name the new account in plain words, for example "Amortization expense".');
        perform private.require(v_type is not null, 'Choose the new account''s QuickBooks account type.');
        insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at, client_new, qbo_type)
        values (p_file, 'new:' || lower(v_name), '', v_name, v_line, 'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select p_file, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax)
    values (v_id, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  perform private.require(p_reason <> 'prior_period' or v_ppa_line, 'The reason "Prior period adjustment" needs a line on 31500 Prior period adjustments.');
  perform private.require(p_reason <> 'prior_period' or not coalesce(p_reverse, false), 'A prior period adjustment never reverses next year.');
  -- A standard entry needs no review at or under the threshold, if it is still the standard entry:
  -- two lines, one amount, on the setting's GIFI lines, with the setting's type and reason.
  if p_standard is not null then
    select * into v_std from public.cb_standard_entries where id = p_standard;
    perform private.require(v_std.id is not null, 'That standard entry is gone. Choose another.');
    select entry_review_amount into v_limit from public.cb_settings limit 1;
    update public.cb_entries set standard_id = v_std.id,
      needs_review = not (jsonb_array_length(v_plain) = 2 and v_std.kind = p_kind and v_std.reason = p_reason
        and (v_plain -> 0 ->> 'amount')::numeric = -(v_plain -> 1 ->> 'amount')::numeric
        and abs((v_plain -> 0 ->> 'amount')::numeric) <= coalesce(v_limit, 0)
        and exists (select 1 from jsonb_array_elements(v_plain) x where (x ->> 'amount')::numeric > 0 and x ->> 'line' = (select line_no from public.cb_chart_accounts where number = v_std.debit_account))
        and exists (select 1 from jsonb_array_elements(v_plain) x where (x ->> 'amount')::numeric < 0 and x ->> 'line' = (select line_no from public.cb_chart_accounts where number = v_std.credit_account)))
     where id = v_id;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$function$;

revoke all on function public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) from public, anon;
grant execute on function public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) to authenticated, service_role;

drop function if exists public.cb_add_revenue_entry(uuid, text, jsonb, boolean);
CREATE OR REPLACE FUNCTION public.cb_add_revenue_entry(p_file uuid, p_note text, p_lines jsonb, p_reverse boolean, p_seq integer DEFAULT NULL::integer)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_file public.cb_files; v_entry uuid;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_entry := public.cb_add_entry(p_file, 'AJE', case when coalesce(p_reverse, false) then 'accrual' else 'correction' end, p_note, coalesce(p_reverse, false), p_lines, 'Revenue check', v_file.year_end, null, '{}', p_seq);
  update public.cb_entries set origin = 'revenue_check' where id = v_entry;
  return v_entry;
end;
$function$;

revoke all on function public.cb_add_revenue_entry(uuid, text, jsonb, boolean, integer) from public, anon;
grant execute on function public.cb_add_revenue_entry(uuid, text, jsonb, boolean, integer) to authenticated, service_role;

create or replace function public.cb_edit_entry(p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text,
  p_date date default null, p_standard uuid default null, p_attachments text[] default '{}', p_seq integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_e public.cb_entries; v_id uuid;
begin
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require(coalesce(v_e.origin, '') <> 'expenses_personal', 'Change this entry on the Expenses paid personally paper.');
  -- The delete rule applies: an approved entry cannot change, a locked file cannot change.
  perform public.cb_delete_entry(p_entry);
  v_id := public.cb_add_entry(v_e.file_id, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_standard, p_attachments, coalesce(p_seq, v_e.seq));
  update public.cb_entries set origin = v_e.origin where id = v_id;
  return v_id;
end;
$$;
revoke all on function public.cb_edit_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) from public, anon;
grant execute on function public.cb_edit_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) to authenticated, service_role;
