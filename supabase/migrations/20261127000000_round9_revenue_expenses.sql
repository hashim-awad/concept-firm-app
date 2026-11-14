-- Round 9 (Hashim, Nov 26, 2026): the revenue check and expenses paid personally, on step 5.
--
-- A. The revenue check (CaseWare's tie-out working paper): revenue per the trial balance against its
--    source (the brokerage's commission statement, a sales report, a processor's report, slips), never
--    bank deposits; GST/HST registrants also against the year's GST/HST returns; realtors' T4A from the
--    brokerage against the commission statement. A difference is explained in one line or fixed with an
--    entry made from the check. A difference left over the review threshold waits for the reviewer.
--    Step 5 cannot be signed as prepared until it is done.
-- B. Expenses paid personally (QuickBooks Online's journal entry): a new standard entry, "Expenses paid
--    personally", with the 31 category lines of the client's sheet, in its names and order, and the
--    defaults Hashim approved (Nov 26, 2026). The preparer types each line's before-tax and GST/HST
--    amounts from the sheet's Summary; Closebook books one AJE dated the year end that debits each
--    line's account, debits ITCs to 21500 where allowed and credits the shareholder loan. Closebook does
--    not read the sheet: it is attached to the entry as its source.
-- Safe to run twice (round 4d rule).

-- Entries made from a check say so, and link back to it.
alter table public.cb_entries add column if not exists origin text;
alter table public.cb_entries drop constraint if exists cb_entries_origin_check;
alter table public.cb_entries add constraint cb_entries_origin_check check (origin in ('revenue_check', 'expenses_personal'));

-- ---------------------------------------------------------------------------------------------------
-- A. Revenue check
-- ---------------------------------------------------------------------------------------------------
create table if not exists public.cb_revenue_sources (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  kind        text not null check (kind in ('commission_statement', 't4a', 'sales_report', 'processor_report', 'slips', 'gst_returns')),
  payer       text not null default '' check (payer in ('', 'brokerage', 'other')),
  label       text not null default '' check (length(label) <= 120),
  amount      numeric(14, 2) not null,
  attachment  text not null check (length(attachment) > 0),
  created_by  uuid references public.staff (id),
  created_at  timestamptz not null default now(),
  check (kind <> 't4a' or payer in ('brokerage', 'other'))
);
create index if not exists cb_revenue_sources_file on public.cb_revenue_sources (file_id);

create table if not exists public.cb_revenue_checks (
  file_id          uuid primary key references public.cb_files (id) on delete cascade,
  explanation      text not null default '' check (length(explanation) <= 200),
  gst_explanation  text not null default '' check (length(gst_explanation) <= 200),
  t4a_explanation  text not null default '' check (length(t4a_explanation) <= 200),
  t4a_none         boolean not null default false,
  -- The difference each explanation was written for: when the difference changes, it is open again.
  explained_diff      numeric(14, 2),
  gst_explained_diff  numeric(14, 2),
  t4a_explained_diff  numeric(14, 2),
  accepted_by      uuid references public.staff (id),
  accepted_at      timestamptz,
  accepted_diff    numeric(14, 2),
  updated_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now()
);
alter table public.cb_revenue_checks add column if not exists explained_diff numeric(14, 2);
alter table public.cb_revenue_checks add column if not exists gst_explained_diff numeric(14, 2);
alter table public.cb_revenue_checks add column if not exists t4a_explained_diff numeric(14, 2);

alter table public.cb_revenue_sources enable row level security;
alter table public.cb_revenue_sources force row level security;
alter table public.cb_revenue_checks enable row level security;
alter table public.cb_revenue_checks force row level security;
drop policy if exists "Closebook viewers read revenue sources" on public.cb_revenue_sources;
create policy "Closebook viewers read revenue sources" on public.cb_revenue_sources for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Closebook viewers read revenue checks" on public.cb_revenue_checks;
create policy "Closebook viewers read revenue checks" on public.cb_revenue_checks for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_revenue_sources, public.cb_revenue_checks from anon;
grant select on public.cb_revenue_sources, public.cb_revenue_checks to authenticated;

-- The check's figures: revenue per the trial balance (every account on a revenue line, after entries,
-- as a positive amount), the primary sources, the GST/HST returns and the T4A check.
create or replace function private.cb_revenue_state(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_tb numeric; v_src numeric; v_gst numeric; v_comm numeric; v_t4a numeric;
  v_n_src int; v_n_gst int; v_n_comm int; v_n_t4a int;
  r public.cb_revenue_checks;
  v_limit numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  select -coalesce(sum(private.cb_account_final(a.id)), 0) into v_tb
    from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no where a.file_id = p_file and m.line_type = 'Revenue';
  select coalesce(sum(amount) filter (where kind in ('commission_statement', 'sales_report', 'processor_report', 'slips') or (kind = 't4a' and payer = 'other')), 0),
         count(*) filter (where kind in ('commission_statement', 'sales_report', 'processor_report', 'slips') or (kind = 't4a' and payer = 'other')),
         coalesce(sum(amount) filter (where kind = 'gst_returns'), 0), count(*) filter (where kind = 'gst_returns'),
         coalesce(sum(amount) filter (where kind = 'commission_statement'), 0), count(*) filter (where kind = 'commission_statement'),
         coalesce(sum(amount) filter (where kind = 't4a' and payer = 'brokerage'), 0), count(*) filter (where kind = 't4a' and payer = 'brokerage')
    into v_src, v_n_src, v_gst, v_n_gst, v_comm, v_n_comm, v_t4a, v_n_t4a
    from public.cb_revenue_sources where file_id = p_file;
  select * into r from public.cb_revenue_checks where file_id = p_file;
  select entry_review_amount into v_limit from public.cb_settings limit 1;
  return jsonb_build_object('tb', v_tb, 'sources', v_src, 'n_sources', v_n_src, 'diff', v_tb - v_src,
    'gst', v_gst, 'n_gst', v_n_gst, 'gst_diff', v_tb - v_gst, 'commission', v_comm, 'n_commission', v_n_comm,
    't4a', v_t4a, 'n_t4a', v_n_t4a, 't4a_diff', v_comm - v_t4a, 'threshold', coalesce(v_limit, 5000),
    'realtor', coalesce((v_file.setup ->> 'realtor')::boolean, false), 'registrant', coalesce((v_file.setup ->> 'gst_registered')::boolean, false),
    'explanation', coalesce(r.explanation, ''), 'gst_explanation', coalesce(r.gst_explanation, ''), 't4a_explanation', coalesce(r.t4a_explanation, ''),
    't4a_none', coalesce(r.t4a_none, false), 'accepted_diff', r.accepted_diff, 'accepted_by', r.accepted_by, 'accepted_at', r.accepted_at,
    'explained_diff', r.explained_diff, 'gst_explained_diff', r.gst_explained_diff, 't4a_explained_diff', r.t4a_explained_diff,
    -- An explanation counts only for the difference it was written for.
    'explained', coalesce(r.explanation, '') <> '' and r.explained_diff = v_tb - v_src,
    'gst_explained', coalesce(r.gst_explanation, '') <> '' and r.gst_explained_diff = v_tb - v_gst,
    't4a_explained', coalesce(r.t4a_explanation, '') <> '' and r.t4a_explained_diff = v_comm - v_t4a);
end;
$$;

create or replace function public.cb_revenue_status(p_file uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook access.');
  return private.cb_revenue_state(p_file);
end;
$$;

create or replace function public.cb_add_revenue_source(p_file uuid, p_kind text, p_payer text, p_label text, p_amount numeric, p_attachment text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_id uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_kind in ('commission_statement', 't4a', 'sales_report', 'processor_report', 'slips', 'gst_returns'), 'Choose the source.');
  perform private.require(p_kind <> 't4a' or p_payer in ('brokerage', 'other'), 'Say who paid the T4A: the brokerage or another payer.');
  perform private.require(p_amount is not null, 'Type the total from the report.');
  perform private.require(length(coalesce(p_attachment, '')) > 0, 'Attach the report.');
  insert into public.cb_revenue_sources (file_id, kind, payer, label, amount, attachment, created_by)
  values (p_file, p_kind, case when p_kind = 't4a' then p_payer else '' end, left(btrim(coalesce(p_label, '')), 120), round(p_amount, 2), p_attachment, (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.cb_remove_revenue_source(p_source uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file uuid;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select file_id into v_file from public.cb_revenue_sources where id = p_source;
  perform private.require(v_file is not null and (select phase from public.cb_files where id = v_file) <> 'locked', 'This file is locked or the source is gone.');
  delete from public.cb_revenue_sources where id = p_source;
end;
$$;

create or replace function public.cb_save_revenue_check(p_file uuid, p_explanation text, p_gst_explanation text, p_t4a_explanation text, p_t4a_none boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(length(btrim(coalesce(p_explanation, ''))) <= 200 and length(btrim(coalesce(p_gst_explanation, ''))) <= 200
    and length(btrim(coalesce(p_t4a_explanation, ''))) <= 200, 'Keep each explanation to one line (200 characters).');
  v := private.cb_revenue_state(p_file);
  insert into public.cb_revenue_checks (file_id, explanation, gst_explanation, t4a_explanation, t4a_none, explained_diff, gst_explained_diff, t4a_explained_diff, updated_by)
  values (p_file, btrim(coalesce(p_explanation, '')), btrim(coalesce(p_gst_explanation, '')), btrim(coalesce(p_t4a_explanation, '')), coalesce(p_t4a_none, false),
    case when btrim(coalesce(p_explanation, '')) <> '' then (v ->> 'diff')::numeric end, case when btrim(coalesce(p_gst_explanation, '')) <> '' then (v ->> 'gst_diff')::numeric end,
    case when btrim(coalesce(p_t4a_explanation, '')) <> '' then (v ->> 't4a_diff')::numeric end, (select auth.uid()))
  on conflict (file_id) do update set explanation = excluded.explanation, gst_explanation = excluded.gst_explanation, t4a_explanation = excluded.t4a_explanation,
    t4a_none = excluded.t4a_none, explained_diff = excluded.explained_diff, gst_explained_diff = excluded.gst_explained_diff, t4a_explained_diff = excluded.t4a_explained_diff,
    updated_by = excluded.updated_by, updated_at = now();
end;
$$;

-- The reviewer accepts a difference left over the threshold. A later change to the difference opens it again.
create or replace function public.cb_accept_revenue_difference(p_file uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v jsonb;
begin
  perform private.require(private.can_edit('closebook') and private.is_owner(), 'Only the reviewer accepts a revenue difference. Reviewers are owners.');
  v := private.cb_revenue_state(p_file);
  perform private.require(abs((v ->> 'diff')::numeric) > (v ->> 'threshold')::numeric, 'The difference is within the review threshold: nothing to accept.');
  perform private.require((v ->> 'explained')::boolean, 'The preparer explains this difference first.');
  insert into public.cb_revenue_checks (file_id, accepted_by, accepted_at, accepted_diff) values (p_file, (select auth.uid()), now(), (v ->> 'diff')::numeric)
  on conflict (file_id) do update set accepted_by = excluded.accepted_by, accepted_at = excluded.accepted_at, accepted_diff = excluded.accepted_diff;
  perform private.cb_log(p_file, 'revenue_accepted', 'entries', format('Revenue difference %s accepted', to_char((v ->> 'diff')::numeric, 'FM999,999,990.00')));
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- B. Expenses paid personally: a standard entry with lines
-- ---------------------------------------------------------------------------------------------------
-- A standard entry is "simple" (one debit, one credit: home office, auto, the fee accrual, the tax
-- provision) or has its own lines (this one). Its lines: tax: taxable (the client's GST/HST: ITC for a
-- regular registrant), meals (50% of the tax claimable, the rest added to the cost), none ("No tax
-- normally": a typed amount is flagged), auto (the Auto expenses standard entry's tax setting). share: km
-- (business km / total km), phone (the preparer's business share). pick: the preparer chooses the account
-- (choices: the only accounts allowed, when set); note: the preparer says what it is.
alter table public.cb_standard_entries add column if not exists style text not null default 'simple';
alter table public.cb_standard_entries drop constraint if exists cb_standard_entries_style_check;
alter table public.cb_standard_entries add constraint cb_standard_entries_style_check check (style in ('simple', 'lines'));

insert into public.cb_standard_entries (name, kind, reason, debit_account, credit_account, memo, wp_ref, reverse_next_year, tax_mode, sort_order, style)
select 'Expenses paid personally', 'AJE', 'correction', '65100', '23000', 'Business costs the shareholder paid personally during the year.',
       'Expenses paid personally summary', false, 'line', coalesce((select max(sort_order) from public.cb_standard_entries), 0) + 1, 'lines'
 where not exists (select 1 from public.cb_standard_entries where name = 'Expenses paid personally');

create table if not exists public.cb_standard_entry_lines (
  standard_id    uuid not null references public.cb_standard_entries (id) on delete cascade,
  key            text not null check (key ~ '^[a-z_]{2,40}$'),
  name           text not null,
  sort_order     int not null,
  account        text references public.cb_chart_accounts (number),
  tax            text not null check (tax in ('taxable', 'meals', 'none', 'auto')),
  share          text not null default 'none' check (share in ('none', 'km', 'phone')),
  capital        boolean not null default false,
  to_reviewer    boolean not null default false,
  pick           boolean not null default false,
  note_required  boolean not null default false,
  choices        text[] not null default '{}',
  updated_by     uuid references public.staff (id),
  updated_at     timestamptz not null default now(),
  primary key (standard_id, key)
);
insert into public.cb_standard_entry_lines (standard_id, key, name, sort_order, account, tax, share, capital, to_reviewer, pick, note_required, choices)
select s.id, v.key, v.name, v.ord, v.account, v.tax, v.share, v.capital, v.rev, v.pick, v.note, v.choices
  from public.cb_standard_entries s cross join (values
  ('advertising', 'Advertising and marketing', 1, '60000', 'taxable', 'none', false, false, false, false, '{}'::text[]),
  ('meals', 'Meals and entertainment', 2, '60200', 'meals', 'none', false, false, false, false, '{}'),
  ('gifts', 'Client gifts (not food or drink)', 3, '60100', 'taxable', 'none', false, false, false, false, '{}'),
  ('gifts_food', 'Client gifts of food or drink', 4, '60200', 'meals', 'none', false, false, false, false, '{}'),
  ('licences', 'Licences, permits and dues', 5, '64100', 'taxable', 'none', false, false, false, false, '{}'),
  ('business_insurance', 'Business insurance', 6, '62000', 'none', 'none', false, false, false, false, '{}'),
  ('professional', 'Professional fees', 7, '66000', 'taxable', 'none', false, false, false, false, '{}'),
  ('subcontractors', 'Subcontractors and contract labour', 8, '69200', 'taxable', 'none', false, false, false, false, '{}'),
  ('materials', 'Materials, supplies and goods for resale', 9, '69300', 'taxable', 'none', false, false, false, false, '{}'),
  ('office', 'Office supplies and postage', 10, '65000', 'taxable', 'none', false, false, false, false, '{}'),
  ('delivery', 'Delivery, shipping and courier', 11, '65300', 'taxable', 'none', false, false, false, false, '{}'),
  ('software', 'Software and subscriptions', 12, '65200', 'taxable', 'none', false, false, false, false, '{}'),
  ('phone', 'Phone and internet', 13, '70500', 'taxable', 'phone', false, false, false, false, '{}'),
  ('rent', 'Rent for business space', 14, '67000', 'taxable', 'none', false, false, false, false, '{}'),
  ('repairs', 'Repairs and maintenance', 15, '68000', 'taxable', 'none', false, false, false, false, '{}'),
  ('utilities', 'Utilities for business space', 16, '70400', 'taxable', 'none', false, false, false, false, '{}'),
  ('training', 'Training, courses and conferences', 17, '66500', 'taxable', 'none', false, false, false, false, '{}'),
  ('travel', 'Travel (out of town)', 18, '70200', 'taxable', 'none', false, false, false, false, '{}'),
  ('bank', 'Bank fees and interest', 19, '63000', 'none', 'none', false, false, false, false, '{}'),
  ('vehicle_fuel', 'Vehicle - fuel', 20, '70600', 'auto', 'km', false, false, false, false, '{}'),
  ('vehicle_repairs', 'Vehicle - repairs and maintenance', 21, '70650', 'auto', 'km', false, false, false, false, '{}'),
  ('vehicle_insurance', 'Vehicle - insurance', 22, '70600', 'none', 'km', false, false, false, false, '{}'),
  ('vehicle_licence', 'Vehicle - licence and registration', 23, '70600', 'none', 'km', false, false, false, false, '{}'),
  ('vehicle_lease', 'Vehicle - lease payments', 24, '70600', 'auto', 'km', false, true, false, false, '{}'),
  ('vehicle_loan_interest', 'Vehicle - loan interest', 25, '70600', 'none', 'km', false, true, false, false, '{}'),
  ('vehicle_parking', 'Vehicle - parking and tolls', 26, '70600', 'auto', 'km', false, false, false, false, '{}'),
  ('vehicle_purchase', 'Vehicle purchase', 27, '15300', 'taxable', 'none', true, true, false, false, '{}'),
  ('equipment', 'Equipment purchases', 28, '15200', 'taxable', 'none', true, true, false, false, '{}'),
  ('cra', 'Payments to CRA for the company', 29, null, 'none', 'none', false, false, true, false, '{21400,21500,21300}'),
  ('other', 'Other business expenses', 30, null, 'taxable', 'none', false, false, true, true, '{}'),
  ('not_sure', 'Not sure', 31, null, 'taxable', 'none', false, false, true, true, '{}')
  ) v(key, name, ord, account, tax, share, capital, rev, pick, note, choices)
 where s.name = 'Expenses paid personally' and s.style = 'lines'
on conflict (standard_id, key) do nothing;

alter table public.cb_standard_entry_lines enable row level security;
alter table public.cb_standard_entry_lines force row level security;
drop policy if exists "Closebook viewers read standard entry lines" on public.cb_standard_entry_lines;
create policy "Closebook viewers read standard entry lines" on public.cb_standard_entry_lines for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_standard_entry_lines from anon;
grant select on public.cb_standard_entry_lines to authenticated;

-- Owners change a line's default account, tax treatment or reviewer flag in Settings.
create or replace function public.cb_save_standard_entry_line(p_standard uuid, p_key text, p_account text, p_tax text, p_to_reviewer boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cb_standard_entry_lines;
begin
  perform private.require(private.is_owner(), 'Only owners change standard entries.');
  select * into c from public.cb_standard_entry_lines where standard_id = p_standard and key = p_key;
  perform private.require(c.key is not null, 'Unknown line.');
  perform private.require(nullif(p_account, '') is null or exists (select 1 from public.cb_chart_accounts where number = p_account), 'Choose an account from the standard chart.');
  perform private.require(c.pick or nullif(p_account, '') is not null, 'This line needs a default account.');
  perform private.require(nullif(p_account, '') is null or cardinality(c.choices) = 0 or p_account = any (c.choices), format('Choose one of %s.', array_to_string(c.choices, ', ')));
  perform private.require(p_tax in ('taxable', 'meals', 'none', 'auto'), 'Choose the sales tax treatment.');
  update public.cb_standard_entry_lines set account = nullif(p_account, ''), tax = p_tax, to_reviewer = coalesce(p_to_reviewer, false) or capital,
    updated_by = (select auth.uid()), updated_at = now() where standard_id = p_standard and key = p_key;
end;
$$;

-- The firm's expenses entry is kept by name: Settings changes its lines, never the entry itself.
create or replace function private.cb_keep_lines_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.style = 'lines' then
    raise exception 'The "Expenses paid personally" entry is set by its lines. Change a line instead.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
drop trigger if exists cb_keep_lines_entry on public.cb_standard_entries;
create trigger cb_keep_lines_entry before update or delete on public.cb_standard_entries for each row execute function private.cb_keep_lines_entry();

-- Book the entry from the typed Summary lines. The server works the lines out with the rules the screen
-- shows (src/lib/closebook/expenses.ts); the database checks again what must never slip: the sheet is
-- attached, the typed lines add up to the typed Summary total (before any business share is taken off),
-- vehicle amounts have the km, picked accounts are allowed, "Other" and "Not sure" say what they are,
-- every line over $5,000 has its receipts, and cb_add_entry's own rules (balance, date, accounts).
-- p_check: {"summary_total", "km_total", "km_business", "credit", "lines": [{"key", "total", "receipts", "account", "note"}]}.
-- Review: the normal rule (a total over the review threshold), plus the lines Settings sends to the
-- reviewer, plus a capital purchase on the quick method, plus what the screen flagged (p_to_reviewer).
create or replace function public.cb_add_personal_expenses(p_file uuid, p_lines jsonb, p_check jsonb, p_attachments text[], p_to_reviewer boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files; v_entry uuid; v_sum numeric; v_n int; v_std uuid; v_limit numeric; v_review boolean; v_credit numeric;
  x jsonb; c public.cb_standard_entry_lines;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(coalesce(array_length(p_attachments, 1), 0) >= 1, 'Attach the client''s sheet as the source.');
  select id into v_std from public.cb_standard_entries where name = 'Expenses paid personally' and style = 'lines';
  perform private.require(v_std is not null, 'The "Expenses paid personally" standard entry is missing.');
  perform private.require(jsonb_typeof(p_check -> 'lines') = 'array' and jsonb_array_length(p_check -> 'lines') > 0, 'Type the amounts from the Summary.');
  select coalesce(sum((e ->> 'total')::numeric), 0) into v_sum from jsonb_array_elements(p_check -> 'lines') e;
  perform private.require(round(v_sum, 2) = round((p_check ->> 'summary_total')::numeric, 2),
    format('The lines add up to %s, not the Summary total of %s. Check the amounts typed.', to_char(v_sum, 'FM999,999,990.00'), to_char((p_check ->> 'summary_total')::numeric, 'FM999,999,990.00')));
  v_review := coalesce(p_to_reviewer, false);
  for x in select * from jsonb_array_elements(p_check -> 'lines') loop
    select * into c from public.cb_standard_entry_lines where standard_id = v_std and key = x ->> 'key';
    perform private.require(c.key is not null, 'A line is not on the standard entry.');
    continue when coalesce((x ->> 'total')::numeric, 0) = 0;
    perform private.require(c.share <> 'km' or (coalesce((p_check ->> 'km_total')::numeric, 0) > 0 and coalesce((p_check ->> 'km_business')::numeric, -1) between 0 and (p_check ->> 'km_total')::numeric),
      'Vehicle lines need the total km and the business km for the year.');
    perform private.require(not c.pick or nullif(x ->> 'account', '') is not null, format('%s: choose the account.', c.name));
    perform private.require(cardinality(c.choices) = 0 or x ->> 'account' = any (c.choices), format('%s: choose one of %s.', c.name, array_to_string(c.choices, ', ')));
    perform private.require(not c.note_required or length(btrim(coalesce(x ->> 'note', ''))) >= 3, format('%s: add a note saying what it is.', c.name));
    perform private.require((x ->> 'total')::numeric <= 5000 or coalesce((x ->> 'receipts')::int, 0) > 0, format('%s is over $5,000: attach the receipts.', c.name));
    v_review := v_review or c.to_reviewer or (c.capital and coalesce((v_file.setup ->> 'quick_method')::boolean, false));
  end loop;
  v_entry := public.cb_add_entry(p_file, 'AJE', 'correction', 'Business costs the shareholder paid personally during the year.', false, p_lines,
    'Expenses paid personally summary', v_file.year_end, null, p_attachments);
  select entry_review_amount into v_limit from public.cb_settings limit 1;
  select coalesce(sum(amount), 0) into v_credit from public.cb_entry_lines where entry_id = v_entry and amount > 0;
  update public.cb_entries set origin = 'expenses_personal', standard_id = v_std, needs_review = v_review or v_credit > coalesce(v_limit, 0) where id = v_entry;
  return v_entry;
end;
$$;

-- A revenue fix: an entry made from the revenue check, linked back to it.
create or replace function public.cb_add_revenue_entry(p_file uuid, p_note text, p_lines jsonb, p_reverse boolean) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; v_entry uuid;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_entry := public.cb_add_entry(p_file, 'AJE', case when coalesce(p_reverse, false) then 'accrual' else 'correction' end, p_note, coalesce(p_reverse, false), p_lines, 'Revenue check', v_file.year_end, null, '{}');
  update public.cb_entries set origin = 'revenue_check' where id = v_entry;
  return v_entry;
end;
$$;

revoke all on function private.cb_revenue_state(uuid), private.cb_keep_lines_entry() from public, anon, authenticated;
revoke all on function public.cb_revenue_status(uuid), public.cb_add_revenue_source(uuid, text, text, text, numeric, text), public.cb_remove_revenue_source(uuid),
  public.cb_save_revenue_check(uuid, text, text, text, boolean), public.cb_accept_revenue_difference(uuid), public.cb_save_standard_entry_line(uuid, text, text, text, boolean),
  public.cb_add_personal_expenses(uuid, jsonb, jsonb, text[], boolean), public.cb_add_revenue_entry(uuid, text, jsonb, boolean) from public, anon;
grant execute on function public.cb_revenue_status(uuid), public.cb_add_revenue_source(uuid, text, text, text, numeric, text), public.cb_remove_revenue_source(uuid),
  public.cb_save_revenue_check(uuid, text, text, text, boolean), public.cb_accept_revenue_difference(uuid), public.cb_save_standard_entry_line(uuid, text, text, text, boolean),
  public.cb_add_personal_expenses(uuid, jsonb, jsonb, text[], boolean), public.cb_add_revenue_entry(uuid, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Step 5: what is open, and what waits for the reviewer.
-- ---------------------------------------------------------------------------------------------------
create or replace function private.cb_step5_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v jsonb := private.cb_revenue_state(p_file);
  v_out text[] := '{}';
  v_file public.cb_files;
begin
  select * into v_file from public.cb_files where id = p_file;
  if (v ->> 'realtor')::boolean and (v ->> 'n_commission')::int = 0 then
    v_out := v_out || 'Revenue check: enter the brokerage''s commission statement.'::text;
  elsif (v ->> 'n_sources')::int = 0 then
    v_out := v_out || 'Revenue check: enter the revenue source and attach it.'::text;
  elsif (v ->> 'diff')::numeric <> 0 and not (v ->> 'explained')::boolean then
    v_out := v_out || case when v ->> 'explanation' = '' then 'Revenue check: explain the difference, or fix it with an entry.'
      else 'Revenue check: the difference changed since it was explained. Check the explanation and save it again.' end;
  end if;
  if (v ->> 'registrant')::boolean then
    if (v ->> 'n_gst')::int = 0 then v_out := v_out || 'Revenue check: enter the revenue on the year''s GST/HST returns.'::text;
    elsif (v ->> 'gst_diff')::numeric <> 0 and not (v ->> 'gst_explained')::boolean then v_out := v_out || 'Revenue check: explain the difference with the GST/HST returns.'::text;
    end if;
  end if;
  if (v ->> 'realtor')::boolean then
    if (v ->> 'n_t4a')::int = 0 and not (v ->> 't4a_none')::boolean then v_out := v_out || 'Revenue check: enter the brokerage''s T4A, or say there is none.'::text;
    elsif (v ->> 'n_t4a')::int > 0 and (v ->> 't4a_diff')::numeric <> 0 and not (v ->> 't4a_explained')::boolean then
      v_out := v_out || 'Revenue check: explain the difference between the T4A and the commission statement.'::text;
    end if;
  end if;
  return v_out;
end;
$$;

create or replace function private.cb_step5_waiting(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb := private.cb_revenue_state(p_file);
begin
  if abs((v ->> 'diff')::numeric) > (v ->> 'threshold')::numeric and (v ->> 'accepted_diff')::numeric is distinct from (v ->> 'diff')::numeric then
    return array[format('Revenue difference of %s, over the review threshold.', to_char((v ->> 'diff')::numeric, 'FM999,999,990.00'))];
  end if;
  return '{}';
end;
$$;
revoke all on function private.cb_step5_problems(uuid), private.cb_step5_waiting(uuid) from public, anon, authenticated;

-- A change to the revenue check clears step 5's sign-offs, as any change to a step does. The
-- reviewer's acceptance is a decision on an item sent to the reviewer: it does not.
drop trigger if exists cb_changed_revenue_sources on public.cb_revenue_sources;
create trigger cb_changed_revenue_sources after insert or update or delete on public.cb_revenue_sources for each row
  execute function private.cb_changed('entries', 'A revenue source changed');
drop trigger if exists cb_changed_revenue_check on public.cb_revenue_checks;
create trigger cb_changed_revenue_check after insert or update of explanation, gst_explanation, t4a_explanation, t4a_none on public.cb_revenue_checks for each row
  execute function private.cb_changed('entries', 'A revenue check explanation changed');

-- Step 5 and its waiting list, with the checks above (round 8 rules otherwise unchanged).
create or replace function private.cb_step_problems(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_bank boolean;
  v_out text[] := '{}';
  v_n int;
  v_txt text;
  v_set jsonb;
  v_flag_amount numeric; v_flag_percent numeric;
begin
  select * into v_file from public.cb_files where id = p_file;
  v_bank := v_file.books in ('statements', 'paper');
  v_set := coalesce(v_file.setup, '{}'::jsonb);
  if p_step = 'setup' then
    select count(*) into v_n from unnest(array['realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered']) k where not (v_set ? k);
    if (v_set ->> 'gst_registered') = 'true' then
      v_n := v_n + (case when v_set ? 'gst_frequency' then 0 else 1 end) + (case when v_set ? 'quick_method' then 0 else 1 end);
    end if;
    if v_n > 0 then v_out := v_out || format('%s setup question%s to answer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'opening' then
    if v_bank then
      v_txt := private.cb_opening_problem(p_file);
      if v_txt is not null then v_out := v_out || v_txt; end if;
    elsif not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
      v_out := v_out || 'Import the trial balance: last year''s column comes with it.'::text;
    end if;
  elsif p_step = 'records' then
    if v_bank then
      if not exists (select 1 from public.cb_bank_accounts where file_id = p_file) then
        v_out := v_out || 'Add the bank and card accounts and upload their statements.'::text;
      else
        select count(*) into v_n from (
          select distinct a.id, date_trunc('month', d) from public.cb_bank_accounts a
           cross join generate_series(v_file.year_start::timestamp, v_file.year_end::timestamp, interval '1 day') d
           where a.file_id = p_file and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and d::date between s.period_start and s.period_end)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s of statements missing.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select opening, lag(closing) over (partition by account_id order by period_start) prev from public.cb_bank_statements where file_id = p_file) x
         where prev is not null and opening <> prev;
        if v_n > 0 then v_out := v_out || format('%s statement%s whose opening balance does not follow the one before.', v_n, case when v_n = 1 then '' else 's' end); end if;
        select count(*) into v_n from (
          select a.id, m from public.cb_bank_accounts a
           cross join generate_series(date_trunc('month', v_file.year_start::timestamp), v_file.year_end::timestamp, interval '1 month') m
           where a.file_id = p_file
             and exists (select 1 from public.cb_bank_statements s where s.account_id = a.id and s.period_start <= (m + interval '1 month - 1 day')::date and s.period_end >= m::date)
             and not exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and l.account_id = a.id and date_trunc('month', l.txn_date::timestamp) = m)) x;
        if v_n > 0 then v_out := v_out || format('%s month%s with no transactions: check the statements are complete.', v_n, case when v_n = 1 then '' else 's' end); end if;
      end if;
    else
      if not exists (select 1 from public.cb_imports where file_id = p_file and target = 'this_year') then
        v_out := v_out || 'Import the trial balance.'::text;
      elsif (select coalesce(sum(this_year), 0) from public.cb_accounts where file_id = p_file) <> 0 then
        v_out := v_out || 'The trial balance does not balance: import it again.'::text;
      end if;
    end if;
  elsif p_step = 'code' then
    if v_bank then
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'new';
      if v_n > 0 then v_out := v_out || format('%s line%s to code.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'ask_client';
      if v_n > 0 then v_out := v_out || format('%s line%s on the client''s question list.', v_n, case when v_n = 1 then '' else 's' end); end if;
    else
      select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
         and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
      if v_n > 0 then v_out := v_out || format('%s account%s to match to a GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    end if;
  elsif p_step = 'entries' then
    select flag_amount, flag_percent into v_flag_amount, v_flag_percent from public.cb_settings limit 1;
    v_flag_amount := coalesce(v_flag_amount, 5000); v_flag_percent := coalesce(v_flag_percent, 20);
    select count(*) into v_n from (
      select a.id, private.cb_account_final(a.id) fin, a.last_year from public.cb_accounts a join public.cb_master_lines m on m.line_no = a.line_no
       where a.file_id = p_file and m.lead_sheet is not null) x
     where abs(fin - last_year) > v_flag_amount and (last_year = 0 or abs(fin - last_year) / abs(last_year) * 100 > v_flag_percent)
       and not exists (select 1 from public.cb_flag_notes n where n.account_id = x.id);
    if v_n > 0 then v_out := v_out || format('%s flagged change%s to explain on the lead sheets.', v_n, case when v_n = 1 then '' else 's' end); end if;
    -- Round 9: the revenue check, and expenses paid personally when the setup says so.
    v_out := v_out || private.cb_step5_problems(p_file);
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts a where a.file_id = p_file and a.line_no is null and not a.needs_reviewer
       and a.account_key not in ('chart:10900', 'opening', 'uncoded') and private.cb_account_used(a.id);
    if v_n > 0 then v_out := v_out || format('%s account%s with no GIFI line.', v_n, case when v_n = 1 then '' else 's' end); end if;
    if exists (select 1 from public.cb_accounts a where a.file_id = p_file and a.account_key = 'chart:10900' and private.cb_account_final(a.id) <> 0) then
      v_out := v_out || 'Clearing (10900) has a balance: move it to the right account.'::text;
    end if;
  end if;
  -- A review note not yet fixed is open work on its step.
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status = 'open';
  if v_n > 0 then v_out := v_out || format('%s review note%s to fix.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;

create or replace function private.cb_step_waiting(p_file uuid, p_step text) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare
  v_out text[] := '{}';
  v_n int;
begin
  if p_step = 'opening' then
    if exists (select 1 from public.cb_accounts where file_id = p_file and account_key = 'opening' and needs_reviewer) then
      v_out := v_out || 'A difference with last year''s closing balances.'::text;
    end if;
  elsif p_step = 'code' then
    select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'reviewer';
    if v_n > 0 then v_out := v_out || format('%s line%s for the reviewer.', v_n, case when v_n = 1 then '' else 's' end); end if;
  elsif p_step = 'entries' then
    select count(*) into v_n from public.cb_entries where file_id = p_file and needs_review and reviewed_at is null;
    if v_n > 0 then v_out := v_out || format('%s entr%s to approve.', v_n, case when v_n = 1 then 'y' else 'ies' end); end if;
    v_out := v_out || private.cb_step5_waiting(p_file);
  elsif p_step = 'mapping' then
    select count(*) into v_n from public.cb_accounts where file_id = p_file and needs_reviewer and account_key not in ('opening', 'uncoded');
    if v_n > 0 then v_out := v_out || format('%s account%s waiting for the reviewer''s decision.', v_n, case when v_n = 1 then '' else 's' end); end if;
    v_n := private.cb_open_type_flags(p_file);
    if v_n > 0 then v_out := v_out || format('%s account%s on a GIFI line of another type.', v_n, case when v_n = 1 then '' else 's' end); end if;
  end if;
  select count(*) into v_n from public.cb_review_notes where file_id = p_file and step = p_step and status <> 'cleared';
  if v_n > 0 then v_out := v_out || format('%s review note%s to clear.', v_n, case when v_n = 1 then '' else 's' end); end if;
  return v_out;
end;
$$;
