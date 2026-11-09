-- T2 deadlines from TaxDome (brief decision 43, Hashim, Nov 9, 2026).
-- TaxDome is the master list of T2 clients. "Import from TaxDome" brings in, for T2-tagged Company
-- accounts only: legal name, Business Number (first 9 digits), fiscal year-end, TaxDome tags and the
-- TaxDome account id (the link is built from it). Nothing else from the export is ever stored.
-- Those fields change only through the import; Studio never edits them by hand.
-- Staff set, per client, the balance-due period (2 or 3 months) and "Exclude from deadlines".

alter table public.clients
  add column business_number       text not null default '' check (business_number = '' or business_number ~ '^\d{9}$'),
  add column taxdome_account_id    text unique,
  add column taxdome_tags          text[] not null default '{}',
  add column taxdome_synced_at     timestamptz,
  add column t2_balance_due_months int not null default 2 check (t2_balance_due_months in (2, 3)),
  add column t2_exclude_deadlines  boolean not null default false;
create unique index clients_business_number_key on public.clients (business_number) where business_number <> '';

-- TaxDome fields change only through apply_taxdome_import (which switches app.taxdome_import on).
create or replace function private.guard_taxdome_fields()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.taxdome_import', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    if new.taxdome_account_id is not null or new.business_number <> '' or new.taxdome_tags <> '{}' then
      raise exception 'Business Number and TaxDome details come only from the TaxDome import.' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.taxdome_account_id is distinct from old.taxdome_account_id or new.business_number is distinct from old.business_number
     or new.taxdome_tags is distinct from old.taxdome_tags or new.taxdome_synced_at is distinct from old.taxdome_synced_at
     or (old.taxdome_account_id is not null and (new.legal_name is distinct from old.legal_name or new.year_end_md is distinct from old.year_end_md)) then
    raise exception 'This client''s legal name, Business Number, year-end and TaxDome details come from TaxDome. Change them in TaxDome, then import again.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger clients_guard_taxdome before insert or update on public.clients
  for each row execute function private.guard_taxdome_fields();

-- Deadlines marked done on My day (filed, or balance paid), per client, year-end and kind.
create table public.t2_deadline_done (
  client_id  uuid not null references public.clients (id) on delete cascade,
  year_end   date not null,
  kind       text not null check (kind in ('filing', 'balance')),
  done_at    timestamptz not null default now(),
  done_by    uuid references public.staff (id) default auth.uid(),
  primary key (client_id, year_end, kind)
);
alter table public.t2_deadline_done enable row level security;
create policy "Client viewers read done deadlines" on public.t2_deadline_done for select to authenticated using ((select private.can_view('clients')));
create policy "Client editors mark deadlines done" on public.t2_deadline_done for insert to authenticated with check ((select private.can_edit('clients')));
create policy "Client editors undo done deadlines" on public.t2_deadline_done for delete to authenticated using ((select private.can_edit('clients')));
grant select, insert, delete on public.t2_deadline_done to authenticated;
create trigger t2_deadline_done_log after insert or delete on public.t2_deadline_done for each row execute function private.log_change();

-- The import: the exact list the owner saw, all or nothing. Logs one entry with counts only.
create or replace function public.apply_taxdome_import(p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_op jsonb;
  v_ins int := 0;
  v_upd int := 0;
  v_tags text[];
begin
  perform private.require(private.is_owner(), 'Only an owner can import from TaxDome.');
  perform private.require(jsonb_typeof(p_plan) = 'array', 'The import list is not valid.');
  perform set_config('app.taxdome_import', 'on', true);
  for v_op in select * from jsonb_array_elements(p_plan) loop
    perform private.require(coalesce(v_op ->> 'taxdome_id', '') <> '', 'Every account needs its TaxDome id.');
    perform private.require(length(btrim(coalesce(v_op ->> 'legal_name', ''))) between 1 and 200, 'Every account needs a legal name.');
    perform private.require(coalesce(v_op ->> 'bn', '') = '' or (v_op ->> 'bn') ~ '^\d{9}$', 'Business Number must be 9 digits.');
    perform private.require(coalesce(v_op ->> 'fye', '') = '' or (v_op ->> 'fye') ~ '^\d{2}-\d{2}$', 'Year-end must be MM-DD.');
    v_tags := array(select jsonb_array_elements_text(coalesce(v_op -> 'tags', '[]'::jsonb)));
    if v_op ->> 'op' = 'insert' then
      insert into public.clients (kind, legal_name, entity_type, province, year_end_md, business_number, taxdome_account_id, taxdome_tags, taxdome_synced_at, source)
      values ('corporation', btrim(v_op ->> 'legal_name'), 'Other',
              case when v_op ->> 'province' in ('ON', 'AB', 'BC', 'OTHER') then v_op ->> 'province' else 'OTHER' end,
              coalesce(v_op ->> 'fye', ''), coalesce(v_op ->> 'bn', ''), v_op ->> 'taxdome_id', v_tags, now(), jsonb_build_object('from', 'TaxDome'));
      v_ins := v_ins + 1;
    elsif v_op ->> 'op' = 'update' then
      perform private.require(exists (select 1 from public.clients c where c.id = (v_op ->> 'client_id')::uuid and (c.taxdome_account_id is null or c.taxdome_account_id = v_op ->> 'taxdome_id')),
        'A matched client changed since the preview. Check the list again.');
      update public.clients set
        legal_name = btrim(v_op ->> 'legal_name'),
        business_number = case when coalesce(v_op ->> 'bn', '') <> '' then v_op ->> 'bn' else business_number end,
        year_end_md = case when coalesce(v_op ->> 'fye', '') <> '' then v_op ->> 'fye' else year_end_md end,
        taxdome_account_id = v_op ->> 'taxdome_id', taxdome_tags = v_tags, taxdome_synced_at = now()
      where id = (v_op ->> 'client_id')::uuid;
      v_upd := v_upd + 1;
    else
      perform private.require(false, 'Unknown import step.');
    end if;
  end loop;
  perform set_config('app.taxdome_import', 'off', true);
  insert into public.activity_log (actor_id, action, entity_type, details)
  values ((select auth.uid()), 'taxdome_import', 'clients', jsonb_build_object('added', v_ins, 'updated', v_upd));
  return jsonb_build_object('added', v_ins, 'updated', v_upd);
end;
$$;
revoke all on function public.apply_taxdome_import(jsonb) from public, anon;
grant execute on function public.apply_taxdome_import(jsonb) to authenticated;

-- The link to a TaxDome account: an owner sets the address pattern once (Settings), with {id} where
-- the account id goes. Readable by all staff.
insert into public.settings (key, value) values ('taxdome_account_url', '""') on conflict (key) do nothing;
create or replace function public.taxdome_account_url()
returns text language sql stable security definer set search_path = '' as $$
  select case when private.is_active_staff() then (select value #>> '{}' from public.settings where key = 'taxdome_account_url') end
$$;
revoke all on function public.taxdome_account_url() from public, anon;
grant execute on function public.taxdome_account_url() to authenticated;

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
  elsif p_key = 'taxdome_account_url' then
    perform private.require(private.is_owner(), 'Only an owner can change the TaxDome link.');
    perform private.require(jsonb_typeof(p_value) = 'string' and ((p_value #>> '{}') = '' or ((p_value #>> '{}') ~ '^https://' and (p_value #>> '{}') like '%{id}%')),
      'The TaxDome link must start with https:// and contain {id} where the account id goes.');
  elsif p_key = 'signature_image' then
    perform private.require(private.is_owner(), 'Only an owner can change the signature image.');
    p_value := jsonb_build_object('uploaded', coalesce((p_value ->> 'uploaded')::boolean, false), 'uploaded_at', now());
  else
    perform private.require(false, 'Unknown setting: ' || p_key);
  end if;
  update public.settings set value = p_value, updated_by = (select auth.uid()) where key = p_key;
end;
$$;
