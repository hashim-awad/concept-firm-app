-- CloseBook2 piece CB2-1, PR A: an entry's History text names it by its journal number (typed in Books, else the year and
-- order), with its type only when it has one (entries made since CB2-1 have none).
create or replace function private.cb_entry_snapshot(p_entry uuid) returns text
 language sql stable security definer set search_path to ''
as $function$
  select format('%s, %s%s: %s', coalesce(e.journal_no, format('%s-%s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'))) || coalesce(' ' || e.kind, ''),
    to_char(coalesce(e.entry_date, f.year_end), 'Mon FMDD, YYYY'),
    case when e.note <> '' then ', ' || e.note else '' end,
    coalesce((select string_agg(format('%s %s %s%s%s', case when l.amount >= 0 then 'Dr' else 'Cr' end, btrim(coalesce(nullif(a.number, '') || ' ', '') || a.name),
        to_char(abs(l.amount), 'FM999,999,999,990.00'), case when l.is_tax then ' (sales tax)' when coalesce(l.tax_code, '') <> '' then ' ' || l.tax_code else '' end,
        case when l.memo <> '' then ' (' || l.memo || ')' else '' end), '; ' order by l.amount desc, a.number)
      from public.cb_entry_lines l join public.cb_accounts a on a.id = l.account_id where l.entry_id = e.id), 'no lines'))
  from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = p_entry;
$function$;
