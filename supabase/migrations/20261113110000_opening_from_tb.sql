-- Opening balances route 3 (Hashim, Nov 13, 2026): the prior accountant's trial balance, imported into
-- last year's column and matched to GIFI, becomes the opening balances by GIFI code (cb_set_opening,
-- source 'trial_balance'). The imported rows are then removed: the built rows carry last year from here.
create or replace function public.cb_drop_imported_rows(p_file uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select books from public.cb_files where id = p_file) in ('statements', 'paper'), 'Only files built from bank and card statements.');
  delete from public.cb_accounts a
   where a.file_id = p_file and a.this_year = 0
     and not (a.account_key like 'chart:%' or a.account_key like 'bank:%' or a.account_key like 'gifi:%' or a.account_key in ('uncoded', 'opening'))
     and not exists (select 1 from public.cb_entry_lines l where l.account_id = a.id)
     and not exists (select 1 from public.cb_flag_notes n where n.account_id = a.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.cb_drop_imported_rows(uuid) from public, anon;
grant execute on function public.cb_drop_imported_rows(uuid) to authenticated;
