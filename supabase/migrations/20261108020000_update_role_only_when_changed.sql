-- Saving a role without changing its name or description no longer writes an
-- empty "role updated" entry to the activity log.
create or replace function public.update_role(p_role_id uuid, p_name text, p_description text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can change roles.');
  perform private.require(exists (select 1 from public.roles where id = p_role_id), 'Role not found.');
  update public.roles set name = btrim(p_name), description = coalesce(btrim(p_description), '')
  where id = p_role_id
    and (name is distinct from btrim(p_name) or description is distinct from coalesce(btrim(p_description), ''));
end;
$$;
