-- Reports and entries in the working paper package format (Hashim, Nov 15, 2026; reference: a large firm's
-- CaseWare package, "Trial balance by group and journal entries").
--
-- 1. Retained earnings (3600.00) belongs on lead sheet GG Retained earnings and dividends, not FF.
-- 2. Opening balances by account (QuickBooks practice): when a GIFI line maps to more than one standard
--    chart account, the row in step 2 names its account. Empty means the first in chart order.
-- 3. Entries are numbered by year-end year in order of creation (2026-001, 2026-002) across AJE, RJE
--    and TJE, and each names its working paper reference (the step or schedule that supports it).
-- 4. An entry that posts to retained earnings must be a prior period adjustment; it posts to GIFI 3720.

update public.cb_master_lines set lead_sheet = 'GG' where line_no = '3600.00' and lead_sheet is distinct from 'GG';
insert into public.cb_master_line_log (line_no, action, changes, reason)
values ('3600.00', 'edit', '{"lead_sheet": {"from": "FF", "to": "GG"}}', 'Hashim, Nov 15, 2026: retained earnings belongs in GG Retained earnings and dividends.');

alter table public.cb_opening_balances add column chart_account text references public.cb_chart_accounts (number) on update cascade;

create or replace function public.cb_save_opening(p_file uuid, p_codes jsonb, p_re_stated numeric, p_ni_typed numeric, p_note text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_acc text;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) <= 1000, 'Lines are missing.');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    perform private.require((v_row ->> 'code') ~ '^\d{4}$' and private.cb_gifi_type(v_row ->> 'code') is not null, format('GIFI %s is not a code Closebook can use.', v_row ->> 'code'));
    perform private.require((v_row ->> 'code') not in ('2599', '3499', '3600', '3620', '3640', '3849', '8299', '9368', '9999'), format('%s is a total: it calculates by itself.', v_row ->> 'code'));
    v_acc := nullif(v_row ->> 'account', '');
    perform private.require(v_acc is null or exists (select 1 from public.cb_chart_accounts c join public.cb_master_lines m on m.line_no = c.line_no
      where c.number = v_acc and (m.gifi_code = v_row ->> 'code' or (v_row ->> 'code' = '3660' and m.gifi_code = '3600'))),
      format('Account %s is not on GIFI line %s.', v_acc, v_row ->> 'code'));
    insert into public.cb_opening_balances (file_id, code, amount, chart_account)
    values (p_file, v_row ->> 'code', case when (v_row ->> 'code')::int between 3700 and 3740 then -abs(round((v_row ->> 'amount')::numeric, 2)) else round((v_row ->> 'amount')::numeric, 2) end, v_acc)
    on conflict (file_id, code) do update set amount = public.cb_opening_balances.amount + excluded.amount;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = coalesce(opening_source, 'manual'), opening_re_stated = p_re_stated, opening_ni_typed = p_ni_typed,
         opening_note = left(coalesce(btrim(p_note), ''), 300), opening_set_by = (select auth.uid()), opening_set_at = now(),
         opening_signed_by = null, opening_signed_at = null, updated_at = now()
   where id = p_file;
  return v_n;
end;
$$;

alter table public.cb_entries add column seq int, add column wp_ref text not null default '';
update public.cb_entries e set seq = r.n
  from (select id, row_number() over (partition by file_id order by created_at, kind, number) as n from public.cb_entries) r where r.id = e.id;
alter table public.cb_entries alter column seq set not null, add constraint cb_entries_file_seq unique (file_id, seq);
alter table public.cb_entries drop constraint if exists cb_entries_reason_check;
alter table public.cb_entries add constraint cb_entries_reason_check check (reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'));

drop function if exists public.cb_add_entry(uuid, text, text, text, boolean, jsonb);
create or replace function public.cb_add_entry(p_file uuid, p_kind text, p_reason text, p_note text, p_reverse boolean, p_lines jsonb, p_wp_ref text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_id uuid;
  v jsonb;
  v_acc uuid;
  v_line text;
  v_key text;
  v_sum numeric := 0;
  v_income numeric := 0;
  v_re boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to add entries.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(v_file.file_type = 'full', 'Monthly files: entries are made in QuickBooks.');
  perform private.require(p_kind in ('AJE', 'RJE', 'TJE'), 'Unknown entry type.');
  perform private.require(p_reason in ('accrual', 'reclassification', 'correction', 'tax', 'prior_period'), 'Choose a reason.');
  perform private.require(length(btrim(coalesce(p_wp_ref, ''))) between 3 and 120, 'Add the working paper reference: the step or schedule that supports the entry.');
  perform private.require(jsonb_typeof(p_lines) = 'array' and jsonb_array_length(p_lines) >= 2, 'An entry needs at least two lines.');
  insert into public.cb_entries (file_id, kind, number, seq, reason, note, reverse_next_year, wp_ref, created_by)
  values (p_file, p_kind, coalesce((select max(number) from public.cb_entries where file_id = p_file and kind = p_kind), 0) + 1,
          coalesce((select max(seq) from public.cb_entries where file_id = p_file), 0) + 1,
          p_reason, btrim(coalesce(p_note, '')), coalesce(p_reverse, false), btrim(p_wp_ref), (select auth.uid()))
  returning id into v_id;
  for v in select * from jsonb_array_elements(p_lines) loop
    perform private.require(round((v ->> 'amount')::numeric, 2) <> 0, 'Every line needs an amount.');
    if v ? 'account' and nullif(v ->> 'account', '') is not null then
      select a.id, a.line_no, a.account_key into v_acc, v_line, v_key from public.cb_accounts a where a.id = (v ->> 'account')::uuid and a.file_id = p_file;
      perform private.require(v_acc is not null, 'An account is not in this file.');
      perform private.require(v_line is not null, 'Match every account in the entry to a GIFI line first.');
    else
      v_line := v ->> 'line'; v_acc := null; v_key := '';
    end if;
    -- Retained earnings only moves through a prior period adjustment, which posts to GIFI 3720.
    v_re := v_line like '3600.%' or v_key in ('gifi:3660', 'gifi:3600');
    if v_re then
      perform private.require(p_reason = 'prior_period', 'An entry that posts to retained earnings must use the reason "Prior period adjustment".');
      v_line := '3720.00'; v_acc := null;
    end if;
    if v_acc is null then
      perform private.require(exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Entries cannot post to a total line.');
      perform private.require(not private.cb_line_locked(v_line), 'This line is locked because it has sub-lines. Choose one of its sub-lines.');
      insert into public.cb_accounts (file_id, account_key, number, name, line_no, mapping_source, mapped_by, mapped_at)
      select p_file, 'line:' || v_line, '', m.name, v_line, 'preparer', (select auth.uid()), now() from public.cb_master_lines m where m.line_no = v_line
      on conflict (file_id, account_key) do nothing;
      select id into v_acc from public.cb_accounts where file_id = p_file and account_key = 'line:' || v_line;
    end if;
    insert into public.cb_entry_lines (entry_id, account_id, amount, memo) values (v_id, v_acc, round((v ->> 'amount')::numeric, 2), left(coalesce(v ->> 'memo', ''), 200));
    v_sum := v_sum + round((v ->> 'amount')::numeric, 2);
    if (select line_type from public.cb_master_lines where line_no = v_line) in ('Revenue', 'Expense') then v_income := v_income + round((v ->> 'amount')::numeric, 2); end if;
  end loop;
  perform private.require(v_sum = 0, format('The entry does not balance: it is out by %s.', v_sum));
  perform private.require(p_kind <> 'RJE' or v_income = 0, 'A reclassifying entry (RJE) cannot change the result. Use an AJE.');
  update public.cb_files set updated_at = now() where id = p_file;
  return v_id;
end;
$$;
revoke all on function public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text) from public, anon;
grant execute on function public.cb_add_entry(uuid, text, text, text, boolean, jsonb, text) to authenticated;
