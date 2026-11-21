-- CloseBook2 piece CB2-1 version 4, PR C, after the one spec-checker run (Hashim, Nov 21, 2026): no "Sales tax account"
-- tick. Sales tax reads control account roles per agency instead (PR D). The two sales_tax columns added by
-- 20261224000000 stay, unused (a migration never drops a column); the save function and the History text go back to before.
comment on column public.cb_chart_accounts.sales_tax is 'Unused (PR C): sales tax reads control account roles (PR D).';
comment on column public.cb_client_accounts.sales_tax is 'Unused (PR C): sales tax reads control account roles (PR D).';

create or replace function private.cb_books_account_text(a public.cb_client_accounts) returns text
 language sql immutable set search_path to ''
as $function$
  select concat_ws(E'\n', 'Number: ' || coalesce(nullif(a.number, ''), 'none'), 'Name: ' || a.name, 'Type: ' || a.account_type,
    'GIFI line: ' || coalesce(a.line_no, 'Unmatched'), 'Default tax code: ' || coalesce(a.tax_code, 'none'), 'Active: ' || case when a.active then 'Yes' else 'No' end);
$function$;

drop function if exists public.cb_books_save_account(uuid, uuid, text, text, text, text, text, boolean, boolean);
create or replace function public.cb_books_save_account(p_client uuid, p_id uuid, p_number text, p_name text, p_type text, p_line text,
  p_tax text, p_merge boolean default false) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v_old public.cb_client_accounts; v_new public.cb_client_accounts; v_other public.cb_client_accounts;
  v_num text := btrim(coalesce(p_number, '')); v_name text := btrim(coalesce(p_name, '')); v_line text := nullif(btrim(coalesce(p_line, '')), '');
  v_tax text := nullif(btrim(coalesce(p_tax, '')), '');
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  perform private.cb_books_client(p_client);
  perform private.require(length(v_name) between 1 and 120, 'Enter the account name.');
  perform private.require(length(v_num) <= 20, 'The account number is too long.');
  perform private.require(p_type in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense'), 'Choose the account type.');
  perform private.require(v_line is null or exists (select 1 from public.cb_master_lines where line_no = v_line and mappable), 'Choose a GIFI line from the list.');
  perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a tax code from the list.');
  if p_id is not null then
    select * into v_old from public.cb_client_accounts where id = p_id and cb_client_id = p_client and merged_into is null;
    perform private.require(v_old.id is not null, 'Account not found.');
  end if;
  select * into v_other from public.cb_client_accounts x where x.cb_client_id = p_client and x.merged_into is null and x.id is distinct from p_id
     and (case when v_num <> '' then x.number = v_num else x.number = '' and lower(x.name) = lower(v_name) end);
  if v_other.id is not null then
    perform private.require(p_id is not null, case when v_num <> '' then format('Account number %s is already used by %s.', v_num, v_other.name)
      else format('There is already an account named %s.', v_other.name) end);
    if not coalesce(p_merge, false) then
      raise exception 'MERGE|%|%', v_other.id, btrim(coalesce(nullif(v_other.number, '') || ' ', '') || v_other.name);
    end if;
    update public.cb_client_accounts set merged_into = v_other.id, active = false, updated_at = now(), updated_by = (select auth.uid()) where id = p_id;
    insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, old_value, new_value)
    values (p_client, p_id, (select auth.uid()), 'account_merged',
            format('%s merged into %s', btrim(coalesce(nullif(v_old.number, '') || ' ', '') || v_old.name), btrim(coalesce(nullif(v_other.number, '') || ' ', '') || v_other.name)),
            private.cb_books_account_text(v_old), null);
    insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail)
    values (p_client, v_other.id, (select auth.uid()), 'account_merged_in',
            format('%s merged into this account', btrim(coalesce(nullif(v_old.number, '') || ' ', '') || v_old.name)));
    return v_other.id;
  end if;
  if p_id is null then
    insert into public.cb_client_accounts (cb_client_id, number, name, account_type, line_no, tax_code, source, updated_by)
    values (p_client, v_num, v_name, p_type, v_line, v_tax, 'user', (select auth.uid())) returning * into v_new;
    insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, new_value)
    values (p_client, v_new.id, (select auth.uid()), 'account_added', format('Account %s added', btrim(coalesce(nullif(v_num, '') || ' ', '') || v_name)),
            private.cb_books_account_text(v_new));
  else
    update public.cb_client_accounts set number = v_num, name = v_name, account_type = p_type, line_no = v_line, tax_code = v_tax, source = 'user',
      updated_at = now(), updated_by = (select auth.uid()) where id = p_id returning * into v_new;
    if private.cb_books_account_text(v_new) is distinct from private.cb_books_account_text(v_old) then
      insert into public.cb_books_history (cb_client_id, account_id, actor_id, action, detail, old_value, new_value)
      values (p_client, p_id, (select auth.uid()), 'account_changed', format('Account %s changed', btrim(coalesce(nullif(v_num, '') || ' ', '') || v_name)),
              private.cb_books_account_text(v_old), private.cb_books_account_text(v_new));
    end if;
  end if;
  return v_new.id;
end;
$function$;
revoke all on function public.cb_books_save_account(uuid, uuid, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.cb_books_save_account(uuid, uuid, text, text, text, text, text, boolean) to authenticated;
