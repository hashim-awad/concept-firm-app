-- Test database repair (Hashim, Nov 18, 2026): adds the columns and tables the earlier migrations create but the Test
-- database lacks (it ran earlier versions of those migrations). Read-only check on Nov 18, 2026: Test lacked 30
-- columns (17 in existing tables, 2 whole tables); Live lacked none. Each statement below is copied from the migration
-- that first created it and only adds what is missing, so on Live (and local) nothing changes. No data is changed.
-- No table or column is dropped. Safe to run twice.

-- Round 9 (20261127000000): the reviewer's acceptance of the GST/HST and T4A differences.
alter table public.cb_revenue_checks add column if not exists gst_accepted_by uuid references public.staff (id);
alter table public.cb_revenue_checks add column if not exists gst_accepted_at timestamptz;
alter table public.cb_revenue_checks add column if not exists gst_accepted_diff numeric(14, 2);
alter table public.cb_revenue_checks add column if not exists t4a_accepted_by uuid references public.staff (id);
alter table public.cb_revenue_checks add column if not exists t4a_accepted_at timestamptz;
alter table public.cb_revenue_checks add column if not exists t4a_accepted_diff numeric(14, 2);

-- Round 10 (20261129000000): the side confirmation on accounts, and the T2 rounding setting.
alter table public.cb_accounts add column if not exists side_confirm_reason text check (side_confirm_reason is null or length(side_confirm_reason) <= 300);
alter table public.cb_accounts add column if not exists side_confirmed_line text;
alter table public.cb_accounts add column if not exists side_confirmed_by uuid references public.staff (id);
alter table public.cb_accounts add column if not exists side_confirmed_at timestamptz;
alter table public.cb_settings add column if not exists t2_rounding numeric(12, 2) not null default 5;
do $$ begin
  alter table public.cb_settings add constraint cb_settings_t2_rounding_check check (t2_rounding between 0 and 1000);
exception when duplicate_object then null; end $$;

-- Round 13 (20261202000000): entries counted as GST/HST instalments.
alter table public.cb_gst_check add column if not exists instalment_entries uuid[] not null default '{}';

-- Round 16 (20261206000000): the reviewer's choice on last year's shareholder loan part, and the decided amounts.
alter table public.cb_sh_flags add column if not exists accepted_kind text not null default '';
alter table public.cb_sh_flags add column if not exists accepted_year int;
do $$ begin
  alter table public.cb_sh_flags add constraint cb_sh_flags_accepted_kind check (accepted_kind in ('', 'included', 'not_included'));
exception when duplicate_object then null; end $$;
alter table public.cb_sh_groups add column if not exists decided jsonb not null default '[]';

-- Round 32 (20261212090000, 20261212100000): the client question link's lock columns, codes and sessions. No longer used
-- by the app (20261212110000) but kept, so every database has the same tables and columns.
alter table public.cb_question_links add column if not exists failed_codes int not null default 0;
alter table public.cb_question_links add column if not exists locked_until timestamptz;
create table if not exists public.cb_question_codes (
  id          uuid primary key default gen_random_uuid(),
  link_id     uuid not null references public.cb_question_links(id) on delete cascade,
  email       text not null,
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz
);
alter table public.cb_question_codes enable row level security;
alter table public.cb_question_codes force row level security;
create table if not exists public.cb_question_sessions (
  id            uuid primary key default gen_random_uuid(),
  link_id       uuid not null references public.cb_question_links(id) on delete cascade,
  session_hash  text not null unique,
  email         text not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
alter table public.cb_question_sessions enable row level security;
alter table public.cb_question_sessions force row level security;
grant update (failed_codes, locked_until) on public.cb_question_links to service_role;
-- The server key's rights on the two tables, as Live has them after every migration (select, insert, update, delete).
revoke all on public.cb_question_codes, public.cb_question_sessions from service_role;
grant select, insert, update, delete on public.cb_question_codes, public.cb_question_sessions to service_role;
