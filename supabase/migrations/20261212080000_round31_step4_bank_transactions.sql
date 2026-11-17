-- Round 31, step 4 (Hashim, Nov 17, 2026): Code transactions rebuilt as QuickBooks Online's "Bank transactions" page
-- (Pending, Posted, Excluded). Benchmark: QuickBooks Online. Safe to run twice.
--
-- What changes in the data:
-- - A Pending line can hold an account, a sales tax code, a transfer account or a split and still post nothing.
--   Nothing posts until the line is posted (status 'done', or 'reviewer' when it goes to the reviewer).
-- - "Ask client" is a flag on a Pending line (asked_at, the question, the client's answer), not a status. The lines
--   on the client's question list today ('ask_client') become Pending lines with the flag. Before this round a line on
--   the list with an account posted; from now on it posts only once someone posts it.
-- - A line can be excluded on its own (status 'excluded', with a reason); the Excluded tab lists it and Undo restores it.
-- - Transfers: a line can be posted to another of the file's accounts with no line on the other side yet
--   (transfer_account). A pair posts one entry from its money-out line; the other side is 'matched' and posts nothing.
--   A line that arrives later for a transfer already posted is matched to it with no second entry.
-- - Pair choices: the pair a person picked among several, and the pairs a person unpaired (never suggested again).
-- - Splits: a line split into rows of account, sales tax, amount and memo.
-- - Receipts attached to a line.
-- - Bank rules (the client's, in priority order) replace the vendor rules, which are copied in.
-- - The step 4 sign-off lists the excluded lines until the reviewer ticks "Excluded lines reviewed".

-- ---------- 1. Lines
alter table public.cb_bank_lines add column if not exists asked_at timestamptz;
alter table public.cb_bank_lines add column if not exists asked_by uuid references public.staff(id);
alter table public.cb_bank_lines add column if not exists client_question text not null default '';
alter table public.cb_bank_lines add column if not exists client_answer text not null default '';
alter table public.cb_bank_lines add column if not exists excluded_reason text not null default '';
alter table public.cb_bank_lines add column if not exists excluded_note text not null default '';
alter table public.cb_bank_lines add column if not exists excluded_by uuid references public.staff(id);
alter table public.cb_bank_lines add column if not exists excluded_at timestamptz;
alter table public.cb_bank_lines add column if not exists transfer_account uuid references public.cb_bank_accounts(id) on delete set null;
alter table public.cb_bank_lines add column if not exists is_split boolean not null default false;
alter table public.cb_bank_lines add column if not exists rule_id uuid;

alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_status_check;
alter table public.cb_bank_lines add constraint cb_bank_lines_status_check check (status in ('new', 'done', 'ask_client', 'reviewer', 'matched', 'excluded'));
alter table public.cb_bank_lines drop constraint if exists cb_bank_lines_source_check;
alter table public.cb_bank_lines add constraint cb_bank_lines_source_check check (source in ('', 'rule', 'auto', 'last_year', 'history', 'firm', 'manual', 'transfer', 'outstanding'));
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cb_bank_lines_question_len') then
    alter table public.cb_bank_lines add constraint cb_bank_lines_question_len check (length(client_question) <= 500 and length(client_answer) <= 1000 and length(excluded_note) <= 300);
  end if;
end $$;

-- ---------- 2. Rules (QuickBooks Online bank rules): the client's, in priority order, rolling forward to next year's file.
create table if not exists public.cb_bank_rules (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references public.clients(id) on delete cascade,
  priority        int not null default 0,
  name            text not null check (length(name) between 1 and 120),
  direction       text not null default 'out' check (direction in ('out', 'in', 'any')),   -- 'any': a vendor rule copied in
  accounts        text[] not null default '{}',   -- the file accounts' numbers ("10000"); empty: all bank and card accounts
  match_all       boolean not null default true,
  conditions      jsonb not null default '[]',
  txn_type        text not null default '' check (txn_type in ('', 'expense', 'deposit', 'transfer')),
  chart_account   text references public.cb_chart_accounts(number) on update cascade,
  bank_number     text,                            -- a transfer: the file account's number ("22100")
  tax_code        text references public.cb_sales_tax_codes(code),
  memo            text not null default '' check (length(memo) <= 300),
  auto_post       boolean not null default false,
  active          boolean not null default true,
  from_vendor_rule uuid unique,
  created_by      uuid references public.staff(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (chart_account is not null or bank_number is not null)
);
create index if not exists cb_bank_rules_client on public.cb_bank_rules (client_id, priority);
alter table public.cb_bank_rules enable row level security;
alter table public.cb_bank_rules force row level security;
drop policy if exists "Closebook viewers read bank rules" on public.cb_bank_rules;
create policy "Closebook viewers read bank rules" on public.cb_bank_rules for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_bank_rules to authenticated;

-- Today's vendor rules move into the list: "Description contains <vendor>", money in or out, in the order they were made.
insert into public.cb_bank_rules (client_id, priority, name, direction, conditions, txn_type, chart_account, tax_code, from_vendor_rule, created_by, created_at)
select v.client_id,
       coalesce((select max(priority) from public.cb_bank_rules r where r.client_id = v.client_id), 0) + row_number() over (partition by v.client_id order by v.created_at, v.id),
       left(initcap(lower(v.vendor_key)), 120), 'any',
       jsonb_build_array(jsonb_build_object('field', 'description', 'op', 'contains', 'value', v.vendor_key)),
       'expense', v.chart_account, v.tax_code, v.id, v.created_by, v.created_at
  from public.cb_vendor_rules v
 where not exists (select 1 from public.cb_bank_rules r where r.from_vendor_rule = v.id);

-- ---------- 3. Pair choices, splits, receipts
create table if not exists public.cb_bank_pair_choices (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files(id) on delete cascade,
  line_a      uuid not null references public.cb_bank_lines(id) on delete cascade,
  line_b      uuid not null references public.cb_bank_lines(id) on delete cascade,
  kind        text not null check (kind in ('chosen', 'rejected')),
  created_by  uuid references public.staff(id),
  created_at  timestamptz not null default now(),
  check (line_a < line_b),
  unique (line_a, line_b)
);
create index if not exists cb_bank_pair_choices_file on public.cb_bank_pair_choices (file_id);
alter table public.cb_bank_pair_choices enable row level security;
alter table public.cb_bank_pair_choices force row level security;
drop policy if exists "Closebook viewers read pair choices" on public.cb_bank_pair_choices;
create policy "Closebook viewers read pair choices" on public.cb_bank_pair_choices for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_bank_pair_choices to authenticated;

create table if not exists public.cb_line_splits (
  id            uuid primary key default gen_random_uuid(),
  file_id       uuid not null references public.cb_files(id) on delete cascade,
  line_id       uuid not null references public.cb_bank_lines(id) on delete cascade,
  row_no        int not null,
  chart_account text not null references public.cb_chart_accounts(number) on update cascade,
  tax_code      text not null references public.cb_sales_tax_codes(code),
  amount        numeric(14,2) not null check (amount <> 0),
  memo          text not null default '' check (length(memo) <= 300),
  unique (line_id, row_no)
);
alter table public.cb_line_splits enable row level security;
alter table public.cb_line_splits force row level security;
drop policy if exists "Closebook viewers read splits" on public.cb_line_splits;
create policy "Closebook viewers read splits" on public.cb_line_splits for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_line_splits to authenticated;

create table if not exists public.cb_line_files (
  id          uuid primary key default gen_random_uuid(),
  file_id     uuid not null references public.cb_files(id) on delete cascade,
  line_id     uuid not null references public.cb_bank_lines(id) on delete cascade,
  path        text not null,
  name        text not null check (length(name) between 1 and 200),
  size        bigint not null default 0,
  uploaded_by uuid references public.staff(id),
  uploaded_at timestamptz not null default now()
);
create index if not exists cb_line_files_line on public.cb_line_files (line_id);
alter table public.cb_line_files enable row level security;
alter table public.cb_line_files force row level security;
drop policy if exists "Closebook viewers read line files" on public.cb_line_files;
create policy "Closebook viewers read line files" on public.cb_line_files for select to authenticated using ((select private.can_view('closebook')));
grant select on public.cb_line_files to authenticated;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'cb_locked_guard' and tgrelid = 'public.cb_line_splits'::regclass) then
    create trigger cb_locked_guard before insert or update or delete on public.cb_line_splits for each row execute function private.cb_locked_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cb_locked_guard' and tgrelid = 'public.cb_bank_pair_choices'::regclass) then
    create trigger cb_locked_guard before insert or update or delete on public.cb_bank_pair_choices for each row execute function private.cb_locked_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'cb_locked_guard' and tgrelid = 'public.cb_line_files'::regclass) then
    create trigger cb_locked_guard before insert or update or delete on public.cb_line_files for each row execute function private.cb_locked_guard();
  end if;
end $$;

alter table public.cb_files add column if not exists excluded_reviewed_key text;
alter table public.cb_files add column if not exists excluded_reviewed_by uuid references public.staff(id);
alter table public.cb_files add column if not exists excluded_reviewed_at timestamptz;

-- ---------- 4. The client's question list becomes a flag on a Pending line.
do $$ begin
  if exists (select 1 from public.cb_bank_lines where status = 'ask_client') then
    perform set_config('cb.transfer', 'on', true);
    update public.cb_bank_lines set status = 'new', asked_at = coalesce(asked_at, coded_at, now()), asked_by = coalesce(asked_by, coded_by),
           client_question = case when client_question = '' then 'What was this payment for?' else client_question end
     where status = 'ask_client';
    perform set_config('cb.transfer', '', true);
  end if;
end $$;

-- ---------- 5. Helpers
-- Pending: still to post. A line sent to the reviewer before it had an account (an uploaded duplicate) is Pending too.
create or replace function private.cb_line_pending(l public.cb_bank_lines) returns boolean language sql immutable set search_path = '' as $$
  select l.status = 'new' or l.status = 'ask_client' or (l.status = 'reviewer' and l.chart_account is null and not l.is_split and l.transfer_account is null);
$$;

-- Money out: a payment from a bank account, a charge on a card or a loan.
create or replace function private.cb_line_out(l public.cb_bank_lines) returns boolean language sql stable security definer set search_path = '' as $$
  select case when (select kind from public.cb_bank_accounts where id = l.account_id) = 'card' then l.amount > 0 else l.amount < 0 end;
$$;

-- The days between two lines, each counting either of its dates (bank date, posting date, printed date).
create or replace function private.cb_pair_days(a public.cb_bank_lines, b public.cb_bank_lines) returns int language sql immutable set search_path = '' as $$
  select min(abs(x - y)) from unnest(array[a.txn_date, a.posted_date, a.printed_date]) x, unnest(array[b.txn_date, b.posted_date, b.printed_date]) y
   where x is not null and y is not null;
$$;

create or replace function private.cb_file_open(p_file uuid) returns public.cb_files language plpgsql stable security definer set search_path = '' as $$
declare v public.cb_files;
begin
  perform private.require(private.can_edit('closebook'), 'You need Edit on Closebook to code transactions.');
  select * into v from public.cb_files where id = p_file;
  perform private.require(v.id is not null and v.phase <> 'locked', 'This file is locked or missing.');
  return v;
end;
$$;

-- The reason a posted line goes to the reviewer (rounds 2 and 3), or ''.
create or replace function private.cb_reviewer_reason(l public.cb_bank_lines, p_account text, p_tax text, p_reviewer boolean) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_acc public.cb_chart_accounts; v_in boolean := not private.cb_line_out(l);
begin
  -- A line uploaded although already in the file stays with the reviewer whoever posts it.
  if l.dup_confirmed and l.reviewer_reason <> '' and not p_reviewer then return l.reviewer_reason; end if;
  select * into v_acc from public.cb_chart_accounts where number = p_account;
  return case
    when v_acc.account_type = 'Expense' and v_in then 'An expense coded to money in: check it is a refund, or choose another account.'
    when v_acc.account_type = 'Revenue' and not v_in then 'Revenue coded to money out: check it is a refund to a customer, or choose another account.'
    when v_acc.tax_default = 'Check' and not p_reviewer then 'The sales tax on this account is the reviewer''s call.'
    when v_acc.number = '60200' and coalesce(p_tax, '') not like 'MEALS%' then 'Meals coded at the full rate: only 50% of the tax is claimable.'
    else '' end;
end;
$$;

-- ---------- 6. Fill a Pending line (QuickBooks Online keeps what is chosen on a "For review" line; nothing posts).
create or replace function public.cb_fill_lines(p_file uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_item jsonb; l public.cb_bank_lines; v_acc text; v_tax text; v_tr uuid; v_n int := 0;
begin
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to save.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into l from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file for update;
    perform private.require(l.id is not null, 'Line not found.');
    perform private.require(private.cb_line_pending(l), 'This line is posted or excluded. Undo it first.');
    v_acc := nullif(v_item ->> 'account', ''); v_tax := nullif(v_item ->> 'tax', ''); v_tr := nullif(v_item ->> 'transfer_account', '')::uuid;
    if v_acc is not null then perform private.require(exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account from the chart.'); end if;
    if v_tax is not null then perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Unknown sales tax code.'); end if;
    if v_tr is not null then
      perform private.require(exists (select 1 from public.cb_bank_accounts where id = v_tr and file_id = p_file) and v_tr <> l.account_id, 'Choose another of this file''s accounts.');
      v_acc := null; v_tax := null;
    end if;
    if v_acc is not null or v_tr is not null then delete from public.cb_line_splits where line_id = l.id; end if;
    update public.cb_bank_lines set chart_account = v_acc, tax_code = v_tax, transfer_account = v_tr,
           is_split = case when v_acc is null and v_tr is null then is_split else false end,
           source = case when v_acc is null and v_tr is null and v_tax is null then '' else 'manual' end, rule_id = null,
           status = case when status = 'reviewer' then 'new' else status end   -- a duplicate for the reviewer stays Pending, with its flag
     where id = l.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- ---------- 7. Post (QuickBooks Online "Post"; batch from the black bar). One item per line:
--   {id, kind: 'code', account, tax, source?, rule_id?}       an account and a sales tax code
--   {id, kind: 'split'}                                         the line's split rows
--   {id, kind: 'transfer', transfer_account}                    to another of the file's accounts, no line there yet
--   {id, kind: 'pair', other}                                   a pair: one entry, both lines posted
--   {id, kind: 'already', other}                                the other side was posted before: no second entry
create or replace function public.cb_post_lines(p_file uuid, p_items jsonb) returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  v_item jsonb; l public.cb_bank_lines; o public.cb_bank_lines; v_out public.cb_bank_lines; v_in public.cb_bank_lines;
  v_kind text; v_acc text; v_tax text; v_reason text; v_src text; v_reviewer boolean; v_tr public.cb_bank_accounts; v_sum numeric; v_n int := 0; v_rule uuid;
begin
  perform private.cb_require_gst_answers(p_file);
  v_reviewer := (select auth.uid()) = v_file.reviewer_id or (select private.is_owner());
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Nothing to post.');
  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into l from public.cb_bank_lines where id = (v_item ->> 'id')::uuid and file_id = p_file for update;
    perform private.require(l.id is not null, 'Line not found.');
    if not private.cb_line_pending(l) then continue; end if;   -- posted already (the other side of a pair in the same batch)
    v_kind := coalesce(v_item ->> 'kind', 'code');
    v_src := coalesce(nullif(v_item ->> 'source', ''), 'manual');
    perform private.require(v_src in ('manual', 'rule', 'auto', 'history', 'firm'), 'Unknown source.');
    v_rule := nullif(v_item ->> 'rule_id', '')::uuid;
    if v_kind = 'code' then
      v_acc := v_item ->> 'account'; v_tax := nullif(v_item ->> 'tax', '');
      perform private.require(exists (select 1 from public.cb_chart_accounts where number = v_acc), 'Choose an account for every line. Nothing was posted.');
      perform private.require(v_tax is not null and exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code for every line. Nothing was posted.');
      v_reason := private.cb_reviewer_reason(l, v_acc, v_tax, v_reviewer);
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_acc, tax_code = v_tax, transfer_account = null, is_split = false,
             status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason, source = v_src, rule_id = v_rule,
             coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind = 'split' then
      perform private.require(l.is_split, 'Split the line first.');
      select coalesce(sum(amount), 0) into v_sum from public.cb_line_splits where line_id = l.id;
      perform private.require(v_sum = abs(l.amount), 'The split rows must add up to the line. Nothing was posted.');
      select coalesce(max(r), '') into v_reason from (select private.cb_reviewer_reason(l, s.chart_account, s.tax_code, v_reviewer) r from public.cb_line_splits s where s.line_id = l.id) x;
      update public.cb_bank_lines set chart_account = null, tax_code = null, transfer_account = null,
             status = case when v_reason = '' then 'done' else 'reviewer' end, reviewer_reason = v_reason, source = v_src, rule_id = v_rule,
             coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind = 'transfer' then
      select * into v_tr from public.cb_bank_accounts where id = nullif(v_item ->> 'transfer_account', '')::uuid and file_id = p_file;
      perform private.require(v_tr.id is not null and v_tr.id <> l.account_id, 'Choose another of this file''s accounts.');
      delete from public.cb_line_splits where line_id = l.id;
      update public.cb_bank_lines set chart_account = v_tr.chart_account, tax_code = null, transfer_account = v_tr.id, is_split = false,
             status = 'done', reviewer_reason = '', source = v_src, rule_id = v_rule, coded_by = (select auth.uid()), coded_at = now()
       where id = l.id;
    elsif v_kind in ('pair', 'already') then
      select * into o from public.cb_bank_lines where id = nullif(v_item ->> 'other', '')::uuid and file_id = p_file for update;
      perform private.require(o.id is not null and o.account_id <> l.account_id, 'The other line was not found.');
      perform private.require(l.amount <> 0 and abs(l.amount) = abs(o.amount), 'The two amounts must be the same to the cent.');
      perform private.require(private.cb_line_out(l) <> private.cb_line_out(o), 'One line must be money out and the other money in.');
      perform private.require(private.cb_pair_days(l, o) <= 7, 'The dates must be within 7 days of each other.');
      perform private.require(not exists (select 1 from public.cb_bank_transfers t where t.out_line in (l.id, o.id) or t.in_line in (l.id, o.id)), 'This line is already in a transfer.');
      perform set_config('cb.transfer', 'on', true);
      if v_kind = 'pair' then
        perform private.require(private.cb_line_pending(o), 'The other line is posted or excluded.');
        perform private.require(not exists (select 1 from public.cb_bank_pair_choices c where c.kind = 'rejected' and c.line_a = least(l.id, o.id) and c.line_b = greatest(l.id, o.id)),
          'These two lines were unpaired.');
        if private.cb_line_out(l) then v_out := l; v_in := o; else v_out := o; v_in := l; end if;
        delete from public.cb_line_splits where line_id in (l.id, o.id);
        -- One entry, from the money-out line: debit the other account, credit this one (tb-build.ts).
        update public.cb_bank_lines set status = 'done', chart_account = (select chart_account from public.cb_bank_accounts where id = v_in.account_id), tax_code = null,
               transfer_account = null, is_split = false, reviewer_reason = '', source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = v_out.id;
        update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, transfer_account = null, is_split = false, reviewer_reason = '',
               source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = v_in.id;
        insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by) values (p_file, v_out.id, v_in.id, (select auth.uid()));
      else
        -- The other side was posted to this line's account before this line came in: this one posts nothing.
        perform private.require(o.status in ('done', 'reviewer') and o.transfer_account = l.account_id, 'The other line is not a transfer posted to this account.');
        update public.cb_bank_lines set status = 'matched', chart_account = null, tax_code = null, transfer_account = null, is_split = false, reviewer_reason = '',
               source = 'transfer', rule_id = null, coded_by = (select auth.uid()), coded_at = now()
         where id = l.id;
        insert into public.cb_bank_transfers (file_id, out_line, in_line, created_by) values (p_file, o.id, l.id, (select auth.uid()));
      end if;
      perform set_config('cb.transfer', '', true);
    else
      perform private.require(false, 'Unknown action.');
    end if;
    v_n := v_n + 1;
  end loop;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

-- A transfer undone: the line that posted nothing goes back to Pending; the line that posted the entry goes back too
-- when it was posted as a pair. A transfer posted before the other side came in stays posted (only the later line returns).
create or replace function private.cb_transfer_removed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('cb.transfer', 'on', true);
  update public.cb_bank_lines set status = 'new', chart_account = null, tax_code = null, reviewer_reason = '', source = '', coded_by = null, coded_at = null,
         transfer_account = null, rule_id = null
   where id = old.in_line or (id = old.out_line and source = 'transfer');
  perform set_config('cb.transfer', '', true);
  return null;
end;
$$;

-- ---------- 8. Undo (Posted tab, and the pill): back to Pending with what it had. A pair returns both sides.
create or replace function public.cb_unpost_lines(p_file uuid, p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_n int; v_t int;
begin
  with gone as (delete from public.cb_bank_transfers where file_id = p_file and (out_line = any (p_ids) or in_line = any (p_ids)) returning id)
  select count(*) into v_t from gone;
  update public.cb_bank_lines set status = 'new', reviewer_reason = case when dup_confirmed then reviewer_reason else '' end, coded_by = null, coded_at = null,
         -- an auto-posted line keeps its account but is not posted again by itself
         source = case when source in ('auto', 'rule', 'history', 'firm') then 'manual' else source end
   where file_id = p_file and id = any (p_ids) and status in ('done', 'reviewer') and source <> 'outstanding';
  get diagnostics v_n = row_count;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n + v_t;
end;
$$;

-- ---------- 9. Exclude and restore (QuickBooks Online "Exclude"; Excluded tab, Undo)
create or replace function public.cb_exclude_lines(p_file uuid, p_ids uuid[], p_reason text, p_note text default '') returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_n int;
begin
  perform private.require(p_reason in ('duplicate', 'recorded', 'other'), 'Choose a reason.');
  perform private.require(p_reason <> 'other' or length(btrim(coalesce(p_note, ''))) >= 3, 'Say why the line is excluded.');
  perform private.require(not exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and l.id = any (p_ids) and not private.cb_line_pending(l)),
    'Only Pending lines can be excluded. Undo a posted line first.');
  update public.cb_bank_lines set status = 'excluded', excluded_reason = p_reason, excluded_note = left(btrim(coalesce(p_note, '')), 300),
         excluded_by = (select auth.uid()), excluded_at = now()
   where file_id = p_file and id = any (p_ids);
  get diagnostics v_n = row_count;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

create or replace function public.cb_restore_lines(p_file uuid, p_ids uuid[]) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_n int;
begin
  update public.cb_bank_lines set status = 'new', excluded_reason = '', excluded_note = '', excluded_by = null, excluded_at = null
   where file_id = p_file and id = any (p_ids) and status = 'excluded';
  get diagnostics v_n = row_count;
  update public.cb_files set updated_at = now() where id = p_file;
  return v_n;
end;
$$;

-- ---------- 10. Ask the client (round 2's question list), and the client's answer
create or replace function public.cb_ask_client_lines(p_file uuid, p_ids uuid[], p_question text) returns int
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_n int;
begin
  perform private.require(length(btrim(coalesce(p_question, ''))) between 3 and 500, 'Write the question.');
  update public.cb_bank_lines l set asked_at = now(), asked_by = (select auth.uid()), client_question = btrim(p_question)
   where l.file_id = p_file and l.id = any (p_ids) and private.cb_line_pending(l);
  get diagnostics v_n = row_count;
  perform private.require(v_n > 0, 'Only Pending lines go on the client''s list.');
  return v_n;
end;
$$;

create or replace function public.cb_set_client_answer(p_line uuid, p_answer text) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.cb_bank_lines;
begin
  select * into l from public.cb_bank_lines where id = p_line;
  perform private.require(l.id is not null, 'Line not found.');
  perform private.cb_file_open(l.file_id);
  update public.cb_bank_lines set client_answer = left(btrim(coalesce(p_answer, '')), 1000) where id = p_line;
end;
$$;

-- ---------- 11. Pairs: the one picked among several, and Unpair (never suggested again)
create or replace function public.cb_pair_choice(p_file uuid, p_a uuid, p_b uuid, p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); a public.cb_bank_lines; b public.cb_bank_lines;
begin
  perform private.require(p_kind in ('chosen', 'rejected'), 'Unknown choice.');
  select * into a from public.cb_bank_lines where id = p_a and file_id = p_file;
  select * into b from public.cb_bank_lines where id = p_b and file_id = p_file;
  perform private.require(a.id is not null and b.id is not null and a.id <> b.id and a.account_id <> b.account_id, 'Line not found.');
  perform private.require(private.cb_line_pending(a) and private.cb_line_pending(b), 'Undo the posted line first.');
  if p_kind = 'chosen' then
    delete from public.cb_bank_pair_choices where kind = 'chosen' and (line_a in (a.id, b.id) or line_b in (a.id, b.id));
  end if;
  insert into public.cb_bank_pair_choices (file_id, line_a, line_b, kind, created_by) values (p_file, least(a.id, b.id), greatest(a.id, b.id), p_kind, (select auth.uid()))
  on conflict (line_a, line_b) do update set kind = excluded.kind, created_by = excluded.created_by, created_at = now();
  if p_kind = 'rejected' then
    -- Unpair: both Account fields go blank.
    update public.cb_bank_lines set chart_account = null, tax_code = null, transfer_account = null, source = '' where id in (a.id, b.id) and status = 'new';
    perform private.cb_log_event(p_file, 'pair_unpaired', 'code', 'Unpaired', a.statement_id, a.id, private.cb_line_label(a), '', private.cb_line_label(b), '');
  end if;
end;
$$;

-- ---------- 12. Split
create or replace function public.cb_save_splits(p_line uuid, p_rows jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.cb_bank_lines; r jsonb; i int := 0; v_sum numeric := 0;
begin
  select * into l from public.cb_bank_lines where id = p_line for update;
  perform private.require(l.id is not null, 'Line not found.');
  perform private.cb_file_open(l.file_id);
  perform private.require(private.cb_line_pending(l), 'Undo the posted line first.');
  perform private.require(jsonb_typeof(p_rows) = 'array' and jsonb_array_length(p_rows) between 2 and 30, 'A split has two lines or more.');
  delete from public.cb_line_splits where line_id = l.id;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    perform private.require(exists (select 1 from public.cb_chart_accounts where number = r ->> 'account'), format('Line %s: choose an account.', i));
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = r ->> 'tax'), format('Line %s: choose a sales tax code.', i));
    perform private.require((r ->> 'amount')::numeric <> 0, format('Line %s: enter an amount.', i));
    insert into public.cb_line_splits (file_id, line_id, row_no, chart_account, tax_code, amount, memo)
    values (l.file_id, l.id, i, r ->> 'account', r ->> 'tax', round((r ->> 'amount')::numeric, 2), left(btrim(coalesce(r ->> 'memo', '')), 300));
    v_sum := v_sum + round((r ->> 'amount')::numeric, 2);
  end loop;
  perform private.require(v_sum = abs(l.amount), format('Left to split: %s. Nothing was saved.', private.cb_money(abs(l.amount) - v_sum)));
  update public.cb_bank_lines set is_split = true, chart_account = null, tax_code = null, transfer_account = null, source = 'manual',
         status = case when status = 'reviewer' then 'new' else status end where id = l.id;
end;
$$;

create or replace function public.cb_clear_splits(p_line uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare l public.cb_bank_lines;
begin
  select * into l from public.cb_bank_lines where id = p_line for update;
  perform private.require(l.id is not null, 'Line not found.');
  perform private.cb_file_open(l.file_id);
  perform private.require(private.cb_line_pending(l), 'Undo the posted line first.');
  delete from public.cb_line_splits where line_id = l.id;
  update public.cb_bank_lines set is_split = false where id = l.id;
end;
$$;

-- ---------- 13. Receipts on a line (📎)
create or replace function public.cb_add_line_file(p_line uuid, p_path text, p_name text, p_size bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l public.cb_bank_lines; v_id uuid;
begin
  select * into l from public.cb_bank_lines where id = p_line;
  perform private.require(l.id is not null, 'Line not found.');
  perform private.cb_file_open(l.file_id);
  perform private.require(p_path like 'closebook/' || l.file_id::text || '/lines/%', 'Wrong place for the file.');
  perform private.require((select count(*) from public.cb_line_files where line_id = l.id) < 10, 'Up to 10 files on a line.');
  insert into public.cb_line_files (file_id, line_id, path, name, size, uploaded_by) values (l.file_id, l.id, p_path, left(p_name, 200), coalesce(p_size, 0), (select auth.uid()))
  returning id into v_id;
  perform private.cb_log_event(l.file_id, 'line_file', 'code', 'Receipt attached', l.statement_id, l.id, private.cb_line_label(l), '', '', left(p_name, 200));
  return v_id;
end;
$$;

-- ---------- 14. Rules
create or replace function private.cb_rule_client(p_file uuid) returns uuid language sql stable security definer set search_path = '' as $$
  select client_id from public.cb_files where id = p_file;
$$;

create or replace function public.cb_save_rule(p_file uuid, p_id uuid, p_rule jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); v_id uuid := p_id; c jsonb; v_conds jsonb := p_rule -> 'conditions';
begin
  perform private.require(length(btrim(coalesce(p_rule ->> 'name', ''))) between 1 and 120, 'Name the rule.');
  perform private.require(p_rule ->> 'direction' in ('out', 'in', 'any'), 'Choose money out or money in.');
  perform private.require(jsonb_typeof(v_conds) = 'array' and jsonb_array_length(v_conds) between 1 and 5, 'Add one to five conditions.');
  for c in select * from jsonb_array_elements(v_conds) loop
    perform private.require(c ->> 'field' in ('description', 'amount'), 'Unknown condition.');
    perform private.require((c ->> 'field' = 'description' and c ->> 'op' in ('contains', 'not_contains', 'is')) or (c ->> 'field' = 'amount' and c ->> 'op' in ('eq', 'gt', 'lt')), 'Unknown condition.');
    perform private.require(length(btrim(coalesce(c ->> 'value', ''))) between 1 and 200, 'Fill in every condition.');
    if c ->> 'field' = 'amount' then perform private.require(btrim(c ->> 'value') ~ '^-?[0-9]+(\.[0-9]{1,2})?$', 'An amount condition needs an amount, for example 6.00.'); end if;
  end loop;
  perform private.require(nullif(p_rule ->> 'account', '') is not null or nullif(p_rule ->> 'bank_number', '') is not null, 'Choose the account.');
  if nullif(p_rule ->> 'account', '') is not null then
    perform private.require(exists (select 1 from public.cb_chart_accounts where number = p_rule ->> 'account'), 'Choose an account from the chart.');
    perform private.require(exists (select 1 from public.cb_sales_tax_codes where code = p_rule ->> 'tax'), 'Choose the sales tax.');
  end if;
  if v_id is null then
    insert into public.cb_bank_rules (client_id, priority, name, direction, accounts, match_all, conditions, txn_type, chart_account, bank_number, tax_code, memo, auto_post, active, created_by)
    values (v_file.client_id, coalesce((select max(priority) from public.cb_bank_rules where client_id = v_file.client_id), 0) + 1,
            btrim(p_rule ->> 'name'), p_rule ->> 'direction', coalesce(array(select jsonb_array_elements_text(p_rule -> 'accounts')), '{}'),
            coalesce((p_rule ->> 'match_all')::boolean, true), v_conds, coalesce(p_rule ->> 'txn_type', ''), nullif(p_rule ->> 'account', ''), nullif(p_rule ->> 'bank_number', ''),
            case when nullif(p_rule ->> 'account', '') is null then null else p_rule ->> 'tax' end, left(coalesce(p_rule ->> 'memo', ''), 300),
            coalesce((p_rule ->> 'auto_post')::boolean, false), true, (select auth.uid()))
    returning id into v_id;
    perform private.cb_log_event(p_file, 'rule_saved', 'code', 'Rule created', null, null, btrim(p_rule ->> 'name'), '', '', '');
  else
    perform private.require(exists (select 1 from public.cb_bank_rules where id = v_id and client_id = v_file.client_id), 'Rule not found.');
    update public.cb_bank_rules set name = btrim(p_rule ->> 'name'), direction = p_rule ->> 'direction', accounts = coalesce(array(select jsonb_array_elements_text(p_rule -> 'accounts')), '{}'),
           match_all = coalesce((p_rule ->> 'match_all')::boolean, true), conditions = v_conds, txn_type = coalesce(p_rule ->> 'txn_type', ''),
           chart_account = nullif(p_rule ->> 'account', ''), bank_number = nullif(p_rule ->> 'bank_number', ''),
           tax_code = case when nullif(p_rule ->> 'account', '') is null then null else p_rule ->> 'tax' end, memo = left(coalesce(p_rule ->> 'memo', ''), 300),
           auto_post = coalesce((p_rule ->> 'auto_post')::boolean, false), updated_at = now()
     where id = v_id;
    perform private.cb_log_event(p_file, 'rule_saved', 'code', 'Rule changed', null, null, btrim(p_rule ->> 'name'), '', '', '');
  end if;
  return v_id;
end;
$$;

create or replace function public.cb_rule_action(p_file uuid, p_id uuid, p_action text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file); r public.cb_bank_rules; v_id uuid;
begin
  select * into r from public.cb_bank_rules where id = p_id and client_id = v_file.client_id;
  perform private.require(r.id is not null, 'Rule not found.');
  if p_action = 'disable' then update public.cb_bank_rules set active = false, updated_at = now() where id = r.id;
  elsif p_action = 'enable' then update public.cb_bank_rules set active = true, updated_at = now() where id = r.id;
  elsif p_action = 'delete' then
    update public.cb_bank_lines set rule_id = null where rule_id = r.id;
    delete from public.cb_bank_rules where id = r.id;
  elsif p_action = 'copy' then
    insert into public.cb_bank_rules (client_id, priority, name, direction, accounts, match_all, conditions, txn_type, chart_account, bank_number, tax_code, memo, auto_post, active, created_by)
    values (r.client_id, (select max(priority) from public.cb_bank_rules where client_id = r.client_id) + 1, left('Copy of ' || r.name, 120), r.direction, r.accounts, r.match_all,
            r.conditions, r.txn_type, r.chart_account, r.bank_number, r.tax_code, r.memo, false, true, (select auth.uid()))
    returning id into v_id;
  else perform private.require(false, 'Unknown action.');
  end if;
  perform private.cb_log_event(p_file, 'rule_saved', 'code', case p_action when 'disable' then 'Rule disabled' when 'enable' then 'Rule enabled' when 'delete' then 'Rule deleted' else 'Rule copied' end,
    null, null, r.name, '', '', '');
  return coalesce(v_id, r.id);
end;
$$;

create or replace function public.cb_reorder_rules(p_file uuid, p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file);
begin
  update public.cb_bank_rules r set priority = x.n, updated_at = now()
    from unnest(p_ids) with ordinality x(id, n) where r.id = x.id and r.client_id = v_file.client_id;
end;
$$;

-- ---------- 15. Excluded lines reviewed (the reviewer's tick; void once the excluded lines change)
create or replace function private.cb_excluded_key(p_file uuid) returns text language sql stable security definer set search_path = '' as $$
  select count(*)::text || '|' || coalesce(sum(abs(amount)), 0)::text || '|' || coalesce(md5(string_agg(id::text, ',' order by id)), '')
    from public.cb_bank_lines where file_id = p_file and status = 'excluded';
$$;

create or replace function public.cb_excluded_key_of(p_file uuid) returns text language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.require(private.can_view('closebook'), 'You need Closebook.');
  return private.cb_excluded_key(p_file);
end;
$$;

create or replace function public.cb_excluded_reviewed(p_file uuid, p_on boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_file public.cb_files := private.cb_file_open(p_file);
begin
  perform private.require((select auth.uid()) = v_file.reviewer_id or (select private.is_owner()), 'Only the reviewer ticks this.');
  update public.cb_files set excluded_reviewed_key = case when p_on then private.cb_excluded_key(p_file) end,
         excluded_reviewed_by = case when p_on then (select auth.uid()) end, excluded_reviewed_at = case when p_on then now() end
   where id = p_file;
  perform private.cb_log_event(p_file, 'excluded_reviewed', 'code', case when p_on then 'Excluded lines reviewed' else 'Excluded lines review removed' end, null, null, '', '', '', '');
end;
$$;

-- ---------- 16. The sign-off check (step 4) and the tie to 3.3
create or replace function private.cb_code_tie_problems(p_file uuid) returns text[]
language plpgsql stable security definer set search_path = '' as $$
declare v_out text[] := '{}'; a record; v_tb numeric; v_close numeric; v_tb_terms numeric; v_excl numeric;
begin
  -- Pending lines: step 4 lists them; the check waits.
  if exists (select 1 from public.cb_bank_lines l where l.file_id = p_file and private.cb_line_pending(l)) then return v_out; end if;
  for a in select * from public.cb_bank_accounts where file_id = p_file and books_opening is not null order by number loop
    v_close := a.books_opening + coalesce((select sum(l.amount) from public.cb_bank_lines l where l.account_id = a.id and not (l.status = 'matched' and l.source = 'outstanding')), 0);
    -- Round 31: an excluded line is in the statements but not in the books; it is listed apart ("Excluded: ...").
    v_excl := coalesce((select sum(l.amount) from public.cb_bank_lines l where l.account_id = a.id and l.status = 'excluded'), 0);
    select coalesce(sum(this_year), 0) into v_tb from public.cb_accounts
     where file_id = p_file and account_key = case when a.number = a.chart_account then 'chart:' || a.chart_account else 'bank:' || a.id::text end;
    v_tb_terms := case when a.kind = 'bank' then v_tb else -v_tb end;
    if v_tb_terms <> v_close - v_excl then
      v_out := v_out || format('%s %s: the trial balance shows %s, but 3.3 closes at %s (%s off).', a.number, a.name, private.cb_bracket(v_tb_terms), private.cb_bracket(v_close - v_excl),
        private.cb_bracket(abs(v_tb_terms - v_close + v_excl)));
    end if;
  end loop;
  return v_out;
end;
$$;

do $$
declare d text;
  k1 text := $k$      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'new';
      if v_n > 0 then v_out := v_out || format('%s line%s to code.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines where file_id = p_file and status = 'ask_client';
      if v_n > 0 then v_out := v_out || format('%s line%s on the client''s question list.', v_n, case when v_n = 1 then '' else 's' end); end if;$k$;
  r1 text := $k$      -- Round 31: Pending lines (some asked of the client), then the excluded lines until the reviewer ticks them.
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and private.cb_line_pending(l);
      if v_n > 0 then v_out := v_out || format('%s line%s pending.', v_n, case when v_n = 1 then '' else 's' end); end if;
      select count(*) into v_n from public.cb_bank_lines l where l.file_id = p_file and l.status = 'excluded';
      if v_n > 0 and (select excluded_reviewed_key from public.cb_files where id = p_file) is distinct from private.cb_excluded_key(p_file) then
        v_out := v_out || format('Excluded: %s line%s · %s. The reviewer ticks "Excluded lines reviewed".', v_n, case when v_n = 1 then '' else 's' end,
          private.cb_money((select sum(abs(amount)) from public.cb_bank_lines where file_id = p_file and status = 'excluded')));
      end if;$k$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'cb_step_problems';
  if position('Round 31: Pending lines' in d) > 0 then return; end if;
  if position(k1 in d) = 0 then raise exception 'cb_step_problems: the text to patch was not found.'; end if;
  execute replace(d, k1, r1);
end $$;

-- ---------- 17. Triggers: the coding change mark only for posted lines; History in QuickBooks Online's words
drop trigger if exists cb_changed_coding on public.cb_bank_lines;
create trigger cb_changed_coding after update of chart_account, tax_code, status on public.cb_bank_lines for each row
  when (old.status is distinct from new.status or (new.status not in ('new', 'excluded') and (old.chart_account is distinct from new.chart_account or old.tax_code is distinct from new.tax_code)))
  execute function private.cb_changed('code', 'A line''s coding changed');

do $$
declare d text;
  k text := $k$when 'matched' then 'matched to a transfer' else 'for the reviewer' end$k$;
  r text := $k$when 'matched' then 'matched to a transfer' when 'excluded' then 'excluded' else 'for the reviewer' end$k$;
begin
  d := pg_get_functiondef('private.cb_changed()'::regprocedure);
  if position($q$when 'excluded' then 'excluded'$q$ in d) > 0 then return; end if;
  if position(k in d) = 0 then raise exception 'cb_changed: the text to patch was not found.'; end if;
  execute replace(d, k, r);
end $$;

create or replace function private.cb_coding_text(p_status text, p_chart text, p_tax text) returns text
language sql stable security definer set search_path = '' as $$
  select case when p_status = 'excluded' then 'Excluded'
              when p_chart is null then case p_status when 'reviewer' then 'Not coded, with the reviewer' when 'matched' then 'Matched' when 'done' then 'Posted' else 'Pending' end
              else concat_ws(', ', p_chart || coalesce(' ' || (select name from public.cb_chart_accounts where number = p_chart), ''), nullif(p_tax, ''),
                             case p_status when 'new' then 'pending' when 'reviewer' then 'with the reviewer' end) end;
$$;

create or replace function private.cb_line_log() returns trigger language plpgsql security definer set search_path = '' as $$
declare v_label text := private.cb_line_label(new); v_was_posted boolean; v_is_posted boolean;
begin
  if new.acct_date is distinct from old.acct_date then
    perform private.cb_log_event(new.file_id, 'line_date', 'code', 'Accounting date changed', new.statement_id, new.id, v_label, '',
      to_char(old.acct_date, 'Mon FMDD, YYYY'), to_char(new.acct_date, 'Mon FMDD, YYYY'));
  end if;
  if new.memo is distinct from old.memo then
    perform private.cb_log_event(new.file_id, 'line_memo', 'code', case when old.memo = '' then 'Memo added' when new.memo = '' then 'Memo removed' else 'Memo changed' end,
      new.statement_id, new.id, v_label, '', old.memo, new.memo);
  end if;
  if new.asked_at is distinct from old.asked_at and new.asked_at is not null then
    perform private.cb_log_event(new.file_id, 'line_client', 'code', 'Asked the client', new.statement_id, new.id, v_label, '', '', new.client_question);
  end if;
  if new.client_answer is distinct from old.client_answer then
    perform private.cb_log_event(new.file_id, 'line_answer', 'code', 'Client''s answer', new.statement_id, new.id, v_label, '', old.client_answer, new.client_answer);
  end if;
  if new.status = 'excluded' and old.status <> 'excluded' then
    perform private.cb_log_event(new.file_id, 'line_excluded', 'code', 'Excluded', new.statement_id, new.id, v_label,
      case new.excluded_reason when 'duplicate' then 'Duplicate line' when 'recorded' then 'Already recorded by an entry' else 'Other' end
        || case when new.excluded_note <> '' then ': ' || new.excluded_note else '' end, '', '');
    return null;
  end if;
  if old.status = 'excluded' and new.status <> 'excluded' then
    perform private.cb_log_event(new.file_id, 'line_restored', 'code', 'Back to Pending', new.statement_id, new.id, v_label, '', 'Excluded', 'Pending');
    return null;
  end if;
  -- Posting and undoing (a transfer logs itself; a Pending line's choices are not logged until it posts).
  v_was_posted := old.status in ('done', 'reviewer', 'matched') and not (old.status = 'reviewer' and old.chart_account is null and not old.is_split and old.transfer_account is null);
  v_is_posted := new.status in ('done', 'reviewer', 'matched') and not (new.status = 'reviewer' and new.chart_account is null and not new.is_split and new.transfer_account is null);
  if coalesce(old.source, '') in ('transfer', 'outstanding') or coalesce(new.source, '') in ('transfer', 'outstanding') then return null; end if;
  if v_is_posted and not v_was_posted then
    perform private.cb_log_event(new.file_id, case when new.status = 'reviewer' then 'line_reviewer' else 'line_coded' end, 'code',
      case when new.status = 'reviewer' then 'Posted, sent to the reviewer' when new.source = 'auto' then 'Posted by a rule (auto-post)' else 'Posted' end,
      new.statement_id, new.id, v_label, new.reviewer_reason, '', case when new.is_split then 'Split' else private.cb_coding_text(new.status, new.chart_account, new.tax_code) end);
  elsif v_was_posted and not v_is_posted then
    perform private.cb_log_event(new.file_id, 'line_uncoded', 'code', 'Undone: back to Pending', new.statement_id, new.id, v_label, '',
      case when old.is_split then 'Split' else private.cb_coding_text(old.status, old.chart_account, old.tax_code) end, 'Pending');
  elsif v_is_posted and (new.chart_account is distinct from old.chart_account or new.tax_code is distinct from old.tax_code or new.status is distinct from old.status) then
    perform private.cb_log_event(new.file_id, 'line_recoded', 'code', 'Coding changed', new.statement_id, new.id, v_label, '',
      private.cb_coding_text(old.status, old.chart_account, old.tax_code), private.cb_coding_text(new.status, new.chart_account, new.tax_code));
  end if;
  return null;
end;
$$;

-- ---------- 18. Grants
revoke all on function public.cb_fill_lines(uuid, jsonb), public.cb_post_lines(uuid, jsonb), public.cb_unpost_lines(uuid, uuid[]), public.cb_exclude_lines(uuid, uuid[], text, text),
  public.cb_restore_lines(uuid, uuid[]), public.cb_ask_client_lines(uuid, uuid[], text), public.cb_set_client_answer(uuid, text), public.cb_pair_choice(uuid, uuid, uuid, text),
  public.cb_save_splits(uuid, jsonb), public.cb_clear_splits(uuid), public.cb_add_line_file(uuid, text, text, bigint), public.cb_save_rule(uuid, uuid, jsonb),
  public.cb_rule_action(uuid, uuid, text), public.cb_reorder_rules(uuid, uuid[]), public.cb_excluded_reviewed(uuid, boolean), public.cb_excluded_key_of(uuid) from public, anon;
grant execute on function public.cb_fill_lines(uuid, jsonb), public.cb_post_lines(uuid, jsonb), public.cb_unpost_lines(uuid, uuid[]), public.cb_exclude_lines(uuid, uuid[], text, text),
  public.cb_restore_lines(uuid, uuid[]), public.cb_ask_client_lines(uuid, uuid[], text), public.cb_set_client_answer(uuid, text), public.cb_pair_choice(uuid, uuid, uuid, text),
  public.cb_save_splits(uuid, jsonb), public.cb_clear_splits(uuid), public.cb_add_line_file(uuid, text, text, bigint), public.cb_save_rule(uuid, uuid, jsonb),
  public.cb_rule_action(uuid, uuid, text), public.cb_reorder_rules(uuid, uuid[]), public.cb_excluded_reviewed(uuid, boolean), public.cb_excluded_key_of(uuid) to authenticated;
revoke all on function private.cb_line_pending(public.cb_bank_lines), private.cb_line_out(public.cb_bank_lines), private.cb_pair_days(public.cb_bank_lines, public.cb_bank_lines),
  private.cb_file_open(uuid), private.cb_reviewer_reason(public.cb_bank_lines, text, text, boolean), private.cb_rule_client(uuid), private.cb_excluded_key(uuid) from public, anon;
grant execute on function private.cb_line_pending(public.cb_bank_lines), private.cb_line_out(public.cb_bank_lines), private.cb_pair_days(public.cb_bank_lines, public.cb_bank_lines),
  private.cb_file_open(uuid), private.cb_reviewer_reason(public.cb_bank_lines, text, text, boolean), private.cb_rule_client(uuid), private.cb_excluded_key(uuid) to authenticated;
