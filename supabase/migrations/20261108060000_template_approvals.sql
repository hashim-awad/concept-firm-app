-- Template library approvals (Studio recorded these in the Quality log, which comes in Phase 3).
-- An owner approves a trial template for client use at a wording version. Approvals are a
-- permanent record: no changes, no deletes.
create table public.template_approvals (
  id            uuid primary key default gen_random_uuid(),
  template_key  text not null check (template_key ~ '^[A-Za-z0-9]{1,40}$'),
  template_name text not null,
  el_version    text not null,
  basis         text not null default '',
  approved_on   date not null default private.today(),
  created_at    timestamptz not null default now(),
  created_by    uuid references public.staff (id),
  unique (template_key, el_version)
);
alter table public.template_approvals enable row level security;
create trigger template_approvals_created_by before insert on public.template_approvals for each row execute function private.set_created_by();
create or replace function private.block_approval_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Template approvals are kept as a record.' using errcode = '42501';
end;
$$;
create trigger template_approvals_permanent before update or delete on public.template_approvals
  for each row execute function private.block_approval_change();
create trigger template_approvals_log after insert on public.template_approvals
  for each row execute function private.log_change();

create policy "Document viewers read approvals" on public.template_approvals for select to authenticated
  using ((select private.can_view('documents')) or (select private.can_view('engagement_terms')));
create policy "Owners approve templates" on public.template_approvals for insert to authenticated
  with check ((select private.is_owner()));
grant select, insert on public.template_approvals to authenticated;
