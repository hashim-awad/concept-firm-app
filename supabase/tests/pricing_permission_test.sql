-- Local tests: the Pricing permission (Phase 2 batch, section 2). Staff without Pricing see no prices
-- anywhere (price book prices, packages, proposals, document versions, engagement fees); owners do.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));

-- Made-up data, entered by the owner.
insert into public.catalogue_items (service_line_id, code, name, unit_label, price_type)
select id, 'PTX-110', 'Personal tax return (T1), single', 'per return', 'Fixed' from public.service_lines where key = 't1';
insert into public.item_prices (item_id, amount_cents, effective_from) select id, 29900, '2026-11-01' from public.catalogue_items where code = 'PTX-110';
insert into public.offers (offer, segment, is_package, monthly_fee, annual_floor) values ('Team: Core', 'Team or brokerage', true, 2400, 28800);
insert into public.clients (id, kind, legal_name) values ('00000000-0000-0000-0000-0000000000c1', 'corporation', 'Dummy Co Ltd');
insert into public.engagements (id, client_id, title, type, fee, letter_data)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 'Dummy Co Ltd FYE 2026-12-31', 'T2 only', 2800, '{"fees": [2800]}');
insert into public.proposals (title, client_id, options_data) values ('Dummy proposal', '00000000-0000-0000-0000-0000000000c1', '{"o": [{"n": "Core", "p": 2400}]}');

select test.check('owner has Pricing', private.can_edit('pricing'));
select test.check('owner reads prices', (select count(*) from public.item_prices) > 0);
select test.check('owner reads engagement fees', (select fee from public.engagement_fees('00000000-0000-0000-0000-0000000000e1')) = 2800);
select test.check('owner reads proposals', (select count(*) from public.proposals) = 1);

-- Staff role: documents edit, no Pricing (the default for every role except Owner).
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff has no Pricing', not private.can_view('pricing') and private.can_edit('documents'));
select test.check('staff sees item names', (select count(*) from public.catalogue_items where code = 'PTX-110') = 1);
select test.check('staff sees no prices', (select count(*) from public.item_prices) = 0 and (select count(*) from public.current_item_prices) = 0);
select test.check('staff sees no packages or floors', (select count(*) from public.offers) = 0);
select test.check('staff sees no proposals', (select count(*) from public.proposals) = 0);
select test.check('staff sees the engagement and its status', (select status from public.engagements where id = '00000000-0000-0000-0000-0000000000e1') = 'EL drafted');
select test.check('staff cannot read the fee column', test.try($$select fee from public.engagements$$) <> 'OK');
select test.check('staff cannot read the letter inputs', test.try($$select letter_data from public.engagements$$) <> 'OK');
select test.check('engagement_fees gives staff nothing', (select count(*) from public.engagement_fees()) = 0);
select test.check('staff cannot add a price', test.try($$insert into public.item_prices (item_id, amount_cents, effective_from) select id, 1, '2026-12-01' from public.catalogue_items where code = 'PTX-110'$$) <> 'OK');
select test.check('staff cannot add a package', test.try($$insert into public.offers (offer, segment) values ('X', 'Agent')$$) <> 'OK');
select test.check('staff cannot add a document version', test.try($$insert into public.documents (kind, title, client_id) values ('corporate_letter', 'EL', '00000000-0000-0000-0000-0000000000c1')$$) = 'OK'
  and test.try($$insert into public.document_versions (document_id, version, mode, inputs, file_path, file_name, file_sha256, file_size)
    select id, 1, 'draft', '{}', 'x/1.pdf', 'a.pdf', repeat('a', 64), 10 from public.documents$$) <> 'OK');
select test.check('staff still sees the document in the list', (select count(*) from public.documents) = 1);
select test.check('staff can still update an engagement status', test.try($$update public.engagements set status = 'EL sent' where id = '00000000-0000-0000-0000-0000000000e1'$$) = 'OK');

-- An owner can give Pricing to the Staff role; it then applies at once.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.set_role_permissions((select id from public.roles where name = 'Staff'), '{"pricing": "view"}');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('with Pricing view, staff reads prices', (select count(*) from public.item_prices) > 0 and (select count(*) from public.engagement_fees()) = 1);
select test.check('view is not edit', test.try($$insert into public.offers (offer, segment) values ('Y', 'Agent')$$) <> 'OK');
reset role;
