-- Price book clean-up after the Studio import (Hashim, 2026-11-08).
-- - Internal note per item: for staff only, never on quotes or invoices.
-- - apply_catalogue_cleanup(plan): owner only. Applies the exact list of changes the owner saw
--   on the clean-up screen, all at once (all or nothing). Each change is in the activity log.
--   It may (only here) repoint rules in published screening versions to the replacement
--   item, and remove the brief's seed T1 items with their prices. Those items were never used
--   on a quote (quotes start in Phase 2).

alter table public.catalogue_items add column internal_note text not null default '' check (length(internal_note) <= 500);
grant update (internal_note) on public.catalogue_items to authenticated;

-- Allow the clean-up function, and nothing else, past the "draft only" and "prices are
-- permanent" rules.
create or replace function private.guard_draft_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('app.catalogue_cleanup', true) = 'on' and tg_table_name = 'rules' and tg_op = 'UPDATE'
     and private.is_owner() and (to_jsonb(new) - 'item_code') = (to_jsonb(old) - 'item_code') then
    return new; -- only the item a rule adds is changed
  end if;
  if exists (
    select 1 from public.questionnaires
    where id in (case when tg_op <> 'INSERT' then old.questionnaire_id end,
                 case when tg_op <> 'DELETE' then new.questionnaire_id end)
      and status <> 'draft'
  ) then
    raise exception 'Only a draft can be changed. Create a new draft from the published version.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function private.block_price_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.catalogue_cleanup', true) = 'on' and private.is_owner() then
    return old;
  end if;
  raise exception 'Prices are never changed or deleted. Add a new price with a start date.' using errcode = '42501';
end;
$$;

create or replace function public.apply_catalogue_cleanup(p_plan jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_op jsonb;
  v_item uuid;
  v_line uuid;
  v_done int := 0;
begin
  perform private.require(private.is_owner(), 'Only an owner can apply the price book clean-up.');
  perform private.require(jsonb_typeof(p_plan) = 'array', 'The plan is not valid.');
  perform set_config('app.catalogue_cleanup', 'on', true);
  for v_op in select * from jsonb_array_elements(p_plan) loop
    case v_op ->> 'op'
    when 'set_line' then
      select id into v_line from public.service_lines where key = v_op ->> 'line';
      perform private.require(v_line is not null, 'Unknown service line ' || coalesce(v_op ->> 'line', ''));
      update public.catalogue_items set service_line_id = v_line where code = v_op ->> 'code';
    when 'set_fields' then
      update public.catalogue_items set
        unit_label = coalesce(v_op ->> 'unit_label', unit_label),
        internal_note = coalesce(v_op ->> 'internal_note', internal_note),
        per_spouse = coalesce((v_op ->> 'per_spouse')::boolean, per_spouse)
      where code = v_op ->> 'code';
    when 'add_item' then
      select id into v_line from public.service_lines where key = v_op ->> 'line';
      perform private.require(v_line is not null, 'Unknown service line');
      perform private.require(not exists (select 1 from public.catalogue_items where code = v_op ->> 'code'), 'Item ' || (v_op ->> 'code') || ' already exists.');
      insert into public.catalogue_items (service_line_id, code, name, description, unit_label, per_spouse, sort_order, category, income_account, price_type, studio_source)
      values (v_line, v_op ->> 'code', v_op ->> 'name', coalesce(v_op ->> 'description', ''), v_op ->> 'unit_label', (v_op ->> 'per_spouse')::boolean,
              (v_op ->> 'sort_order')::numeric, 'T1 personal', v_op ->> 'income_account', v_op ->> 'price_type', 'Brief')
      returning id into v_item;
      insert into public.item_prices (item_id, amount_cents, effective_from, note)
      values (v_item, (v_op ->> 'price_cents')::int, private.today(), 'From the build brief');
    when 'replace_item' then
      perform private.require(exists (select 1 from public.catalogue_items where code = v_op ->> 'to'), 'Replacement item ' || (v_op ->> 'to') || ' is not in the price book.');
      update public.rules set item_code = v_op ->> 'to' where item_code = v_op ->> 'from';
      delete from public.item_prices where item_id = (select id from public.catalogue_items where code = v_op ->> 'from');
      delete from public.catalogue_items where code = v_op ->> 'from';
    when 'remove_empty_line' then
      delete from public.service_lines sl where sl.key = v_op ->> 'line'
        and not exists (select 1 from public.catalogue_items i where i.service_line_id = sl.id);
    else
      perform private.require(false, 'Unknown change: ' || coalesce(v_op ->> 'op', ''));
    end case;
    v_done := v_done + 1;
  end loop;
  perform set_config('app.catalogue_cleanup', 'off', true);
  return jsonb_build_object('applied', v_done);
end;
$$;
revoke all on function public.apply_catalogue_cleanup(jsonb) from public, anon;
grant execute on function public.apply_catalogue_cleanup(jsonb) to authenticated;
