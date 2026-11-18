-- Piece 2 of the step 5 restructure (Hashim, Nov 18, 2026; benchmark CaseWare Cloud, where an adjustment keeps
-- its identity when it is changed). Edit changes an entry in place: same number, same id, same creator and created
-- date, same origin, and the link to its standard entry is kept. Before this piece, cb_edit_entry deleted the entry
-- and added it again (round 15b), which gave it a new id; the schedules of the next pieces must stay linked to their
-- entry. History records each change with its old and new value (action entry_edited).
-- Everything else is as before: the same checks in the same order (the entry rules move, unchanged, into two
-- helpers that cb_add_entry and cb_edit_entry both call), Approve by the file's reviewer, the delete rule (an
-- approved entry cannot change; a locked file cannot change), the Expenses paid personally lock, and the sign-offs
-- an edit clears (the same triggers fire: the header columns and the lines). As before, an edited entry goes to the
-- reviewer again. No table or column is dropped. Safe to run twice.

-- The checks on an entry's header, in the order cb_add_entry made them (round 15b).
create or replace function private.cb_entry_head_check(p_file public.cb_files, p_kind text, p_reason text, p_note text, p_reverse boolean,
  p_lines jsonb, p_wp_ref text, p_date date, p_attachments text[]) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(p_file.id is not null and p_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) between 3 and 120, 'Add the W/P reference: the step or schedule that supports the entry.');
  perform private.require(length(btrim(coalesce(p_note, ''))) between 3 and 500, 'Add the memo: what the entry does and why.');
  perform private.require(not coalesce(p_reverse, false) or p_reason = 'accrual', 'Only an accrual reverses next year.');
  perform private.require(p_date is null or p_date between p_file.year_start and p_file.year_end, 'The entry date must fall in the file''s year.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) <= 10, 'Up to 10 attachments.');
end;
$$;
revoke all on function private.cb_entry_head_check(public.cb_files, text, text, text, boolean, jsonb, text, date, text[]) from public, anon, authenticated;

-- An entry's lines: each line's account (made when needed), then the rules on the whole entry. Returns the non-tax
-- lines for the standard entry check. The body is cb_add_entry's line loop of round 15b, unchanged.
create or replace function private.cb_entry_write_lines(p_entry uuid, p_file public.cb_files, p_kind text, p_reason text, p_reverse boolean, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_fid uuid := p_file.id;
  v_own boolean := p_file.books in ('client_software', 'bookkeeper');
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
  v_plain jsonb := '[]'::jsonb;
begin
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    perform private.require(nullif(v ->> 'tax_code', '') is null or exists (select 1 from public.cb_sales_tax_codes where code = v ->> 'tax_code'), 'Unknown sales tax code.');
    v_name := nullif(btrim(coalesce(v ->> 'new_name', '')), '');
    v_type := nullif(v ->> 'new_type', '');
    v_acc := null; v_key := '';
    if nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = v_fid;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      -- Clearing (10900) has no GIFI line by design; the reviewer clears it with an entry (round 4 item 3).
      perform private.require(v_line is not null or v_key = 'chart:10900', 'Match every account in the entry to a GIFI line first.');
    elsif nullif(v ->> 'chart', '') is not null then
      select * into v_chart from public.cb_chart_accounts where number = v ->> 'chart';
      perform private.require(v_chart.number is not null, 'Choose an account from the standard chart.');
      v_line := v_chart.line_no;
      if v_own then
        -- The client's own account on that GIFI line; for the sales tax line only, a new "GST/HST payable".
        select id into v_acc from public.cb_accounts where file_id = v_fid and line_no = v_line and not client_new
          and account_key not like 'line:%' and account_key not like 'gifi:%' and number <> '' order by number limit 1;
        if v_acc is null then
          perform private.require(coalesce((v ->> 'is_tax')::boolean, false), 'Choose one of the client''s accounts, or name a new account for their books.');
          v_name := v_chart.name; v_type := 'Other Current Liabilities';
        end if;
      else
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id, account_key into v_acc, v_key from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
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
        values (v_fid, 'new:' || lower(v_name), '', v_name, v_line, 'preparer', (select auth.uid()), now(), true, v_type)
        on conflict (file_id, account_key) do nothing;
        select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'new:' || lower(v_name);
      else
        -- A standard chart account on that line comes first (31500 for 3720); a bare line only when none.
        select * into v_chart from public.cb_chart_accounts where line_no = v_line order by sort_order limit 1;
        if v_chart.number is not null then
          insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
          values (v_fid, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'chart:' || v_chart.number;
        else
          insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
          select v_fid, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
          on conflict (file_id, account_key) do nothing;
          select id into v_acc from public.cb_accounts where file_id = v_fid and account_key = 'line:' || v_line;
        end if;
      end if;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo, tax_code, is_tax)
    values (p_entry, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200), nullif(v ->> 'tax_code', ''), coalesce((v ->> 'is_tax')::boolean, false));
    if not coalesce((v ->> 'is_tax')::boolean, false) then v_plain := v_plain || jsonb_build_array(jsonb_build_object('line', v_line, 'amount', round((v ->> 'amount')::numeric, 2), 'tax', v ->> 'tax_code')); end if;
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  perform private.require(p_reason <> 'prior_period' or v_ppa_line, 'The reason "Prior period adjustment" needs a line on 31500 Prior period adjustments.');
  perform private.require(p_reason <> 'prior_period' or not coalesce(p_reverse, false), 'A prior period adjustment never reverses next year.');
  return v_plain;
end;
$$;
revoke all on function private.cb_entry_write_lines(uuid, public.cb_files, text, text, boolean, jsonb) from public, anon, authenticated;

-- cb_add_entry: as round 15b, through the two helpers.
CREATE OR REPLACE FUNCTION public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text, p_date date DEFAULT NULL::date, p_standard uuid DEFAULT NULL::uuid, p_attachments text[] DEFAULT '{}'::text[], p_seq integer DEFAULT NULL::integer)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
declare
  v_file public.cb_files;
  v_id uuid;
  v_std public.cb_standard_entries;
  v_limit numeric;
  v_plain jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.cb_entry_head_check(v_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_attachments);
  -- Round 15b: the entry number can be typed (CaseWare's adjustment number); blank takes the next one.
  perform private.require(p_seq is null or (p_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = p_file and seq = p_seq)),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(coalesce(p_seq, 0)::text, 3, '0')));
  insert into public.cb_entries (file_id, kind, number, seq, reason, note, reverse_next_year, wp_ref, created_by, entry_date, attachments)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          coalesce(p_seq, coalesce((select max(seq) from public.cb_entries where file_id = p_file), 0) + 1),
          p_reason, btrim(p_note), coalesce(p_reverse, false), btrim(p_wp_ref), (select auth.uid()), coalesce(p_date, v_file.year_end), coalesce(p_attachments, '{}'))
  returning id into v_id;
  v_plain := private.cb_entry_write_lines(v_id, v_file, p_kind, p_reason, p_reverse, p_lines);
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

-- An entry's lines in words for History: "64000 Licences and permits Dr 400.00 · 21100 Accrued liabilities Cr 400.00".
-- Sales tax lines are worked out from the others, so they are left out; a line's tax code shows after its amount.
create or replace function private.cb_entry_lines_text(p_entry uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(string_agg(trim(concat_ws(' ', nullif(a.number, ''), a.name, case when l.amount > 0 then 'Dr' else 'Cr' end,
           to_char(abs(l.amount), 'FM999,999,999,990.00'), nullif(l.tax_code, ''))), ' · ' order by l.amount < 0, a.number, l.id), '')
    from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id
   where l.entry_id = p_entry and not l.is_tax;
$$;
revoke all on function private.cb_entry_lines_text(uuid) from public, anon, authenticated;

-- Edit in place. The same rules as before this piece, in the same order: the Expenses paid personally lock, then the
-- delete rule (Edit on Closebook; an approved entry cannot change; a locked file cannot change), then every rule of a
-- new entry. The id, creator, created date, origin and standard entry link stay; the number stays unless a free one is
-- typed. The entry goes to the reviewer again, as it did when Edit replaced it.
create or replace function public.cb_edit_entry(p_entry uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text,
  p_date date default null, p_standard uuid default null, p_attachments text[] default '{}', p_seq integer default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_e public.cb_entries;
  v_file public.cb_files;
  v_new public.cb_entries;
  v_label text;
  v_old_lines text;
  v_new_lines text;
  v_seq int;
  r record;
begin
  select * into v_e from public.cb_entries where id = p_entry;
  perform private.require(v_e.id is not null, 'Entry not found.');
  perform private.require(coalesce(v_e.origin, '') <> 'expenses_personal', 'Change this entry on the Expenses paid personally paper.');
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(v_e.reviewed_at is null, 'An approved entry cannot be deleted. Add a correcting entry instead.');
  select * into v_file from public.cb_files where id = v_e.file_id for update;
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.cb_entry_head_check(v_file, p_kind, p_reason, p_note, p_reverse, p_lines, p_wp_ref, p_date, p_attachments);
  v_seq := coalesce(p_seq, v_e.seq);
  perform private.require(v_seq between 1 and 999 and not exists (select 1 from public.cb_entries where file_id = v_e.file_id and seq = v_seq and id <> p_entry),
    format('Entry number %s-%s is taken. Choose another.', to_char(v_file.year_end, 'YYYY'), lpad(v_seq::text, 3, '0')));
  v_label := private.cb_entry_label(p_entry);
  v_old_lines := private.cb_entry_lines_text(p_entry);

  -- The header, in place. The per-type number changes only when the type does (it is unique per type).
  update public.cb_entries set kind = p_kind, reason = p_reason, note = btrim(p_note), reverse_next_year = coalesce(p_reverse, false),
      wp_ref = btrim(p_wp_ref), entry_date = coalesce(p_date, v_file.year_end), attachments = coalesce(p_attachments, '{}'), seq = v_seq,
      number = case when p_kind = v_e.kind then v_e.number else coalesce((select max(number) from public.cb_entries where file_id = v_e.file_id and kind = p_kind), 0) + 1 end,
      needs_review = true, reviewed_by = null, reviewed_at = null
   where id = p_entry
  returning * into v_new;
  -- The lines, written again by the same rules as a new entry.
  delete from public.cb_entry_lines where entry_id = p_entry;
  perform private.cb_entry_write_lines(p_entry, v_file, p_kind, p_reason, p_reverse, p_lines);
  v_new_lines := private.cb_entry_lines_text(p_entry);

  -- History: one row per thing that changed, with the old and new value.
  for r in select * from (values
      ('Number', v_new.seq = v_e.seq, v_label, private.cb_entry_label(p_entry)),
      ('Type', p_kind = v_e.kind, v_e.kind, p_kind),
      ('Date', v_new.entry_date = v_e.entry_date, to_char(v_e.entry_date, 'Mon FMDD, YYYY'), to_char(v_new.entry_date, 'Mon FMDD, YYYY')),
      ('Description', v_new.note = v_e.note, v_e.note, v_new.note),
      ('W/P ref', v_new.wp_ref = v_e.wp_ref, v_e.wp_ref, v_new.wp_ref),
      ('Reverses next year', v_new.reverse_next_year = v_e.reverse_next_year, case when v_e.reverse_next_year then 'Yes' else 'No' end, case when v_new.reverse_next_year then 'Yes' else 'No' end),
      ('Attachments', v_new.attachments = v_e.attachments,
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_e.attachments) x), ', '), ''), 'None'),
         coalesce(nullif(array_to_string(array(select regexp_replace(x, '^.*/(\d+-)?', '') from unnest(v_new.attachments) x), ', '), ''), 'None')),
      ('Lines', v_new_lines = v_old_lines, v_old_lines, v_new_lines)) as x(what, same, was, now)
    where not same loop
    perform private.cb_log_event(v_e.file_id, 'entry_edited', 'entries', format('Entry %s changed: %s', private.cb_entry_label(p_entry), lower(r.what)),
      null, null, private.cb_entry_label(p_entry), r.what, r.was, r.now);
  end loop;
  update public.cb_files set updated_at = now() where id = v_e.file_id;
  return p_entry;
end;
$$;
revoke all on function public.cb_edit_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) from public, anon;
grant execute on function public.cb_edit_entry(uuid, text, text, text, boolean, jsonb, text, date, uuid, text[], integer) to authenticated, service_role;
