-- Local tests: price book clean-up (owner only; rules in the published screening repointed;
-- seed items removed; new items added with a price; empty line removed; all or nothing).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
-- Made-up Studio items, as the import would add them.
insert into public.catalogue_items (service_line_id, code, name, unit_label, price_type)
select id, v.code, v.name, v.unit, 'Fixed' from public.service_lines, (values ('PTX-110', 'T1 single', 'per return'), ('PTX-120', 'Rental', 'per property'), ('PTX-125', 'Investment sales', 'per return')) v(code, name, unit)
where key = 'corporate';
insert into public.item_prices (item_id, amount_cents, effective_from) select id, 29900, '2026-11-08' from public.catalogue_items where code like 'PTX-%';

select test.check('published screening uses the seed items', exists (select 1 from public.rules r join public.questionnaires q on q.id = r.questionnaire_id where q.status = 'published' and r.item_code = 'T1_RENTAL'));

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot apply', test.try($$select public.apply_catalogue_cleanup('[{"op":"replace_item","from":"T1_RENTAL","to":"PTX-120"}]')$$) like 'Only an owner%');
select test.check('staff still cannot change published rules', test.try($$update public.rules set item_code = 'PTX-120' where item_code = 'T1_RENTAL'$$) <> 'OK'
  or exists (select 1 from public.rules where item_code = 'T1_RENTAL'));

set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('a bad plan changes nothing (all or nothing)', test.try($$select public.apply_catalogue_cleanup('[{"op":"replace_item","from":"T1_RENTAL","to":"PTX-120"},{"op":"replace_item","from":"T1_STR","to":"PTX-999"}]')$$) like '%PTX-999%'
  and exists (select 1 from public.catalogue_items where code = 'T1_RENTAL'));
select test.check('owner applies the plan', test.try($$select public.apply_catalogue_cleanup('[
  {"op":"replace_item","from":"T1_BASE_SINGLE","to":"PTX-110"},
  {"op":"replace_item","from":"T1_RENTAL","to":"PTX-120"},
  {"op":"replace_item","from":"T1_STR","to":"PTX-120"},
  {"op":"replace_item","from":"T1_INVESTMENT_SALES","to":"PTX-125"},
  {"op":"set_fields","code":"PTX-125","per_spouse":true},
  {"op":"set_fields","code":"PTX-110","name":"Personal tax return (T1), single"},
  {"op":"set_fields","code":"PTX-120","unit_label":"per property","internal_note":"Includes short-term rentals."},
  {"op":"set_line","code":"PTX-110","line":"t1"},{"op":"set_line","code":"PTX-120","line":"t1"},{"op":"set_line","code":"PTX-125","line":"t1"},
  {"op":"add_item","code":"PTX-133","name":"Crypto or active trading, including options","unit_label":"per return","per_spouse":true,"sort_order":133,"line":"t1","income_account":"4020 Tax Preparation - Personal (T1)","price_type":"Fixed","price_cents":24900},
  {"op":"remove_empty_line","line":"corporate"}]')$$) = 'OK');
select test.check('rules now add the Studio items', not exists (select 1 from public.rules where item_code in ('T1_BASE_SINGLE', 'T1_RENTAL', 'T1_STR', 'T1_INVESTMENT_SALES'))
  and exists (select 1 from public.rules r join public.questionnaires q on q.id = r.questionnaire_id where q.status = 'published' and r.item_code = 'PTX-120'));
select test.check('seed items and their prices removed', not exists (select 1 from public.catalogue_items where code in ('T1_BASE_SINGLE', 'T1_RENTAL', 'T1_STR', 'T1_INVESTMENT_SALES')));
select test.check('renamed, code unchanged', (select name from public.catalogue_items where code = 'PTX-110') = 'Personal tax return (T1), single');
select test.check('per-spouse carried over', (select per_spouse from public.catalogue_items where code = 'PTX-125'));
select test.check('note moved', (select internal_note from public.catalogue_items where code = 'PTX-120') = 'Includes short-term rentals.');
select test.check('new item with its price', (select amount_cents from public.current_item_prices p join public.catalogue_items i on i.id = p.item_id where i.code = 'PTX-133') = 24900);
select test.check('empty Corporate line removed', not exists (select 1 from public.service_lines where key = 'corporate'));
select test.check('prices are permanent again after the clean-up', test.try($$delete from public.item_prices$$) <> 'OK' or exists (select 1 from public.item_prices));
select test.check('published rules locked again', test.try($$update public.rules set message = 'x'$$) <> 'OK' or not exists (select 1 from public.rules where message = 'x'));
select test.check('logged', (select count(*) from public.activity_log where entity_type in ('rules', 'catalogue_items', 'service_lines')) >= 5);
reset role;
