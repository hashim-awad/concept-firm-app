-- Closebook build step 1, part 2a (Phase 3 batch, sections 1, 2 and 5.1): year-end files, their core
-- documents, accounts and trial balance imports.
-- - One file per client per year-end. Every file starts at All files, New file.
-- - Core documents are created with the file (section 5.1). Setup answers add documents later (step 3);
--   no answer removes a core document.
-- - Accounts hold last year's and this year's balances (debits positive, credits negative). An import
--   must balance, and replaces the previous import of the same column.
-- Anyone with Closebook reads files; Closebook Edit creates files and imports.

create table public.cb_files (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references public.clients (id),
  year_start         date not null,
  year_end           date not null,
  year_change_reason text not null default '',
  file_type          text not null check (file_type in ('monthly', 'full')),
  books              text not null check (books in ('concept_qbo', 'client_software', 'bookkeeper', 'statements', 'paper')),
  preparer_id        uuid not null references public.staff (id),
  reviewer_id        uuid not null references public.staff (id),
  phase              text not null default 'planning' check (phase in ('planning', 'fieldwork', 'conclusion', 'locked')),
  created_by         uuid references public.staff (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, year_end),
  check (year_end > year_start and year_end - year_start <= 371),
  -- Monthly files are Concept's own QuickBooks clients (batch section 3).
  check (file_type = 'full' or books = 'concept_qbo')
);

create table public.cb_documents (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  code        text not null,
  phase       text not null check (phase in ('planning', 'fieldwork', 'conclusion')),
  title       text not null,
  detail      text not null default '',
  sort_order  int not null,
  core        boolean not null default true,
  status      text not null default 'open' check (status in ('open', 'prepared', 'signed')),
  prepared_by uuid references public.staff (id),
  prepared_at timestamptz,
  reviewed_by uuid references public.staff (id),
  reviewed_at timestamptz,
  unique (file_id, code)
);

create table public.cb_imports (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  target       text not null check (target in ('this_year', 'last_year')),
  source       text not null check (source in ('quickbooks', 'client_software', 'bookkeeper', 'prior_accountant')),
  file_name    text not null default '',
  rows         int not null,
  debit_total  numeric(14, 2) not null,
  credit_total numeric(14, 2) not null,
  imported_by  uuid references public.staff (id),
  imported_at  timestamptz not null default now()
);

create table public.cb_accounts (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  account_key text not null,       -- the account's number, or its name in lower case when it has none
  number      text not null default '',
  name        text not null,
  last_year   numeric(14, 2) not null default 0,
  this_year   numeric(14, 2) not null default 0,   -- before Closebook entries
  unique (file_id, account_key)
);

-- The core documents (batch 5.1), in plain action names. Monthly files have no entries document and
-- confirm, rather than reconcile, bank and cards (section 3).
create or replace function private.cb_core_documents(p_file uuid, p_type text)
returns void language sql security definer set search_path = '' as $$
  insert into public.cb_documents (file_id, code, phase, title, detail, sort_order)
  select p_file, d.code, d.phase, d.title, d.detail, d.sort_order from (values
    ('P1', 'planning', 'Engagement setup', 'File type, year-end, how the books are kept, and the setup questions', 10),
    ('P2', 'planning', 'Acceptance or continuance', 'Independence, intended use and basis of accounting (CSRS 4200)', 20),
    ('P3', 'planning', 'Engagement letter', 'Signed or waiting', 30),
    ('P4', 'planning', 'Client snapshot', 'From the client record, the TaxDome tags and last year''s file', 40),
    ('P5', 'planning', 'Records received and CRA check', 'What came in, and the CRA account check', 50),
    ('F1', 'fieldwork', case when p_type = 'monthly' then 'Import the trial balance' else 'Build the trial balance' end, '', 110),
    ('F2', 'fieldwork', 'Match accounts to GIFI', '', 120),
    ('F3', 'fieldwork', case when p_type = 'monthly' then 'Confirm bank and cards' else 'Reconcile bank and cards' end, '', 130),
    ('F4', 'fieldwork', 'Adjusting entries', '', 140),
    ('F5', 'fieldwork', 'Compare to last year', 'Lead sheets, flagged changes, and what changed this year', 150),
    ('F7', 'fieldwork', 'Revenue check', '', 160),
    ('F6', 'fieldwork', 'Schedules', 'Shareholder loans, capital assets, GST/HST, income tax, receivables and payables, equity', 170),
    ('C1', 'conclusion', 'Financial statements and compilation report', '', 210),
    ('C2', 'conclusion', 'Management acknowledgement', 'Signed by the client through Studio signing', 220),
    ('C3', 'conclusion', 'Tax and GIFI tie-out', '', 230),
    ('C4', 'conclusion', 'Completion checklist and sign-off', '', 240),
    ('C5', 'conclusion', 'Filing and delivery', '', 250),
    ('C6', 'conclusion', 'Lock and roll forward', '', 260)
  ) as d(code, phase, title, detail, sort_order)
  where not (p_type = 'monthly' and d.code = 'F4');
$$;

-- New file (batch section 1). The year runs from the day after last year's end unless a reason is given
-- (a short first year or a changed year-end).
create or replace function public.cb_create_file(p_client uuid, p_year_end date, p_year_start date, p_reason text, p_type text, p_books text, p_preparer uuid, p_reviewer uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_client public.clients;
  v_id uuid;
  v_normal date := (p_year_end - interval '1 year' + interval '1 day')::date;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to start a file.');
  select * into v_client from public.clients where id = p_client;
  perform private.require(v_client.id is not null and v_client.kind = 'corporation', 'Choose a company from the client list.');
  perform private.require(p_year_start is not null and p_year_end is not null and p_year_end > p_year_start and p_year_end - p_year_start <= 371,
    'The year must end after it starts and be no longer than 53 weeks.');
  perform private.require(p_year_start = v_normal or length(btrim(coalesce(p_reason, ''))) >= 3,
    'A year that is not a full 12 months needs a reason (for example a short first year or a changed year-end).');
  perform private.require(exists (select 1 from public.staff where id = p_preparer and is_active)
    and exists (select 1 from public.staff where id = p_reviewer and is_active), 'Choose an active preparer and reviewer.');
  perform private.require(not exists (select 1 from public.cb_files where client_id = p_client and year_end = p_year_end),
    'This client already has a file for that year-end.');
  insert into public.cb_files (client_id, year_start, year_end, year_change_reason, file_type, books, preparer_id, reviewer_id, created_by)
  values (p_client, p_year_start, p_year_end, case when p_year_start = v_normal then '' else btrim(p_reason) end,
          p_type, p_books, p_preparer, p_reviewer, (select auth.uid()))
  returning id into v_id;
  perform private.cb_core_documents(v_id, p_type);
  return v_id;
end;
$$;

-- Import a trial balance into this year's or last year's column (batch 5.1, F1). Rows:
-- [{"number": "", "name": "", "amount": 123.45}], debits positive. The trial balance must balance.
-- A new import replaces the previous one for that column; accounts with nothing left are removed.
create or replace function public.cb_import_tb(p_file uuid, p_target text, p_source text, p_file_name text, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_key text;
  v_amt numeric;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to import.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(p_target in ('this_year', 'last_year'), 'Unknown column.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 1 and 5000, 'The file has no accounts, or too many.');
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_amt := round((v_row ->> 'amount')::numeric, 2);
    if v_amt > 0 then v_dr := v_dr + v_amt; else v_cr := v_cr - v_amt; end if;
  end loop;
  perform private.require(v_dr = v_cr, format('The trial balance does not balance: debits %s, credits %s, difference %s.', v_dr, v_cr, v_dr - v_cr));

  if p_target = 'this_year' then update public.cb_accounts set this_year = 0 where file_id = p_file;
  else update public.cb_accounts set last_year = 0 where file_id = p_file; end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    perform private.require(length(btrim(coalesce(v_row ->> 'name', ''))) between 1 and 200, 'Every account needs a name.');
    v_key := coalesce(nullif(btrim(v_row ->> 'number'), ''), lower(regexp_replace(btrim(v_row ->> 'name'), '\s+', ' ', 'g')));
    v_amt := round((v_row ->> 'amount')::numeric, 2);
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year)
    values (p_file, v_key, btrim(coalesce(v_row ->> 'number', '')), btrim(v_row ->> 'name'),
            case when p_target = 'this_year' then v_amt else 0 end, case when p_target = 'last_year' then v_amt else 0 end)
    on conflict (file_id, account_key) do update
      set name = excluded.name,
          this_year = case when p_target = 'this_year' then public.cb_accounts.this_year + excluded.this_year else public.cb_accounts.this_year end,
          last_year = case when p_target = 'last_year' then public.cb_accounts.last_year + excluded.last_year else public.cb_accounts.last_year end;
    v_n := v_n + 1;
  end loop;
  delete from public.cb_accounts where file_id = p_file and this_year = 0 and last_year = 0;
  insert into public.cb_imports (file_id, target, source, file_name, rows, debit_total, credit_total, imported_by)
  values (p_file, p_target, p_source, left(coalesce(p_file_name, ''), 200), v_n, v_dr, v_cr, (select auth.uid()));
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

alter table public.cb_files enable row level security;
alter table public.cb_files force row level security;
alter table public.cb_documents enable row level security;
alter table public.cb_documents force row level security;
alter table public.cb_imports enable row level security;
alter table public.cb_imports force row level security;
alter table public.cb_accounts enable row level security;
alter table public.cb_accounts force row level security;
create policy "Closebook viewers read files" on public.cb_files for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read documents" on public.cb_documents for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read imports" on public.cb_imports for select to authenticated using ((select private.can_view('closebook')));
create policy "Closebook viewers read accounts" on public.cb_accounts for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_files, public.cb_documents, public.cb_imports, public.cb_accounts to authenticated;

revoke all on function public.cb_create_file(uuid, date, date, text, text, text, uuid, uuid), public.cb_import_tb(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.cb_create_file(uuid, date, date, text, text, text, uuid, uuid), public.cb_import_tb(uuid, text, text, text, jsonb) to authenticated;
revoke all on function private.cb_core_documents(uuid, text) from public, anon, authenticated;
