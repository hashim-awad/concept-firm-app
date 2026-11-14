-- Round 11 fix (Hashim, Nov 14, 2026): statement lines on the master lines that printed wrong captions
-- on the year-end package. Safe to run twice: each update sets a fixed value.

-- Two GIFI names were cut short when CRA's list (RC4088) was read in; their full names first.
update public.cb_master_lines set gifi_name = 'Accumulated amortization of computer equipment/software' where gifi_code = '1775' and gifi_name = 'Accumulated amortization of computer';
update public.cb_master_lines set name = 'Accumulated amortization of computer equipment/software' where gifi_code = '1775' and name = 'Accumulated amortization of computer';
update public.cb_gifi_codes set name = 'Accumulated amortization of computer equipment/software' where code = '1775' and name = 'Accumulated amortization of computer';
update public.cb_master_lines set gifi_name = 'Accumulated amortization of leasehold improvements' where gifi_code = '1919' and gifi_name = 'Accumulated amortization of leasehold';
update public.cb_master_lines set name = 'Accumulated amortization of leasehold improvements' where gifi_code = '1919' and name = 'Accumulated amortization of leasehold';
update public.cb_gifi_codes set name = 'Accumulated amortization of leasehold improvements' where code = '1919' and name = 'Accumulated amortization of leasehold';

-- Every capital asset line, cost and accumulated amortization (1600 to 2589), prints its own GIFI name in
-- sentence case, as Appendix C does ("Canada" and "Canadian" keep their capital). Calculated totals stay.
create or replace function pg_temp.sentence(t text) returns text language sql immutable as $$
  select regexp_replace(upper(left(btrim(t), 1)) || lower(substr(btrim(t), 2)), '\mcanad', 'Canad', 'g')
$$;
update public.cb_master_lines
   set statement_line = pg_temp.sentence(gifi_name)
 where gifi_code ~ '^\d{4}$' and gifi_code::int between 1600 and 2589
   and coalesce(statement_line, '') <> 'Calculated total'
   and statement_line is distinct from pg_temp.sentence(gifi_name);

-- Payables: 2620 to 2628 print as one line. (Note 1's source deductions bullet still follows 2627.)
update public.cb_master_lines set statement_line = 'Accounts payable and accrued liabilities'
 where gifi_code in ('2620', '2621', '2622', '2623', '2624', '2625', '2626', '2627', '2628')
   and statement_line is distinct from 'Accounts payable and accrued liabilities';

-- Credit cards (2707) and trade receivables (1062).
update public.cb_master_lines set statement_line = 'Credit cards payable' where gifi_code = '2707' and statement_line is distinct from 'Credit cards payable';
update public.cb_master_lines set statement_line = 'Trade accounts receivable' where gifi_code = '1062' and statement_line is distinct from 'Trade accounts receivable';
