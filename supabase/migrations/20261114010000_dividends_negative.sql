-- Hashim's rule 3 (Nov 14, 2026): GIFI data carries equity debits as negative, as in the QuickBooks GIFI
-- files ProFile imports. In opening balances, lines 3700 to 3740 are always deductions: stored negative
-- whatever sign is typed; staff type the figure exactly as printed. 3849 = 3660 + 9999 + the 3700s.
update public.cb_opening_balances set amount = -abs(amount) where code ~ '^\d{4}$' and code::int between 3700 and 3740;

create or replace function public.cb_save_opening(p_file uuid, p_codes jsonb, p_re_stated numeric, p_ni_typed numeric, p_note text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_row jsonb;
  v_n int := 0;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(jsonb_typeof(p_codes) = 'array' and jsonb_array_length(p_codes) <= 1000, 'Lines are missing.');
  delete from public.cb_opening_balances where file_id = p_file;
  for v_row in select * from jsonb_array_elements(p_codes) loop
    perform private.require((v_row ->> 'code') ~ '^\d{4}$' and private.cb_gifi_type(v_row ->> 'code') is not null, format('GIFI %s is not a code Closebook can use.', v_row ->> 'code'));
    perform private.require((v_row ->> 'code') not in ('2599', '3499', '3600', '3620', '3640', '3849', '8299', '9368', '9999'), format('%s is a total: it calculates by itself.', v_row ->> 'code'));
    insert into public.cb_opening_balances (file_id, code, amount)
    values (p_file, v_row ->> 'code', case when (v_row ->> 'code')::int between 3700 and 3740 then -abs(round((v_row ->> 'amount')::numeric, 2)) else round((v_row ->> 'amount')::numeric, 2) end)
    on conflict (file_id, code) do update set amount = public.cb_opening_balances.amount + excluded.amount;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set opening_source = coalesce(opening_source, 'manual'), opening_re_stated = p_re_stated, opening_ni_typed = p_ni_typed,
         opening_note = left(coalesce(btrim(p_note), ''), 300), opening_set_by = (select auth.uid()), opening_set_at = now(),
         opening_signed_by = null, opening_signed_at = null, updated_at = now()
   where id = p_file;
  return v_n;
end;
$$;

create or replace function public.cb_sign_opening(p_file uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files;
  v_assets numeric; v_liab numeric; v_equity numeric; v_rev numeric; v_exp numeric; v_re numeric; v_has125 boolean; v_ni numeric;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook.');
  select * into v_file from public.cb_files where id = p_file for update;
  perform private.require(v_file.id is not null and v_file.phase <> 'locked', 'This file is locked or missing.');
  perform private.require(exists (select 1 from public.cb_opening_balances where file_id = p_file), 'Enter last year''s balance sheet first.');
  perform private.require(v_file.opening_re_stated is not null, 'Type last year''s 3849 from the T2.');
  select coalesce(sum(amount) filter (where t = 'Asset'), 0), coalesce(sum(amount) filter (where t = 'Liability'), 0),
         coalesce(sum(amount) filter (where t = 'Equity' and not (code = '3660' or code::int between 3700 and 3848)), 0),
         coalesce(sum(amount) filter (where t = 'Revenue'), 0), coalesce(sum(amount) filter (where t = 'Expense'), 0),
         coalesce(sum(case when code = '3660' or code::int between 3700 and 3848 then amount else 0 end), 0),
         bool_or(t in ('Revenue', 'Expense'))
    into v_assets, v_liab, v_equity, v_rev, v_exp, v_re, v_has125
    from (select code, amount, private.cb_gifi_type(code) t from public.cb_opening_balances where file_id = p_file) x;
  v_ni := case when coalesce(v_has125, false) then v_rev - v_exp else v_file.opening_ni_typed end;
  perform private.require(v_ni is not null, 'Type last year''s net income (9999), or enter the Schedule 125 tab.');
  perform private.require(v_re + v_ni = v_file.opening_re_stated, format('3849 (%s) does not equal 3660 + 9999 + the 3700s (%s).', v_file.opening_re_stated, v_re + v_ni));
  perform private.require(v_liab + v_equity + v_file.opening_re_stated = v_assets, format('Total liabilities and equity (3640, %s) does not equal total assets (2599, %s).', v_liab + v_equity + v_file.opening_re_stated, v_assets));
  update public.cb_files set opening_signed_by = (select auth.uid()), opening_signed_at = now(), updated_at = now() where id = p_file;
end;
$$;
