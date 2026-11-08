-- Local tests for the price book, questionnaires and rules.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
reset role;

select test.check('RLS on for every public table',
  not exists (select 1 from pg_tables where schemaname = 'public' and not rowsecurity));
select test.check('16 T1 items seeded', (select count(*) from public.catalogue_items) = 16);
select test.check('every item has a current price',
  (select count(*) from public.current_item_prices) = 16);
select test.check('single return is $299.00',
  (select p.amount_cents from public.current_item_prices p join public.catalogue_items i on i.id = p.item_id
   where i.code = 'T1_BASE_SINGLE') = 29900);
select test.check('personal v1 published', exists (
  select 1 from public.questionnaires where route = 'personal' and version = 1 and status = 'published'));
select test.check('corporate v1 is a draft', exists (
  select 1 from public.questionnaires where route = 'corporate' and version = 1 and status = 'draft'));

-- Staff role: view only
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff can read prices', (select count(*) from public.current_item_prices) = 16);
select test.check('staff cannot add a price', test.try($$insert into public.item_prices (item_id, amount_cents, effective_from)
  select id, 1, date '2027-01-01' from public.catalogue_items where code = 'T1_MOVING'$$) like '%row-level security%');
select test.check('staff cannot add an item', test.try($$insert into public.catalogue_items (service_line_id, code, name)
  select id, 'X_TEST', 'x' from public.service_lines where key = 't2'$$) like '%row-level security%');
select test.check('staff cannot create a draft', test.try($$select public.create_questionnaire_draft('personal')$$) like 'You do not have permission%');

-- Owner
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner adds a future price', test.try($$insert into public.item_prices (item_id, amount_cents, effective_from)
  select id, 15900, date '2099-01-01' from public.catalogue_items where code = 'T1_MOVING'$$) = 'OK');
select test.check('future price not yet current',
  (select p.amount_cents from public.current_item_prices p join public.catalogue_items i on i.id = p.item_id
   where i.code = 'T1_MOVING') = 14900);
select test.check('prices cannot be changed', test.try($$update public.item_prices set amount_cents = 1$$) like '%permission denied%'
  or test.try($$update public.item_prices set amount_cents = 1$$) like '%never changed%');
select test.check('created_by stamped', (select created_by from public.item_prices where effective_from = '2099-01-01')
  = '00000000-0000-0000-0000-00000000000a');
select test.check('owner adds a T2 item', test.try($$insert into public.catalogue_items (service_line_id, code, name, unit_label)
  select id, 'T2_TEST', 'Test T2 item', 'per return' from public.service_lines where key = 't2'$$) = 'OK');
select test.check('item code cannot change', test.try($$update public.catalogue_items set code = 'T2_OTHER' where code = 'T2_TEST'$$) like '%permission denied%'
  or test.try($$update public.catalogue_items set code = 'T2_OTHER' where code = 'T2_TEST'$$) like '%cannot be changed%');
select test.check('item can be renamed', test.try($$update public.catalogue_items set name = 'Renamed' where code = 'T2_TEST'$$) = 'OK');

select test.check('published questions cannot change', test.try($$update public.questions set prompt = 'x'
  where questionnaire_id = (select id from public.questionnaires where route = 'personal' and status = 'published')$$) like 'Only a draft%');
select test.check('published rules cannot be deleted', test.try($$delete from public.rules
  where questionnaire_id = (select id from public.questionnaires where route = 'personal' and status = 'published')$$) like 'Only a draft%');
select test.check('owner creates personal draft', test.try($$select public.create_questionnaire_draft('personal')$$) = 'OK');
select test.check('only one draft per route', test.try($$select public.create_questionnaire_draft('personal')$$) like 'A draft already exists%');
select test.check('draft copied questions and rules',
  (select count(*) from public.questions q join public.questionnaires n on n.id = q.questionnaire_id where n.route = 'personal' and n.status = 'draft') = 20
  and (select count(*) from public.rules r join public.questionnaires n on n.id = r.questionnaire_id where n.route = 'personal' and n.status = 'draft') = 22);
select test.check('draft question can change', test.try($$update public.questions set prompt = 'Who is filing this year?'
  where key = 'filing_type' and questionnaire_id = (select id from public.questionnaires where route = 'personal' and status = 'draft')$$) = 'OK');
select test.check('cannot move a question into the published version', test.try($$update public.questions
  set questionnaire_id = (select id from public.questionnaires where route = 'personal' and status = 'published')
  where key = 'province' and questionnaire_id = (select id from public.questionnaires where route = 'personal' and status = 'draft')$$) like 'Only a draft%');
select test.check('draft accepts a new rule', test.try($$insert into public.rules (questionnaire_id, kind, conditions, message)
  select id, 'check', '[{"question":"nope","op":"eq","value":1}]', 'x' from public.questionnaires where route = 'personal' and status = 'draft'$$) = 'OK');
select test.check('broken rule is reported', array_to_string(public.questionnaire_problems((select id from public.questionnaires where route = 'personal' and status = 'draft')), ' ')
      like '%"nope", which does not exist%');
select test.check('publish refused while broken', test.try($$select public.publish_questionnaire(
  (select id from public.questionnaires where route = 'personal' and status = 'draft'))$$) like 'Fix these first%');
delete from public.rules where conditions @> '[{"question":"nope"}]';
select test.check('publish works', test.try($$select public.publish_questionnaire(
  (select id from public.questionnaires where route = 'personal' and status = 'draft'))$$) = 'OK');
select test.check('old version retired, new one published',
  (select status from public.questionnaires where route = 'personal' and version = 1) = 'retired'
  and (select status from public.questionnaires where route = 'personal' and version = 2) = 'published');
select test.check('corporate draft cannot publish without prices', test.try($$select public.publish_questionnaire(
  (select id from public.questionnaires where route = 'corporate' and status = 'draft'))$$) like '%No rule adds a price%');
select test.check('published version cannot be deleted', test.try($$select public.delete_questionnaire_draft(
  (select id from public.questionnaires where route = 'personal' and status = 'published'))$$) like 'Draft not found%');
reset role;
select test.check('price changes are logged', exists (select 1 from public.activity_log where entity_type = 'item_prices' and actor_id is not null));
select test.check('publishing is logged', exists (select 1 from public.activity_log where entity_type = 'questionnaires' and action = 'update'));
