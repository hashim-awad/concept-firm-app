-- Closebook (Phase 3 batch 5.5): explanations for flagged lead sheet lines. For each line that changed
-- by more than the flag amount and percentage, the preparer picks an explanation and adds a short note;
-- the reviewer judges it when signing "Compare to last year" (step 3).
create table public.cb_flag_notes (
  account_id   uuid primary key references public.cb_accounts (id) on delete cascade,
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  reason       text not null check (reason in ('new_asset', 'new_loan', 'revenue_grew', 'one_time', 'reclassified', 'error_fixed')),
  note         text not null check (length(btrim(note)) between 3 and 500),
  explained_by uuid references public.staff (id),
  explained_at timestamptz not null default now()
);

create or replace function public.cb_explain_flag(p_account uuid, p_reason text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  v_file := private.cb_file_of_account(p_account);
  perform private.require(v_file.id is not null, 'Account not found.');
  perform private.require(v_file.phase <> 'locked', 'This file is locked.');
  perform private.require(length(btrim(coalesce(p_note, ''))) >= 3, 'Add a short note.');
  insert into public.cb_flag_notes (account_id, file_id, reason, note, explained_by)
  values (p_account, v_file.id, p_reason, btrim(p_note), (select auth.uid()))
  on conflict (account_id) do update set reason = excluded.reason, note = excluded.note, explained_by = excluded.explained_by, explained_at = now();
end;
$$;

alter table public.cb_flag_notes enable row level security;
alter table public.cb_flag_notes force row level security;
create policy "Closebook viewers read flag notes" on public.cb_flag_notes for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_flag_notes to authenticated;
revoke all on function public.cb_explain_flag(uuid, text, text) from public, anon;
grant execute on function public.cb_explain_flag(uuid, text, text) to authenticated;
