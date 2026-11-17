-- Round 34b (Hashim, Nov 17, 2026): which 3.x sign-offs an account change removes.
--   * An account's opening balance (balance at last year end) feeds the reconcile: it removes 3.1 and 3.3, never 3.2.
--   * Its GIFI line, T2 line, chart account or last four digits remove 3.1 only, never 3.2 or 3.3.
--   * Unchanged: an account added or removed removes 3.1 and 3.3; its months remove 3.2 and 3.3; an outstanding item 3.3.
--   History and the pill name the reason ("3.1 sign-off removed: GIFI line changed").
-- No data is changed. Never drops a table or column. Safe to run twice.

-- ---------- 0. History's reason starts lower case, except a word in capitals ("GIFI line changed", "T2 line changed").
create or replace function private.cb_clear_substeps(p_file uuid, p_subs text[], p_why text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_gone text[]; v_why text := btrim(coalesce(p_why, ''));
begin
  with d as (delete from public.cb_substep_signoffs where file_id = p_file and substep = any (p_subs) returning substep)
  select array_agg(substep order by substep) into v_gone from d;
  if v_gone is not null then
    if substr(v_why, 2, 1) ~ '[a-z]' then v_why := lower(left(v_why, 1)) || substr(v_why, 2); end if;
    perform private.cb_log_event(p_file, 'signoff_cleared', 'records', format('%s removed: %s', private.cb_substep_label(v_gone), v_why),
      null, null, '', v_why, array_to_string(v_gone, ', ') || ' signed', 'not signed');
    perform private.cb_records_follow(p_file);
  end if;
end;
$$;
revoke all on function private.cb_clear_substeps(uuid, text[], text) from public, anon, authenticated;

-- "a", "a and b", "a, b and c".
create or replace function private.cb_list_words(p text[]) returns text
language sql immutable set search_path = '' as $$
  select case when cardinality(p) = 0 then '' when cardinality(p) = 1 then p[1]
    else array_to_string(p[1:cardinality(p) - 1], ', ') || ' and ' || p[cardinality(p)] end;
$$;
revoke all on function private.cb_list_words(text[]) from public, anon, authenticated;

-- ---------- 1. The trigger behind every account change follows the same split.
create or replace function private.cb_banking_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_file uuid := coalesce(new.file_id, old.file_id); v_what text[];
begin
  if not exists (select 1 from public.cb_substep_signoffs where file_id = v_file) then return coalesce(new, old); end if;
  if tg_table_name = 'cb_bank_accounts' then
    if tg_op = 'INSERT' then
      perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'Account added');
    elsif tg_op = 'DELETE' then
      perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'Account removed');
    else
      if new.books_opening is distinct from old.books_opening then
        perform private.cb_clear_substeps(v_file, array['3.1', '3.3'], 'Opening balance changed');
      end if;
      v_what := array_remove(array[
        case when new.gifi_line is distinct from old.gifi_line then 'GIFI line' end,
        case when new.t2_line is distinct from old.t2_line then 'T2 line' end,
        case when new.chart_account is distinct from old.chart_account then 'chart account' end,
        case when new.last4 is distinct from old.last4 then 'last four digits' end], null);
      if cardinality(v_what) > 0 then
        perform private.cb_clear_substeps(v_file, array['3.1'], private.cb_list_words(v_what) || ' changed');
      end if;
      if new.opened_on is distinct from old.opened_on or new.closed_on is distinct from old.closed_on or new.coverage_note is distinct from old.coverage_note then
        perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], 'Account''s months changed');
      end if;
    end if;
  elsif tg_table_name = 'cb_bank_statements' then
    perform private.cb_clear_substeps(v_file, array['3.2', '3.3'], case when tg_op = 'DELETE' then 'A statement was deleted' else 'A statement was added' end);
  elsif tg_table_name = 'cb_bank_outstanding' then
    perform private.cb_clear_substeps(v_file, array['3.3'], 'An outstanding item changed');
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.cb_banking_changed() from public, anon, authenticated;

-- ---------- 2. Saving an account asks first for exactly those sign-offs, with the reason.
-- Written out in full (not patched by text): a database that ran an earlier text of round 25 holds a slightly
-- different copy, so a text patch cannot find its place there. This is the repository's version, with the two
-- round 34b lines.
CREATE OR REPLACE FUNCTION public.cb_save_bank_account(p_file uuid, p_id uuid, p_type text, p_bank text, p_last4 text, p_balance numeric, p_negative boolean, p_long_term boolean, p_confirm boolean DEFAULT false, p_t2_line text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_file public.cb_files;
  v_acc public.cb_bank_accounts;
  p record;
  v_bank text := btrim(regexp_replace(coalesce(p_bank, ''), '\s+', ' ', 'g'));
  v_last text := regexp_replace(coalesce(p_last4, ''), '\D', '', 'g');
  v_name text;
  v_id uuid;
  v_bal numeric := case when p_negative then -p_balance else p_balance end;
  v_t2 text := nullif(btrim(coalesce(p_t2_line, '')), '');
  v_usual text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  select * into p from private.cb_bank_placement(p_type, p_long_term);
  perform private.require(p.std_name is not null, 'Choose the type: chequing, savings, credit card, line of credit or loan.');
  perform private.require(length(v_bank) between 1 and 40, 'Enter the bank, for example RBC.');
  perform private.require(length(v_last) between 2 and 8, 'Enter the last digits of the account or card, as printed on the statement.');
  perform private.require(p_balance is not null and p_balance >= 0 and round(p_balance, 2) = p_balance, 'Enter the balance as a positive number with up to 2 decimals.');
  v_usual := case when p.kind = 'bank' and v_bal < 0 then '2600'
                  else left(coalesce(p.gifi_line, (select line_no from public.cb_chart_accounts where number = p.chart_account), ''), 4) end;
  if v_t2 = v_usual then v_t2 := null; end if;
  -- Last year's T2 line: a balance sheet line in step 2 that holds an amount (or the type's usual line).
  perform private.require(v_t2 is null or (v_t2 ~ '^\d{4}$' and v_t2 between '1000' and '3499'
      and exists (select 1 from public.cb_opening_balances where file_id = p_file and code = v_t2 and amount <> 0)),
    'Choose last year''s T2 line from the balance sheet lines in step 2.');
  v_name := p.std_name || ' · ' || v_bank || ' ••• ' || v_last;
  perform private.require(not exists (select 1 from public.cb_bank_accounts where file_id = p_file and name_key = lower(v_name) and id is distinct from p_id),
    format('%s is already on this file.', v_name));
  if p_id is null then
    perform private.cb_substep_guard(p_file, array['3.1', '3.3'], p_confirm, 'account added');
    insert into public.cb_bank_accounts (file_id, name, name_key, kind, chart_account, number_base, gifi_line, account_type, bank, last4, long_term, books_opening, origin, created_by, t2_line)
    values (p_file, v_name, lower(v_name), p.kind, p.chart_account, p.number_base, p.gifi_line, p_type, v_bank, v_last, coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
            v_bal, 'added', (select auth.uid()), v_t2)
    returning id into v_id;
    perform private.cb_log_event(p_file, 'bank_account_added', 'records', format('Account added: %s, balance in the books %s.', v_name, to_char(v_bal, 'FM999,999,999,990.00')),
      null, null, v_name, '', '', to_char(v_bal, 'FM999,999,999,990.00'));
  else
    select * into v_acc from public.cb_bank_accounts where id = p_id and file_id = p_file for update;
    perform private.require(v_acc.id is not null, 'Account not found.');
    perform private.require(v_acc.kind = p.kind or not (exists (select 1 from public.cb_bank_statements where account_id = p_id) or exists (select 1 from public.cb_excluded_statements where account_id = p_id)),
      'This account has statements. It can''t change between a bank account and a card, line of credit or loan.');
    if v_acc.books_opening is distinct from v_bal then
      perform private.cb_substep_guard(p_file, array['3.1', '3.3'], p_confirm, 'opening balance changed');   -- round 34b
    elsif v_acc.last4 is distinct from v_last or v_acc.chart_account is distinct from p.chart_account or v_acc.gifi_line is distinct from p.gifi_line
       or v_acc.t2_line is distinct from v_t2 then
      perform private.cb_substep_guard(p_file, array['3.1'], p_confirm, private.cb_list_words(array_remove(array[
        case when v_acc.gifi_line is distinct from p.gifi_line then 'GIFI line' end,
        case when v_acc.t2_line is distinct from v_t2 then 'T2 line' end,
        case when v_acc.chart_account is distinct from p.chart_account then 'chart account' end,
        case when v_acc.last4 is distinct from v_last then 'last four digits' end], null)) || ' changed');
    end if;
    update public.cb_bank_accounts set name = v_name, name_key = lower(v_name), kind = p.kind, chart_account = p.chart_account, number_base = p.number_base,
           gifi_line = p.gifi_line, account_type = p_type, bank = v_bank, last4 = v_last, long_term = coalesce(p_long_term, false) and p_type in ('loc', 'loan'),
           books_opening = v_bal, t2_line = v_t2
     where id = p_id;
    v_id := p_id;
  end if;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$function$;
revoke all on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.cb_save_bank_account(uuid, uuid, text, text, text, numeric, boolean, boolean, boolean, text) to authenticated;
