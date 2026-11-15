-- Round 20 fix before merge (Hashim, Nov 15, 2026): the Quick method rates page shows only the provinces
-- the firm uses, as QuickBooks Online shows only the tax agencies you use. Benchmark: QuickBooks Online.
-- - Provinces in use: Ontario, Alberta, British Columbia to start; "Add a province" adds another
--   (cb_quick_provinces). A province with no approved rate shows "Not set"; the return still flags it.
-- - CRA's figures are pre-filled as drafts waiting for an owner's approval. Source: CRA guide RC4058,
--   Quick Method of Accounting for GST/HST, figures checked by Hashim on canada.ca, Nov 2026:
--   Ontario 8.8% services, 4.4% goods for resale; Alberta 3.6% and 1.8%; British Columbia 3.6% and 1.8%;
--   the credit 1% on the first $30,000 of eligible sales each fiscal year. Nothing applies until approved.
-- - The Ontario rate typed before round 20 with no source is retired; the drafts replace it.
-- - The credit gets the same draft and approval as the rates. The due-dates form no longer changes it.
-- - A draft can wait beside an approved rate; approving it retires the approved rate it replaces.
-- Safe to run twice.

-- ---------- Rates: a source name, an optional start date (blank = every period), drafts beside approved rates.
alter table public.cb_quick_rates add column if not exists source_name text not null default '' check (length(source_name) <= 200);
alter table public.cb_quick_rates drop constraint if exists cb_quick_rates_sourced;
alter table public.cb_quick_rates add constraint cb_quick_rates_sourced check (legacy or (source_url is not null and checked_on is not null));
drop index if exists public.cb_quick_rates_one_live;
create unique index if not exists cb_quick_rates_one_approved on public.cb_quick_rates (province, coalesce(effective_from, '0001-01-01'::date)) where status = 'approved';
create unique index if not exists cb_quick_rates_one_draft on public.cb_quick_rates (province, coalesce(effective_from, '0001-01-01'::date)) where status = 'pending';

-- ---------- The provinces the firm uses (the rows the page shows).
create table if not exists public.cb_quick_provinces (
  province  text primary key check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  added_by  uuid references public.staff (id),
  added_at  timestamptz not null default now()
);
alter table public.cb_quick_provinces enable row level security;
alter table public.cb_quick_provinces force row level security;
drop policy if exists "Closebook viewers read quick provinces" on public.cb_quick_provinces;
create policy "Closebook viewers read quick provinces" on public.cb_quick_provinces for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_quick_provinces to authenticated;
insert into public.cb_quick_provinces (province) values ('ON'), ('AB'), ('BC') on conflict (province) do nothing;
-- A province that already has rates stays on the page.
insert into public.cb_quick_provinces (province)
select distinct province from public.cb_quick_rates where status <> 'retired' on conflict (province) do nothing;

create or replace function public.cb_add_quick_province(p_province text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner adds a province.');
  perform private.require(coalesce(p_province, '') in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'), 'Choose a province.');
  insert into public.cb_quick_provinces (province, added_by) values (p_province, (select auth.uid())) on conflict (province) do nothing;
end;
$$;
revoke all on function public.cb_add_quick_province(text) from public, anon;
grant execute on function public.cb_add_quick_province(text) to authenticated;

-- ---------- The rate typed before round 20 with no source: retired (the drafts below replace it).
-- The guard lets only an owner retire; this one change is made with it off.
alter table public.cb_quick_rates disable trigger cb_quick_rates_guard;
update public.cb_quick_rates set status = 'retired', updated_at = now(),
       notes = left('Retired in round 20: no source recorded. Replaced by the CRA RC4058 drafts. ' || notes, 300)
 where legacy and status = 'approved';
alter table public.cb_quick_rates enable trigger cb_quick_rates_guard;

-- ---------- CRA's figures as drafts (pending), once per province. Rates as fractions.
insert into public.cb_quick_rates (province, services_rate, goods_rate, effective_from, source_url, source_name, checked_on, notes)
select v.province, v.s, v.g, null,
       'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4058/quick-method-accounting-gst-hst.html',
       'CRA guide RC4058, Quick Method of Accounting for GST/HST', '2026-11-15',
       'Figures checked by Hashim Awad on canada.ca, Nov 2026. Pre-filled in round 20.'
  from (values ('ON', 0.088, 0.044), ('AB', 0.036, 0.018), ('BC', 0.036, 0.018)) v(province, s, g)
 -- Only for a province that has never had sourced rates, so a second run never brings back a replaced draft.
 where not exists (select 1 from public.cb_quick_rates r where r.province = v.province and not r.legacy);

-- ---------- Adding rates: the start date is optional (blank = every period); a draft can wait beside an
-- approved rate. Rows like a live one are skipped; a second, different draft for the same province and
-- date is refused (reject the first). Returns how many were added.
create or replace function public.cb_add_quick_rates(p_rows jsonb, p_from date, p_source text, p_checked_on date, p_notes text default '')
returns int language plpgsql security definer set search_path = '' as $$
declare x jsonb; v_s numeric; v_g numeric; v_n int := 0; o public.cb_quick_rates;
begin
  perform private.require(private.is_owner(), 'Only an owner adds quick method rates.');
  perform private.require(jsonb_typeof(coalesce(p_rows, '[]')) = 'array' and jsonb_array_length(coalesce(p_rows, '[]')) > 0, 'No rates to add.');
  perform private.require(coalesce(p_source, '') ~ '^https://www\.canada\.ca/', 'The source must be a canada.ca page.');
  perform private.require(p_checked_on is not null and p_checked_on <= private.today(), 'Enter the date you read the rates on the CRA page (today or before).');
  for x in select * from jsonb_array_elements(p_rows) loop
    perform private.require(coalesce(x ->> 'province', '') in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT'), 'Each rate needs its province (two letters, for example ON).');
    v_s := nullif(x ->> 'services', '')::numeric;
    v_g := nullif(x ->> 'goods', '')::numeric;
    perform private.require(v_s is not null or v_g is not null, format('%s: enter the services rate, the goods for resale rate, or both.', x ->> 'province'));
    perform private.require((v_s is null or v_s between 0 and 1) and (v_g is null or v_g between 0 and 1), 'A quick method rate is from 0 to 100%.');
    if exists (select 1 from public.cb_quick_rates r where r.province = x ->> 'province' and r.effective_from is not distinct from p_from
                 and r.status <> 'retired' and r.services_rate is not distinct from v_s and r.goods_rate is not distinct from v_g) then
      continue;
    end if;
    select * into o from public.cb_quick_rates r where r.province = x ->> 'province' and r.effective_from is not distinct from p_from and r.status = 'pending';
    perform private.require(o.id is null, format('%s already has rates waiting for approval%s. Reject them first.', x ->> 'province',
      case when p_from is null then '' else ' from ' || to_char(p_from, 'Mon FMDD, YYYY') end));
    insert into public.cb_quick_rates (province, services_rate, goods_rate, effective_from, source_url, source_name, checked_on, checked_by, notes)
    values (x ->> 'province', v_s, v_g, p_from, p_source,
            case when p_source ~ 'rc4058' then 'CRA guide RC4058, Quick Method of Accounting for GST/HST' else 'CRA page' end,
            p_checked_on, (select auth.uid()), left(coalesce(p_notes, ''), 300));
    insert into public.cb_quick_provinces (province, added_by) values (x ->> 'province', (select auth.uid())) on conflict (province) do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Approving a draft retires the approved rate it replaces (same province and start date).
create or replace function private.cb_quick_rate_approve(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare o public.cb_quick_rates;
begin
  select * into o from public.cb_quick_rates where id = p_id for update;
  update public.cb_quick_rates set status = 'retired'
   where province = o.province and effective_from is not distinct from o.effective_from and status = 'approved' and id <> o.id;
  update public.cb_quick_rates set status = 'approved' where id = o.id;
end;
$$;
revoke all on function private.cb_quick_rate_approve(uuid) from public, anon, authenticated;

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
  if p_status = 'approved' then
    perform private.cb_quick_rate_approve(p_id);
  else
    update public.cb_quick_rates set status = 'retired' where id = p_id;
  end if;
end;
$$;

-- ---------- The credit: the approved figures (quick_credit_rate, quick_credit_limit, the only ones a return
-- uses) and a draft waiting for approval, with its source.
alter table public.cb_settings add column if not exists quick_credit_draft jsonb;
alter table public.cb_settings add column if not exists quick_credit_source_url text;
alter table public.cb_settings add column if not exists quick_credit_source_name text not null default '';
alter table public.cb_settings add column if not exists quick_credit_checked_on date;
alter table public.cb_settings add column if not exists quick_credit_approved_by uuid references public.staff (id);
alter table public.cb_settings add column if not exists quick_credit_approved_at timestamptz;
-- Once: the credit typed before round 20 (no source, no approval) becomes the CRA draft; nothing applies
-- until an owner approves it.
update public.cb_settings set quick_credit_rate = null, quick_credit_limit = null,
       quick_credit_draft = jsonb_build_object('rate', 0.01, 'limit', 30000,
         'source_url', 'https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4058/quick-method-accounting-gst-hst.html',
         'source_name', 'CRA guide RC4058, Quick Method of Accounting for GST/HST', 'checked_on', '2026-11-15')
 where quick_credit_approved_at is null and quick_credit_draft is null;

create or replace function public.cb_set_quick_credit(p_rate numeric, p_limit numeric, p_source text, p_checked_on date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner changes the quick method credit.');
  perform private.require(p_rate is not null and p_rate between 0 and 1, 'The credit is a rate from 0 to 100%.');
  perform private.require(p_limit is not null and p_limit >= 0, 'The credit limit is an amount, 0 or more.');
  perform private.require(coalesce(p_source, '') ~ '^https://www\.canada\.ca/', 'The source must be a canada.ca page.');
  perform private.require(p_checked_on is not null and p_checked_on <= private.today(), 'Enter the date you read the credit on the CRA page (today or before).');
  update public.cb_settings set quick_credit_draft = jsonb_build_object('rate', p_rate, 'limit', p_limit, 'source_url', p_source,
           'source_name', case when p_source ~ 'rc4058' then 'CRA guide RC4058, Quick Method of Accounting for GST/HST' else 'CRA page' end,
           'checked_on', p_checked_on), updated_at = now(), updated_by = (select auth.uid());
end;
$$;

create or replace function private.cb_quick_credit_approve() returns int
language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  update public.cb_settings set quick_credit_rate = (quick_credit_draft ->> 'rate')::numeric, quick_credit_limit = (quick_credit_draft ->> 'limit')::numeric,
         quick_credit_source_url = quick_credit_draft ->> 'source_url', quick_credit_source_name = coalesce(quick_credit_draft ->> 'source_name', ''),
         quick_credit_checked_on = (quick_credit_draft ->> 'checked_on')::date,
         quick_credit_approved_by = (select auth.uid()), quick_credit_approved_at = now(), quick_credit_draft = null,
         updated_at = now(), updated_by = (select auth.uid())
   where quick_credit_draft is not null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.cb_quick_credit_approve() from public, anon, authenticated;

-- p_approve true approves the draft; false rejects it (the approved credit stays).
create or replace function public.cb_decide_quick_credit(p_approve boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can approve the quick method credit.');
  perform private.require(exists (select 1 from public.cb_settings where quick_credit_draft is not null), 'No credit is waiting for approval.');
  if p_approve then
    perform private.cb_quick_credit_approve();
  else
    update public.cb_settings set quick_credit_draft = null, updated_at = now(), updated_by = (select auth.uid());
  end if;
end;
$$;

-- Approve all: every draft rate and the draft credit, in one step. Returns how many.
create or replace function public.cb_approve_quick_rates() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v_n int := 0;
begin
  perform private.require(private.is_owner(), 'Only an owner can approve quick method rates.');
  for r in select id from public.cb_quick_rates where status = 'pending' order by province loop
    perform private.cb_quick_rate_approve(r.id);
    v_n := v_n + 1;
  end loop;
  return v_n + private.cb_quick_credit_approve();
end;
$$;

-- The due dates (Closebook rules) no longer change the credit; the credit has its own draft and approval.
create or replace function public.cb_update_gst_settings(p_due_annual int, p_due_period int, p_credit_rate numeric, p_credit_limit numeric, p_rates jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner changes the GST/HST settings.');
  perform private.require(p_due_annual between 1 and 12 and p_due_period between 1 and 12, 'Due dates: a number of months from 1 to 12.');
  update public.cb_settings set gst_due_months_annual = p_due_annual, gst_due_months_period = p_due_period, updated_at = now(), updated_by = (select auth.uid());
end;
$$;

revoke all on function public.cb_set_quick_rate_status(uuid, text), public.cb_approve_quick_rates(), public.cb_set_quick_credit(numeric, numeric, text, date),
  public.cb_decide_quick_credit(boolean), public.cb_add_quick_rates(jsonb, date, text, date, text) from public, anon;
grant execute on function public.cb_set_quick_rate_status(uuid, text), public.cb_approve_quick_rates(), public.cb_set_quick_credit(numeric, numeric, text, date),
  public.cb_decide_quick_credit(boolean), public.cb_add_quick_rates(jsonb, date, text, date, text) to authenticated;
