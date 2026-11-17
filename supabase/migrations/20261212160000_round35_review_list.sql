-- Round 35 (Hashim, Nov 17, 2026): step 7 Review, "Lines for the reviewer" as a working list.
-- Benchmarks: QuickBooks Online Accountant's "Reclassify transactions" (change the account of a posted line in place,
-- one at a time or in a batch), TaxDome's "Mark reviewed".
--   * A line with the reviewer can take another account and sales tax in place (cb_recode_lines): the posting
--     changes at once (the trial balance is rebuilt from the lines), History logs the old and new coding. The line
--     stays with the reviewer until it is marked reviewed.
--   * Mark reviewed (cb_review_lines) clears the flag and changes nothing in the posting; it records who and when.
--     Undo (cb_unreview_lines) puts the flag back. Only the file's reviewer or an owner.
--   * A split posted line can be split again in place (cb_resplit_line).
--   * An account for the reviewer's decision is marked reviewed with a required note (cb_review_account). The
--     decision stands while the balance stays the same; a new balance brings it back.
-- No data is changed. Never drops a table or column. Safe to run twice.

-- ---------- 1. Who marked a line or an account reviewed
alter table public.cb_bank_lines add column if not exists reviewed_by uuid;
alter table public.cb_bank_lines add column if not exists reviewed_at timestamptz;
alter table public.cb_bank_lines add column if not exists reviewed_reason text not null default '';
alter table public.cb_accounts add column if not exists review_note text not null default '';
alter table public.cb_accounts add column if not exists review_by uuid;
alter table public.cb_accounts add column if not exists review_at timestamptz;
alter table public.cb_accounts add column if not exists review_cents bigint;

create or replace function private.cb_is_reviewer(p_file public.cb_files) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = p_file.reviewer_id or private.is_owner();
$$;
revoke all on function private.cb_is_reviewer(public.cb_files) from public, anon, authenticated;

-- ---------- 2. Marking reviewed is the reviewer's decision, not a coding change: it neither clears step 4's
-- sign-off nor logs "Coding changed" (it logs its own line). Inserted at the start of each trigger body.
do $$
declare d text;
  g text := E'\n  if tg_table_name = ''cb_bank_lines'' and coalesce(current_setting(''cb.review'', true), '''') = ''on'' then return null; end if;   -- round 35';
begin
  d := pg_get_functiondef('private.cb_changed()'::regprocedure);
  if position('-- round 35' in d) = 0 then
    if d !~ E'\nbegin\n' then raise exception 'round 35: cb_changed has no body start.'; end if;
    execute regexp_replace(d, E'\nbegin\n', E'\nbegin' || g || E'\n');
  end if;
  d := pg_get_functiondef('private.cb_line_log()'::regprocedure);
  if position('-- round 35' in d) = 0 then
    if d !~ E'\nbegin\n' then raise exception 'round 35: cb_line_log has no body start.'; end if;
    execute regexp_replace(d, E'\nbegin\n', E'\nbegin' || g || E'\n');
  end if;
end $$;
revoke all on function private.cb_changed() from public, anon, authenticated;

-- ---------- 3. Mark reviewed, and Undo
create or replace function public.cb_review_lines(p_file uuid, p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); l public.cb_bank_lines; v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(private.cb_is_reviewer(v_file), 'Only the file''s reviewer or an owner marks a line reviewed.');
  perform set_config('cb.review', 'on', true);
  for l in select * from public.cb_bank_lines where file_id = p_file and id = any (p_ids) and status = 'reviewer' for update loop
    update public.cb_bank_lines set status = 'done', reviewed_reason = reviewer_reason, reviewer_reason = '',
           reviewed_by = (select auth.uid()), reviewed_at = now() where id = l.id;
    perform private.cb_log_event(p_file, 'line_reviewed', 'review', 'Marked reviewed', l.statement_id, l.id, private.cb_line_label(l), l.reviewer_reason, 'For the reviewer', 'Reviewed');
    v_n := v_n + 1;
  end loop;
  perform set_config('cb.review', '', true);
  return v_n;
end;
$$;

create or replace function public.cb_unreview_lines(p_file uuid, p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); l public.cb_bank_lines; v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(private.cb_is_reviewer(v_file), 'Only the file''s reviewer or an owner puts the flag back.');
  perform set_config('cb.review', 'on', true);
  for l in select * from public.cb_bank_lines where file_id = p_file and id = any (p_ids) and status = 'done' and reviewed_at is not null for update loop
    update public.cb_bank_lines set status = 'reviewer', reviewer_reason = reviewed_reason, reviewed_reason = '',
           reviewed_by = null, reviewed_at = null where id = l.id;
    perform private.cb_log_event(p_file, 'line_unreviewed', 'review', 'Flag put back for the reviewer', l.statement_id, l.id, private.cb_line_label(l), l.reviewed_reason, 'Reviewed', 'For the reviewer');
    v_n := v_n + 1;
  end loop;
  perform set_config('cb.review', '', true);
  return v_n;
end;
$$;

-- ---------- 4. Another account and sales tax on a posted line, in place (QuickBooks Online's Reclassify)
-- items: [{id, account, tax}]. A line with the reviewer, or one marked reviewed; never a transfer or a split.
create or replace function public.cb_recode_lines(p_file uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_item jsonb; l public.cb_bank_lines; v_acc text; v_tax text; v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 1000, 'Choose the lines.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into l from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file for update;
    perform private.require(l.id is not null, 'Line not found.');
    perform private.require(l.status in ('reviewer', 'done') and not private.cb_line_pending(l), 'Only a posted line changes here. Post it in step 4 first.');
    perform private.require(l.transfer_account is null and coalesce(l.source, '') not in ('transfer', 'outstanding')
      and not exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id), 'This line is a transfer. Change it in step 4.');
    perform private.require(not l.is_split, 'This line is split. Use Split to change it.');
    v_acc := v_item ->> 'account'; v_tax := nullif(v_item ->> 'tax', '');
    perform private.require(exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account for every line. Nothing was changed.');
    perform private.require(v_tax is not null and exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code for every line. Nothing was changed.');
    if v_acc is distinct from l.chart_account or v_tax is distinct from l.tax_code then
      update public.cb_bank_lines set chart_account = v_acc, tax_code = v_tax, source = 'manual', rule_id = null where id = l.id;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

-- A posted line split again in place: the rows replace the line's coding; the line keeps its status.
create or replace function public.cb_resplit_line(p_line uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.cb_bank_lines; r jsonb; i int := 0; v_sum numeric := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into l from public.cb_bank_lines where id = p_line for update;
  perform private.require(l.id is not null, 'Line not found.');
  perform private.cb_file_open(l.file_id);
  perform private.require(l.status in ('reviewer', 'done') and not private.cb_line_pending(l), 'Only a posted line splits here.');
  perform private.require(l.transfer_account is null and coalesce(l.source, '') not in ('transfer', 'outstanding')
    and not exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id), 'This line is a transfer. Change it in step 4.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 2 and 30, 'A split has two lines or more.');
  delete from public.cb_line_splits where line_id = l.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    perform private.require(exists (select 1 from public.cb_chart_accounts where number = r ->> 'account'), format('Line %s: choose an account.', i));
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = r ->> 'tax'), format('Line %s: choose a sales tax code.', i));
    perform private.require((r ->> 'amount')::numeric <> 0, format('Line %s: enter an amount.', i));
    insert into public.cb_line_splits (file_id, line_id, row_no, chart_account, tax_code, amount, memo)
    values (l.file_id, l.id, i, r ->> 'account', r ->> 'tax', round((r ->> 'amount')::numeric, 2), left(btrim(coalesce(r ->> 'memo', '')), 300));
    v_sum := v_sum + round((r ->> 'amount')::numeric, 2);
  end loop;
  perform private.require(v_sum = abs(l.amount), format('Left to split: %s. Nothing was saved.', private.cb_money(abs(l.amount) - v_sum)));
  update public.cb_bank_lines set is_split = true, chart_account = null, tax_code = null, source = 'manual', rule_id = null where id = l.id;
end;
$$;

revoke all on function public.cb_review_lines(uuid, uuid[]), public.cb_unreview_lines(uuid, uuid[]), public.cb_recode_lines(uuid, jsonb), public.cb_resplit_line(uuid, jsonb) from public, anon;
grant execute on function public.cb_review_lines(uuid, uuid[]), public.cb_unreview_lines(uuid, uuid[]), public.cb_recode_lines(uuid, jsonb), public.cb_resplit_line(uuid, jsonb) to authenticated;

-- ---------- 5. An account for the reviewer's decision: Mark reviewed with a note (required)
create or replace function public.cb_review_account(p_account uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.cb_accounts; v_file public.cb_files; v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into a from public.cb_accounts where id = p_account for update;
  perform private.require(a.id is not null, 'Account not found.');
  v_file := private.cb_file_open(a.file_id);
  perform private.require(private.cb_is_reviewer(v_file), 'Only the file''s reviewer or an owner marks an account reviewed.');
  perform private.require(length(v_note) between 3 and 500, 'Write the decision: 500 characters at most.');
  perform private.require(a.needs_reviewer, 'This account is not waiting for the reviewer.');
  update public.cb_accounts set needs_reviewer = false, review_note = v_note, review_by = (select auth.uid()), review_at = now(),
         review_cents = round(this_year * 100) where id = a.id;
  perform private.cb_log_event(a.file_id, 'account_reviewed', 'review', 'Account marked reviewed', null, null,
    btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name), v_note, a.reviewer_reason, 'Reviewed');
end;
$$;
revoke all on function public.cb_review_account(uuid, text) from public, anon;
grant execute on function public.cb_review_account(uuid, text) to authenticated;

-- The decision stands while the balance stays the same (the trial balance is rebuilt often); a new balance
-- brings the account back to the reviewer and the decision lapses.
create or replace function private.cb_account_review_keep() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.review_at is null then return new; end if;
  if round(new.this_year * 100) is distinct from old.review_cents then
    new.review_at := null; new.review_by := null; new.review_note := ''; new.review_cents := null;
  elsif new.needs_reviewer and not old.needs_reviewer then
    new.needs_reviewer := false;
  end if;
  return new;
end;
$$;
revoke all on function private.cb_account_review_keep() from public, anon, authenticated;
drop trigger if exists cb_account_review_keep on public.cb_accounts;
create trigger cb_account_review_keep before update on public.cb_accounts for each row execute function private.cb_account_review_keep();
