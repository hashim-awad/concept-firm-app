-- Round 36b (Hashim, Nov 17, 2026): the left menus fold like TaxDome's, and each person's choice is kept
-- across pages and sign-ins. One row per person: is the main menu pinned (open), is the steps panel pinned.
-- menu_pinned is empty until the person first uses the pin: until then the menu works as before (open on
-- most pages, folded to icons inside a Closebook file). A table of its own, so a click on the pin is not
-- logged as a change to the person's staff record.
-- Each person reads and changes only their own row. Never drops a table or column. Safe to run twice.

create table if not exists public.staff_ui_prefs (
  staff_id uuid primary key references public.staff (id) on delete cascade,
  menu_pinned boolean,
  steps_pinned boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.staff_ui_prefs enable row level security;
alter table public.staff_ui_prefs force row level security;
drop policy if exists "Own menu choices" on public.staff_ui_prefs;
create policy "Own menu choices" on public.staff_ui_prefs for select to authenticated using (staff_id = (select auth.uid()));
grant select on public.staff_ui_prefs to authenticated;

-- Pin or unpin one menu ('menu' or 'steps') for the person signed in.
create or replace function public.set_my_menu_pin(p_menu text, p_pinned boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require((select auth.uid()) is not null and exists (select 1 from public.staff where id = (select auth.uid()) and is_active), 'Sign in first.');
  perform private.require(p_menu in ('menu', 'steps') and p_pinned is not null, 'Unknown menu.');
  insert into public.staff_ui_prefs (staff_id, menu_pinned, steps_pinned)
  values ((select auth.uid()), case when p_menu = 'menu' then p_pinned end, case when p_menu = 'steps' then p_pinned else true end)
  on conflict (staff_id) do update
    set menu_pinned = case when p_menu = 'menu' then p_pinned else public.staff_ui_prefs.menu_pinned end,
        steps_pinned = case when p_menu = 'steps' then p_pinned else public.staff_ui_prefs.steps_pinned end,
        updated_at = now();
end;
$$;
revoke all on function public.set_my_menu_pin(text, boolean) from public, anon;
grant execute on function public.set_my_menu_pin(text, boolean) to authenticated;
