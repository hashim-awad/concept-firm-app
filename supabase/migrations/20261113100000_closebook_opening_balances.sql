-- Opening balances for files built from bank and card CSVs (Hashim, Nov 13, 2026; BRIEF.md). Last year's
-- balances by GIFI code (GIFI signs, as in the file), from last year's Closebook file, a prior-year GIFI
-- file, or typed in; with last year's 3849 as stated on last year's T2 for the retained earnings check.
create table public.cb_opening_balances (
  file_id uuid not null references public.cb_files (id) on delete cascade,
  code    text not null check (code ~ '^\d{4}$'),
  amount  numeric(14, 2) not null,
  primary key (file_id, code)
);
alter table public.cb_files
  add column opening_source text check (opening_source in ('closebook', 'gifi_file', 'manual', 'trial_balance')),
  add column opening_re_stated numeric(14, 2),
  add column opening_set_by uuid references public.staff (id),
  add column opening_set_at timestamptz;

create or replace function public.cb_set_opening(p_file uuid, p_source text, p_codes jsonb, p_re_stated numeric)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(p_source in ('closebook', 'gifi_file', 'manual', 'trial_balance'), 'Unknown source.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) between 1 and 1000, 'There are no GIFI lines.');
  perform private.require(p_source = 'closebook' or p_re_stated is not null, 'Enter last year''s retained earnings at the end of the year (GIFI 3849, from last year''s T2).');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    perform private.require((v_row ->> 'code') ~ '^\d{4}$' and (v_row ->> 'code') <> '3849', format('GIFI %s cannot be used here.', v_row ->> 'code'));
    perform private.require(exists (select 1 from public.cb_master_lines where gifi_code = v_row ->> 'code'), format('GIFI %s is not a known code.', v_row ->> 'code'));
    insert into public.cb_opening_balances (file_id, code, amount) values (p_file, v_row ->> 'code', round((v_row ->> 'amount')::numeric, 2));
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = p_source, opening_re_stated = p_re_stated, opening_set_by = (select auth.uid()), opening_set_at = now(), updated_at = now()
   where id = p_file;
  return v_n;
end;
$$;

-- The build now also writes last year's column, and carries rows keyed by GIFI code (gifi:1002).
create or replace function public.cb_build_tb(p_file uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_total numeric := 0;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(v_file.books in ('statements', 'paper'), 'Only files built from bank and card statements build their trial balance.');
  perform private.require(jsonb_typeof(p_rows) = 'array', 'Rows are missing.');
  select coalesce(sum((r ->> 'amount')::numeric), 0) into v_total from jsonb_array_elements(p_rows) r;
  perform private.require(v_total = 0, format('The built trial balance does not balance (out by %s).', v_total));

  update public.cb_accounts set this_year = 0, last_year = 0,
         needs_reviewer = case when account_key in ('uncoded', 'opening') then false else needs_reviewer end,
         reviewer_reason = case when account_key in ('uncoded', 'opening') then '' else reviewer_reason end
   where file_id = p_file and (account_key like 'chart:%' or account_key like 'bank:%' or account_key like 'gifi:%' or account_key in ('uncoded', 'opening'));
  for v_row in select * from jsonb_array_elements(p_rows) loop
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, last_year, line_no, mapping_source, needs_reviewer, reviewer_reason, mapped_at)
    values (p_file, v_row ->> 'key', coalesce(v_row ->> 'number', ''), v_row ->> 'name', round((v_row ->> 'amount')::numeric, 2), round(coalesce((v_row ->> 'last')::numeric, 0), 2),
            nullif(v_row ->> 'line_no', ''), case when nullif(v_row ->> 'line_no', '') is null then null else 'chart' end,
            coalesce(v_row ->> 'reviewer', '') <> '', coalesce(v_row ->> 'reviewer', ''), now())
    on conflict (file_id, account_key) do update
      set this_year = excluded.this_year, last_year = excluded.last_year, name = excluded.name, number = excluded.number,
          needs_reviewer = excluded.needs_reviewer, reviewer_reason = excluded.reviewer_reason,
          line_no = case when public.cb_accounts.mapping_source in ('preparer', 'reviewer') then public.cb_accounts.line_no else excluded.line_no end,
          mapping_source = case when public.cb_accounts.mapping_source in ('preparer', 'reviewer') then public.cb_accounts.mapping_source else excluded.mapping_source end;
    v_n := v_n + 1;
  end loop;
  -- Built rows with nothing left go, unless an entry or a note points at them.
  delete from public.cb_accounts a
   where a.file_id = p_file and a.this_year = 0 and a.last_year = 0
     and (a.account_key like 'chart:%' or a.account_key like 'bank:%' or a.account_key like 'gifi:%' or a.account_key = 'uncoded' or (a.account_key = 'opening' and not a.needs_reviewer))
     and not exists (select 1 from public.cb_entry_lines l where l.account_id = a.id)
     and not exists (select 1 from public.cb_flag_notes n where n.account_id = a.id);
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

alter table public.cb_opening_balances enable row level security;
alter table public.cb_opening_balances force row level security;
create policy "Closebook viewers read opening balances" on public.cb_opening_balances for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_opening_balances to authenticated;
revoke all on function public.cb_set_opening(uuid, text, jsonb, numeric) from public, anon;
grant execute on function public.cb_set_opening(uuid, text, jsonb, numeric) to authenticated;
