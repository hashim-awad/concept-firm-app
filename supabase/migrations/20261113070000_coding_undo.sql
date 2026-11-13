-- Undo (Hashim, Nov 13, 2026), as in the QuickBooks bank feed: a coded line, or one on the client's
-- question list, goes back to "Needs you" with its account and sales tax cleared.
create or replace function public.cb_uncode_lines(p_file uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.require((select phase from public.cb_files where id = p_file) <> 'locked', 'This file is locked.');
  update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null
   where file_id = p_file and id = any (p_ids) and status in ('done', 'ask_client', 'reviewer');
  get diagnostics v_n = row_count;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;
revoke all on function public.cb_uncode_lines(uuid, uuid[]) from public, anon;
grant execute on function public.cb_uncode_lines(uuid, uuid[]) to authenticated;
