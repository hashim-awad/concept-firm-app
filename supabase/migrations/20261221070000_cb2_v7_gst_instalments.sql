-- CloseBook2 piece CB2-0 version 7, Part 4 item 4 (Hashim, Nov 21, 2026; answer Q4 A). "GST/HST instalments paid" joins
-- the standard chart, marked as the instalments account. Line 110 of the GST/HST return reads only that account for the
-- period (what was coded, rule 4); a payment coded to GST/HST payable (21500) is a balance payment, not an instalment.
alter table public.cb_chart_accounts add column if not exists is_gst_instalments boolean not null default false;
create unique index if not exists cb_chart_accounts_one_gst_instalments on public.cb_chart_accounts (is_gst_instalments) where is_gst_instalments;
do $$
begin
  if not exists (select 1 from public.cb_chart_accounts where number = '21510') then
    update public.cb_chart_accounts set sort_order = sort_order + 1 where sort_order > (select sort_order from public.cb_chart_accounts where number = '21500');
    insert into public.cb_chart_accounts (number, name, account_type, line_no, tax_default, note, sort_order, is_gst_instalments)
    values ('21510', 'GST/HST instalments paid', 'Liability', '2680.00', 'None',
            'Instalments paid to the CRA; line 110 of the GST/HST return reads this account',
            (select sort_order + 1 from public.cb_chart_accounts where number = '21500'), true);
  else
    update public.cb_chart_accounts set is_gst_instalments = true where number = '21510';
  end if;
end $$;
