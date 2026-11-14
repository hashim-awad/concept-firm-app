-- Local tests: round 11 (Hashim, Nov 14, 2026), step 9: the fields ("To fill" blocks the preparer),
-- last year's Schedule 125, the MAL sent through the signing engine after the reviewer signs, signed by
-- the signing officer with a title, and withdrawn when the trial balance changes.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'prep.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Preparer C', 'prep.c@example.test', (select id from public.roles where name = 'Staff'));
reset role;
reset request.jwt.claims;
update public.role_permissions set level = 'edit' where area_key = 'closebook' and role_id = (select id from public.roles where name = 'Staff');
insert into public.clients (kind, legal_name, province) values ('corporation', 'Spruce Test Realty Inc.', 'ON') returning id as client \gset
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_create_file(:'client', '2026-12-31', '2026-01-01', '', 'full', 'client_software', '00000000-0000-0000-0000-00000000000c'::uuid, '00000000-0000-0000-0000-00000000000a'::uuid) as f \gset
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
-- Chequing 9,000; due to shareholder 1,000; dividends 2,000 (debit); commission 20,000; fees 10,000.
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb.csv', '[
  {"number":"10100","name":"Chequing","amount":9000},{"number":"26000","name":"Shareholder loan","amount":-1000},{"number":"33000","name":"Dividends","amount":2000},
  {"number":"41000","name":"Commission income","amount":-20000},{"number":"64250","name":"Accounting fees","amount":10000}]');
select public.cb_map_account(id, case number when '10100' then '1002.00' when '26000' then '2781.10' when '33000' then '3700.00' when '41000' then '8000.00' else '8862.00' end)
  from public.cb_accounts where file_id = :'f';
\set checks '[{"key":"tb","title":"TB","ok":true},{"key":"bs","title":"BS","ok":true},{"key":"ni","title":"NI","ok":true},{"key":"re","title":"RE","ok":true},{"key":"opening","title":"Opening","ok":true}]'
\set totals '{"9999":10000,"2599":9000,"amort":0,"inctax":0}'
select public.cb_record_gifi_export(:'f', 'final', 'Spruce final.gfi', '"GIFI01",""', :'totals', :'checks');
select public.cb_save_t2_tieout(:'f', 10000, 9000, 0, 0, 'files/t2.pdf');
reset role;
reset request.jwt.claims;
select test.check('step 9 before the fields: each empty one is "To fill"', private.cb_step9_problems(:'f') @> array[
  'To fill: the signing officer''s name.', 'To fill: the signing officer''s position.', 'To fill: the signing officer''s email.',
  'To fill: whether this is the corporation''s first year.', 'To fill: the shareholder loan terms.']
  and private.cb_step9_problems(:'f') @> array['Step 8 must be signed by the preparer first.']);
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_sign_step(:'f', 't2', 'prepared');
select test.check('"To fill" blocks the preparer''s sign-off', test.try(format($q$select public.cb_sign_step(%L, 'statements', 'prepared')$q$, :'f')) like 'Not yet: To fill: the signing officer''s name.%');
select test.check('a bad email is refused', test.try(format($q$select public.cb_save_fs_fields(%L, '{"officer_email":"not-an-email"}')$q$, :'f')) = 'The signing officer''s email does not look right.');
select public.cb_save_fs_fields(:'f', '{"officer_name":"Pat Dummy","officer_position":"President","officer_email":"Pat@Example.test","sh_terms":"The amount is non-interest bearing.","first_year":true,"audit_waiver":true,"related":{},"dividends":[]}');
reset role;
reset request.jwt.claims;
select test.check('the email is kept in lower case, the fields per client', (select officer_email from public.cb_client_fs_fields where client_id = :'client') = 'pat@example.test');
select test.check('the dividend line still needs its class and dates', private.cb_step9_problems(:'f') = array['To fill: the class and dates of the dividends on 3700 (Dividends declared).']
  or private.cb_step9_problems(:'f')::text like '%To fill: the class and dates of the dividends on 3700%');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_save_fs_fields(:'f', '{"officer_name":"Pat Dummy","officer_position":"President","officer_email":"pat@example.test","sh_terms":"The amount is non-interest bearing.","first_year":true,"audit_waiver":true,"related":{},
  "dividends":[{"line":"3700.00","cls":"Class A common","declared":"2026-06-30","paid":"2026-07-15"}]}');
reset role;
reset request.jwt.claims;
select test.check('all fields filled: nothing open', private.cb_step9_problems(:'f') = '{}');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_sign_step(:'f', 'statements', 'prepared');
select test.check('the MAL waits for the reviewer', test.try(format($q$select public.cb_send_mal(%L, 'MAL', repeat('x', 200), '[]')$q$, :'f')) = 'The reviewer signs step 9 first. Nothing goes to the client before that.');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.cb_sign_step(:'f', 'statements', 'reviewed');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('the MAL needs its document', test.try(format($q$select public.cb_send_mal(%L, 'MAL', 'short', '[]')$q$, :'f')) = 'The MAL could not be built.');
select public.cb_send_mal(:'f', 'Management Responsibility Acknowledgement', '<p>' || repeat('MAL text ', 30) || '{{DATE}}</p>', '[{"text":"MAL"}]') as mal \gset
select test.check('only one MAL out at a time', test.try(format($q$select public.cb_send_mal(%L, 'MAL', repeat('x', 200), '[]')$q$, :'f')) = 'The MAL is already out for signing.');
select test.check('the step shows the MAL sent, with its signing link', (public.cb_fs_status(:'f') ->> 'mal_status') = 'sent' and length(public.cb_fs_status(:'f') ->> 'mal_token') = 64
  and (public.cb_fs_status(:'f') ->> 'mal_email') = 'pat@example.test');
reset role;
reset request.jwt.claims;
select test.check('the MAL is a letter for the signing officer, kept out of Engagement letters',
  (select kind = 'letter' and details ->> 'doc_kind' = 'cb_mal' and status = 'sent' from public.quotes where id = :'mal')
  and (select first_name = 'Pat' and last_name = 'Dummy' from public.quote_signers where quote_id = :'mal'));
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('not in the Engagement letters list or its badge', not exists (select 1 from public.letter_list() where id = :'mal') and public.letters_waiting_count() = 0);
reset role;
reset request.jwt.claims;

-- Signing: the officer's title is required, as on a company letter; the file's history records it.
-- (Called as the server does, with the server key: here, without a role.)
select test.check('the signing officer gives a title', test.try(format($q$select public.record_t1_signature(%L, 0, 'Pat Dummy', '127.0.0.1', 'test', repeat('a', 64), false, '', null)$q$, :'mal')) = 'Type your title at the company to sign.');
select public.record_t1_signature(:'mal', 0, 'Pat Dummy', '127.0.0.1', 'test', repeat('a', 64), false, 'President', null);
select test.check('signed: the signature is kept with its title, and no engagement is created',
  (select signed_title from public.quote_signers where quote_id = :'mal') = 'President' and (select status from public.quotes where id = :'mal') = 'signed'
  and not exists (select 1 from public.engagements where quote_id = :'mal')
  and exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'mal_signed' and detail = 'MAL signed by Pat Dummy, President'));

-- A trial balance change after the MAL is sent withdraws it; the package goes back to draft.
-- (A second MAL, to test the withdrawal: the signed one is set aside here by hand.)
update public.cb_file_fs set mal_quote_id = null where file_id = :'f';
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select public.cb_send_mal(:'f', 'Management Responsibility Acknowledgement', '<p>' || repeat('MAL text ', 30) || '{{DATE}}</p>', '[{"text":"MAL"}]') as mal2 \gset
select public.cb_import_tb(:'f', 'this_year', 'client_software', 'tb2.csv', '[
  {"number":"10100","name":"Chequing","amount":9500},{"number":"26000","name":"Shareholder loan","amount":-1000},{"number":"33000","name":"Dividends","amount":2000},
  {"number":"41000","name":"Commission income","amount":-20500},{"number":"64250","name":"Accounting fees","amount":10000}]');
reset role;
reset request.jwt.claims;
select test.check('the MAL is withdrawn: its link says so', (select status from public.quotes where id = :'mal2') = 'withdrawn'
  and (select mal_quote_id is null and mal_withdrawn_quote = :'mal2'::uuid from public.cb_file_fs where file_id = :'f'));
select test.check('step 9 reopens: its sign-offs are cleared', not exists (select 1 from public.cb_step_signoffs where file_id = :'f' and step = 'statements' and (prepared_at is not null or reviewed_at is not null)));
select test.check('the history names the withdrawal', exists (select 1 from public.cb_file_history where file_id = :'f' and action = 'mal_withdrawn'));

-- Last year's Schedule 125: only revenue and expense codes.
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('a balance sheet code is not a Schedule 125 line', test.try(format($q$select public.cb_save_opening_s125(%L, '[{"code":"1002","amount":5}]')$q$, :'f')) = 'GIFI 1002 is not a Schedule 125 line.');
select public.cb_save_opening_s125(:'f', '[{"code":"8000","amount":18000},{"code":"8862","amount":9000},{"code":"8871","amount":0}]');
reset role;
reset request.jwt.claims;
select test.check('Schedule 125 saved, zero lines dropped', (select count(*) from public.cb_opening_s125 where file_id = :'f') = 2);
