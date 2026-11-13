-- Standard chart accounts never look like GIFI codes (Hashim, Nov 15, 2026; benchmark: QuickBooks Online
-- and CaseWare number their own chart separately from the GIFI lines it maps to). Every standard chart
-- account moves from 4 digits to 5 by adding a zero: 1000 Chequing becomes 10000, 2300 Due to
-- shareholder 1 becomes 23000. Every reference moves with it: bank and card accounts, coded bank lines,
-- vendor rules, the built trial balance rows (chart:1000 becomes chart:10000), and the numbers named in
-- the chart's notes and in the coding functions.

alter table public.cb_bank_accounts drop constraint if exists cb_bank_accounts_chart_account_fkey;
alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_chart_account_fkey;
alter table public.cb_vendor_rules drop constraint if exists cb_vendor_rules_chart_account_fkey;
alter table public.cb_chart_accounts drop constraint if exists cb_chart_accounts_number_check;

update public.cb_chart_accounts set number = number || '0', note = regexp_replace(note, '\y(\d{4})\y', '\10', 'g') where number ~ '^\d{4}$';
update public.cb_bank_accounts set chart_account = chart_account || '0' where chart_account ~ '^\d{4}$';
update public.cb_bank_lines set chart_account = chart_account || '0' where chart_account ~ '^\d{4}$';
update public.cb_vendor_rules set chart_account = chart_account || '0' where chart_account ~ '^\d{4}$';
-- Built rows of bank-statement files: chart:1000 and bank rows numbered on a chart account.
update public.cb_accounts a set account_key = 'chart:' || substr(a.account_key, 7) || '0', number = a.number || '0'
 where a.account_key ~ '^chart:\d{4}$'
   and exists (select 1 from public.cb_files f where f.id = a.file_id and f.books in ('statements', 'paper'));
update public.cb_accounts a set number = a.number || '0'
 where a.account_key like 'bank:%' and a.number ~ '^\d{4}$'
   and exists (select 1 from public.cb_files f where f.id = a.file_id and f.books in ('statements', 'paper'));

alter table public.cb_chart_accounts add constraint cb_chart_accounts_number_check check (number ~ '^\d{5}$');
alter table public.cb_bank_accounts add constraint cb_bank_accounts_chart_account_fkey foreign key (chart_account) references public.cb_chart_accounts (number) on update cascade;
alter table public.cb_bank_lines add constraint cb_bank_lines_chart_account_fkey foreign key (chart_account) references public.cb_chart_accounts (number) on update cascade;
alter table public.cb_vendor_rules add constraint cb_vendor_rules_chart_account_fkey foreign key (chart_account) references public.cb_chart_accounts (number) on update cascade;

-- A new bank or card account sits on Chequing (10000) or Credit card (22000) unless one is chosen.
create or replace function private.cb_bank_account_default() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.chart_account is null then new.chart_account := case new.kind when 'bank' then '10000' else '22000' end; end if;
  return new;
end;
$$;

create or replace function public.cb_set_bank_chart_account(p_account uuid, p_chart text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require(p_chart in ('10000', '10100', '10200', '20000', '22000', '22100'), 'Choose chequing, savings, US dollar account, overdraft, credit card or line of credit.');
  update public.cb_bank_accounts set chart_account = p_chart where id = p_account;
end;
$$;

-- Coding: meals (60200) at the full rate still go to the reviewer.
create or replace function public.cb_code_lines(p_file uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_item jsonb;
  v_acc public.cb_chart_accounts;
  v_tax text;
  v_reviewer boolean;
  v_line public.cb_bank_lines;
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
    perform private.require(v_tax is not null, 'Choose a sales tax code for every line. Nothing was saved.');
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Unknown sales tax code.');
    select * into v_line from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file;
    perform private.require(v_line.id is not null, 'Line not found.');
    v_reason := case
      when v_reviewer and v_line.status = 'reviewer' then ''
      when v_acc.tax_default = 'Check' and not v_reviewer then 'The sales tax on this account is the reviewer''s call.'
      when v_acc.number = '60200' and coalesce(v_tax, '') not like 'MEALS%' then 'Meals coded at the full rate: only 50% of the tax is claimable.'
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
