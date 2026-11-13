-- Closebook builds the trial balance of a file made from bank and card CSVs (Hashim, Nov 13, 2026;
-- PHASE3-BATCH.md 5.1). The app works out the rows from the coded lines (src/lib/closebook/tb-build.ts)
-- and this saves them as the file's this-year column, rebuilt after every upload, coding or undo.
-- Rows: [{"key": "chart:6510", "number": "6510", "name": "Office expenses", "line_no": "8810.00",
--         "amount": 100.00, "reviewer": ""}]. They must balance. Built rows carry mapping_source "chart":
-- their GIFI line comes from the standard chart; a line the reviewer changed in step 6 is kept.
alter table public.cb_accounts drop constraint cb_accounts_mapping_source_check;
alter table public.cb_accounts add constraint cb_accounts_mapping_source_check check (mapping_source in ('history', 'suggested', 'preparer', 'reviewer', 'chart'));

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

  update public.cb_accounts set this_year = 0
   where file_id = p_file and (account_key like 'chart:%' or account_key like 'bank:%' or account_key in ('uncoded', 'opening'));
  for v_row in select * from jsonb_array_elements(p_rows) loop
    insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, needs_reviewer, reviewer_reason, mapped_at)
    values (p_file, v_row ->> 'key', coalesce(v_row ->> 'number', ''), v_row ->> 'name', round((v_row ->> 'amount')::numeric, 2),
            nullif(v_row ->> 'line_no', ''), case when nullif(v_row ->> 'line_no', '') is null then null else 'chart' end,
            coalesce(v_row ->> 'reviewer', '') <> '', coalesce(v_row ->> 'reviewer', ''), now())
    on conflict (file_id, account_key) do update
      set this_year = excluded.this_year, name = excluded.name, number = excluded.number,
          needs_reviewer = excluded.needs_reviewer, reviewer_reason = excluded.reviewer_reason,
          line_no = case when public.cb_accounts.mapping_source in ('preparer', 'reviewer') then public.cb_accounts.line_no else excluded.line_no end,
          mapping_source = case when public.cb_accounts.mapping_source in ('preparer', 'reviewer') then public.cb_accounts.mapping_source else excluded.mapping_source end;
    v_n := v_n + 1;
  end loop;
  -- Built rows with nothing left go, unless an entry or a note points at them.
  delete from public.cb_accounts a
   where a.file_id = p_file and a.this_year = 0 and a.last_year = 0
     and (a.account_key like 'chart:%' or a.account_key like 'bank:%' or a.account_key in ('uncoded', 'opening'))
     and not exists (select 1 from public.cb_entry_lines l where l.account_id = a.id)
     and not exists (select 1 from public.cb_flag_notes n where n.account_id = a.id);
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;
revoke all on function public.cb_build_tb(uuid, jsonb) from public, anon;
grant execute on function public.cb_build_tb(uuid, jsonb) to authenticated;
