-- Monthly company leads (Phase 2 step 10, batch section 12, decision 41). The form does not ask
-- whether a real estate client is a single agent or a team, so staff mark it on the lead. Empty means
-- not marked yet (Studio shows its guess from the business-type answer).
alter table public.leads add column client_kind text check (client_kind in ('agent', 'team', 'other'));
