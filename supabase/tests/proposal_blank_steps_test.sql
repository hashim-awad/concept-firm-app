-- Local tests: a proposal Next steps line may be blank; other wording may not.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.start_wording_draft('EL v9.01') as v \gset
select test.check('a Next steps line can be saved blank', test.try(format($f$insert into public.wording_texts (version_id, key, text) values (%L, 'w5725499754', '')$f$, :'v')) = 'OK');
select test.check('other wording cannot be blank', test.try(format($f$insert into public.wording_texts (version_id, key, text) values (%L, 'w11fc14203d', '  ')$f$, :'v')) <> 'OK');
