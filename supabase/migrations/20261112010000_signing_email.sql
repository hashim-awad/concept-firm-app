-- Signing emails sent from Studio (Hashim, Nov 12, 2026): through Microsoft 365, from the issuing
-- person's own mailbox. One switch per path; New letters first, quotes and proposals after testing.
-- The Copy buttons stay as the fallback when sending is off or fails.

insert into public.settings (key, value) values ('signing_email', '{"letters": false, "quotes": false, "proposals": false}')
on conflict (key) do nothing;

create or replace function public.set_signing_email(p_letters boolean, p_quotes boolean, p_proposals boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can change how signing emails are sent.');
  insert into public.settings (key, value) values ('signing_email', jsonb_build_object('letters', coalesce(p_letters, false), 'quotes', coalesce(p_quotes, false), 'proposals', coalesce(p_proposals, false)))
  on conflict (key) do update set value = excluded.value;
end;
$$;
revoke all on function public.set_signing_email(boolean, boolean, boolean) from public, anon;
grant execute on function public.set_signing_email(boolean, boolean, boolean) to authenticated;

-- Which paths send from Studio (any active staff may read it; it holds no client data).
create or replace function public.signing_email_settings()
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when private.is_active_staff() then coalesce((select value from public.settings where key = 'signing_email'), '{}'::jsonb) else '{}'::jsonb end
$$;
revoke all on function public.signing_email_settings() from public, anon;
grant execute on function public.signing_email_settings() to authenticated, service_role;

-- What happened when the email was sent: {at, from, to, ok, error}. The server records it.
create or replace function public.record_quote_email(p_id uuid, p_result jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.quotes set details = coalesce(details, '{}'::jsonb) || jsonb_build_object('email', p_result) where id = p_id;
end;
$$;
revoke all on function public.record_quote_email(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_quote_email(uuid, jsonb) to service_role;
