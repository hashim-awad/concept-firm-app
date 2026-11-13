-- Hashim, Nov 13, 2026: as in QuickBooks, the sales tax on a line starts blank so uncoded lines stand
-- out, and Confirm with no sales tax code is refused with a message; nothing is saved.
create or replace function public.cb_code_lines(p_file uuid, p_items jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_item jsonb;
  v_acc public.cb_chart_accounts;
  v_tax text;
  v_reviewer boolean;
  v_line public.cb_bank_lines;
  v_reason text;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v_file from public.cb_files where id = p_file;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or (select private.is_owner());
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to code.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_acc from public.cb_chart_accounts where number = v_item ->> 'account';
    perform private.require(v_acc.number is not null, 'Choose an account from the standard chart.');
    v_tax := nullif(v_item ->> 'tax', '');
    -- Like QuickBooks: sales tax starts blank, and a line is never coded without one (Hashim, Nov 13).
    perform private.require(v_tax is not null, 'Choose a sales tax code for every line. Nothing was saved.');
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Unknown sales tax code.');
    select * into v_line from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file;
    perform private.require(v_line.id is not null, 'Line not found.');
    -- Only the reviewer deciding a line already sent to them is final. Coding a new line follows the
    -- same rules for everyone, so meals at the full rate always reach "For the reviewer" first. A "Check"
    -- account is the reviewer's call, so the reviewer coding it is final.
    v_reason := case
      when v_reviewer and v_line.status = 'reviewer' then ''
      when v_acc.tax_default = 'Check' and not v_reviewer then 'The sales tax on this account is the reviewer''s call.'
      when v_acc.number = '6020' and coalesce(v_tax, '') not like 'MEALS%' then 'Meals coded at the full rate: only 50% of the tax is claimable.'
      else '' end;
    update public.cb_bank_lines set chart_account = v_acc.number, tax_code = v_tax,
      status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason,
      source = coalesce(nullif(v_item ->> 'source', ''), 'manual'), coded_by = (select auth.uid()), coded_at = now()
     where id = (v_item ->> 'id')::uuid and file_id = p_file;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;
