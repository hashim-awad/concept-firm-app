-- Service catalogue (price book), screening questionnaires and pricing rules.
--
-- Plain words:
-- - One catalogue for every service line. Each item has a price history: a price change adds
--   a new price with a start date. Old prices are never changed or deleted, so a quote can
--   always show the price that applied when it was made.
-- - A questionnaire (personal or corporate) has questions and rules. Rules turn answers into
--   priced lines, mark a lead out of scope, or stop the form when answers do not agree.
-- - Questionnaires are versioned. Only a draft can be edited. Publishing a draft retires the
--   old version, so every lead keeps the exact questions and rules it was answered against.
-- - People with "Price book and rules: edit" can change all of this. Every change is logged.

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------

create table public.service_lines (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z0-9_]+$'),
  name       text not null,
  sort_order int  not null default 0,
  is_active  boolean not null default true
);

insert into public.service_lines (key, name, sort_order) values
  ('t1', 'Personal tax (T1)', 10),
  ('t2', 'Corporate tax (T2)', 20),
  ('bookkeeping', 'Bookkeeping', 30),
  ('payroll', 'Payroll', 40),
  ('gst_hst', 'GST/HST', 50),
  ('cfo', 'CFO reporting', 60);

create table public.catalogue_items (
  id              uuid primary key default gen_random_uuid(),
  service_line_id uuid not null references public.service_lines (id),
  code            text not null unique check (code ~ '^[A-Z0-9_]{2,40}$'),
  name            text not null check (length(btrim(name)) between 1 and 120),
  description     text not null default '',
  unit_label      text not null default 'each',   -- shown on quotes, e.g. "per property"
  per_spouse      boolean not null default false, -- true: charged for each spouse who needs it
  sort_order      int not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.staff (id),
  updated_at      timestamptz not null default now()
);
create index catalogue_items_line_idx on public.catalogue_items (service_line_id, sort_order);

create table public.item_prices (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references public.catalogue_items (id),
  amount_cents   int  not null check (amount_cents >= 0),
  effective_from date not null,
  note           text not null default '',
  created_at     timestamptz not null default now(),
  created_by     uuid references public.staff (id),
  unique (item_id, effective_from)
);

-- Today's date in the firm's time zone.
create or replace function private.today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Toronto')::date
$$;

-- Current price of each item (the latest price that has started).
create view public.current_item_prices with (security_invoker = true) as
select distinct on (p.item_id)
  p.item_id, p.amount_cents, p.effective_from
from public.item_prices p
where p.effective_from <= private.today()
order by p.item_id, p.effective_from desc;

-- ---------------------------------------------------------------------------
-- Questionnaires, questions and rules
-- ---------------------------------------------------------------------------

create table public.questionnaires (
  id           uuid primary key default gen_random_uuid(),
  route        text not null check (route in ('personal', 'corporate')),
  version      int  not null,
  status       text not null default 'draft' check (status in ('draft', 'published', 'retired')),
  title        text not null,
  intro        text not null default '',
  -- Personal route: which answer means "two people are filing" (asks per-person questions twice).
  couple_question_key text,
  couple_value        text,
  created_at   timestamptz not null default now(),
  created_by   uuid references public.staff (id),
  published_at timestamptz,
  published_by uuid references public.staff (id),
  updated_at   timestamptz not null default now(),
  unique (route, version)
);
create unique index questionnaires_one_published on public.questionnaires (route) where status = 'published';
create unique index questionnaires_one_draft on public.questionnaires (route) where status = 'draft';

create table public.questions (
  id               uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  key              text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  section          text not null default '',
  prompt           text not null check (length(btrim(prompt)) between 1 and 300),
  help_text        text not null default '',
  answer_type      text not null check (answer_type in ('yes_no', 'number', 'single_choice', 'province', 'text', 'email', 'phone')),
  options          jsonb not null default '[]',  -- single_choice: [{"value": "...", "label": "..."}]
  required         boolean not null default true,
  per_person       boolean not null default false, -- asked once for each person filing
  min_value        int,
  max_value        int,
  show_if          jsonb,  -- {"question": key, "op": "eq", "value": ...} or null
  sort_order       int not null default 0,
  unique (questionnaire_id, key)
);

-- kind:
--   add_item     when the conditions hold, add the item (quantity fixed or from a number answer)
--   out_of_scope when the conditions hold, no quote; the lead is flagged for an owner
--   check        when the conditions hold, stop the form and show the message
-- conditions: [{"question": key, "op": "eq|neq|gt|gte|lt|lte|in|answered|not_answered", "value": ...}]
--   All conditions must hold. Rules that use a per-person question are checked for each person.
create table public.rules (
  id               uuid primary key default gen_random_uuid(),
  questionnaire_id uuid not null references public.questionnaires (id) on delete cascade,
  kind             text not null check (kind in ('add_item', 'out_of_scope', 'check')),
  conditions       jsonb not null default '[]',
  item_code        text references public.catalogue_items (code),
  quantity_question_key text,      -- add_item: quantity is this number answer; null means 1
  message          text not null default '',
  sort_order       int not null default 0,
  check (kind <> 'add_item' or item_code is not null),
  check (kind = 'add_item' or length(btrim(message)) > 0)
);
create index rules_questionnaire_idx on public.rules (questionnaire_id, sort_order);

-- ---------------------------------------------------------------------------
-- Rules the database enforces
-- ---------------------------------------------------------------------------

create trigger catalogue_items_touch before update on public.catalogue_items
  for each row execute function private.touch_updated_at();
create trigger questionnaires_touch before update on public.questionnaires
  for each row execute function private.touch_updated_at();

-- Item codes never change (quotes and rules refer to them).
create or replace function private.guard_item_code()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.code is distinct from old.code then
    raise exception 'An item code cannot be changed. Create a new item instead.' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger catalogue_items_code_fixed before update on public.catalogue_items
  for each row execute function private.guard_item_code();

-- Prices are append-only.
create or replace function private.block_price_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Prices are never changed or deleted. Add a new price with a start date.' using errcode = '42501';
end;
$$;
create trigger item_prices_append_only before update or delete on public.item_prices
  for each row execute function private.block_price_change();

-- Questions and rules can only change while their questionnaire is a draft.
create or replace function private.guard_draft_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (
    select 1 from public.questionnaires
    where id in (case when tg_op <> 'INSERT' then old.questionnaire_id end,
                 case when tg_op <> 'DELETE' then new.questionnaire_id end)
      and status <> 'draft'
  ) then
    raise exception 'Only a draft can be changed. Create a new draft from the published version.' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger questions_draft_only before insert or update or delete on public.questions
  for each row execute function private.guard_draft_only();
create trigger rules_draft_only before insert or update or delete on public.rules
  for each row execute function private.guard_draft_only();

-- Questionnaire status only moves draft -> published -> retired, through the functions below.
create or replace function private.guard_questionnaire()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Only a draft can be deleted.' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.status <> 'draft' and (
       new.title is distinct from old.title or new.intro is distinct from old.intro
       or new.couple_question_key is distinct from old.couple_question_key
       or new.couple_value is distinct from old.couple_value or new.route is distinct from old.route
       or new.version is distinct from old.version) then
    raise exception 'A published or retired questionnaire cannot be changed.' using errcode = '42501';
  end if;
  if not (old.status = new.status
          or (old.status = 'draft' and new.status = 'published')
          or (old.status = 'published' and new.status = 'retired')) then
    raise exception 'Not allowed: % to %.', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger questionnaires_guard before update or delete on public.questionnaires
  for each row execute function private.guard_questionnaire();

-- Activity log
create trigger service_lines_log after insert or update or delete on public.service_lines
  for each row execute function private.log_change();
create trigger catalogue_items_log after insert or update or delete on public.catalogue_items
  for each row execute function private.log_change();
create trigger item_prices_log after insert or update or delete on public.item_prices
  for each row execute function private.log_change();
create trigger questionnaires_log after insert or update or delete on public.questionnaires
  for each row execute function private.log_change();
create trigger questions_log after insert or update or delete on public.questions
  for each row execute function private.log_change();
create trigger rules_log after insert or update or delete on public.rules
  for each row execute function private.log_change();

-- Stamp who created a row.
create or replace function private.set_created_by()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.created_by := (select auth.uid());
  return new;
end;
$$;
create trigger catalogue_items_created_by before insert on public.catalogue_items
  for each row execute function private.set_created_by();
create trigger item_prices_created_by before insert on public.item_prices
  for each row execute function private.set_created_by();

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.service_lines   enable row level security;
alter table public.catalogue_items enable row level security;
alter table public.item_prices     enable row level security;
alter table public.questionnaires  enable row level security;
alter table public.questions       enable row level security;
alter table public.rules           enable row level security;

create policy "Price book viewers read service lines" on public.service_lines
  for select to authenticated using ((select private.can_view('price_book')));
create policy "Price book viewers read items" on public.catalogue_items
  for select to authenticated using ((select private.can_view('price_book')));
create policy "Price book viewers read prices" on public.item_prices
  for select to authenticated using ((select private.can_view('price_book')));
create policy "Price book viewers read questionnaires" on public.questionnaires
  for select to authenticated using ((select private.can_view('price_book')));
create policy "Price book viewers read questions" on public.questions
  for select to authenticated using ((select private.can_view('price_book')));
create policy "Price book viewers read rules" on public.rules
  for select to authenticated using ((select private.can_view('price_book')));

create policy "Price book editors add items" on public.catalogue_items
  for insert to authenticated with check ((select private.can_edit('price_book')));
create policy "Price book editors change items" on public.catalogue_items
  for update to authenticated using ((select private.can_edit('price_book'))) with check ((select private.can_edit('price_book')));
create policy "Price book editors add prices" on public.item_prices
  for insert to authenticated with check ((select private.can_edit('price_book')));
create policy "Price book editors add questions" on public.questions
  for insert to authenticated with check ((select private.can_edit('price_book')));
create policy "Price book editors change questions" on public.questions
  for update to authenticated using ((select private.can_edit('price_book'))) with check ((select private.can_edit('price_book')));
create policy "Price book editors delete questions" on public.questions
  for delete to authenticated using ((select private.can_edit('price_book')));
create policy "Price book editors add rules" on public.rules
  for insert to authenticated with check ((select private.can_edit('price_book')));
create policy "Price book editors change rules" on public.rules
  for update to authenticated using ((select private.can_edit('price_book'))) with check ((select private.can_edit('price_book')));
create policy "Price book editors delete rules" on public.rules
  for delete to authenticated using ((select private.can_edit('price_book')));
create policy "Price book editors change draft details" on public.questionnaires
  for update to authenticated using ((select private.can_edit('price_book')) and status = 'draft')
  with check ((select private.can_edit('price_book')) and status = 'draft');

grant select on public.service_lines, public.catalogue_items, public.item_prices, public.current_item_prices,
  public.questionnaires, public.questions, public.rules to authenticated;
grant insert, update (service_line_id, name, description, unit_label, per_spouse, sort_order, is_active)
  on public.catalogue_items to authenticated;
grant insert (item_id, amount_cents, effective_from, note) on public.item_prices to authenticated;
grant insert, update, delete on public.questions, public.rules to authenticated;
grant update (title, intro, couple_question_key, couple_value) on public.questionnaires to authenticated;
grant execute on function private.today() to authenticated;

-- ---------------------------------------------------------------------------
-- Versioning actions
-- ---------------------------------------------------------------------------

-- Copy the published version (questions and rules) into a new draft.
create or replace function public.create_questionnaire_draft(p_route text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_src public.questionnaires;
  v_new uuid;
begin
  perform private.require(private.can_edit('price_book'), 'You do not have permission to change screening questions.');
  perform private.require(not exists (select 1 from public.questionnaires where route = p_route and status = 'draft'),
    'A draft already exists. Open it, or delete it first.');
  select * into v_src from public.questionnaires where route = p_route and status = 'published';
  perform private.require(v_src.id is not null, 'Nothing is published for this route yet.');
  insert into public.questionnaires (route, version, title, intro, couple_question_key, couple_value, created_by)
  values (p_route, (select max(version) + 1 from public.questionnaires where route = p_route),
          v_src.title, v_src.intro, v_src.couple_question_key, v_src.couple_value, (select auth.uid()))
  returning id into v_new;
  insert into public.questions (questionnaire_id, key, section, prompt, help_text, answer_type, options, required,
    per_person, min_value, max_value, show_if, sort_order)
  select v_new, key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order
  from public.questions where questionnaire_id = v_src.id;
  insert into public.rules (questionnaire_id, kind, conditions, item_code, quantity_question_key, message, sort_order)
  select v_new, kind, conditions, item_code, quantity_question_key, message, sort_order
  from public.rules where questionnaire_id = v_src.id;
  return v_new;
end;
$$;

-- Checks a draft hangs together: every rule and condition refers to a real question, etc.
-- Returns a list of problems (empty when fine).
create or replace function public.questionnaire_problems(p_id uuid)
returns text[] language plpgsql stable security definer set search_path = '' as $$
declare
  v_q public.questionnaires;
  v_problems text[] := '{}';
  r record;
  c jsonb;
begin
  perform private.require(private.can_view('price_book'), 'You do not have permission to view screening questions.');
  select * into v_q from public.questionnaires where id = p_id;
  perform private.require(v_q.id is not null, 'Questionnaire not found.');
  if not exists (select 1 from public.questions where questionnaire_id = p_id) then
    v_problems := v_problems || 'There are no questions.';
  end if;
  if not exists (select 1 from public.rules where questionnaire_id = p_id and kind = 'add_item') then
    v_problems := v_problems || 'No rule adds a price, so every quote would be empty.';
  end if;
  if v_q.couple_question_key is not null and not exists (
    select 1 from public.questions where questionnaire_id = p_id and key = v_q.couple_question_key and not per_person) then
    v_problems := v_problems || format('The couple question "%s" is missing or is asked per person.', v_q.couple_question_key);
  end if;
  for r in select * from public.questions where questionnaire_id = p_id loop
    if r.answer_type = 'single_choice' and jsonb_array_length(r.options) < 2 then
      v_problems := v_problems || format('Question "%s" needs at least two choices.', r.key);
    end if;
    if r.show_if is not null and not exists (
      select 1 from public.questions q where q.questionnaire_id = p_id and q.key = r.show_if ->> 'question' and q.sort_order < r.sort_order) then
      v_problems := v_problems || format('Question "%s" depends on "%s", which is missing or comes later.', r.key, r.show_if ->> 'question');
    end if;
  end loop;
  for r in select * from public.rules where questionnaire_id = p_id loop
    for c in select * from jsonb_array_elements(r.conditions) loop
      if not exists (select 1 from public.questions q where q.questionnaire_id = p_id and q.key = c ->> 'question') then
        v_problems := v_problems || format('A rule refers to question "%s", which does not exist.', c ->> 'question');
      end if;
      if c ->> 'op' = 'gt_question' and not exists (
        select 1 from public.questions q where q.questionnaire_id = p_id and q.key = c ->> 'value' and q.answer_type = 'number') then
        v_problems := v_problems || format('A rule compares with "%s", which is not a number question.', c ->> 'value');
      end if;
      if c ->> 'op' not in ('eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'answered', 'not_answered', 'gt_question') then
        v_problems := v_problems || format('A rule uses an unknown comparison "%s".', c ->> 'op');
      end if;
    end loop;
    if jsonb_array_length(r.conditions) = 0 then
      v_problems := v_problems || 'A rule has no conditions.';
    end if;
    if r.kind = 'add_item' and not exists (select 1 from public.catalogue_items i where i.code = r.item_code and i.is_active) then
      v_problems := v_problems || format('A rule adds item %s, which is switched off.', r.item_code);
    end if;
    if r.kind = 'add_item' and not exists (select 1 from public.current_item_prices p join public.catalogue_items i on i.id = p.item_id where i.code = r.item_code) then
      v_problems := v_problems || format('Item %s has no price in effect today.', r.item_code);
    end if;
    if r.quantity_question_key is not null and not exists (
      select 1 from public.questions q where q.questionnaire_id = p_id and q.key = r.quantity_question_key and q.answer_type = 'number') then
      v_problems := v_problems || format('A rule takes its quantity from "%s", which is not a number question.', r.quantity_question_key);
    end if;
  end loop;
  return v_problems;
end;
$$;

create or replace function public.publish_questionnaire(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_q public.questionnaires;
  v_problems text[];
begin
  perform private.require(private.can_edit('price_book'), 'You do not have permission to publish screening questions.');
  select * into v_q from public.questionnaires where id = p_id;
  perform private.require(v_q.status = 'draft', 'Only a draft can be published.');
  v_problems := public.questionnaire_problems(p_id);
  perform private.require(coalesce(array_length(v_problems, 1), 0) = 0,
    'Fix these first: ' || array_to_string(v_problems, ' '));
  update public.questionnaires set status = 'retired' where route = v_q.route and status = 'published';
  update public.questionnaires set status = 'published', published_at = now(), published_by = (select auth.uid())
  where id = p_id;
end;
$$;

create or replace function public.delete_questionnaire_draft(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.can_edit('price_book'), 'You do not have permission to delete drafts.');
  delete from public.questionnaires where id = p_id and status = 'draft';
  perform private.require(found, 'Draft not found.');
end;
$$;

revoke all on function public.create_questionnaire_draft(text), public.questionnaire_problems(uuid),
  public.publish_questionnaire(uuid), public.delete_questionnaire_draft(uuid) from public, anon;
grant execute on function public.create_questionnaire_draft(text), public.questionnaire_problems(uuid),
  public.publish_questionnaire(uuid), public.delete_questionnaire_draft(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed: T1 price book from the build brief (prices before HST), effective 2026-11-01
-- ---------------------------------------------------------------------------

insert into public.catalogue_items (service_line_id, code, name, description, unit_label, per_spouse, sort_order)
select sl.id, v.code, v.name, v.description, v.unit_label, v.per_spouse, v.sort_order
from public.service_lines sl
cross join (values
  ('T1_BASE_SINGLE', 'Personal tax return, single', 'One personal tax return.', 'per return', false, 10),
  ('T1_BASE_COUPLE', 'Personal tax returns, couple filing together', 'Both returns for a married or common-law couple in the same household, on one invoice.', 'per couple', false, 20),
  ('T1_RENTAL', 'Rental property (T776)', 'One address is one property. A basement suite in your own home counts as one. Co-owned property is charged once.', 'per property', false, 30),
  ('T1_STR', 'Short-term rental', 'Short-term rental, reported as rental or business income.', 'per property', false, 40),
  ('T1_SELF_EMPLOYED', 'Self-employment (T2125)', 'Business or professional income.', 'per business', false, 50),
  ('T1_VEHICLE', 'Vehicle claim', 'Vehicle expenses for a business.', 'per vehicle', false, 60),
  ('T1_HOME_OFFICE', 'Home office', 'Business-use-of-home expenses.', 'per business', false, 70),
  ('T1_GST_RETURN', 'GST/HST return', 'GST/HST return for self-employment or rental income.', 'per return filed', false, 80),
  ('T1_INVESTMENT_SALES', 'Investment sales', 'Sales of stocks, funds and similar investments, all accounts.', 'per person', true, 90),
  ('T1_PR_SALE', 'Principal residence sale', 'Reporting the sale of your home.', 'per sale', false, 100),
  ('T1_PROPERTY_SALE', 'Rental or investment property sale', 'Includes property owned under 12 months and assignment sales.', 'per property', false, 110),
  ('T1_T1135_SIMPLE', 'Foreign property report (T1135), simplified', 'Form T1135, simplified method.', 'per person', true, 120),
  ('T1_T1135_DETAILED', 'Foreign property report (T1135), detailed', 'Form T1135, detailed method.', 'per person', true, 130),
  ('T1_FOREIGN_INCOME', 'Foreign income with no Canadian slip', 'Income from outside Canada with no Canadian tax slip.', 'per person', true, 140),
  ('T1_EMPLOYMENT_EXP', 'Employment expenses (T2200/T777)', 'Employment expenses supported by a T2200 from your employer.', 'per person', true, 150),
  ('T1_MOVING', 'Moving expenses', 'Moving expenses claim.', 'per person', true, 160)
) as v(code, name, description, unit_label, per_spouse, sort_order)
where sl.key = 't1';

insert into public.item_prices (item_id, amount_cents, effective_from, note)
select i.id, v.cents, date '2026-11-01', 'From the build brief'
from public.catalogue_items i
join (values
  ('T1_BASE_SINGLE', 29900), ('T1_BASE_COUPLE', 34900), ('T1_RENTAL', 24900), ('T1_STR', 24900),
  ('T1_SELF_EMPLOYED', 49900), ('T1_VEHICLE', 15000), ('T1_HOME_OFFICE', 15000), ('T1_GST_RETURN', 14900),
  ('T1_INVESTMENT_SALES', 9900), ('T1_PR_SALE', 9900), ('T1_PROPERTY_SALE', 24900),
  ('T1_T1135_SIMPLE', 14900), ('T1_T1135_DETAILED', 29900), ('T1_FOREIGN_INCOME', 14900),
  ('T1_EMPLOYMENT_EXP', 14900), ('T1_MOVING', 14900)
) as v(code, cents) on v.code = i.code;

-- ---------------------------------------------------------------------------
-- Seed: personal screening, version 1 (published) and corporate structure (draft)
-- Wording is a first draft for Hashim's review; owners can change it in a new draft.
-- ---------------------------------------------------------------------------

do $$
declare
  v_p uuid;
  v_c uuid;
begin
  insert into public.questionnaires (route, version, status, title, intro, couple_question_key, couple_value, published_at)
  values ('personal', 1, 'draft', 'File your personal tax return',
          'Answer a few questions. We use your answers to prepare your quote. It takes about 3 minutes.',
          'filing_type', 'couple', null)
  returning id into v_p;

  insert into public.questions (questionnaire_id, key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order) values
  (v_p, 'filing_type', 'About you', 'Who is filing?', '', 'single_choice',
     '[{"value":"single","label":"Just me"},{"value":"couple","label":"Me and my spouse or common-law partner. We live together, Concept prepares both returns, one invoice."}]', true, false, null, null, null, 10),
  (v_p, 'province', 'About you', 'Which province or territory did you live in on December 31?', '', 'province', '[]', true, false, null, null, null, 20),
  (v_p, 'latest_year', 'About you', 'Is this for the most recent tax year only?', 'Earlier years are handled separately.', 'yes_no', '[]', true, false, null, null, null, 30),
  (v_p, 'estate_or_trust', 'About you', 'Is this return for an estate or a trust?', '', 'yes_no', '[]', true, false, null, null, null, 40),
  (v_p, 'non_resident', 'Each person', 'Were you a non-resident of Canada for tax purposes at any time in the year?', '', 'yes_no', '[]', true, true, null, null, null, 50),
  (v_p, 'us_person', 'Each person', 'Are you a US citizen or a US green card holder?', '', 'yes_no', '[]', true, true, null, null, null, 60),
  (v_p, 'cra_review', 'Each person', 'Is CRA reviewing or auditing any of your tax returns right now?', '', 'yes_no', '[]', true, true, null, null, null, 70),
  (v_p, 'investment_sales', 'Each person', 'Did you sell any stocks, funds or other investments?', 'Count all your accounts together.', 'yes_no', '[]', true, true, null, null, null, 80),
  (v_p, 'foreign_property', 'Each person', 'What was the total cost of property you owned outside Canada, at its highest point in the year?', 'Cost, not market value. Include foreign bank accounts, shares and property you rent out. Do not include a home you use yourself.', 'single_choice',
     '[{"value":"none","label":"None, or under $100,000"},{"value":"simple","label":"$100,000 to $249,999"},{"value":"detailed","label":"$250,000 or more"}]', true, true, null, null, null, 90),
  (v_p, 'foreign_income', 'Each person', 'Did you earn income from outside Canada that has no Canadian tax slip?', '', 'yes_no', '[]', true, true, null, null, null, 100),
  (v_p, 'employment_expenses', 'Each person', 'Did your employer give you a T2200 to claim employment expenses?', '', 'yes_no', '[]', true, true, null, null, null, 110),
  (v_p, 'moving_expenses', 'Each person', 'Did you move for work or school and want to claim moving expenses?', '', 'yes_no', '[]', true, true, null, null, null, 120),
  (v_p, 'rental_count', 'Property and business', 'How many rental properties do you have?', 'One address is one property. A basement suite in your own home counts as one. If you own it with your spouse, count it once. Do not count short-term rentals here.', 'number', '[]', true, false, 0, 20, null, 130),
  (v_p, 'str_count', 'Property and business', 'How many short-term rental properties do you have (for example Airbnb)?', '', 'number', '[]', true, false, 0, 20, null, 140),
  (v_p, 'business_count', 'Property and business', 'How many businesses do you run as self-employed (not incorporated)?', 'If you are filing with your spouse, count both of your businesses.', 'number', '[]', true, false, 0, 10, null, 150),
  (v_p, 'vehicle_count', 'Property and business', 'How many vehicles do you use for those businesses?', '', 'number', '[]', true, false, 0, 10, '{"question":"business_count","op":"gt","value":0}', 160),
  (v_p, 'home_office_count', 'Property and business', 'How many of those businesses claim a home office?', '', 'number', '[]', true, false, 0, 10, '{"question":"business_count","op":"gt","value":0}', 170),
  (v_p, 'gst_return_count', 'Property and business', 'How many GST/HST returns should we file for you?', 'Enter 0 if you are not registered for GST/HST.', 'number', '[]', true, false, 0, 10, null, 180),
  (v_p, 'home_sale_count', 'Sales', 'How many homes that you lived in did you sell?', '', 'number', '[]', true, false, 0, 5, null, 190),
  (v_p, 'property_sale_count', 'Sales', 'How many rental or investment properties did you sell?', 'Include property you owned less than 12 months and assignment sales.', 'number', '[]', true, false, 0, 20, null, 200);

  insert into public.rules (questionnaire_id, kind, conditions, item_code, quantity_question_key, message, sort_order) values
  -- Out of scope
  (v_p, 'out_of_scope', '[{"question":"latest_year","op":"eq","value":"no"}]', null, null, 'Earlier tax years', 10),
  (v_p, 'out_of_scope', '[{"question":"estate_or_trust","op":"eq","value":"yes"}]', null, null, 'Estate or trust return', 20),
  (v_p, 'out_of_scope', '[{"question":"non_resident","op":"eq","value":"yes"}]', null, null, 'Non-resident', 30),
  (v_p, 'out_of_scope', '[{"question":"us_person","op":"eq","value":"yes"}]', null, null, 'US citizen or green card holder', 40),
  (v_p, 'out_of_scope', '[{"question":"cra_review","op":"eq","value":"yes"}]', null, null, 'CRA review or audit underway', 50),
  -- Checks
  (v_p, 'check', '[{"question":"home_office_count","op":"gt_question","value":"business_count"}]', null, null, 'Home offices cannot be more than the number of businesses.', 60),
  -- Prices
  (v_p, 'add_item', '[{"question":"filing_type","op":"eq","value":"single"}]', 'T1_BASE_SINGLE', null, '', 100),
  (v_p, 'add_item', '[{"question":"filing_type","op":"eq","value":"couple"}]', 'T1_BASE_COUPLE', null, '', 110),
  (v_p, 'add_item', '[{"question":"rental_count","op":"gt","value":0}]', 'T1_RENTAL', 'rental_count', '', 120),
  (v_p, 'add_item', '[{"question":"str_count","op":"gt","value":0}]', 'T1_STR', 'str_count', '', 130),
  (v_p, 'add_item', '[{"question":"business_count","op":"gt","value":0}]', 'T1_SELF_EMPLOYED', 'business_count', '', 140),
  (v_p, 'add_item', '[{"question":"vehicle_count","op":"gt","value":0}]', 'T1_VEHICLE', 'vehicle_count', '', 150),
  (v_p, 'add_item', '[{"question":"home_office_count","op":"gt","value":0}]', 'T1_HOME_OFFICE', 'home_office_count', '', 160),
  (v_p, 'add_item', '[{"question":"gst_return_count","op":"gt","value":0}]', 'T1_GST_RETURN', 'gst_return_count', '', 170),
  (v_p, 'add_item', '[{"question":"investment_sales","op":"eq","value":"yes"}]', 'T1_INVESTMENT_SALES', null, '', 180),
  (v_p, 'add_item', '[{"question":"home_sale_count","op":"gt","value":0}]', 'T1_PR_SALE', 'home_sale_count', '', 190),
  (v_p, 'add_item', '[{"question":"property_sale_count","op":"gt","value":0}]', 'T1_PROPERTY_SALE', 'property_sale_count', '', 200),
  (v_p, 'add_item', '[{"question":"foreign_property","op":"eq","value":"simple"}]', 'T1_T1135_SIMPLE', null, '', 210),
  (v_p, 'add_item', '[{"question":"foreign_property","op":"eq","value":"detailed"}]', 'T1_T1135_DETAILED', null, '', 220),
  (v_p, 'add_item', '[{"question":"foreign_income","op":"eq","value":"yes"}]', 'T1_FOREIGN_INCOME', null, '', 230),
  (v_p, 'add_item', '[{"question":"employment_expenses","op":"eq","value":"yes"}]', 'T1_EMPLOYMENT_EXP', null, '', 240),
  (v_p, 'add_item', '[{"question":"moving_expenses","op":"eq","value":"yes"}]', 'T1_MOVING', null, '', 250);

  update public.questionnaires set status = 'published', published_at = now() where id = v_p;

  -- Corporate: structure only. Prices and rules come with the T2 price book.
  insert into public.questionnaires (route, version, status, title, intro)
  values ('corporate', 1, 'draft', 'File your corporate tax return',
          'Answer a few questions about your corporation. We use your answers to prepare your quote.')
  returning id into v_c;

  insert into public.questions (questionnaire_id, key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order) values
  (v_c, 'corp_province', 'About the corporation', 'Which province is the corporation registered in?', '', 'province', '[]', true, false, null, null, null, 10),
  (v_c, 'year_end_latest', 'About the corporation', 'Is this for the corporation''s most recent year end only?', 'Earlier years are handled separately.', 'yes_no', '[]', true, false, null, null, null, 20),
  (v_c, 'books_done', 'About the corporation', 'Are the books for the year complete and reconciled?', '', 'yes_no', '[]', true, false, null, null, null, 30),
  (v_c, 'cra_review_corp', 'About the corporation', 'Is CRA reviewing or auditing the corporation right now?', '', 'yes_no', '[]', true, false, null, null, null, 40);
end;
$$;
