-- Lead alerts (Phase 2 batch, section 3; step 5). The app emails everyone with the Pricing permission
-- when a lead comes in, and again if the quote is not marked sent within 45 business minutes.
-- This table records which alerts went out, so each goes once. Only the server (service role) uses it.
create table public.lead_alerts (
  lead_id    uuid not null references public.leads (id) on delete cascade,
  kind       text not null check (kind in ('new', 'reminder')),
  claimed_at timestamptz not null default now(),
  sent_at    timestamptz,
  recipients int not null default 0,
  error      text not null default '',
  primary key (lead_id, kind)
);
alter table public.lead_alerts enable row level security;
alter table public.lead_alerts force row level security;
revoke all on public.lead_alerts from public, anon, authenticated;
grant select, insert, update, delete on public.lead_alerts to service_role;
create policy "Server only" on public.lead_alerts for all to service_role using (true) with check (true);

-- Leads that came in before alerts existed are treated as already alerted, so nothing old is sent.
insert into public.lead_alerts (lead_id, kind, sent_at, error)
select id, k, now(), 'before alerts existed' from public.leads cross join (values ('new'), ('reminder')) v(k)
on conflict do nothing;

-- Who gets lead alerts: active staff whose role includes Pricing (view or edit), owners included.
-- Permissions follow roles, never names. Email addresses only.
create or replace function public.lead_alert_recipients()
returns setof text language sql stable security definer set search_path = '' as $$
  select s.email from public.staff s join public.roles r on r.id = s.role_id
  where s.is_active and (r.is_owner or exists (
    select 1 from public.role_permissions rp where rp.role_id = s.role_id and rp.area_key = 'pricing' and rp.level in ('view', 'edit')))
  order by s.email
$$;
revoke all on function public.lead_alert_recipients() from public, anon, authenticated;
grant execute on function public.lead_alert_recipients() to service_role;
