-- CloseBook2 piece CB2-1, PR A: a Books entry writes its own History row. A new entry takes its typed journal number and
-- its origin as it is inserted (so its History row names the number); an edited entry's number changes before the save.
-- (20261222000000 switched off the save's own History row when no Reclass change was recorded: an entry saved with the
-- box unticked had none.)

create or replace function private.cb_entry_books_fields() returns trigger
 language plpgsql security definer set search_path to ''
as $function$
declare v_no text := coalesce(current_setting('cb.journal_no', true), ''); v_origin text := coalesce(current_setting('cb.origin', true), '');
begin
  if v_no <> '' and v_no <> (select format('%s-%s', to_char(f.year_end, 'YYYY'), lpad(new.seq::text, 3, '0')) from public.cb_files f where f.id = new.file_id) then
    new.journal_no := v_no;
  end if;
  if v_origin <> '' and new.origin is null then new.origin := v_origin; end if;
  return new;
end;
$function$;
revoke all on function private.cb_entry_books_fields() from public, anon, authenticated;
drop trigger if exists cb_entry_books_fields on public.cb_entries;
create trigger cb_entry_books_fields before insert on public.cb_entries for each row execute function private.cb_entry_books_fields();

-- Save a journal entry from Books (QBO's Journal Entry window): lines on the client's accounts; the year that covers the
-- date takes a new entry. One History row (the entry's own).
create or replace function public.cb_books_save_entry(p_client uuid, p_entry uuid, p_date date, p_journal_no text, p_reclass boolean, p_memo text,
  p_lines jsonb, p_attachments text[] default '{}'::text[], p_origin text default null) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_file public.cb_files; e public.cb_entries; v_lines jsonb := '[]'::jsonb; l jsonb; v_id uuid; v_no text := nullif(btrim(coalesce(p_journal_no, '')), '');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(p_date is not null, 'Enter the journal date.');
  perform private.require(p_origin is null or p_origin in ('opening_balances', 'opening_difference', 'tb_import'), 'Unknown entry origin.');
  perform private.require(jsonb_typeof(p_lines) = 'array', 'Add the lines.');
  if p_entry is not null then
    select * into e from public.cb_entries where id = p_entry;
    perform private.require(e.id is not null, 'Entry not found.');
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

revoke all on function public.cb_books_save_entry(uuid, uuid, date, text, boolean, text, jsonb, text[], text) from public, anon;
grant execute on function public.cb_books_save_entry(uuid, uuid, date, text, boolean, text, jsonb, text[], text) to authenticated;
