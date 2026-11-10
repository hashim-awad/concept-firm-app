-- Lead alerts (step 5): the server reads the lead and the business hours to build the alert email
-- and the timer. Read only. Nothing new is opened to signed-in staff or the public.
grant select on public.leads to service_role;
grant select on public.settings to service_role;
