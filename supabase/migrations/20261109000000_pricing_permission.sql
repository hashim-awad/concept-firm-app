-- Phase 2 batch, section 2: the Pricing permission (Hashim, Nov 9, 2026).
-- Covers the price book, quote amounts, quote breakdowns and the Issue quote action. Only roles with it
-- see prices. Staff without it see leads, clients and documents with no prices anywhere, and cannot
-- open past letters and proposals, whose PDFs and inputs carry fees (approved Nov 9, 2026).
-- The Owner role always has it (owners have every permission). Tied to roles, never to names.

insert into public.permission_areas (key, label, description, sort_order) values
  ('pricing', 'Pricing', 'Price book, packages and floors, quote amounts and breakdowns, and issuing quotes. Without it, no prices show anywhere.', 45);
update public.permission_areas
   set label = 'Screening questions and rules',
       description = 'Screening questions, the rules that pick price book items, and item names (no prices).'
 where key = 'price_book';

-- The Owner role's rows are locked by a guard; it is lifted only for this one insert, so the Owner row
-- matches every other area (owners have every permission in any case).
alter table public.role_permissions disable trigger role_permissions_guard_owner;
insert into public.role_permissions (role_id, area_key, level)
select r.id, 'pricing', case when r.is_owner then 'edit' else 'none' end from public.roles r
on conflict (role_id, area_key) do nothing;
alter table public.role_permissions enable trigger role_permissions_guard_owner;

-- Price book: item names stay readable for screening editors; prices, items and packages need Pricing.
drop policy "Price book viewers read items" on public.catalogue_items;
create policy "Screening or pricing viewers read items" on public.catalogue_items
  for select to authenticated using ((select private.can_view('price_book')) or (select private.can_view('pricing')));
drop policy "Price book editors add items" on public.catalogue_items;
create policy "Pricing editors add items" on public.catalogue_items
  for insert to authenticated with check ((select private.can_edit('pricing')));
drop policy "Price book editors change items" on public.catalogue_items;
create policy "Pricing editors change items" on public.catalogue_items
  for update to authenticated using ((select private.can_edit('pricing'))) with check ((select private.can_edit('pricing')));

drop policy "Price book viewers read prices" on public.item_prices;
create policy "Pricing viewers read prices" on public.item_prices
  for select to authenticated using ((select private.can_view('pricing')));
drop policy "Price book editors add prices" on public.item_prices;
create policy "Pricing editors add prices" on public.item_prices
  for insert to authenticated with check ((select private.can_edit('pricing')));

drop policy "Price book viewers read offers" on public.offers;
create policy "Pricing viewers read offers" on public.offers
  for select to authenticated using ((select private.can_view('pricing')));
drop policy "Price book editors add offers" on public.offers;
create policy "Pricing editors add offers" on public.offers
  for insert to authenticated with check ((select private.can_edit('pricing')));
drop policy "Price book editors change offers" on public.offers;
create policy "Pricing editors change offers" on public.offers
  for update to authenticated using ((select private.can_edit('pricing'))) with check ((select private.can_edit('pricing')));

-- Proposals carry their options and fees: Pricing needed to read or change them.
drop policy "Document viewers read proposals" on public.proposals;
create policy "Document viewers with pricing read proposals" on public.proposals
  for select to authenticated using ((select private.can_view('documents')) and (select private.can_view('pricing')));
drop policy "Document editors add proposals" on public.proposals;
create policy "Document editors with pricing add proposals" on public.proposals
  for insert to authenticated with check ((select private.can_edit('documents')) and (select private.can_edit('pricing')));
drop policy "Document editors change proposals" on public.proposals;
create policy "Document editors with pricing change proposals" on public.proposals
  for update to authenticated using ((select private.can_edit('documents')) and (select private.can_edit('pricing')))
  with check ((select private.can_edit('documents')) and (select private.can_edit('pricing')));

-- Document versions hold the letter inputs (with fees) and point to the PDF: Pricing needed.
-- The document list itself (title, type, status) stays visible to vault and document viewers.
drop policy "Vault viewers read versions" on public.document_versions;
create policy "Vault viewers with pricing read versions" on public.document_versions
  for select to authenticated using (((select private.can_view('vault')) or (select private.can_view('documents'))) and (select private.can_view('pricing')));
drop policy "Document editors add versions" on public.document_versions;
create policy "Document editors with pricing add versions" on public.document_versions
  for insert to authenticated with check ((select private.can_edit('documents')) and (select private.can_edit('pricing')));

drop policy "Vault viewers read document files" on storage.objects;
create policy "Vault viewers with pricing read document files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and ((select private.can_view('vault')) or (select private.can_view('documents'))) and (select private.can_view('pricing')));
drop policy "Document editors upload document files" on storage.objects;
create policy "Document editors with pricing upload document files" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select private.can_edit('documents')) and (select private.can_edit('pricing')));

-- Engagements: everyone with document access sees the engagement and its status; the fee columns and
-- the letter inputs are readable only through engagement_fees(), which needs Pricing.
revoke select on public.engagements from authenticated;
grant select (id, client_id, title, type, fiscal_year_end, el_version, status, el_issued, el_signed,
  monthly_billing_starts, period_start, payment_method, registration_confirmed, t1_individual, t1_tax_year,
  cra_authorization, cra_request_date, recorded_after_issue, notes, extra, source, issued_by,
  created_at, created_by, updated_at) on public.engagements to authenticated;

create or replace function public.engagement_fees(p_id uuid default null)
returns table (id uuid, fee numeric, monthly_fee numeric, t1_fee numeric, gst_addon_fee numeric, letter_data jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id, e.fee, e.monthly_fee, e.t1_fee, e.gst_addon_fee, e.letter_data
  from public.engagements e
  where (select private.can_view('documents')) and (select private.can_view('pricing'))
    and (p_id is null or e.id = p_id)
$$;
revoke all on function public.engagement_fees(uuid) from public, anon;
grant execute on function public.engagement_fees(uuid) to authenticated;
