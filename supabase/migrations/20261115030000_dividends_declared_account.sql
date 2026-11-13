-- The standard chart gains 32200 Dividends declared, on GIFI 3700 (Hashim, Nov 15, 2026): the dividends
-- line had no account number, so a dividend paid this year had no account to code to. 32200 is the next
-- free number in the 3xxxx range, after 32000 and 32100 (non-eligible and eligible dividends, GIFI 3701).
-- Last year's 3700 balance now posts to 32200 as well.
update public.cb_chart_accounts set sort_order = sort_order + 1 where sort_order > (select sort_order from public.cb_chart_accounts where number = '32100');
insert into public.cb_chart_accounts (number, name, account_type, line_no, tax_default, note, sort_order)
values ('32200', 'Dividends declared', 'Equity', '3700.00', 'None', '', (select sort_order + 1 from public.cb_chart_accounts where number = '32100'));
