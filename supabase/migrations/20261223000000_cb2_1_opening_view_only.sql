-- CloseBook2 piece CB2-1, PR B first commit (Hashim, Nov 21, 2026): until the switch-over, the opening balances, opening
-- difference and trial balance import entries are view-only in Books. Books never saves one, and never changes one that was
-- saved. Ordinary entries are unchanged.

create or replace function public.cb_books_save_entry(p_client uuid, p_entry uuid, p_date date, p_journal_no text, p_reclass boolean, p_memo text,
  p_lines jsonb, p_attachments text[] default '{}'::text[], p_origin text default null) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_file public.cb_files; e public.cb_entries; v_lines jsonb := '[]'::jsonb; l jsonb; v_id uuid; v_no text := nullif(btrim(coalesce(p_journal_no, '')), '');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(p_date is not null, 'Enter the journal date.');
  -- CB2-1 (Hashim, Nov 21, 2026): until the switch-over, the opening balances, opening difference and trial balance import
  -- entries are view-only in Books; they change in the old Closebook.
  perform private.require(p_origin is null, 'Change this entry in the old Closebook until the switch-over.');
  perform private.require(jsonb_typeof(p_lines) = 'array', 'Add the lines.');
  if p_entry is not null then
    select * into e from public.cb_entries where id = p_entry;
    perform private.require(e.id is not null, 'Entry not found.');
    perform private.require(coalesce(e.origin, '') not in ('opening_balances', 'opening_difference', 'tb_import'), 'Change this entry in the old Closebook until the switch-over.');
    select * into v_file from public.cb_files where id = e.file_id;
    perform private.require(v_file.cb_client_id = p_client, 'Entry not found.');
    perform private.require(p_date between v_file.year_start - 1 and v_file.year_end,
      format('This entry belongs to the year %s to %s. To move it to another year, delete it and enter it again.', to_char(v_file.year_start, 'Mon FMDD, YYYY'), to_char(v_file.year_end, 'Mon FMDD, YYYY')));
  else
    v_file := private.cb_books_file_for(p_client, p_date, p_origin);
  end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account', private.cb_books_file_account(v_file, nullif(l ->> 'account', '')::uuid),
      'amount', (l ->> 'amount')::numeric, 'memo', coalesce(l ->> 'memo', ''), 'tax_code', nullif(l ->> 'tax_code', ''), 'is_tax', coalesce((l ->> 'is_tax')::boolean, false)));
  end loop;
  if p_entry is not null then
    -- The number first, so the entry's History row names it.
    update public.cb_entries x set journal_no = case when v_no = format('%s-%s', to_char(v_file.year_end, 'YYYY'), lpad(x.seq::text, 3, '0')) then null else v_no end
     where x.id = p_entry and x.journal_no is distinct from case when v_no = format('%s-%s', to_char(v_file.year_end, 'YYYY'), lpad(x.seq::text, 3, '0')) then null else v_no end;
    v_id := public.cb_save_entry(v_file.id, p_entry, coalesce(p_reclass, false), e.kind, e.reason, coalesce(p_memo, ''), e.reverse_next_year, v_lines, e.wp_ref,
      p_date, e.standard_id, coalesce(p_attachments, '{}'), null);
  else
    -- A new entry takes its typed number and origin as it is inserted (private.cb_entry_books_fields).
    perform set_config('cb.journal_no', coalesce(v_no, ''), true);
    perform set_config('cb.origin', coalesce(p_origin, ''), true);
    v_id := public.cb_save_entry(v_file.id, null, coalesce(p_reclass, false), null, 'correction', coalesce(p_memo, ''), false, v_lines, '',
      p_date, null, coalesce(p_attachments, '{}'), null);
    perform set_config('cb.journal_no', '', true);
    perform set_config('cb.origin', '', true);
  end if;
  return v_id;
end;
$function$;
