-- Round 20 (Hashim, Nov 15, 2026): the quick method has two remittance rates, Services and Goods for
-- resale (CRA RC4058). Sales tax rates > Quick method rates shows both per province. The rates come from
-- CRA's page and wait as pending until an owner approves them, as "Rates we charge" works (tax_rates).
-- Step 1 asks which rate applies to the client (quick_method_type: services or goods; services when
-- missing). The return uses the client's rate; a missing or unapproved rate is named, never guessed.
-- Safe to run twice.

-- ---------- The rates: one row per province and start date, both rates on the row, approved by an owner.
-- Province: the province of the client's permanent establishment, where its supplies are made (the key
-- the round 13 table used). effective_from: CRA's "reporting periods beginning on or after" date; a
-- return period uses the latest approved row that starts on or before the period's first day.
-- legacy: a rate an owner typed in Settings before round 20 (moved here as approved, no source recorded).
create table if not exists public.cb_quick_rates (
  id              uuid primary key default gen_random_uuid(),
  province        text not null check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  services_rate   numeric(8, 6) check (services_rate between 0 and 1),
  goods_rate      numeric(8, 6) check (goods_rate between 0 and 1),
  effective_from  date,
  source_url      text check (source_url ~ '^https://www\.canada\.ca/'),
  checked_on      date,
  checked_by      uuid references public.staff (id),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'retired')),
  approved_by     uuid references public.staff (id),
  approved_at     timestamptz,
  legacy          boolean not null default false,
  notes           text not null default '' check (length(notes) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint cb_quick_rates_one_rate check (services_rate is not null or goods_rate is not null),
  constraint cb_quick_rates_sourced check (legacy or (effective_from is not null and source_url is not null and checked_on is not null and checked_by is not null))
);
create unique index if not exists cb_quick_rates_one_live on public.cb_quick_rates (province, coalesce(effective_from, '0001-01-01'::date)) where status <> 'retired';
alter table public.cb_quick_rates enable row level security;
alter table public.cb_quick_rates force row level security;
drop policy if exists "Closebook viewers read quick rates" on public.cb_quick_rates;
create policy "Closebook viewers read quick rates" on public.cb_quick_rates for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_quick_rates to authenticated;

-- New rows start as pending; only an owner approves or retires; an approved row is never changed; rows are
-- kept as a record (retire, never delete). As tax_rates (private.guard_tax_rate).
create or replace function private.cb_quick_rate_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'pending' then raise exception 'New rates start as pending. An owner approves them.' using errcode = '42501'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Quick method rates are kept as a record. Retire a rate instead of deleting it.' using errcode = '42501';
  end if;
  if old.status <> 'pending' and (new.province, new.services_rate, new.goods_rate, new.effective_from, new.source_url, new.checked_on, new.checked_by)
     is distinct from (old.province, old.services_rate, old.goods_rate, old.effective_from, old.source_url, old.checked_on, old.checked_by) then
    raise exception 'An approved rate cannot be changed. Add a new rate and retire this one.' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if not private.is_owner() then raise exception 'Only an owner can approve or retire a quick method rate.' using errcode = '42501'; end if;
    if old.status = 'retired' or (old.status = 'approved' and new.status = 'pending') then
      raise exception 'A retired rate stays retired; an approved rate can only be retired.' using errcode = '42501';
    end if;
  end if;
  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_by := (select auth.uid());
    new.approved_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists cb_quick_rates_guard on public.cb_quick_rates;
create trigger cb_quick_rates_guard before insert or update or delete on public.cb_quick_rates for each row execute function private.cb_quick_rate_guard();

-- The round 13 rates (services only, typed by an owner) move across once, as approved: an owner set them.
-- The guard is off for this one insert (a new row otherwise starts as pending), so a second run works too.
alter table public.cb_quick_rates disable trigger cb_quick_rates_guard;
insert into public.cb_quick_rates (province, services_rate, status, approved_by, approved_at, checked_by, checked_on, legacy, notes, created_at)
select q.province, q.rate, 'approved', q.updated_by, q.updated_at, q.updated_by, q.updated_at::date, true,
       'Typed by an owner in Settings before round 20. Source not recorded. Goods for resale not set.', q.updated_at
  from public.cb_gst_quick_rates q
 where q.province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')
   and not exists (select 1 from public.cb_quick_rates r where r.legacy and r.province = q.province);
alter table public.cb_quick_rates enable trigger cb_quick_rates_guard;
comment on table public.cb_gst_quick_rates is 'Round 13 quick method rates (services only). Replaced by cb_quick_rates in round 20; no longer read by the app.';

-- Owner only: add rates as pending, from the CRA table in the app (Load from CRA) or typed from CRA's page.
-- p_rows: [{"province":"ON","services":0.088,"goods":0.044}], rates as fractions; a blank rate is not set.
-- A row the same as a live one (same province, start date and rates) is skipped, so loading twice adds
-- nothing. A different live row for the same province and start date is refused: retire it first.
-- Returns how many rows were added.
create or replace function public.cb_add_quick_rates(p_rows jsonb, p_from date, p_source text, p_checked_on date, p_notes text default '')
returns int language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_s numeric; v_g numeric; v_n int := 0; o public.cb_quick_rates;
begin
  perform private.require(private.is_owner(), 'Only an owner adds quick method rates.');
  perform private.require(jsonb_typeof(coalesce(p_rows, '[]')) = 'array' and jsonb_array_length(coalesce(p_rows, '[]')) > 0, 'No rates to add.');
  perform private.require(p_from is not null, 'Enter the date the rates apply from (reporting periods beginning on or after).');
  perform private.require(coalesce(p_source, '') ~ '^https://www\.canada\.ca/', 'The source must be a canada.ca page.');
  perform private.require(p_checked_on is not null and p_checked_on <= private.today(), 'Enter the date you read the rates on the CRA page (today or before).');
  for x in select * from jsonb_array_elements(p_rows) loop
    perform private.require(coalesce(x ->> 'province', '') in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'), 'Each rate needs its province (two letters, for example ON).');
    v_s := nullif(x ->> 'services', '')::numeric;
    v_g := nullif(x ->> 'goods', '')::numeric;
    perform private.require(v_s is not null or v_g is not null, format('%s: enter the services rate, the goods for resale rate, or both.', x ->> 'province'));
    perform private.require((v_s is null or v_s between 0 and 1) and (v_g is null or v_g between 0 and 1), 'A quick method rate is from 0 to 100%.');
    select * into o from public.cb_quick_rates r where r.province = x ->> 'province' and r.effective_from = p_from and r.status <> 'retired';
    if o.id is not null then
      perform private.require(o.services_rate is not distinct from v_s and o.goods_rate is not distinct from v_g,
        format('%s already has %s quick method rates from %s. Retire them first.', x ->> 'province', o.status, to_char(p_from, 'Mon FMDD, YYYY')));
      continue;
    end if;
    insert into public.cb_quick_rates (province, services_rate, goods_rate, effective_from, source_url, checked_on, checked_by, notes)
    values (x ->> 'province', v_s, v_g, p_from, p_source, p_checked_on, (select auth.uid()), left(coalesce(p_notes, ''), 300));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Owner only: approve or retire one row.
create or replace function public.cb_set_quick_rate_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.cb_quick_rates;
begin
  perform private.require(private.is_owner(), 'Only an owner can approve or retire a quick method rate.');
  perform private.require(p_status in ('approved', 'retired'), 'Unknown action.');
  select * into o from public.cb_quick_rates where id = p_id for update;
  perform private.require(o.id is not null, 'Rate not found.');
  perform private.require(not (p_status = 'approved' and o.status <> 'pending'), 'Only a pending rate can be approved.');
  perform private.require(not (p_status = 'retired' and o.status = 'retired'), 'This rate is already retired.');
  update public.cb_quick_rates set status = p_status where id = p_id;
end;
$$;

-- Owner only: approve every pending row in one step. Returns how many.
create or replace function public.cb_approve_quick_rates() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.is_owner(), 'Only an owner can approve quick method rates.');
  update public.cb_quick_rates set status = 'approved' where status = 'pending';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cb_add_quick_rates(jsonb, date, text, date, text), public.cb_set_quick_rate_status(uuid, text), public.cb_approve_quick_rates() from public, anon;
grant execute on function public.cb_add_quick_rates(jsonb, date, text, date, text), public.cb_set_quick_rate_status(uuid, text), public.cb_approve_quick_rates() to authenticated;

-- The approved rate a return period uses: the client's province and type (services when not answered),
-- the latest approved row starting on or before the period's first day. Null when there is none (the
-- return then says the rate is missing). The app works the same out in gst-return.ts (quickRateFor).
create or replace function public.cb_quick_rate(p_province text, p_type text, p_period_start date) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when coalesce(p_type, 'services') = 'goods' then r.goods_rate else r.services_rate end
    from public.cb_quick_rates r
   where private.can_view('closebook') and r.province = p_province and r.status = 'approved'
     and coalesce(r.effective_from, '0001-01-01'::date) <= p_period_start
     and (case when coalesce(p_type, 'services') = 'goods' then r.goods_rate else r.services_rate end) is not null
   order by coalesce(r.effective_from, '0001-01-01'::date) desc
   limit 1
$$;
revoke all on function public.cb_quick_rate(text, text, date) from public, anon;
grant execute on function public.cb_quick_rate(text, text, date) to authenticated;

-- ---------- Step 1: which quick method rate applies (round 20). The round 13 function with one more key;
-- every other key and rule as before. Changing the type, like the quick method answer, sends the taxed
-- work back to the reviewer.
create or replace function public.cb_save_setup(p_file uuid, p_setup jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_key text;
  v_new jsonb;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null, 'File not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(jsonb_typeof(p_setup) = 'object', 'Answers are missing.');
  for v_key in select jsonb_object_keys(p_setup) loop
    perform private.require(v_key in ('realtor', 'owner_paid', 'dividends', 'payroll', 'holdco', 'gst_registered', 'gst_frequency', 'quick_method', 'gst_rt', 'gst_year_same', 'quick_method_type'), format('Unknown question %s.', v_key));
  end loop;
  perform private.require(coalesce(p_setup ->> 'gst_frequency', 'annual') in ('annual', 'quarterly', 'monthly'), 'Choose annual, quarterly or monthly.');
  -- Round 13: the GST/HST account (RT0001 by default) and whether the GST/HST year is the fiscal year.
  perform private.require(coalesce(p_setup ->> 'gst_rt', 'RT0001') ~ '^RT[0-9]{4}$', 'The GST/HST account is RT and four digits, for example RT0001.');
  perform private.require(coalesce(jsonb_typeof(p_setup -> 'gst_year_same'), 'boolean') = 'boolean', 'Answer Yes or No.');
  -- Round 20: the quick method rate that applies, services (most real estate businesses) or goods for resale.
  perform private.require(coalesce(p_setup ->> 'quick_method_type', 'services') in ('services', 'goods'), 'Choose Services or Goods for resale.');
  v_new := coalesce(v_file.setup, '{}'::jsonb) || p_setup;
  update public.cb_files set setup = v_new, updated_at = now() where id = p_file;
  -- Before November 17 an unanswered file was coded as a registrant on the regular method; compare with that.
  if coalesce((v_file.setup ->> 'gst_registered')::boolean, true) is distinct from coalesce((v_new ->> 'gst_registered')::boolean, true)
     or coalesce((v_file.setup ->> 'quick_method')::boolean, false) is distinct from coalesce((v_new ->> 'quick_method')::boolean, false)
     -- Round 20: the quick method rate changed on a quick method file (services when not answered).
     or (coalesce((v_new ->> 'quick_method')::boolean, false)
         and coalesce(v_file.setup ->> 'quick_method_type', 'services') is distinct from coalesce(v_new ->> 'quick_method_type', 'services')) then
    update public.cb_bank_lines l set status = 'reviewer', reviewer_reason = 'The GST/HST answers changed: the sales tax was worked out again. Check it.'
     where l.file_id = p_file and l.status = 'done'
       and exists (select 1 from public.cb_sales_tax_parts p where p.code = l.tax_code and p.rate > 0);
    update public.cb_entries e set needs_review = true, reviewed_at = null, reviewed_by = null
     where e.file_id = p_file and exists (select 1 from public.cb_entry_lines x where x.entry_id = e.id and x.tax_code is not null);
  end if;
end;
$$;
