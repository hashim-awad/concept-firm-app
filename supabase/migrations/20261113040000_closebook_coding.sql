-- Closebook step 3, coding (Hashim, Nov 13, 2026; BRIEF.md "Closebook standard chart", "Sales tax codes",
-- "Sales tax on each line"). Settings: sales tax codes and their dated rates (Ontario, Alberta, BC only),
-- the standard chart (docs/phase3/Closebook-standard-chart-APPROVED.csv). Each file: the setup answers.
-- Each bank or card line: its account, sales tax code and status. Vendor rules are kept per client, so
-- they carry to the client's future years.

create table public.cb_sales_tax_codes (
  code       text primary key check (code ~ '^[A-Z0-9_]{2,30}$'),
  name       text not null,
  provinces  text[],                      -- null: every province
  sort_order int not null
);
create table public.cb_sales_tax_parts (
  id             uuid primary key default gen_random_uuid(),
  code           text not null references public.cb_sales_tax_codes (code) on delete cascade,
  name           text not null,
  rate           numeric(7, 5) not null check (rate >= 0 and rate < 1),
  recoverable    boolean not null,
  liability      text not null check (liability in ('gst_hst', 'pst')),
  effective_from date not null,           -- a new rate is a new row with the date it starts
  unique (code, name, effective_from)
);
insert into public.cb_sales_tax_codes (code, name, provinces, sort_order) values
  ('EXEMPT', 'Exempt', null, 10), ('OUT_OF_SCOPE', 'Out of Scope', null, 20), ('ZERO_RATED', 'Zero Rated', null, 30),
  ('HST_ON', 'HST ON', '{ON}', 40), ('GST', 'GST', '{ON,AB,BC}', 50), ('PST_BC', 'PST BC', '{BC}', 60), ('GST_PST_BC', 'GST/PST BC', '{BC}', 70),
  ('MEALS_HST_50', 'Meals HST 50', '{ON}', 80), ('MEALS_GST_50', 'Meals GST 50', '{AB,BC}', 90);
-- Rates as Hashim set them (Nov 13, 2026). The meals parts follow the firm's QBO SOP.
insert into public.cb_sales_tax_parts (code, name, rate, recoverable, liability, effective_from) values
  ('HST_ON', 'HST ON', 0.13, true, 'gst_hst', '2000-01-01'),
  ('GST', 'GST', 0.05, true, 'gst_hst', '2000-01-01'),
  ('PST_BC', 'PST BC', 0.07, false, 'pst', '2000-01-01'),
  ('GST_PST_BC', 'GST', 0.05, true, 'gst_hst', '2000-01-01'),
  ('GST_PST_BC', 'PST BC', 0.07, false, 'pst', '2000-01-01'),
  ('MEALS_HST_50', 'Meals HST ITC', 0.065, true, 'gst_hst', '2000-01-01'),
  ('MEALS_HST_50', 'Meals HST NoITC', 0.065, false, 'gst_hst', '2000-01-01'),
  ('MEALS_GST_50', 'Meals GST ITC', 0.025, true, 'gst_hst', '2000-01-01'),
  ('MEALS_GST_50', 'Meals GST NoITC', 0.025, false, 'gst_hst', '2000-01-01');

create table public.cb_chart_accounts (
  number       text primary key check (number ~ '^\d{4}$'),
  name         text not null,
  account_type text not null check (account_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense')),
  line_no      text not null references public.cb_master_lines (line_no),
  tax_default  text not null check (tax_default in ('GST/HST', 'None', 'Exempt', 'Check')),
  note         text not null default '',
  sort_order   int not null
);
insert into public.cb_chart_accounts (number, name, account_type, line_no, tax_default, note, sort_order) values
  ('1000', 'Chequing', 'Asset', '1002.00', 'None', 'Moves to 2000 Bank overdraft when negative', 1),
  ('1010', 'Savings', 'Asset', '1002.00', 'None', '', 2),
  ('1020', 'US dollar account', 'Asset', '1003.00', 'None', '', 3),
  ('1050', 'Petty cash', 'Asset', '1001.00', 'None', '', 4),
  ('1100', 'Accounts receivable', 'Asset', '1062.00', 'None', '', 5),
  ('1105', 'Allowance for doubtful accounts', 'Asset', '1063.00', 'None', '', 6),
  ('1110', 'Due from related company (current)', 'Asset', '1403.00', 'None', '', 7),
  ('1150', 'Inventory', 'Asset', '1121.00', 'None', '', 8),
  ('1200', 'Prepaid expenses', 'Asset', '1484.00', 'None', '', 9),
  ('1210', 'Deposits paid', 'Asset', '1486.00', 'None', '', 10),
  ('1220', 'Income taxes recoverable', 'Asset', '1483.00', 'None', '', 11),
  ('1250', 'Term deposits and GICs', 'Asset', '1181.00', 'None', '', 12),
  ('1300', 'Due from shareholder 1', 'Asset', '1301.10', 'None', 'Moves to 2300 Due to shareholder 1 when negative', 13),
  ('1305', 'Due from shareholder 2', 'Asset', '1301.20', 'None', 'Moves to 2305 Due to shareholder 2 when negative', 14),
  ('1500', 'Computer equipment', 'Asset', '1774.00', 'GST/HST', 'Capital: ITC claimed under both methods', 15),
  ('1505', 'Accumulated amortization – computer equipment', 'Asset', '1775.00', 'None', '', 16),
  ('1510', 'Furniture and fixtures', 'Asset', '1787.00', 'GST/HST', 'Capital', 17),
  ('1515', 'Accumulated amortization – furniture and fixtures', 'Asset', '1788.00', 'None', '', 18),
  ('1520', 'Equipment', 'Asset', '1740.00', 'GST/HST', 'Capital', 19),
  ('1525', 'Accumulated amortization – equipment', 'Asset', '1741.00', 'None', '', 20),
  ('1530', 'Vehicles', 'Asset', '1742.00', 'GST/HST', 'Capital: passenger vehicle ITC limits apply', 21),
  ('1535', 'Accumulated amortization – vehicles', 'Asset', '1743.00', 'None', '', 22),
  ('1540', 'Leasehold improvements', 'Asset', '1918.00', 'GST/HST', 'Capital', 23),
  ('1545', 'Accumulated amortization – leasehold improvements', 'Asset', '1919.00', 'None', '', 24),
  ('1550', 'Land', 'Asset', '1600.00', 'Check', 'Real property: reviewer decides', 25),
  ('1560', 'Building', 'Asset', '1680.00', 'Check', 'Real property: reviewer decides', 26),
  ('1565', 'Accumulated amortization – building', 'Asset', '1681.00', 'None', '', 27),
  ('1600', 'Intangible assets', 'Asset', '2010.00', 'GST/HST', '', 28),
  ('1605', 'Accumulated amortization – intangible assets', 'Asset', '2011.00', 'None', '', 29),
  ('1610', 'Goodwill', 'Asset', '2012.00', 'None', '', 30),
  ('1620', 'Incorporation costs', 'Asset', '2018.00', 'Check', '', 31),
  ('1700', 'Shares in related company', 'Asset', '2242.00', 'None', '', 32),
  ('1710', 'Loan to related company (long-term)', 'Asset', '2243.00', 'None', '', 33),
  ('1720', 'Investments – Canadian shares', 'Asset', '2303.00', 'None', '', 34),
  ('1730', 'Investments – other', 'Asset', '2311.00', 'None', '', 35),
  ('2000', 'Bank overdraft', 'Liability', '2600.00', 'None', '', 36),
  ('2100', 'Accounts payable', 'Liability', '2621.00', 'None', '', 37),
  ('2110', 'Accrued liabilities', 'Liability', '2620.00', 'None', '', 38),
  ('2120', 'Wages payable', 'Liability', '2624.00', 'None', '', 39),
  ('2130', 'Payroll deductions payable', 'Liability', '2627.00', 'None', '', 40),
  ('2140', 'Income taxes payable', 'Liability', '2680.00', 'None', '', 41),
  ('2150', 'GST/HST payable', 'Liability', '2680.00', 'None', 'The tax column posts here', 42),
  ('2155', 'PST payable', 'Liability', '2680.00', 'None', 'PST that BC clients collect on their sales', 43),
  ('2160', 'Dividends payable', 'Liability', '2962.00', 'None', '', 44),
  ('2170', 'Customer deposits', 'Liability', '2961.00', 'None', '', 45),
  ('2180', 'Deferred revenue', 'Liability', '2770.00', 'None', '', 46),
  ('2200', 'Credit card', 'Liability', '2707.00', 'None', 'One account per card in the file', 47),
  ('2210', 'Line of credit', 'Liability', '2701.00', 'None', '', 48),
  ('2300', 'Due to shareholder 1', 'Liability', '2781.10', 'None', 'Moves to 1300 Due from shareholder 1 when negative', 49),
  ('2305', 'Due to shareholder 2', 'Liability', '2781.20', 'None', 'Moves to 1305 Due from shareholder 2 when negative', 50),
  ('2310', 'Due to related company', 'Liability', '2863.00', 'None', '', 51),
  ('2400', 'Current portion of long-term debt', 'Liability', '2920.00', 'None', '', 52),
  ('2500', 'Bank loan', 'Liability', '3143.00', 'None', '', 53),
  ('2510', 'Mortgage', 'Liability', '3141.00', 'None', '', 54),
  ('2520', 'Other long-term loan', 'Liability', '3140.00', 'None', '', 55),
  ('2540', 'Loan from shareholder (long-term)', 'Liability', '3261.00', 'None', '', 56),
  ('3000', 'Common shares', 'Equity', '3500.00', 'None', '', 57),
  ('3010', 'Preferred shares', 'Equity', '3520.00', 'None', '', 58),
  ('3100', 'Retained earnings', 'Equity', '3600.00', 'None', '', 59),
  ('3200', 'Dividends – non-eligible', 'Equity', '3701.10', 'None', '', 60),
  ('3210', 'Dividends – eligible', 'Equity', '3701.20', 'None', '', 61),
  ('4000', 'Sales', 'Revenue', '8000.00', 'GST/HST', 'Quick method: year-end entry moves the quick method difference to 4230', 62),
  ('4010', 'Service revenue', 'Revenue', '8000.00', 'GST/HST', '', 63),
  ('4020', 'Commission income', 'Revenue', '8120.00', 'GST/HST', '', 64),
  ('4025', 'Real estate commission', 'Revenue', '8121.00', 'GST/HST', '', 65),
  ('4030', 'Consulting income', 'Revenue', '8241.00', 'GST/HST', '', 66),
  ('4040', 'Management fee income', 'Revenue', '8239.00', 'GST/HST', '', 67),
  ('4050', 'Rental income', 'Revenue', '8141.00', 'Check', 'Commercial rent is taxable; residential is exempt', 68),
  ('4100', 'Interest income', 'Revenue', '8094.00', 'Exempt', '', 69),
  ('4110', 'Dividend income', 'Revenue', '8096.00', 'None', '', 70),
  ('4200', 'Gain or loss on sale of assets', 'Revenue', '8210.00', 'None', '', 71),
  ('4210', 'Foreign exchange gain or loss', 'Revenue', '8231.00', 'None', '', 72),
  ('4220', 'Government grants and subsidies', 'Revenue', '8242.00', 'None', '', 73),
  ('4230', 'Other income', 'Revenue', '8230.00', 'Check', '', 74),
  ('5000', 'Purchases and materials', 'Expense', '8320.00', 'GST/HST', '', 75),
  ('5010', 'Subcontractors – cost of sales', 'Expense', '8360.00', 'GST/HST', '', 76),
  ('5020', 'Direct wages', 'Expense', '8340.00', 'None', '', 77),
  ('5030', 'Freight-in and duty', 'Expense', '8457.00', 'GST/HST', '', 78),
  ('5040', 'Opening inventory', 'Expense', '8300.00', 'None', 'Year-end entry', 79),
  ('5050', 'Closing inventory', 'Expense', '8500.00', 'None', 'Year-end entry', 80),
  ('6000', 'Advertising', 'Expense', '8521.00', 'GST/HST', '', 81),
  ('6010', 'Promotion and client gifts', 'Expense', '8524.00', 'GST/HST', '', 82),
  ('6020', 'Meals and entertainment', 'Expense', '8523.00', 'GST/HST', 'ITC limited to 50% under regular method', 83),
  ('6025', 'Staff events (all employees)', 'Expense', '8523.10', 'GST/HST', '', 84),
  ('6030', 'Club dues and golf', 'Expense', '8761.10', 'None', '', 85),
  ('6040', 'Donations', 'Expense', '8522.00', 'None', '', 86),
  ('6045', 'Political contributions', 'Expense', '8522.10', 'None', '', 87),
  ('6050', 'Bad debts', 'Expense', '8590.00', 'None', '', 88),
  ('6100', 'Employee benefits', 'Expense', '8622.00', 'None', '', 89),
  ('6110', 'Group insurance', 'Expense', '8621.00', 'Exempt', '', 90),
  ('6150', 'Amortization', 'Expense', '8670.00', 'None', 'Year-end entry', 91),
  ('6160', 'Amortization of intangible assets', 'Expense', '8570.00', 'None', 'Year-end entry', 92),
  ('6200', 'Insurance', 'Expense', '8690.00', 'Exempt', '', 93),
  ('6210', 'Life insurance on executives', 'Expense', '8691.00', 'Exempt', '', 94),
  ('6300', 'Bank charges', 'Expense', '8715.00', 'Exempt', '', 95),
  ('6310', 'Credit card and merchant fees', 'Expense', '8716.00', 'Exempt', '', 96),
  ('6320', 'Interest on loans', 'Expense', '8714.00', 'Exempt', '', 97),
  ('6325', 'Interest on line of credit', 'Expense', '8711.00', 'Exempt', '', 98),
  ('6330', 'Mortgage interest', 'Expense', '8713.00', 'Exempt', '', 99),
  ('6340', 'CRA interest and penalties', 'Expense', '8710.10', 'None', '', 100),
  ('6400', 'Licences and permits', 'Expense', '8764.00', 'None', '', 101),
  ('6410', 'Memberships and dues', 'Expense', '8761.00', 'GST/HST', '', 102),
  ('6420', 'Business taxes', 'Expense', '8762.00', 'None', '', 103),
  ('6500', 'Office supplies', 'Expense', '8811.00', 'GST/HST', '', 104),
  ('6510', 'Office expenses', 'Expense', '8810.00', 'GST/HST', '', 105),
  ('6520', 'Software and subscriptions', 'Expense', '9150.00', 'GST/HST', 'Foreign vendors: check', 106),
  ('6530', 'Postage, courier and freight', 'Expense', '9275.00', 'GST/HST', '', 107),
  ('6600', 'Accounting fees', 'Expense', '8862.00', 'GST/HST', '', 108),
  ('6610', 'Legal fees', 'Expense', '8861.00', 'GST/HST', '', 109),
  ('6620', 'Consulting fees', 'Expense', '8863.00', 'GST/HST', '', 110),
  ('6630', 'Brokerage fees', 'Expense', '8869.00', 'GST/HST', '', 111),
  ('6640', 'Management fees', 'Expense', '8871.00', 'GST/HST', '', 112),
  ('6645', 'Management fees – related parties', 'Expense', '8871.10', 'GST/HST', '', 113),
  ('6650', 'Training and education', 'Expense', '8876.00', 'GST/HST', '', 114),
  ('6700', 'Rent', 'Expense', '8911.00', 'GST/HST', 'Residential rent is exempt', 115),
  ('6705', 'Rent – related party', 'Expense', '8911.10', 'GST/HST', '', 116),
  ('6710', 'Condominium fees', 'Expense', '8913.00', 'Check', '', 117),
  ('6720', 'Equipment rental', 'Expense', '8914.00', 'GST/HST', '', 118),
  ('6730', 'Vehicle lease', 'Expense', '8915.00', 'GST/HST', 'Lease limits apply', 119),
  ('6740', 'Storage', 'Expense', '8917.00', 'GST/HST', '', 120),
  ('6800', 'Repairs and maintenance', 'Expense', '8960.00', 'GST/HST', '', 121),
  ('6810', 'Repairs – building', 'Expense', '8961.00', 'GST/HST', '', 122),
  ('6820', 'Cleaning and janitorial', 'Expense', '9010.00', 'GST/HST', '', 123),
  ('6830', 'Security', 'Expense', '9013.00', 'GST/HST', '', 124),
  ('6900', 'Salaries and wages', 'Expense', '9066.00', 'None', '', 125),
  ('6905', 'Shareholder salary (T4)', 'Expense', '9065.10', 'None', '', 126),
  ('6910', 'Commissions paid', 'Expense', '9061.00', 'Check', 'Paid to a registrant: GST/HST', 127),
  ('6915', 'Bonuses', 'Expense', '9063.00', 'None', '', 128),
  ('6920', 'Subcontractors', 'Expense', '9110.00', 'GST/HST', 'Small suppliers may not charge tax', 129),
  ('6930', 'Supplies', 'Expense', '9130.00', 'GST/HST', '', 130),
  ('6940', 'Small tools', 'Expense', '9131.00', 'GST/HST', '', 131),
  ('7000', 'Internet', 'Expense', '9152.00', 'GST/HST', '', 132),
  ('7010', 'Property taxes', 'Expense', '9180.00', 'None', '', 133),
  ('7020', 'Travel', 'Expense', '9200.00', 'GST/HST', 'Foreign travel: check', 134),
  ('7030', 'Conferences and meetings', 'Expense', '9201.00', 'GST/HST', '', 135),
  ('7040', 'Utilities', 'Expense', '9220.00', 'GST/HST', '', 136),
  ('7050', 'Telephone', 'Expense', '9225.00', 'GST/HST', '', 137),
  ('7060', 'Vehicle expenses', 'Expense', '9281.00', 'GST/HST', 'Fuel and parking', 138),
  ('7065', 'Vehicle repairs', 'Expense', '8962.00', 'GST/HST', '', 139),
  ('7100', 'Other expenses', 'Expense', '9270.00', 'Check', '', 140),
  ('7110', 'Fines and penalties', 'Expense', '9270.10', 'None', '', 141),
  ('7120', 'Cash over and short', 'Expense', '9271.00', 'None', '', 142),
  ('7200', 'Current income taxes', 'Expense', '9990.00', 'None', 'Year-end entry from ProFile', 143),
  ('7210', 'Deferred income taxes', 'Expense', '9995.00', 'None', '', 144);

-- The setup answers (step 1): realtor, owner_paid, dividends, payroll, holdco, gst_registered,
-- gst_frequency (annual, quarterly, monthly), quick_method.
alter table public.cb_files add column setup jsonb not null default '{}'::jsonb;

-- Each bank or card account sits on one standard chart account (chequing, savings, card, line of credit).
alter table public.cb_bank_accounts add column chart_account text references public.cb_chart_accounts (number);
update public.cb_bank_accounts set chart_account = case kind when 'bank' then '1000' else '2200' end;
alter table public.cb_bank_accounts alter column chart_account set not null;

alter table public.cb_bank_lines
  add column chart_account   text references public.cb_chart_accounts (number),
  add column tax_code        text references public.cb_sales_tax_codes (code),
  add column status          text not null default 'new' check (status in ('new', 'done', 'ask_client', 'reviewer')),
  add column source          text not null default '' check (source in ('', 'rule', 'last_year', 'manual')),
  add column reviewer_reason text not null default '',
  add column coded_by        uuid references public.staff (id),
  add column coded_at        timestamptz;

create table public.cb_vendor_rules (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  vendor_key    text not null check (length(vendor_key) between 2 and 200),
  chart_account text not null references public.cb_chart_accounts (number),
  tax_code      text references public.cb_sales_tax_codes (code),
  created_by    uuid references public.staff (id),
  created_at    timestamptz not null default now(),
  unique (client_id, vendor_key)
);

-- Save the setup answers. Known keys only; the GST/HST answers set the tax column's defaults.
create or replace function public.cb_save_setup(p_file uuid, p_setup jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_key text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(jsonb_typeof(p_setup) = 'object', 'Answers are missing.');
  for v_key in select jsonb_object_keys(p_setup) loop
    perform private.require(v_key in ('realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered', 'gst_frequency', 'quick_method'), format('Unknown question %s.', v_key));
  end loop;
  perform private.require(coalesce(p_setup ->> 'gst_frequency', 'annual') in ('annual', 'quarterly', 'monthly'), 'Choose annual, quarterly or monthly.');
  update public.cb_files set setup = setup || p_setup, updated_at = now() where id = p_file;
end;
$$;

-- Code bank and card lines: [{"id": "...", "account": "6510", "tax": "HST_ON"}]. A line goes to the reviewer
-- instead of done when its account's sales tax is "Check", or when Meals and entertainment is coded at a
-- rate that is not a meals code (the SOP's #1 review flag). The reviewer's own coding is always final.
create or replace function public.cb_code_lines(p_file uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_item jsonb;
  v_acc public.cb_chart_accounts;
  v_tax text;
  v_reviewer boolean;
  v_reason text;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or (select private.is_owner());
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to code.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_acc from public.cb_chart_accounts where number = v_item ->> 'account';
    perform private.require(v_acc.number is not null, 'Choose an account from the standard chart.');
    v_tax := nullif(v_item ->> 'tax', '');
    perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Unknown sales tax code.');
    v_reason := case
      when v_reviewer then ''
      when v_acc.tax_default = 'Check' then 'The sales tax on this account is the reviewer''s call.'
      when v_acc.number = '6020' and coalesce(v_tax, '') not like 'MEALS%' then 'Meals coded at the full rate: only 50% of the tax is claimable.'
      when v_tax is null then 'No sales tax code chosen.'
      else '' end;
    update public.cb_bank_lines set chart_account = v_acc.number, tax_code = v_tax,
      status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason,
      source = coalesce(nullif(v_item ->> 'source', ''), 'manual'), coded_by = (select auth.uid()), coded_at = now()
     where id = (v_item ->> 'id')::uuid and file_id = p_file;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

-- Lines nobody can identify go on the client's question list (round 2, through TaxDome).
create or replace function public.cb_ask_client(p_file uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  update public.cb_bank_lines set status = 'ask_client', coded_by = (select auth.uid()), coded_at = now()
   where file_id = p_file and id = any (p_ids);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- Save a vendor rule for the client: the same vendor is coded the same way in this and future years.
create or replace function public.cb_save_vendor_rule(p_file uuid, p_vendor_key text, p_account text, p_tax text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_client uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select client_id into v_client from public.cb_files where id = p_file;
  perform private.require(v_client is not null, 'File not found.');
  perform private.require(exists (select 1 from public.cb_chart_accounts where number = p_account), 'Choose an account from the standard chart.');
  insert into public.cb_vendor_rules (client_id, vendor_key, chart_account, tax_code, created_by)
  values (v_client, btrim(p_vendor_key), p_account, nullif(p_tax, ''), (select auth.uid()))
  on conflict (client_id, vendor_key) do update set chart_account = excluded.chart_account, tax_code = excluded.tax_code, created_by = excluded.created_by, created_at = now();
end;
$$;

alter table public.cb_sales_tax_codes enable row level security;
alter table public.cb_sales_tax_codes force row level security;
alter table public.cb_sales_tax_parts enable row level security;
alter table public.cb_sales_tax_parts force row level security;
alter table public.cb_chart_accounts enable row level security;
alter table public.cb_chart_accounts force row level security;
alter table public.cb_vendor_rules enable row level security;
alter table public.cb_vendor_rules force row level security;
create policy "Closebook viewers read sales tax codes" on public.cb_sales_tax_codes for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read sales tax parts" on public.cb_sales_tax_parts for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read the standard chart" on public.cb_chart_accounts for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read vendor rules" on public.cb_vendor_rules for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_sales_tax_codes, public.cb_sales_tax_parts, public.cb_chart_accounts, public.cb_vendor_rules to authenticated;

revoke all on function public.cb_save_setup(uuid, jsonb), public.cb_code_lines(uuid, jsonb), public.cb_ask_client(uuid, uuid[]), public.cb_save_vendor_rule(uuid, text, text, text) from public, anon;
grant execute on function public.cb_save_setup(uuid, jsonb), public.cb_code_lines(uuid, jsonb), public.cb_ask_client(uuid, uuid[]), public.cb_save_vendor_rule(uuid, text, text, text) to authenticated;

-- A new bank or card account sits on Chequing (1000) or Credit card (2200) unless one is chosen;
-- cb_set_bank_chart_account moves it (savings, US dollar account, line of credit).
create or replace function private.cb_bank_account_default() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.chart_account is null then new.chart_account := case new.kind when 'bank' then '1000' else '2200' end; end if;
  return new;
end;
$$;
create trigger cb_bank_account_default before insert on public.cb_bank_accounts for each row execute function private.cb_bank_account_default();
alter table public.cb_bank_accounts alter column chart_account drop not null;
alter table public.cb_bank_accounts add constraint cb_bank_accounts_chart_set check (chart_account is not null) not valid;

create or replace function public.cb_set_bank_chart_account(p_account uuid, p_chart text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(p_chart in ('1000', '1010', '1020', '2000', '2200', '2210'), 'Choose chequing, savings, US dollar account, overdraft, credit card or line of credit.');
  update public.cb_bank_accounts set chart_account = p_chart where id = p_account;
end;
$$;
revoke all on function public.cb_set_bank_chart_account(uuid, text) from public, anon;
grant execute on function public.cb_set_bank_chart_account(uuid, text) to authenticated;
revoke all on function private.cb_bank_account_default() from public, anon, authenticated;
