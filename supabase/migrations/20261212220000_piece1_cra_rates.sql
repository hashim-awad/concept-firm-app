-- Piece 1 of the step 5 restructure (Hashim, Nov 18, 2026; benchmark CaseWare Cloud): the CRA rates page.
-- Settings › Closebook rules › CRA rates, owners only. Two tables the firm fills in by hand:
--   cb_cra_km_rates     the CRA's prescribed per-km allowance rates by calendar year (section 7306 of the
--                       Income Tax Regulations): first 5,000 km and after, provinces and territories.
--   cb_cra_itc_factors  the ITC factor on allowances and reimbursements, one row per province or territory,
--                       kept as a fraction (13/113).
-- Nothing uses these rates yet (the Vehicle allowance schedule reads them in piece 3). No rates are loaded:
-- an owner types them in. Every add or change goes to the activity log (who, when, old and new values).
-- No table or column is dropped. Safe to run twice.

create table if not exists public.cb_cra_km_rates (
  year            int primary key check (year between 2000 and 2100),
  first_prov      numeric(6, 2) not null check (first_prov > 0 and first_prov < 10),
  after_prov      numeric(6, 2) not null check (after_prov > 0 and after_prov < 10),
  first_terr      numeric(6, 2) not null check (first_terr > 0 and first_terr < 10),
  after_terr      numeric(6, 2) not null check (after_terr > 0 and after_terr < 10),
  entered_by      uuid references public.staff (id),
  entered_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id),
  updated_at      timestamptz
);

create table if not exists public.cb_cra_itc_factors (
  province        text primary key check (province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT')),
  numerator       int not null check (numerator > 0),
  denominator     int not null check (denominator > 0 and denominator > numerator),
  entered_by      uuid references public.staff (id),
  entered_at      timestamptz not null default now(),
  updated_by      uuid references public.staff (id),
  updated_at      timestamptz
);

alter table public.cb_cra_km_rates enable row level security;
alter table public.cb_cra_km_rates force row level security;
alter table public.cb_cra_itc_factors enable row level security;
alter table public.cb_cra_itc_factors force row level security;
-- Read by anyone who can view Closebook (the schedules will read them); written only through the owner functions below.
drop policy if exists "Closebook viewers read CRA km rates" on public.cb_cra_km_rates;
create policy "Closebook viewers read CRA km rates" on public.cb_cra_km_rates for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Closebook viewers read CRA ITC factors" on public.cb_cra_itc_factors;
create policy "Closebook viewers read CRA ITC factors" on public.cb_cra_itc_factors for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_cra_km_rates, public.cb_cra_itc_factors from anon, authenticated;
grant select on public.cb_cra_km_rates, public.cb_cra_itc_factors to authenticated;

-- Every add or change shows in Settings › Activity log, with the old and new row.
drop trigger if exists cb_cra_km_rates_log on public.cb_cra_km_rates;
create trigger cb_cra_km_rates_log after insert or update or delete on public.cb_cra_km_rates
  for each row execute function private.log_change();
drop trigger if exists cb_cra_itc_factors_log on public.cb_cra_itc_factors;
create trigger cb_cra_itc_factors_log after insert or update or delete on public.cb_cra_itc_factors
  for each row execute function private.log_change();

-- Add a year (p_new = true) or change one already in the table. Rates are dollars per km, two decimals.
create or replace function public.cb_save_km_rates(p_year int, p_first_prov numeric, p_after_prov numeric, p_first_terr numeric, p_after_terr numeric, p_new boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.cb_cra_km_rates;
begin
  perform private.require(private.is_owner(), 'Only an owner can change the CRA rates.');
  perform private.require(p_year is not null and p_year between 2000 and 2100, 'Type the year as four digits, for example 2026.');
  perform private.require(p_first_prov is not null and p_after_prov is not null and p_first_terr is not null and p_after_terr is not null,
    'Fill in all four rates.');
  perform private.require(p_first_prov > 0 and p_after_prov > 0 and p_first_terr > 0 and p_after_terr > 0
    and p_first_prov < 10 and p_after_prov < 10 and p_first_terr < 10 and p_after_terr < 10,
    'Each rate is dollars per km, for example 0.73.');
  perform private.require(round(p_first_prov, 2) = p_first_prov and round(p_after_prov, 2) = p_after_prov
    and round(p_first_terr, 2) = p_first_terr and round(p_after_terr, 2) = p_after_terr, 'Rates have at most two decimals, for example 0.73.');
  select * into r from public.cb_cra_km_rates where year = p_year;
  if p_new then
    perform private.require(r.year is null, format('%s is already in the table. Change its rates instead.', p_year));
    insert into public.cb_cra_km_rates (year, first_prov, after_prov, first_terr, after_terr, entered_by)
    values (p_year, p_first_prov, p_after_prov, p_first_terr, p_after_terr, (select auth.uid()));
  else
    perform private.require(r.year is not null, format('%s is not in the table. Add it first.', p_year));
    perform private.require(r.first_prov <> p_first_prov or r.after_prov <> p_after_prov or r.first_terr <> p_first_terr or r.after_terr <> p_after_terr,
      'Nothing changed.');
    update public.cb_cra_km_rates set first_prov = p_first_prov, after_prov = p_after_prov, first_terr = p_first_terr, after_terr = p_after_terr,
      updated_by = (select auth.uid()), updated_at = now() where year = p_year;
  end if;
end;
$$;
revoke all on function public.cb_save_km_rates(int, numeric, numeric, numeric, numeric, boolean) from public, anon;
grant execute on function public.cb_save_km_rates(int, numeric, numeric, numeric, numeric, boolean) to authenticated;

-- The ITC factor for one province or territory, typed as a fraction of two whole numbers ("13/113").
create or replace function public.cb_save_itc_factor(p_province text, p_factor text)
returns void language plpgsql security definer set search_path = '' as $$
declare m text[]; v_num int; v_den int; r public.cb_cra_itc_factors;
begin
  perform private.require(private.is_owner(), 'Only an owner can change the CRA rates.');
  perform private.require(p_province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT'), 'Pick a province or territory.');
  m := regexp_match(coalesce(p_factor, ''), '^\s*(\d{1,6})\s*/\s*(\d{1,6})\s*$');
  perform private.require(m is not null, 'Type the factor as two whole numbers with a slash, for example 13/113.');
  v_num := m[1]::int; v_den := m[2]::int;
  perform private.require(v_num > 0 and v_den > v_num, 'The top number must be more than 0 and smaller than the bottom number, for example 13/113.');
  select * into r from public.cb_cra_itc_factors where province = p_province;
  if r.province is null then
    insert into public.cb_cra_itc_factors (province, numerator, denominator, entered_by) values (p_province, v_num, v_den, (select auth.uid()));
  else
    perform private.require(r.numerator <> v_num or r.denominator <> v_den, 'Nothing changed.');
    update public.cb_cra_itc_factors set numerator = v_num, denominator = v_den, updated_by = (select auth.uid()), updated_at = now() where province = p_province;
  end if;
end;
$$;
revoke all on function public.cb_save_itc_factor(text, text) from public, anon;
grant execute on function public.cb_save_itc_factor(text, text) to authenticated;
