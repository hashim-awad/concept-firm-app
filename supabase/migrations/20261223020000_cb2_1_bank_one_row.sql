-- CloseBook2 piece CB2-1 version 4, PR B, the one spec-checker run (rule 16): Confirm writes one History row per line.
-- A memo sent with a line was written as its own row, and a match to a journal entry left the one-action switch on, so
-- later lines in the same Confirm selected wrote none. The memo is now saved quietly (the posting's row carries it) and the
-- switch is reset for each line.
create or replace function public.cb_books_confirm(p_client uuid, p_items jsonb) returns int
 language plpgsql security definer set search_path to ''
as $function$
declare it jsonb; l public.cb_bank_lines; f public.cb_files; v_n int := 0; v_kind text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to confirm.');
  for it in select * from jsonb_array_elements(p_items) loop
    select x.* into l from public.cb_bank_lines x join public.cb_files y on y.id = x.file_id where x.id = (it ->> 'id')::uuid and y.cb_client_id = p_client;
    perform private.require(l.id is not null, 'Line not found.');
    select * into f from public.cb_files where id = l.file_id;
    v_kind := coalesce(it ->> 'kind', 'code');
    -- One History row per line: the memo and the posting are saved quietly, then the line's own row names the coding
    -- with its memo (a match to an entry writes its own row).
    perform private.cb_one_action(true);
    if it ? 'memo' and coalesce(it ->> 'memo', '') <> coalesce(l.memo, '') then
      perform private.require(length(it ->> 'memo') <= 2000, 'Keep the memo under 2,000 characters.');
      update public.cb_bank_lines set memo = btrim(it ->> 'memo') where id = l.id;
    end if;
    if v_kind = 'entry' then perform private.cb_one_action(false); end if;
    if v_kind = 'code' then
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'code', 'account', it ->> 'account', 'tax', it ->> 'tax',
        'source', coalesce(nullif(it ->> 'source', ''), 'manual'), 'rule_id', it ->> 'rule_id')));
    elsif v_kind = 'split' then
      perform public.cb_save_splits(l.id, it -> 'rows');
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'split', 'source', coalesce(nullif(it ->> 'source', ''), 'manual'))));
    elsif v_kind = 'transfer' then
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'transfer',
        'transfer_account', private.cb_books_bank_account(f, it ->> 'transfer'))));
    elsif v_kind = 'pair' then
      perform public.cb_post_lines(l.file_id, jsonb_build_array(jsonb_build_object('id', l.id, 'kind', 'pair', 'other', it ->> 'other')));
    elsif v_kind = 'entry' then
      perform public.cb_books_match_entry(l.id, (it ->> 'entry')::uuid);
    else
      perform private.require(false, 'Unknown action.');
    end if;
    perform private.cb_one_action(false);   -- a match to an entry leaves it on; the next line writes its own row
    if v_kind <> 'entry' then
      select x.* into l from public.cb_bank_lines x where x.id = l.id;
      perform private.cb_log_event(l.file_id, 'line_coded', 'code', case when it ->> 'source' = 'rule' then 'Posted by a rule' else 'Posted' end,
        l.statement_id, l.id, private.cb_line_label(l), '', '', private.cb_line_coding(l.id), null);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;
