-- Local tests: T1 screening version 2, PTX-100 and lead quotes (Phase 2 step 6).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing":"none","leads":"view","price_book":"view"}');
reset role;
reset request.jwt.claims;

-- PTX-100 is in every database, invoice only, with no price.
select test.check('PTX-100 is invoice only', (select price_type from public.catalogue_items where code = 'PTX-100') = 'Invoice only');
select test.check('PTX-100 has no price', not exists (select 1 from public.item_prices p join public.catalogue_items i on i.id = p.item_id where i.code = 'PTX-100'));
select test.check('PTX-100 goes to QBO 4020', (select income_account from public.catalogue_items where code = 'PTX-100') like '4020%');

-- A new database has no PTX price book, so version 2 is not published by the migration.
select test.check('nothing published from an empty price book', not exists (select 1 from public.questionnaires where title = 'Your personal tax return'));
select id as old_pub from public.questionnaires where route = 'personal' and status = 'published' \gset

-- Load the section 4 price book (dummy test database), but one price wrong.
insert into public.catalogue_items (service_line_id, code, name, unit_label, sort_order)
select (select id from public.service_lines where key = 't1'), code, code, 'each', 0
from (values ('PTX-110'), ('PTX-111'), ('PTX-120'), ('PTX-121'), ('PTX-122'), ('PTX-123'), ('PTX-124'), ('PTX-125'), ('PTX-126'),
             ('PTX-127'), ('PTX-128'), ('PTX-129'), ('PTX-130'), ('PTX-131'), ('PTX-132'), ('PTX-133'), ('PTX-134'), ('PTX-135'), ('PTX-136')) v(code);
insert into public.item_prices (item_id, amount_cents, effective_from)
select i.id, v.cents, '2026-01-01' from public.catalogue_items i join (values
  ('PTX-110', 29900), ('PTX-111', 34900), ('PTX-120', 24900), ('PTX-121', 49900), ('PTX-122', 15000), ('PTX-123', 15000), ('PTX-124', 14900),
  ('PTX-125', 9900), ('PTX-126', 9900), ('PTX-127', 24900), ('PTX-128', 14900), ('PTX-129', 29900), ('PTX-130', 14900), ('PTX-131', 14900),
  ('PTX-132', 14900), ('PTX-133', 24900), ('PTX-134', 14900), ('PTX-135', 79900), ('PTX-136', 25000)) v(code, cents) on v.code = i.code;

select test.check('refused when the price book differs from section 4',
  test.try($$select private.publish_t1_screening()$$) like '%PTX-136: price book 250%batch 249%');

-- Fix the price (a new price from today), then publish.
insert into public.item_prices (item_id, amount_cents, effective_from)
select id, 24900, private.today() from public.catalogue_items where code = 'PTX-136';
select private.publish_t1_screening() as v2 \gset
select test.check('version 2 published', (select status from public.questionnaires where id = :'v2') = 'published');
select test.check('the previous version retired', (select status from public.questionnaires where id = :'old_pub') = 'retired');
select test.check('37 questions and 30 rules', (select count(*) from public.questions where questionnaire_id = :'v2') = 37
  and (select count(*) from public.rules where questionnaire_id = :'v2') = 30);

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('version 2 passes the screening checks', coalesce(array_length(public.questionnaire_problems(:'v2'), 1), 0) = 0);

-- A draft that adds PTX-100 is refused.
select public.create_questionnaire_draft('personal') as d \gset
insert into public.rules (questionnaire_id, kind, conditions, item_code, message, sort_order)
values (:'d', 'add_item', '[{"question":"filing_type","op":"eq","value":"single"}]', 'PTX-100', '', 999);
select test.check('a rule adding PTX-100 is a problem', array_to_string(public.questionnaire_problems(:'d'), ' ') like '%PTX-100, which is an invoice-only item%');
select public.delete_questionnaire_draft(:'d');
reset role;
reset request.jwt.claims;

-- A personal draft blocks publishing from the migration (clear message, nothing changes).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.create_questionnaire_draft('personal') as d2 \gset
reset role;
reset request.jwt.claims;
select test.check('a personal draft blocks publishing', test.try($$select private.publish_t1_screening()$$) like '%a personal draft exists%');

-- Lead quotes: Pricing holders only.
insert into public.settings (key, value) values ('start_page_open', 'true') on conflict (key) do update set value = 'true';
set role anon;
select public.submit_lead('personal', '{"first_name":"Jane","last_name":"Dummy","email":"jane@example.test","phone":"519-555-0100","province":"ON"}', '{}', repeat('c', 64)) as lead \gset
reset role;
set role service_role;
insert into public.lead_quotes (lead_id, questionnaire_id, lines, subtotal_cents) values (:'lead', :'v2', '[{"code":"PTX-110","total_cents":29900}]', 29900);
update public.leads set status = 'out_of_scope', source = 'Referral' where id = :'lead';
reset role;
select test.check('the server set status and source', (select status || ' ' || source from public.leads where id = :'lead') = 'out_of_scope Referral');

set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner reads the quote', (select subtotal_cents from public.lead_quotes where lead_id = :'lead') = 29900);
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff without Pricing see no quote', (select count(*) from public.lead_quotes) = 0);
select test.check('staff cannot write quotes', test.try($$insert into public.lead_quotes (lead_id, subtotal_cents) values (gen_random_uuid(), 1)$$) <> 'OK');
reset role;
reset request.jwt.claims;
set role anon;
select test.check('the public cannot read quotes', test.try($$select count(*) from public.lead_quotes$$) <> 'OK');
reset role;

-- The owner button: staff cannot use it; for an owner it gives the same checks (a draft exists here).
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff cannot use the publish button', test.try($$select public.publish_t1_screening_now()$$) like 'Only an owner%');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner sees the exact reason', test.try($$select public.publish_t1_screening_now()$$) like '%a personal draft exists%');
reset role;
reset request.jwt.claims;
