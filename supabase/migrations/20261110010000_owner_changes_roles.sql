-- Only owners change a person's role (Hashim, Nov 10, 2026, decision 48). Everyone still edits their
-- own phone (update_staff_phone, unchanged). Staff-account editors can still invite people and switch
-- accounts on or off, within their own access.
create or replace function public.set_staff_role(p_staff_id uuid, p_role_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current_role uuid;
begin
  perform private.require(private.is_owner(), 'Only an owner can change roles.');
  perform private.require(p_staff_id <> (select auth.uid()), 'You cannot change your own role.');
  select role_id into v_current_role from public.staff where id = p_staff_id;
  perform private.require(v_current_role is not null, 'Staff member not found.');
  perform private.require(private.role_within_caller(v_current_role),
    'You cannot change the role of someone with more access than you.');
  perform private.require(private.role_within_caller(p_role_id),
    'You can only give a role that does not go beyond your own access.');
  update public.staff set role_id = p_role_id where id = p_staff_id;
end;
$$;
revoke all on function public.set_staff_role(uuid, uuid) from public, anon;
grant execute on function public.set_staff_role(uuid, uuid) to authenticated;
