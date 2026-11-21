-- CloseBook2 piece CB2-1, PR A (spec-checker, rule 16): a client's chart starts from the firm's chart template (Part 1.6).
-- A client added by hand gets the whole template; every client's chart is kept in step with the template and its year
-- files (the template first, then the years, so the latest year's name wins). Each account carries a default sales tax
-- code: the template's category ("GST/HST", "Exempt", "None", "Check") turned into the code for the client's province,
-- the same rule as src/lib/closebook/sales-tax.ts defaultTaxCode.

create or replace function private.cb_template_tax(p_default text, p_province text, p_number text) returns text
 language sql immutable set search_path to ''
as $function$
  select case when p_default = 'Check' then null
              when p_number = '60200' then case when p_province = 'ON' then 'MEALS_HST_50' else 'MEALS_GST_50' end
              when p_default = 'GST/HST' then case when p_province = 'ON' then 'HST_ON' else 'GST' end
              when p_default = 'Exempt' then 'EXEMPT'
              else 'OUT_OF_SCOPE' end;
$function$;

CREATE OR REPLACE FUNCTION public.cb_books_sync_accounts(p_client uuid, p_rows jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v jsonb; a public.cb_client_accounts; v_num text; v_name text; v_type text; v_line text; v_merged boolean; v_tax text;
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook.');
  perform private.cb_books_client(p_client);
  for v in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_num := left(btrim(coalesce(v ->> 'number', '')), 20);
    v_name := left(btrim(coalesce(v ->> 'name', '')), 120);
    continue when v_name = '';
    v_type := case when v ->> 'type' in ('Asset', 'Liability', 'Equity', 'Revenue', 'Expense') then v ->> 'type' else 'Asset' end;
    v_line := nullif(v ->> 'line_no', '');
    v_tax := nullif(v ->> 'tax', '');
    if v_tax is not null and not exists (select 1 from public.cb_sales_tax_codes where code = v_tax) then v_tax := null; end if;
    if v_line is not null and not exists (select 1 from public.cb_master_lines where line_no = v_line) then v_line := null; end if;
    a := null;
    select * into a from public.cb_client_accounts x where x.cb_client_id = p_client and x.merged_into is null
       and (case when v_num <> '' then x.number = v_num else x.number = '' and lower(x.name) = lower(v_name) end);
    if a.id is null then
      select exists (select 1 from public.cb_client_accounts x where x.cb_client_id = p_client and x.merged_into is not null
         and (case when v_num <> '' then x.number = v_num else x.number = '' and lower(x.name) = lower(v_name) end)) into v_merged;
      continue when v_merged;
      insert into public.cb_client_accounts (cb_client_id, number, name, account_type, line_no, tax_code)
      values (p_client, v_num, v_name, v_type, v_line, v_tax) on conflict do nothing;
    elsif a.source = 'books' and (a.name, a.account_type, a.line_no) is distinct from (v_name, v_type, v_line) then
      update public.cb_client_accounts set name = v_name, account_type = v_type, line_no = v_line, tax_code = coalesce(tax_code, v_tax), updated_at = now() where id = a.id;
    elsif a.tax_code is null and v_tax is not null then
      -- An account with no default tax code takes the template's (the firm's chart template, for the client's province).
      update public.cb_client_accounts set tax_code = v_tax, updated_at = now() where id = a.id;
    end if;
  end loop;
end;
$function$;

create or replace function public.cb_books_add_client(p_name text, p_province text default 'ON', p_studio uuid default null) returns uuid
 language plpgsql security definer set search_path to ''
as $function$
declare v uuid; v_name text := btrim(coalesce(p_name, '')); v_new boolean := true; v_prov text;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  if p_studio is not null then
    select id into v from public.cb_clients where firm_id = private.cb_default_firm() and studio_client_id = p_studio;
    if v is not null then return v; end if;
    select legal_name, coalesce(nullif(province, ''), p_province) into v_name, p_province from public.clients where id = p_studio;
    perform private.require(v_name is not null, 'Client not found.');
  end if;
  perform private.require(length(v_name) between 1 and 200, 'Enter the client''s name.');
  v_prov := coalesce(nullif(btrim(p_province), ''), 'ON');
  insert into public.cb_clients (studio_client_id, name, province, created_by)
  values (p_studio, v_name, v_prov, (select auth.uid())) returning id into v;
  -- The chart starts from the firm's template.
  insert into public.cb_client_accounts (cb_client_id, number, name, account_type, line_no, tax_code)
  select v, t.number, t.name, t.account_type, t.line_no, private.cb_template_tax(t.tax_default, v_prov, t.number)
    from public.cb_chart_accounts t where t.firm_id = private.cb_default_firm()
  on conflict do nothing;
  return v;
end;
$function$;
