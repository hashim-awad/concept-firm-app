-- Local tests: round 36b (Hashim, Nov 17, 2026): each person's menu pins (main menu, steps panel), kept per
-- person. A person reads and changes only their own. Dummy data only.
\set ON_ERROR_STOP 1
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner.a@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'staff.c@example.test');
select private.bootstrap_owner('owner.a@example.test', 'Test Owner A');
set role authenticated;
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000a"}';
select public.add_staff('00000000-0000-0000-0000-00000000000c', 'Test Staff C', 'staff.c@example.test', (select id from public.roles where name = 'Staff'));

-- ---------- Never chosen: no row (the app uses the old behaviour for the menu, the steps panel pinned).
select test.check('no choice yet', not exists (select 1 from public.staff_ui_prefs));

-- ---------- The owner unpins the main menu: kept; the steps panel stays pinned.
select public.set_my_menu_pin('menu', false);
select test.check('main menu unpinned; steps panel pinned', (select menu_pinned = false and steps_pinned from public.staff_ui_prefs where staff_id = '00000000-0000-0000-0000-00000000000a'));
select public.set_my_menu_pin('steps', false);
select test.check('steps panel unpinned; the main menu choice kept', (select menu_pinned = false and not steps_pinned from public.staff_ui_prefs where staff_id = '00000000-0000-0000-0000-00000000000a'));
select public.set_my_menu_pin('menu', true);
select test.check('main menu pinned again; one row per person', (select count(*) = 1 and bool_and(menu_pinned and not steps_pinned) from public.staff_ui_prefs));
select test.check('an unknown menu is refused', test.try($q$select public.set_my_menu_pin('other', true)$q$) = 'Unknown menu.');

-- ---------- Another person: their own row; they never see or change the owner's.
set request.jwt.claims = '{"sub":"00000000-0000-0000-0000-00000000000c"}';
select test.check('another person sees no one else''s choices', (select count(*) = 0 from public.staff_ui_prefs));
select public.set_my_menu_pin('steps', false);
select test.check('their own choice: steps unpinned, main menu never chosen', (select count(*) = 1 and bool_and(menu_pinned is null and not steps_pinned) from public.staff_ui_prefs));
select test.check('no direct writes', test.try($q$update public.staff_ui_prefs set menu_pinned = false$q$) like '%permission denied%');
reset role;
select test.check('the owner''s row is unchanged', (select menu_pinned and not steps_pinned from public.staff_ui_prefs where staff_id = '00000000-0000-0000-0000-00000000000a'));
set role anon;
select test.check('anon cannot pin', test.try($q$select public.set_my_menu_pin('menu', true)$q$) like '%permission denied%');
reset role;
