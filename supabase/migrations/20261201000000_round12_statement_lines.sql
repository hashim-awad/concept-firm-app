-- Round 12 A (Hashim, Nov 14, 2026): statement-line corrections from the round 11 list. Every update sets a
-- fixed value, so the migration is safe to run twice. docs/phase3/Closebook-master-lines-APPROVED.xlsx is
-- brought in line in the same change, so the file and the database say the same.

-- 1. Capital leases print their own names, the dash written as a colon.
update public.cb_master_lines set statement_line = v.cap
  from (values ('1910', 'Capital leases: buildings'), ('1911', 'Accumulated amortization of capital leases: buildings'),
               ('1912', 'Capital leases: equipment'), ('1913', 'Accumulated amortization of capital leases: equipment'),
               ('1914', 'Capital leases: vehicles'), ('1915', 'Accumulated amortization of capital leases: vehicles'),
               ('1916', 'Capital leases: others'), ('1917', 'Accumulated amortization of capital leases: others')) as v(code, cap)
 where gifi_code = v.code and statement_line is distinct from v.cap;

-- 2. Prepaid expenses and deposits: 1480, 1484 and 1486 one line. 1483 its own line.
update public.cb_master_lines set statement_line = 'Prepaid expenses and deposits'
 where gifi_code in ('1480', '1484', '1486') and statement_line is distinct from 'Prepaid expenses and deposits';
update public.cb_master_lines set statement_line = 'Taxes recoverable' where gifi_code = '1483' and statement_line is distinct from 'Taxes recoverable';

-- 3. One caption per section for shareholder balances (Appendix C's wording). 1300, the section's own
-- line, takes the same caption as 1301 to 1303.
update public.cb_master_lines set statement_line = 'Due from shareholder'
 where gifi_code in ('1300', '1301', '1302', '1303') and statement_line is distinct from 'Due from shareholder';
update public.cb_master_lines set statement_line = 'Due to shareholder'
 where gifi_code in ('2780', '2781', '2782', '2783', '3260', '3261', '3262', '3263') and statement_line is distinct from 'Due to shareholder';

-- 4. Rent: 8910 to 8917 one line.
update public.cb_master_lines set statement_line = 'Rent'
 where gifi_code ~ '^\d{4}$' and gifi_code::int between 8910 and 8917 and statement_line is distinct from 'Rent';

-- 5. Own lines.
update public.cb_master_lines set statement_line = v.cap
  from (values ('8869', 'Brokerage fees'), ('8871', 'Management fees'), ('8876', 'Training'), ('9061', 'Commissions')) as v(code, cap)
 where gifi_code = v.code and statement_line is distinct from v.cap;
