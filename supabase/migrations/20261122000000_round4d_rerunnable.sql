-- Round 4d (Hashim, Nov 20, 2026): migrations run twice safely.
--
-- The reversible deploy (scripts/deploy/db-deploy.sh) restores the data from its backup when a change
-- fails its check, and takes the change's migrations off the list, so the next deploy runs them again.
-- So every migration from here on must be safe to run twice: create or replace, if not exists,
-- drop trigger if exists. Round 4c's trigger was created without that; this puts it right.
--
-- Also: a GIFI-line account numbered in its type's range skips numbers the file's bank accounts hold
-- (the round 4b repair checked the chart and the file's accounts only).

drop trigger if exists cb_number_line_account on public.cb_accounts;
create trigger cb_number_line_account before insert on public.cb_accounts for each row execute function private.cb_number_line_account();

create or replace function private.cb_repair_line_postings() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_n int := 0;
  r record;
  v_chart public.cb_chart_accounts;
  v_target uuid;
  v_no int;
begin
  for r in select a.*, m.line_type from public.cb_accounts a join public.cb_files f on f.id = a.file_id
           left join public.cb_master_lines m on m.line_no = a.line_no
            where a.account_key like 'line:%' and f.books in ('statements', 'paper') loop
    v_chart := null;
    select * into v_chart from public.cb_chart_accounts c where c.line_no = r.line_no order by c.sort_order limit 1;
    if v_chart.number is not null then
      insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
      values (r.file_id, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
      on conflict (file_id, account_key) do nothing;
      select id into v_target from public.cb_accounts where file_id = r.file_id and account_key = 'chart:' || v_chart.number;
      update public.cb_entry_lines set account_id = v_target where account_id = r.id;
      update public.cb_flag_notes set account_id = v_target where account_id = r.id
        and not exists (select 1 from public.cb_flag_notes n where n.account_id = v_target);
      delete from public.cb_flag_notes where account_id = r.id;
      delete from public.cb_accounts where id = r.id;
      v_n := v_n + 1;
    elsif coalesce(r.number, '') = '' then
      v_no := case r.line_type when 'Asset' then 19000 when 'Liability' then 29000 when 'Equity' then 39000 when 'Revenue' then 49000 else 79000 end;
      while exists (select 1 from public.cb_chart_accounts where number = v_no::text)
         or exists (select 1 from public.cb_accounts where file_id = r.file_id and number = v_no::text)
         or exists (select 1 from public.cb_bank_accounts where file_id = r.file_id and number = v_no::text) loop
        v_no := v_no + 10;
      end loop;
      update public.cb_accounts set number = v_no::text where id = r.id;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.cb_repair_line_postings() from public, anon, authenticated;
