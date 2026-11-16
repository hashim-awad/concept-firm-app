-- Round 22 correction (Hashim, Nov 16, 2026): "Undo import" puts a statement back as "Ready to check" when
-- its checks passed when it was read (no line for review, no difference), else "Needs a look". Before, it was
-- always "Needs a look". Safe to run twice.
create or replace function public.cb_delete_bank_statement(p_statement uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_st public.cb_bank_statements;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_st from public.cb_bank_statements where id = p_statement;
  perform private.require(v_st.id is not null, 'Statement not found.');
  perform private.require((select phase from public.cb_files where id = v_st.file_id) <> 'locked', 'This file is locked.');
  delete from public.cb_bank_statements where id = p_statement;
  delete from public.cb_bank_accounts a where a.id = v_st.account_id and a.origin = 'import' and not exists (select 1 from public.cb_bank_statements s where s.account_id = a.id);
  if v_st.statement_import_id is not null and not exists (select 1 from public.cb_bank_statements where statement_import_id = v_st.statement_import_id) then
    -- Back to the status its checks gave when it was read: ready when nothing was off, else needs a look.
    update public.cb_statement_imports set status = case when coalesce((summary ->> 'review')::int, 1) = 0 and coalesce((summary ->> 'difference_cents')::int, 1) = 0 then 'ready' else 'needs_look' end,
           imported_at = null, imported_by = null where id = v_st.statement_import_id and status = 'imported';
  end if;
  perform private.cb_log(v_st.file_id, 'statement_undone', 'records', format('Import undone: %s, %s to %s.', v_st.file_name,
    to_char(v_st.period_start, 'Mon FMDD, YYYY'), to_char(v_st.period_end, 'Mon FMDD, YYYY')));
  update public.cb_files set updated_at = now() where id = v_st.file_id;
end;
$$;
revoke all on function public.cb_delete_bank_statement(uuid) from public, anon;
grant execute on function public.cb_delete_bank_statement(uuid) to authenticated;
