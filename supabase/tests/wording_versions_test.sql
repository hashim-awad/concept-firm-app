-- Local tests: wording versions (draft, owner approval, current, revert, permanence).
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test',
  (select id from public.roles where name = 'Staff'));
select test.check('original EL v3.31 is current', (public.current_wording() ->> 'label') = 'EL v3.31');
select test.check('owner starts a draft', test.try($$select public.start_wording_draft('EL v3.32')$$) = 'OK');
select test.check('only one draft at a time', test.try($$select public.start_wording_draft('EL v3.33')$$) like 'A draft already exists%');
select test.check('draft text saved', test.try($$insert into public.wording_texts (version_id, key, text) select id, 'w0123456789', 'Sincerely,' from public.wording_versions where label = 'EL v3.32'$$) = 'OK');
select test.check('draft not used before approval', (public.current_wording() ->> 'label') = 'EL v3.31');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('staff (no wording edit) cannot approve', test.try($$select public.approve_wording((select id from public.wording_versions where label = 'EL v3.32'))$$) like 'Only an owner%');
select test.check('staff cannot change texts', test.try($$update public.wording_texts set text = 'x'$$) = 'OK' and (select text from public.wording_texts limit 1) = 'Sincerely,');
select test.check('staff cannot fake approval by update', test.try($$update public.wording_versions set status = 'approved', is_current = true where label = 'EL v3.32'$$) = 'OK'
  and (select status from public.wording_versions where label = 'EL v3.32') = 'draft');
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select test.check('owner cannot approve by a direct update either', test.try($$update public.wording_versions set status = 'approved' where label = 'EL v3.32'$$) like 'Only an owner approves%');
select test.check('owner approves', test.try($$select public.approve_wording((select id from public.wording_versions where label = 'EL v3.32'))$$) = 'OK');
select test.check('approved version is current, with its edit', (public.current_wording() ->> 'label') = 'EL v3.32' and (public.current_wording() -> 'texts' ->> 'w0123456789') = 'Sincerely,');
select test.check('approved wording cannot change', test.try($$update public.wording_texts set text = 'Regards,'$$) like '%cannot be changed%');
select test.check('approved version cannot be deleted', test.try($$delete from public.wording_versions where label = 'EL v3.32'$$) like '%kept as a record%');
select test.check('revert needs a reason', test.try($$select public.make_wording_current((select id from public.wording_versions where label = 'EL v3.31'), '')$$) like 'Give the reason%');
select test.check('owner makes the original current again', test.try($$select public.make_wording_current((select id from public.wording_versions where label = 'EL v3.31'), 'Client feedback on the new closing')$$) = 'OK');
select test.check('original current again', (public.current_wording() ->> 'label') = 'EL v3.31');
select test.check('next draft copies the current version', test.try($$select public.start_wording_draft('EL v3.33')$$) = 'OK'
  and not exists (select 1 from public.wording_texts t join public.wording_versions v on v.id = t.version_id where v.label = 'EL v3.33'));
select test.check('a draft can be deleted', test.try($$delete from public.wording_versions where label = 'EL v3.33'$$) = 'OK');
select test.check('changes are logged', (select count(*) from public.activity_log where entity_type in ('wording_versions', 'wording_texts')) >= 5);
reset role;
