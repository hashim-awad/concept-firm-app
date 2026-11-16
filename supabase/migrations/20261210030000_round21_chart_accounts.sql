-- Round 21 (Hashim, Nov 16, 2026): chart accounts for step 2 and the shareholder loan schedule. Safe to run twice.
-- Hashim's decision on agent O's item 13 report: "A and B, with one condition: add 17500 'Due from
-- shareholder (long-term)' to shareholder 1's accounts in the shareholder loan schedule (with 13000, 23000
-- and 25400), so a long-term amount owed by the shareholder gets the s.15(2) check. The director accounts
-- (13100, 23150, 25450) stay outside the schedule; they are for directors who are not shareholders."
--  A. A summary GIFI line (a GIFI-Short generic item, such as 3260) offers the standard accounts on its
--     detail lines (3261 to 3263: 25400) in step 2, and the file's bank accounts when the detail line is a
--     bank line (1000: the accounts on 1001 to 1007). The pairs are CRA's own (RC4088, the "GIFI-Short:
--     include all amounts under items ..." text in docs/phase3/GIFI-Concept-RC4088-Rev23.csv); an
--     accumulated amortization summary (1681, 1741, 1901, 2011) takes the accumulated line of each item.
--  B. Sixteen standard chart accounts (docs/phase3/Closebook-standard-chart-APPROVED.csv, approved Nov 16).
--  C. 17500 is shareholder 1's; the long-term due from shareholder lines (2180 to 2183) join the schedule;
--     13100, 23150 and 25450 (directors who are not shareholders) stay out of it.
-- Note: this redefines private.cb_chart_on_code and public.cb_save_opening from 20261210010000; run the
-- migrations in order (as every runner here does).

-- A. Summary lines and their detail lines (Schedule 100).
create table if not exists public.cb_gifi_parts (
  summary text not null,
  detail  text not null,
  primary key (summary, detail)
);
alter table public.cb_gifi_parts enable row level security;
drop policy if exists "Closebook viewers read GIFI parts" on public.cb_gifi_parts;
create policy "Closebook viewers read GIFI parts" on public.cb_gifi_parts for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_gifi_parts to authenticated;
insert into public.cb_gifi_parts (summary, detail) values
  ('1000', '1001'),
  ('1000', '1002'),
  ('1000', '1003'),
  ('1000', '1004'),
  ('1000', '1005'),
  ('1000', '1007'),
  ('1060', '1062'),
  ('1060', '1064'),
  ('1060', '1066'),
  ('1060', '1067'),
  ('1060', '1068'),
  ('1060', '1069'),
  ('1060', '1071'),
  ('1061', '1063'),
  ('1061', '1065'),
  ('1061', '1070'),
  ('1061', '1072'),
  ('1120', '1121'),
  ('1120', '1122'),
  ('1120', '1123'),
  ('1120', '1125'),
  ('1120', '1126'),
  ('1180', '1181'),
  ('1180', '1182'),
  ('1180', '1183'),
  ('1180', '1184'),
  ('1180', '1186'),
  ('1180', '1187'),
  ('1240', '1241'),
  ('1240', '1242'),
  ('1240', '1243'),
  ('1240', '1244'),
  ('1300', '1301'),
  ('1300', '1302'),
  ('1300', '1303'),
  ('1400', '1401'),
  ('1400', '1402'),
  ('1400', '1403'),
  ('1480', '1481'),
  ('1480', '1482'),
  ('1480', '1483'),
  ('1480', '1484'),
  ('1480', '1486'),
  ('1600', '1601'),
  ('1600', '1602'),
  ('1680', '1684'),
  ('1740', '1742'),
  ('1740', '1744'),
  ('1740', '1746'),
  ('1740', '1768'),
  ('1740', '1770'),
  ('1740', '1772'),
  ('1740', '1774'),
  ('1740', '1783'),
  ('1740', '1785'),
  ('1741', '1743'),
  ('1741', '1745'),
  ('1741', '1747'),
  ('1741', '1769'),
  ('1741', '1771'),
  ('1741', '1773'),
  ('1741', '1775'),
  ('1741', '1784'),
  ('1741', '1786'),
  ('1900', '1904'),
  ('1900', '1908'),
  ('1900', '1910'),
  ('1900', '1912'),
  ('1900', '1914'),
  ('1900', '1916'),
  ('1900', '1918'),
  ('1900', '1920'),
  ('1901', '1905'),
  ('1901', '1909'),
  ('1901', '1911'),
  ('1901', '1913'),
  ('1901', '1915'),
  ('1901', '1917'),
  ('1901', '1919'),
  ('2010', '2012'),
  ('2010', '2016'),
  ('2010', '2018'),
  ('2010', '2020'),
  ('2010', '2022'),
  ('2010', '2024'),
  ('2010', '2026'),
  ('2011', '2013'),
  ('2011', '2017'),
  ('2011', '2019'),
  ('2011', '2021'),
  ('2011', '2023'),
  ('2011', '2025'),
  ('2011', '2027'),
  ('2180', '2181'),
  ('2180', '2182'),
  ('2180', '2183'),
  ('2240', '2241'),
  ('2240', '2242'),
  ('2240', '2243'),
  ('2240', '2244'),
  ('2240', '2245'),
  ('2240', '2246'),
  ('2240', '2247'),
  ('2240', '2248'),
  ('2240', '2249'),
  ('2240', '2250'),
  ('2300', '2301'),
  ('2300', '2302'),
  ('2300', '2303'),
  ('2300', '2304'),
  ('2300', '2305'),
  ('2300', '2306'),
  ('2300', '2311'),
  ('2420', '2421'),
  ('2420', '2423'),
  ('2420', '2424'),
  ('2420', '2425'),
  ('2420', '2426'),
  ('2420', '2427'),
  ('2620', '2621'),
  ('2620', '2622'),
  ('2620', '2623'),
  ('2620', '2624'),
  ('2620', '2625'),
  ('2620', '2626'),
  ('2620', '2627'),
  ('2620', '2628'),
  ('2620', '2629'),
  ('2700', '2701'),
  ('2700', '2705'),
  ('2700', '2706'),
  ('2700', '2840'),
  ('2780', '2781'),
  ('2780', '2782'),
  ('2780', '2783'),
  ('2860', '2861'),
  ('2860', '2862'),
  ('2860', '2863'),
  ('2960', '2961'),
  ('2960', '2962'),
  ('2960', '2963'),
  ('2960', '2964'),
  ('2960', '2965'),
  ('3140', '3141'),
  ('3140', '3143'),
  ('3140', '3144'),
  ('3140', '3145'),
  ('3140', '3146'),
  ('3140', '3147'),
  ('3140', '3149'),
  ('3260', '3261'),
  ('3260', '3262'),
  ('3260', '3263'),
  ('3300', '3301'),
  ('3300', '3302'),
  ('3320', '3321'),
  ('3320', '3322'),
  ('3320', '3325'),
  ('3320', '3326'),
  ('3320', '3328'),
  ('3540', '3541'),
  ('3540', '3542'),
  ('3540', '3543'),
  ('3700', '3701'),
  ('3740', '3741'),
  ('3740', '3743'),
  ('3740', '3744')
on conflict do nothing;

-- A code and its detail lines.
create or replace function private.cb_gifi_family(p_code text) returns text[]
language sql stable set search_path = '' as $$
  select array[p_code] || coalesce((select array_agg(detail order by detail) from public.cb_gifi_parts where summary = p_code), '{}')
$$;

-- The standard chart accounts a step 2 line can sit on: those on the code itself (3660: those on 3600), then
-- those on its detail lines, each in chart order.
create or replace function private.cb_chart_on_code(p_code text) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(number order by own desc, sort_order), '{}') from (
    select c.number, c.sort_order, (left(c.line_no, 4) = p_code or (p_code = '3660' and left(c.line_no, 4) = '3600')) own
      from public.cb_chart_accounts c
     where c.line_no is not null
       and (left(c.line_no, 4) = any(private.cb_gifi_family(p_code)) or (p_code = '3660' and left(c.line_no, 4) = '3600'))) x
$$;
revoke all on function private.cb_gifi_family(text), private.cb_chart_on_code(text) from public, anon;

create or replace function public.cb_save_opening(p_file uuid, p_codes jsonb, p_re_stated numeric, p_ni_typed numeric, p_note text)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_code text;
  v_acc text;
  v_bank uuid;
  v_on text[];
  v_n int := 0;
  v_before jsonb; v_after jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) <= 1000, 'Lines are missing.');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    v_code := v_row ->> 'code';
    perform private.require(v_code ~ '^\d{4}$' and private.cb_gifi_type(v_code) is not null, format('GIFI %s is not a code Closebook can use.', v_code));
    perform private.require(v_code not in ('2599', '3499', '3600', '3620', '3640', '3680', '3849', '8299', '9368', '9999'), format('%s is a total: it calculates by itself.', v_code));
    v_acc := nullif(v_row ->> 'account', ''); v_bank := null;
    if v_acc like 'bank:%' then
      -- One of the file's bank or card accounts, on this GIFI line or one of its detail lines.
      select b.id into v_bank from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
       where b.id = substr(v_acc, 6)::uuid and b.file_id = p_file and left(c.line_no, 4) = any(private.cb_gifi_family(v_code));
      perform private.require(v_bank is not null, format('That bank account is not on GIFI line %s.', v_code));
      v_acc := null;
    end if;
    perform private.require(v_acc is null or v_acc = any(private.cb_chart_on_code(v_code)), format('Account %s is not on GIFI line %s.', v_acc, v_code));
    -- A Schedule 100 line with one standard account, and no bank account of the file on it, takes it.
    if v_acc is null and v_bank is null and private.cb_gifi_type(v_code) not in ('Revenue', 'Expense') then
      v_on := private.cb_chart_on_code(v_code);
      if cardinality(v_on) = 1 and not exists (select 1 from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
                                                 where b.file_id = p_file and left(c.line_no, 4) = any(private.cb_gifi_family(v_code))) then
        v_acc := v_on[1];
      end if;
    end if;
    -- As printed on the T2; dividends (3700 to 3719) always negative (rule 3).
    insert into public.cb_opening_balances (file_id, code, amount, chart_account, bank_account)
    values (p_file, v_code, case when v_code::int between 3700 and 3719 then -abs(round((v_row ->> 'amount')::numeric, 2)) else round((v_row ->> 'amount')::numeric, 2) end, v_acc, v_bank)
    on conflict (file_id, code) do update set amount = public.cb_opening_balances.amount + excluded.amount;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = coalesce(opening_source, 'manual'), opening_re_stated = p_re_stated, opening_ni_typed = p_ni_typed,
         opening_note = left(coalesce(btrim(p_note), ''), 300), opening_set_by = (select auth.uid()), opening_set_at = now(),
         opening_signed_by = null, opening_signed_at = null, updated_at = now()
   where id = p_file;
  -- One place for last year's Schedule 125 (item 8): the tab's lines feed the statements' prior-year column.
  select coalesce(jsonb_agg(jsonb_build_array(code, amount) order by code), '[]'::jsonb) into v_before from public.cb_opening_s125 where file_id = p_file;
  delete from public.cb_opening_s125 where file_id = p_file;
  insert into public.cb_opening_s125 (file_id, code, amount)
  select p_file, code, amount from public.cb_opening_balances where file_id = p_file and amount <> 0 and private.cb_gifi_type(code) in ('Revenue', 'Expense');
  select coalesce(jsonb_agg(jsonb_build_array(code, amount) order by code), '[]'::jsonb) into v_after from public.cb_opening_s125 where file_id = p_file;
  if v_before <> v_after then perform private.cb_clear_step(p_file, 'statements', 'Last year''s Schedule 125 changed'); end if;
  return v_n;
end;
$$;
revoke all on function public.cb_save_opening(uuid, jsonb, numeric, numeric, text) from public, anon;
grant execute on function public.cb_save_opening(uuid, jsonb, numeric, numeric, text) to authenticated;

-- B. Sixteen standard chart accounts (Hashim approved, Nov 16, 2026), as in the chart file. The lead sheet
-- comes with the master line, like every chart account.
insert into public.cb_chart_accounts (number, name, account_type, line_no, tax_default, note, sort_order) values
  ('13100', 'Due from director', 'Asset', '1303.00', 'None', 'A director who is not a shareholder: outside the shareholder loan schedule', 0),
  ('15700', 'Tools and dies', 'Asset', '1744.00', 'GST/HST', 'Capital', 0),
  ('15750', 'Accumulated amortization – tools and dies', 'Asset', '1745.00', 'None', '', 0),
  ('15800', 'Signs', 'Asset', '1768.00', 'GST/HST', 'Capital', 0),
  ('15850', 'Accumulated amortization – signs', 'Asset', '1769.00', 'None', '', 0),
  ('15900', 'Other tangible capital assets', 'Asset', '1900.00', 'GST/HST', 'Capital', 0),
  ('15950', 'Accumulated amortization – other tangible capital assets', 'Asset', '1901.00', 'None', '', 0),
  ('16250', 'Accumulated amortization – incorporation costs', 'Asset', '2019.00', 'None', '', 0),
  ('17500', 'Due from shareholder (long-term)', 'Asset', '2181.00', 'None', 'Shareholder 1: in the shareholder loan schedule with 13000, 23000 and 25400', 0),
  ('17600', 'Cash surrender value of life insurance', 'Asset', '2427.00', 'None', '', 0),
  ('21250', 'Bonuses payable', 'Liability', '2626.00', 'None', '', 0),
  ('23150', 'Due to director', 'Liability', '2783.00', 'None', 'A director who is not a shareholder: outside the shareholder loan schedule', 0),
  ('25450', 'Due to director (long-term)', 'Liability', '3263.00', 'None', 'A director who is not a shareholder: outside the shareholder loan schedule', 0),
  ('25500', 'Private loan', 'Liability', '3147.00', 'None', '', 0),
  ('30200', 'Contributed surplus', 'Equity', '3541.00', 'None', '', 0),
  ('31600', 'Other items affecting retained earnings', 'Equity', '3740.00', 'None', '', 0)
on conflict (number) do update set name = excluded.name, account_type = excluded.account_type, line_no = excluded.line_no,
  tax_default = excluded.tax_default, note = excluded.note;
-- Chart order is number order: the new accounts take their place (the same accounts keep the same order).
update public.cb_chart_accounts c set sort_order = x.n
  from (select number, (row_number() over (order by number))::int n from public.cb_chart_accounts) x
 where x.number = c.number and c.sort_order is distinct from x.n;

-- C. The shareholder loan schedule: 17500 is shareholder 1's (with 13000, 23000 and 25400), so a long-term
-- amount the shareholder owes gets the s.15(2) check; the long-term due from shareholder lines (2180 to
-- 2183) join the schedule's lines; the director accounts 13100, 23150 and 25450 stay out of it.
create or replace function private.cb_sh_applies(p_file uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cb_accounts a where a.file_id = p_file
     and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')
     and a.account_key not in ('chart:13100', 'chart:23150', 'chart:25450')
     and (a.this_year <> 0 or a.last_year <> 0 or private.cb_account_final(a.id) <> 0))
$$;

create or replace function public.cb_set_sh_owner(p_file uuid, p_account text, p_shareholder int) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_shareholder between 1 and 9, 'Pick shareholder 1 to 9.');
  perform private.require(p_account not in ('chart:13000', 'chart:23000', 'chart:25400', 'chart:17500', 'chart:13050', 'chart:23050'),
    'The standard chart sets this account''s shareholder.');
  perform private.require(p_account not in ('chart:13100', 'chart:23150', 'chart:25450'),
    'This account is for a director who is not a shareholder: it is outside the shareholder loan schedule.');
  perform private.require(exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = p_account
     and left(coalesce(a.line_no, ''), 4) in ('1301', '1302', '1303', '2180', '2181', '2182', '2183', '2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263')),
    'That account is not on a shareholder line.');
  insert into public.cb_sh_owners (file_id, account_key, shareholder, source, picked_by) values (p_file, p_account, p_shareholder, 'picked', (select auth.uid()))
  on conflict (file_id, account_key) do update set shareholder = excluded.shareholder, source = 'picked', picked_by = excluded.picked_by, picked_at = now();
  perform private.cb_log(p_file, 'sh_owner', 'entries', format('%s: shareholder %s', p_account, p_shareholder));
end;
$$;
revoke all on function public.cb_set_sh_owner(uuid, text, int) from public, anon;
grant execute on function public.cb_set_sh_owner(uuid, text, int) to authenticated;

-- Lines saved before these accounts existed (1744 and 1745 on the client file): a line whose code now has a
-- single standard account, and no bank account of the file on it or its detail lines, takes it, as the save
-- does. Unlocked files only; the figures do not change, so the sign-offs stay (trigger off for this update).
alter table public.cb_opening_balances disable trigger cb_changed_opening;
update public.cb_opening_balances o set chart_account = (private.cb_chart_on_code(o.code))[1]
 where o.chart_account is null and o.bank_account is null and cardinality(private.cb_chart_on_code(o.code)) = 1
   and coalesce(private.cb_gifi_type(o.code), '') not in ('Revenue', 'Expense')
   and exists (select 1 from public.cb_files f where f.id = o.file_id and f.phase <> 'locked')
   and not exists (select 1 from public.cb_bank_accounts b join public.cb_chart_accounts c on c.number = b.chart_account
                    where b.file_id = o.file_id and left(c.line_no, 4) = any(private.cb_gifi_family(o.code)));
alter table public.cb_opening_balances enable trigger cb_changed_opening;
