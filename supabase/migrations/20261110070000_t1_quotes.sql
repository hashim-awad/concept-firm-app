-- Phase 2 step 7: the T1 quote (batch sections 6 to 8, Appendix A).
-- One quote per lead, made from the screening answers and the quote the server worked out
-- (lead_quotes). One private link per signer (one for a single filer, two for a couple); the
-- signing itself is step 8. Only people with Pricing and Leads can read quotes; the client reads
-- their own quote through the server, by their private link.

create table public.t1_quotes (
  id             uuid primary key default gen_random_uuid(),
  lead_id        uuid not null unique references public.leads (id) on delete cascade,
  tax_year       int not null check (tax_year between 2000 and 2100),
  couple         boolean not null,
  lines          jsonb not null,           -- [{code, person, quantity, unit_cents, total_cents}] staff only
  total_cents    int not null check (total_cents >= 0),
  status         text not null default 'draft' check (status in ('draft', 'sent', 'signed')),
  sent_at        timestamptz,
  sent_by        uuid references public.staff (id),
  valid_until    date,
  sender         jsonb,                    -- {name, phone, email} of the person who sent it
  signer         jsonb,                    -- {name, title}: the engagement-letter signer at sending
  wording        jsonb,                    -- the T1 quote wording at sending (changed pieces only)
  wording_label  text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  check (status = 'draft' or (sent_at is not null and valid_until is not null))
);

create table public.t1_quote_signers (
  quote_id   uuid not null references public.t1_quotes (id) on delete cascade,
  person     int not null check (person in (0, 1)),
  first_name text not null,
  last_name  text not null,
  email      text not null,
  token      text not null unique check (token ~ '^[0-9a-f]{64}$'),
  signed_at  timestamptz,
  primary key (quote_id, person)
);

alter table public.t1_quotes enable row level security;
alter table public.t1_quotes force row level security;
alter table public.t1_quote_signers enable row level security;
alter table public.t1_quote_signers force row level security;
create policy "Pricing and leads viewers read quotes" on public.t1_quotes for select to authenticated
  using ((select private.can_view('pricing')) and (select private.can_view('leads')));
create policy "Pricing and leads viewers read signers" on public.t1_quote_signers for select to authenticated
  using ((select private.can_view('pricing')) and (select private.can_view('leads')));
create policy "Server reads quotes" on public.t1_quotes for select to service_role using (true);
create policy "Server reads signers" on public.t1_quote_signers for select to service_role using (true);
revoke all on public.t1_quotes, public.t1_quote_signers from public, anon, authenticated;
grant select on public.t1_quotes, public.t1_quote_signers to authenticated, service_role;

create trigger t1_quotes_log after insert or update or delete on public.t1_quotes
  for each row execute function private.log_change();

-- The tax year a quote is for when the answers do not say: until June, last year; from July, this year.
create or replace function private.t1_tax_year(p_at timestamptz)
returns int language sql stable set search_path = '' as $$
  select case when extract(month from (p_at at time zone 'America/Toronto')) <= 6
              then extract(year from (p_at at time zone 'America/Toronto'))::int - 1
              else extract(year from (p_at at time zone 'America/Toronto'))::int end
$$;

-- Prepare the quote for a lead (staff with Pricing and Leads edit). Uses the stored answers and quote.
create or replace function public.create_t1_quote(p_lead uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_lead public.leads;
  v_q public.lead_quotes;
  v_h jsonb;
  v_couple boolean;
  v_id uuid;
  v_token text;
begin
  perform private.require(private.can_edit('pricing') and private.can_edit('leads'), 'You need Edit on Pricing and Leads to prepare a quote.');
  select * into v_lead from public.leads where id = p_lead;
  perform private.require(v_lead.id is not null, 'Lead not found.');
  perform private.require(v_lead.route = 'personal', 'Only personal tax leads have a T1 quote.');
  select * into v_q from public.lead_quotes where lead_id = p_lead;
  perform private.require(v_q.lead_id is not null, 'This lead has no quote from its answers (out of scope, or sent before the screening questions).');
  select id into v_id from public.t1_quotes where lead_id = p_lead;
  if v_id is not null then return v_id; end if;
  v_h := coalesce(v_lead.answers -> 'household', '{}'::jsonb);
  v_couple := v_h ->> 'filing_type' = 'couple';
  insert into public.t1_quotes (lead_id, tax_year, couple, lines, total_cents, created_by)
  values (p_lead, coalesce((v_lead.answers ->> 'tax_year')::int, private.t1_tax_year(v_lead.created_at)), v_couple,
          v_q.lines, v_q.subtotal_cents, (select auth.uid()))
  returning id into v_id;
  v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.t1_quote_signers (quote_id, person, first_name, last_name, email, token)
  values (v_id, 0, v_lead.first_name, v_lead.last_name, v_lead.email, v_token);
  if v_couple then
    perform private.require(coalesce(v_h ->> 'spouse_email', '') <> '', 'The spouse''s email is missing from the answers.');
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into public.t1_quote_signers (quote_id, person, first_name, last_name, email, token)
    values (v_id, 1, btrim(v_h ->> 'spouse_first_name'), btrim(v_h ->> 'spouse_last_name'), lower(btrim(v_h ->> 'spouse_email')), v_token);
  end if;
  return v_id;
end;
$$;

-- Mark as sent (batch section 8): starts the 21-day clock, records who sent it, keeps the wording and
-- signer as they are today (later wording changes do not change a sent quote), and marks the lead Quote sent.
create or replace function public.mark_t1_quote_sent(p_id uuid)
returns date language plpgsql security definer set search_path = '' as $$
declare
  v_q public.t1_quotes;
  v_staff public.staff;
  v_until date := (now() at time zone 'America/Toronto')::date + 21;
  v_ver uuid := (select id from public.wording_versions where is_current);
begin
  perform private.require(private.can_edit('pricing') and private.can_edit('leads'), 'You need Edit on Pricing and Leads to send a quote.');
  select * into v_q from public.t1_quotes where id = p_id;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status = 'draft', 'This quote is already marked sent.');
  select * into v_staff from public.staff where id = (select auth.uid());
  update public.t1_quotes set status = 'sent', sent_at = now(), sent_by = v_staff.id, valid_until = v_until,
    sender = jsonb_build_object('name', v_staff.full_name, 'phone', v_staff.phone, 'email', v_staff.email),
    signer = coalesce((select value from public.settings where key = 'signer_engagement_letter'), '{}'::jsonb),
    wording = coalesce((select jsonb_object_agg(t.key, t.text) from public.wording_texts t where t.version_id = v_ver and t.key like 'wa1%'), '{}'::jsonb),
    wording_label = (select label from public.wording_versions where id = v_ver)
  where id = p_id;
  update public.leads set status = 'sent' where id = v_q.lead_id;
  return v_until;
end;
$$;

revoke all on function public.create_t1_quote(uuid), public.mark_t1_quote_sent(uuid) from public, anon;
grant execute on function public.create_t1_quote(uuid), public.mark_t1_quote_sent(uuid) to authenticated;
revoke all on function private.t1_tax_year(timestamptz) from public, anon, authenticated;

-- The client's page reads its quote with the server key, by private link.
grant select on public.t1_quotes, public.t1_quote_signers to service_role;
