-- Round 9b (Hashim, Nov 27, 2026): the account on each line of "Expenses paid personally", chosen on the
-- file. Settings keeps the firm's default; on a file the preparer picks another account for lines 1 to 28
-- (the CRA, Other and Not sure lines already pick theirs), as step 2 does when a GIFI line has more than
-- one account. The choice is kept for the file and rolls forward: next year's file for the same client
-- starts from it.
--   kind chart:  a standard chart account (firm and bank-statement files), value = its number
--   kind client: the client's own account (own-books files), value = its number in their books, so it
--                is found again in next year's import
--   kind new:    a new account for the client's books, value = its name
-- Safe to run twice (round 4d rule).

create table if not exists public.cb_expense_line_accounts (
  file_id     uuid not null references public.cb_files (id) on delete cascade,
  key         text not null,
  kind        text not null check (kind in ('chart', 'client', 'new')),
  value       text not null check (length(value) between 1 and 80),
  updated_by  uuid references public.staff (id),
  updated_at  timestamptz not null default now(),
  primary key (file_id, key)
);
alter table public.cb_expense_line_accounts enable row level security;
alter table public.cb_expense_line_accounts force row level security;
drop policy if exists "Closebook viewers read expense line accounts" on public.cb_expense_line_accounts;
create policy "Closebook viewers read expense line accounts" on public.cb_expense_line_accounts for select to authenticated using ((select private.can_view('closebook')));
revoke all on public.cb_expense_line_accounts from anon;
grant select on public.cb_expense_line_accounts to authenticated;

-- Save one line's account for a file. kind "default" goes back to the line's default (Settings).
create or replace function public.cb_save_expense_line_account(p_file uuid, p_key text, p_kind text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files; c public.cb_standard_entry_lines; v_own boolean;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  select l.* into c from public.cb_standard_entry_lines l join public.cb_standard_entries s on s.id = l.standard_id
   where s.name = 'Expenses paid personally' and s.style = 'lines' and l.key = p_key;
  perform private.require(c.key is not null, 'Unknown line.');
  perform private.require(not c.pick, 'This line''s account is picked on the entry itself.');
  if p_kind = 'default' then
    delete from public.cb_expense_line_accounts where file_id = p_file and key = p_key;
    return;
  end if;
  v_own := v_file.books in ('client_software', 'bookkeeper');
  perform private.require(p_kind in ('chart', 'client', 'new'), 'Choose an account.');
  perform private.require(p_kind <> 'chart' or exists (select 1 from public.cb_chart_accounts where number = p_value), 'Choose an account from the standard chart.');
  -- A firm or bank-statement file uses the standard chart; a client who keeps their own books, their accounts.
  perform private.require((p_kind = 'chart') = not v_own,
    case when v_own then 'Choose one of the client''s accounts, or a new account.' else 'This file uses the standard chart.' end);
  perform private.require(p_kind <> 'client' or exists (select 1 from public.cb_accounts where file_id = p_file and number = p_value and not client_new),
    'Choose one of the client''s accounts.');
  perform private.require(p_kind <> 'new' or length(btrim(coalesce(p_value, ''))) between 3 and 80, 'Name the new account in plain words.');
  insert into public.cb_expense_line_accounts (file_id, key, kind, value, updated_by)
  values (p_file, p_key, p_kind, btrim(p_value), (select auth.uid()))
  on conflict (file_id, key) do update set kind = excluded.kind, value = excluded.value, updated_by = excluded.updated_by, updated_at = now();
end;
$$;
revoke all on function public.cb_save_expense_line_account(uuid, text, text, text) from public, anon;
grant execute on function public.cb_save_expense_line_account(uuid, text, text, text) to authenticated;
