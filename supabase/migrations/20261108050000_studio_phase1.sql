-- Phase 1: Concept Studio in the app.
-- Clients, engagements (letter records), proposals, offers and floors, catalogue columns from
-- Studio, the document vault (documents, versions, private PDF storage), GST/HST rates with
-- owner approval, signer-name settings, private signature storage, and import runs.
-- Every table has row level security. Every change is written to the activity log.

-- ---------------------------------------------------------------------------
-- Permission area for the import screen is owner-only by rule (checked with is_owner).
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table public.clients (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('individual', 'corporation')),
  legal_name            text not null check (length(btrim(legal_name)) between 1 and 200),
  entity_type           text not null default 'Other' check (entity_type in ('PREC', 'Holdco', 'Operating co', 'Professional corp', 'Individual', 'Other')),
  signing_officer       text not null default '',
  signer_title          text not null default '',
  salutation            text not null default '',
  email                 text not null default '',
  street_address        text not null default '',
  address_line2         text not null default '',
  city                  text not null default '',
  postal_code           text not null default '',
  province              text not null default 'ON' check (province in ('ON', 'AB', 'BC', 'OTHER')),
  year_end_md           text not null default '' check (year_end_md = '' or year_end_md ~ '^\d{2}-\d{2}$'),
  basis                 text not null default 'standard' check (basis in ('standard', 'cash', 'custom')),
  custom_basis_wording  text not null default '',
  third_party_user      text not null default '',
  third_party_basis     text not null default '',
  name_verified         boolean not null default false,
  name_verified_by      uuid references public.staff (id),
  name_verified_on      date,
  status                text not null default 'active' check (status in ('active', 'inactive')),
  notes                 text not null default '',
  source                jsonb not null default '{}',  -- import trace (e.g. Notion page URL); no secrets
  created_at            timestamptz not null default now(),
  created_by            uuid references public.staff (id),
  updated_at            timestamptz not null default now()
);
create index clients_name_idx on public.clients (lower(legal_name));

create table public.client_links (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null references public.clients (id) on delete cascade,
  linked_id     uuid not null references public.clients (id) on delete cascade,
  relationship  text not null check (relationship in ('spouse', 'common-law partner', 'owner', 'director', 'shareholder', 'other')),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  unique (client_id, linked_id, relationship),
  check (client_id <> linked_id)
);

-- ---------------------------------------------------------------------------
-- Engagements (one per letter, as in Studio) and proposals
-- ---------------------------------------------------------------------------
create table public.engagements (
  id                      uuid primary key default gen_random_uuid(),
  client_id               uuid references public.clients (id),
  title                   text not null,
  type                    text not null check (type in ('Year-end compilation + T2', 'Monthly full service', 'T2 only', 'T1 personal', 'Corporate services')),
  fiscal_year_end         date,
  el_version              text not null default '',
  status                  text not null default 'EL drafted' check (status in ('EL drafted', 'EL sent', 'EL signed', 'Draft package sent', 'MAL signed', 'Issued', 'Cancelled')),
  el_issued               date,
  el_signed               date,
  fee                     numeric(12,2),
  monthly_fee             numeric(12,2),
  monthly_billing_starts  date,
  period_start            date,
  payment_method          text not null default '',
  registration_confirmed  boolean not null default false,
  t1_individual           text not null default '',
  t1_tax_year             int,
  t1_fee                  numeric(12,2),
  gst_addon_fee           numeric(12,2),
  cra_authorization       text not null default '',
  cra_request_date        date,
  recorded_after_issue    boolean not null default false,
  notes                   text not null default '',
  letter_data             jsonb,          -- the letter inputs (Studio "Letter data")
  extra                   jsonb not null default '{}', -- other Studio fields kept for Phase 3 (file checks, MAL, report date)
  source                  jsonb not null default '{}',
  issued_by               uuid references public.staff (id),
  created_at              timestamptz not null default now(),
  created_by              uuid references public.staff (id),
  updated_at              timestamptz not null default now()
);
create index engagements_client_idx on public.engagements (client_id, fiscal_year_end);

create table public.proposals (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references public.clients (id),
  title            text not null,
  prospect_name    text not null default '',
  contact          text not null default '',
  province         text not null default 'ON' check (province in ('ON', 'AB', 'BC', 'OTHER')),
  segment          text not null default 'Other' check (segment in ('Team or brokerage', 'Agent', 'Other')),
  status           text not null default 'Draft' check (status in ('Draft', 'Sent', 'Accepted', 'Declined', 'Expired')),
  date_sent        date,
  valid_until      date,
  options_summary  text not null default '',
  recommended      text not null default '',
  chosen_option    text not null default '',
  options_data     jsonb,
  notes            text not null default '',
  source           jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  created_by       uuid references public.staff (id),
  updated_at       timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Offers: packages, price floors and Studio's T1 price book rows
-- ---------------------------------------------------------------------------
create table public.offers (
  id                    uuid primary key default gen_random_uuid(),
  offer                 text not null unique check (length(btrim(offer)) between 1 and 200),
  segment               text not null check (segment in ('Team or brokerage', 'Agent', 'T1 personal')),
  is_package            boolean not null default false,
  services              text[] not null default '{}',
  monthly_fee           numeric(12,2),
  software_per_month    numeric(12,2),
  year_end_fee          numeric(12,2),
  annual_floor          numeric(12,2),
  monthly_reference     numeric(12,2),
  allows_payment_admin  boolean not null default false,
  t1_group              text check (t1_group in ('Base', 'Add-on', 'Triage', 'Out of scope')),
  unit                  text not null default '',
  unit_price            numeric(12,2),
  notes                 text not null default '',
  sort_order            numeric not null default 0,
  is_active             boolean not null default true,
  source                jsonb not null default '{}',
  created_at            timestamptz not null default now(),
  created_by            uuid references public.staff (id),
  updated_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Catalogue: Studio's service catalogue columns
-- ---------------------------------------------------------------------------
alter table public.catalogue_items drop constraint catalogue_items_code_check;
alter table public.catalogue_items add constraint catalogue_items_code_check check (code ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$');
alter table public.catalogue_items
  add column category         text not null default '',
  add column income_account   text not null default '',
  add column price_type       text not null default 'Fixed' check (price_type in ('Fixed', 'Per client')),
  add column approval_status  text not null default 'approved' check (approval_status in ('draft', 'approved')),
  add column decision_needed  text not null default '',
  add column replaces_qbo     text not null default '',
  add column replaces_taxdome text not null default '',
  add column studio_source    text not null default '';

insert into public.service_lines (key, name, sort_order) values
  ('corporate', 'Corporate', 5),
  ('incorporation', 'Incorporation', 70),
  ('advisory', 'Advisory', 80),
  ('adjustments', 'Adjustments', 90)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Document vault
-- ---------------------------------------------------------------------------
create table public.documents (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('corporate_letter', 't1_letter', 'proposal')),
  title           text not null,
  client_id       uuid references public.clients (id),
  engagement_id   uuid references public.engagements (id),
  proposal_id     uuid references public.proposals (id),
  status          text not null default 'draft' check (status in ('draft', 'final', 'sent', 'signed', 'withdrawn', 'regenerated')),
  current_version int not null default 0,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now()
);
create index documents_client_idx on public.documents (client_id);

create table public.document_versions (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references public.documents (id),
  version      int not null check (version >= 1),
  mode         text not null check (mode in ('draft', 'final')),
  el_version   text not null default '',
  inputs       jsonb not null,           -- exact inputs the document was built from
  file_path    text not null,            -- storage object in bucket "documents"
  file_name    text not null,
  file_sha256  text not null check (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_size    int not null,
  regenerated  boolean not null default false,
  label        text not null default '',
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id),
  unique (document_id, version)
);

-- ---------------------------------------------------------------------------
-- GST/HST rates (decision 22): each rate shows its CRA source, date checked and who checked it.
-- A rate is used only after an owner approves it.
-- ---------------------------------------------------------------------------
create table public.tax_rates (
  id              uuid primary key default gen_random_uuid(),
  province        text not null check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  tax             text not null check (tax in ('GST', 'HST')),
  rate_percent    numeric(6,3) not null check (rate_percent > 0 and rate_percent < 30),
  effective_from  date not null,
  source_url      text not null check (source_url ~ '^https://www\.canada\.ca/'),
  checked_on      date not null,
  checked_by      uuid not null references public.staff (id),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'retired')),
  approved_by     uuid references public.staff (id),
  approved_at     timestamptz,
  notes           text not null default '',
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now()
);
create unique index tax_rates_one_live on public.tax_rates (province, effective_from) where status <> 'retired';

-- ---------------------------------------------------------------------------
-- Import runs (owner only)
-- ---------------------------------------------------------------------------
create table public.import_runs (
  id          uuid primary key default gen_random_uuid(),
  source      text not null check (source in ('clients', 'engagements', 'proposals', 'offers', 'catalogue')),
  file_name   text not null,
  dry_run     boolean not null,
  counts      jsonb not null default '{}',
  problems    jsonb not null default '[]',
  created_at  timestamptz not null default now(),
  created_by  uuid references public.staff (id)
);

-- ---------------------------------------------------------------------------
-- Settings: signer names per document type (decision 25)
-- ---------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('signer_engagement_letter', '{"name": "Hashim Abouelfetouh, CPA", "title": "Director"}'),
  ('signer_proposal', '{"name": "Hashim Awad", "title": "Director"}'),
  ('signer_other', '{"name": "Hashim Awad", "title": "Director"}'),
  ('signature_image', '{"uploaded": false}')
on conflict (key) do nothing;

create or replace function public.update_setting(p_key text, p_value jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
  v_ids jsonb;
  v_count int;
begin
  perform private.require(private.can_edit('settings'), 'You do not have permission to change settings.');
  if p_key = 'lead_assignment' then
    v_mode := p_value ->> 'mode';
    v_ids := coalesce(p_value -> 'staff_ids', '[]'::jsonb);
    perform private.require(v_mode in ('single', 'unassigned', 'rotate'),
      'Assignment must be: one person, unassigned queue, or rotate.');
    perform private.require(jsonb_typeof(v_ids) = 'array', 'Staff list is not valid.');
    v_count := jsonb_array_length(v_ids);
    perform private.require(
      (v_mode = 'unassigned' and v_count = 0) or (v_mode = 'single' and v_count = 1) or (v_mode = 'rotate' and v_count >= 2),
      'Choose one person for "one person", two or more for "rotate", none for "unassigned".');
    perform private.require(not exists (
      select 1 from jsonb_array_elements_text(v_ids) e(id)
      where not exists (select 1 from public.staff s where s.id::text = e.id and s.is_active)
    ), 'Every chosen person must be an active staff member.');
    p_value := jsonb_build_object('mode', v_mode, 'staff_ids', v_ids, 'next_index', 0);
  elsif p_key = 'retention_months' then
    perform private.require(jsonb_typeof(p_value) = 'number'
      and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric)
      and (p_value #>> '{}')::int between 1 and 120,
      'Retention must be a whole number of months from 1 to 120.');
  elsif p_key in ('signer_engagement_letter', 'signer_proposal', 'signer_other') then
    perform private.require(private.is_owner(), 'Only an owner can change signer names.');
    perform private.require(length(btrim(coalesce(p_value ->> 'name', ''))) between 2 and 120, 'Enter the signer name.');
    perform private.require(length(btrim(coalesce(p_value ->> 'title', ''))) between 2 and 60, 'Enter the signer title.');
    p_value := jsonb_build_object('name', btrim(p_value ->> 'name'), 'title', btrim(p_value ->> 'title'));
  elsif p_key = 'signature_image' then
    perform private.require(private.is_owner(), 'Only an owner can change the signature image.');
    p_value := jsonb_build_object('uploaded', coalesce((p_value ->> 'uploaded')::boolean, false), 'uploaded_at', now());
  else
    perform private.require(false, 'Unknown setting: ' || p_key);
  end if;
  update public.settings set value = p_value, updated_by = (select auth.uid()) where key = p_key;
end;
$$;

-- Everyone who can use documents needs the signer names to build them.
create or replace function public.signer_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_active_staff() then (
    select jsonb_object_agg(key, value) from public.settings
    where key in ('signer_engagement_letter', 'signer_proposal', 'signer_other', 'signature_image')
  ) end
$$;
revoke all on function public.signer_settings() from public, anon;
grant execute on function public.signer_settings() to authenticated;

-- ---------------------------------------------------------------------------
-- Rules the database enforces
-- ---------------------------------------------------------------------------
create trigger clients_touch before update on public.clients for each row execute function private.touch_updated_at();
create trigger engagements_touch before update on public.engagements for each row execute function private.touch_updated_at();
create trigger proposals_touch before update on public.proposals for each row execute function private.touch_updated_at();
create trigger offers_touch before update on public.offers for each row execute function private.touch_updated_at();
create trigger documents_touch before update on public.documents for each row execute function private.touch_updated_at();
create trigger tax_rates_touch before update on public.tax_rates for each row execute function private.touch_updated_at();

create trigger clients_created_by before insert on public.clients for each row execute function private.set_created_by();
create trigger client_links_created_by before insert on public.client_links for each row execute function private.set_created_by();
create trigger engagements_created_by before insert on public.engagements for each row execute function private.set_created_by();
create trigger proposals_created_by before insert on public.proposals for each row execute function private.set_created_by();
create trigger offers_created_by before insert on public.offers for each row execute function private.set_created_by();
create trigger documents_created_by before insert on public.documents for each row execute function private.set_created_by();
create trigger document_versions_created_by before insert on public.document_versions for each row execute function private.set_created_by();
create trigger tax_rates_created_by before insert on public.tax_rates for each row execute function private.set_created_by();
create trigger import_runs_created_by before insert on public.import_runs for each row execute function private.set_created_by();

-- Document versions are permanent: never changed or deleted.
create or replace function private.block_version_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Document versions are permanent. Make a new version instead.' using errcode = '42501';
end;
$$;
create trigger document_versions_permanent before update or delete on public.document_versions
  for each row execute function private.block_version_change();

-- A new version must be the next number, and it updates the document.
create or replace function private.next_version()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_current int;
begin
  select current_version into v_current from public.documents where id = new.document_id for update;
  if new.version <> v_current + 1 then
    raise exception 'Version must be % (got %).', v_current + 1, new.version using errcode = '23514';
  end if;
  update public.documents
     set current_version = new.version,
         status = case when new.regenerated then 'regenerated' when new.mode = 'final' then 'final' else 'draft' end
   where id = new.document_id;
  return new;
end;
$$;
create trigger document_versions_next before insert on public.document_versions
  for each row execute function private.next_version();

-- Tax rates: only an owner approves or retires; approved rates cannot be edited.
create or replace function private.guard_tax_rate()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Tax rates are kept as a record. Retire a rate instead of deleting it.' using errcode = '42501';
  end if;
  if old.status = 'approved' and (new.rate_percent, new.province, new.tax, new.effective_from, new.source_url, new.checked_on)
     is distinct from (old.rate_percent, old.province, old.tax, old.effective_from, old.source_url, old.checked_on) then
    raise exception 'An approved rate cannot be changed. Add a new rate and retire this one.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not private.is_owner() then
    raise exception 'Only an owner can approve or retire a tax rate.' using errcode = '42501';
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;
  return new;
end;
$$;
create trigger tax_rates_guard before update or delete on public.tax_rates
  for each row execute function private.guard_tax_rate();

create or replace function private.new_rate_pending()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'pending' then
    raise exception 'New rates start as pending. An owner approves them.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger tax_rates_new_pending before insert on public.tax_rates
  for each row execute function private.new_rate_pending();

-- The approved rate for a province on a date (null when none: no quote is made).
create or replace function public.approved_tax_rate(p_province text, p_on date default null)
returns table (tax text, rate_percent numeric, effective_from date, source_url text)
language sql stable security definer set search_path = '' as $$
  select t.tax, t.rate_percent, t.effective_from, t.source_url
  from public.tax_rates t
  where private.is_active_staff()
    and t.province = p_province and t.status = 'approved'
    and t.effective_from <= coalesce(p_on, private.today())
  order by t.effective_from desc
  limit 1
$$;
revoke all on function public.approved_tax_rate(text, date) from public, anon;
grant execute on function public.approved_tax_rate(text, date) to authenticated;

-- Activity log for every new table.
create trigger clients_log after insert or update or delete on public.clients for each row execute function private.log_change();
create trigger client_links_log after insert or update or delete on public.client_links for each row execute function private.log_change();
create trigger engagements_log after insert or update or delete on public.engagements for each row execute function private.log_change();
create trigger proposals_log after insert or update or delete on public.proposals for each row execute function private.log_change();
create trigger offers_log after insert or update or delete on public.offers for each row execute function private.log_change();
create trigger documents_log after insert or update or delete on public.documents for each row execute function private.log_change();
create trigger document_versions_log after insert on public.document_versions for each row execute function private.log_change();
create trigger tax_rates_log after insert or update or delete on public.tax_rates for each row execute function private.log_change();
create trigger import_runs_log after insert on public.import_runs for each row execute function private.log_change();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.clients enable row level security;
alter table public.client_links enable row level security;
alter table public.engagements enable row level security;
alter table public.proposals enable row level security;
alter table public.offers enable row level security;
alter table public.documents enable row level security;
alter table public.document_versions enable row level security;
alter table public.tax_rates enable row level security;
alter table public.import_runs enable row level security;

create policy "Client viewers read clients" on public.clients for select to authenticated using ((select private.can_view('clients')));
create policy "Client editors add clients" on public.clients for insert to authenticated with check ((select private.can_edit('clients')));
create policy "Client editors change clients" on public.clients for update to authenticated using ((select private.can_edit('clients'))) with check ((select private.can_edit('clients')));
create policy "Client viewers read links" on public.client_links for select to authenticated using ((select private.can_view('clients')));
create policy "Client editors add links" on public.client_links for insert to authenticated with check ((select private.can_edit('clients')));
create policy "Client editors remove links" on public.client_links for delete to authenticated using ((select private.can_edit('clients')));

create policy "Document viewers read engagements" on public.engagements for select to authenticated using ((select private.can_view('documents')));
create policy "Document editors add engagements" on public.engagements for insert to authenticated with check ((select private.can_edit('documents')));
create policy "Document editors change engagements" on public.engagements for update to authenticated using ((select private.can_edit('documents'))) with check ((select private.can_edit('documents')));
create policy "Document viewers read proposals" on public.proposals for select to authenticated using ((select private.can_view('documents')));
create policy "Document editors add proposals" on public.proposals for insert to authenticated with check ((select private.can_edit('documents')));
create policy "Document editors change proposals" on public.proposals for update to authenticated using ((select private.can_edit('documents'))) with check ((select private.can_edit('documents')));

-- Floors are owner/price-book information (Studio: "Hashim only").
create policy "Price book viewers read offers" on public.offers for select to authenticated using ((select private.can_view('price_book')));
create policy "Price book editors add offers" on public.offers for insert to authenticated with check ((select private.can_edit('price_book')));
create policy "Price book editors change offers" on public.offers for update to authenticated using ((select private.can_edit('price_book'))) with check ((select private.can_edit('price_book')));

create policy "Vault viewers read documents" on public.documents for select to authenticated using ((select private.can_view('vault')) or (select private.can_view('documents')));
create policy "Document editors add documents" on public.documents for insert to authenticated with check ((select private.can_edit('documents')));
create policy "Document editors change documents" on public.documents for update to authenticated using ((select private.can_edit('documents'))) with check ((select private.can_edit('documents')));
create policy "Vault viewers read versions" on public.document_versions for select to authenticated using ((select private.can_view('vault')) or (select private.can_view('documents')));
create policy "Document editors add versions" on public.document_versions for insert to authenticated with check ((select private.can_edit('documents')));

create policy "Tax viewers read rates" on public.tax_rates for select to authenticated using ((select private.can_view('tax_rates')));
create policy "Tax editors add rates" on public.tax_rates for insert to authenticated with check ((select private.can_edit('tax_rates')) and checked_by = (select auth.uid()));
create policy "Tax editors change rates" on public.tax_rates for update to authenticated using ((select private.can_edit('tax_rates'))) with check ((select private.can_edit('tax_rates')));

create policy "Owners read import runs" on public.import_runs for select to authenticated using ((select private.is_owner()));
create policy "Owners add import runs" on public.import_runs for insert to authenticated with check ((select private.is_owner()));

grant select, insert, update on public.clients, public.engagements, public.proposals, public.offers, public.documents, public.tax_rates to authenticated;
grant select, insert, delete on public.client_links to authenticated;
grant select, insert on public.document_versions, public.import_runs to authenticated;
grant update (category, income_account, price_type, approval_status, decision_needed, replaces_qbo, replaces_taxdome, studio_source)
  on public.catalogue_items to authenticated;

-- ---------------------------------------------------------------------------
-- Private file storage (Supabase Storage, Canada)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('brand-private', 'brand-private', false) on conflict (id) do nothing;

create policy "Vault viewers read document files" on storage.objects for select to authenticated
  using (bucket_id = 'documents' and ((select private.can_view('vault')) or (select private.can_view('documents'))));
create policy "Document editors upload document files" on storage.objects for insert to authenticated
  with check (bucket_id = 'documents' and (select private.can_edit('documents')));
-- The signature goes only on Final documents, which only an owner issues.
create policy "Owners read the signature" on storage.objects for select to authenticated
  using (bucket_id = 'brand-private' and (select private.is_owner()));
create policy "Owners upload the signature" on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-private' and (select private.is_owner()));
create policy "Owners replace the signature" on storage.objects for update to authenticated
  using (bucket_id = 'brand-private' and (select private.is_owner())) with check (bucket_id = 'brand-private' and (select private.is_owner()));
