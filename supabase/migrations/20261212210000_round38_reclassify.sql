-- Round 38 (Hashim, Nov 18, 2026): Reclassify transactions (benchmarks: QuickBooks Online's "Reclassify Transactions",
-- Xero's "Find and recode"). Many posted lines move to another account (and sales tax) in one step, with Undo.
--   * A bank line: its coded side changes account (and tax, when chosen) and re-posts; date, amount, description and
--     memo stay. The bank, card or loan side, a transfer, a split, an outstanding item and a Pending line do not change
--     here (step 3 or step 4).
--   * An entry line: its account changes. Its sales tax stays: the entry's tax line is worked out from it in step 5.
--     A sales tax line, and an entry made by a working paper, do not change here.
--   * One batch: History logs the batch (who, when, from, to, count, total) and each line (bank lines through the
--     existing line trigger; entry lines here). Sign-offs fall as if each line had changed in its own step (the
--     existing cb_changed trigger: a bank line removes step 4's, an entry line step 5's).
--   * Undo puts each line back, unless it changed again since.
-- Lead sheets: "Explain the change" gains "Revenue fell" and "Other".
-- No data is changed. Never drops a table or column (one check constraint is replaced). Safe to run twice.

create table if not exists public.cb_reclass_batches (
  id           uuid primary key default gen_random_uuid(),
  file_id      uuid not null references public.cb_files (id) on delete cascade,
  created_by   uuid references public.staff (id),
  created_at   timestamptz not null default now(),
  target       text not null default '',            -- the account (chart number, or the file account's id), '' when only the tax changed
  target_label text not null default '',
  tax          text,
  n            int not null default 0,
  total        numeric not null default 0,          -- as shown on the page when applied
  undone_at    timestamptz,
  undone_by    uuid references public.staff (id)
);
create table if not exists public.cb_reclass_items (
  batch_id     uuid not null references public.cb_reclass_batches (id) on delete cascade,
  kind         text not null check (kind in ('bank', 'entry')),
  item_id      uuid not null,
  old_account  text,
  old_tax      text,
  old_source   text,
  old_rule     uuid,
  new_account  text,
  new_tax      text,
  primary key (batch_id, kind, item_id)
);
create index if not exists cb_reclass_batches_file on public.cb_reclass_batches (file_id, created_at desc);
alter table public.cb_reclass_batches enable row level security;
alter table public.cb_reclass_items enable row level security;
drop policy if exists "Closebook viewers read reclass batches" on public.cb_reclass_batches;
create policy "Closebook viewers read reclass batches" on public.cb_reclass_batches for select to authenticated using ((select private.can_view('closebook')));
drop policy if exists "Closebook viewers read reclass items" on public.cb_reclass_items;
create policy "Closebook viewers read reclass items" on public.cb_reclass_items for select to authenticated using ((select private.can_view('closebook')));
revoke insert, update, delete on public.cb_reclass_batches, public.cb_reclass_items from authenticated, anon;
grant select on public.cb_reclass_batches, public.cb_reclass_items to authenticated;
grant select, insert, update, delete on public.cb_reclass_batches, public.cb_reclass_items to service_role;

-- The bank, card and loan accounts: never a target (they change in step 3 and step 4).
create or replace function private.cb_bank_chart(p_file uuid, p_number text) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_number in ('10000', '10100', '10200', '22000', '22100', '25000', '25200')
      or exists (select 1 from public.cb_bank_accounts b where b.file_id = p_file and (b.chart_account = p_number or b.number = p_number));
$$;
revoke all on function private.cb_bank_chart(uuid, text) from public, anon, authenticated;

create or replace function private.cb_entry_label(p_entry uuid) returns text
language sql stable security definer set search_path = '' as $$
  select format('%s-%s %s', to_char(f.year_end, 'YYYY'), lpad(e.seq::text, 3, '0'), e.kind) from public.cb_entries e join public.cb_files f on f.id = e.file_id where e.id = p_entry;
$$;
revoke all on function private.cb_entry_label(uuid) from public, anon, authenticated;

create or replace function private.cb_account_label(p_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select btrim(coalesce(nullif(number, '') || ' ', '') || name) from public.cb_accounts where id = p_id;
$$;
revoke all on function private.cb_account_label(uuid) from public, anon, authenticated;

-- p_items: [{"kind": "bank" | "entry", "id": uuid}]. p_account: a standard chart number (a bank file) or a file
-- account's id (a trial balance file); null keeps each line's account. p_tax: a sales tax code, or null to keep it.
create or replace function public.cb_reclassify(p_file uuid, p_items jsonb, p_account text, p_tax text, p_total numeric default 0) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_file public.cb_files := private.cb_file_open(p_file);
  v_bankfile boolean := v_file.books in ('statements', 'paper');
  v_acc text := nullif(btrim(coalesce(p_account, '')), '');
  v_tax text := nullif(btrim(coalesce(p_tax, '')), '');
  v_chart public.cb_chart_accounts;
  v_target uuid; v_label text := ''; v_batch uuid; it jsonb;
  l public.cb_bank_lines; el public.cb_entry_lines; e public.cb_entries;
  v_new_acc text; v_new_tax text; v_bn int := 0; v_en int := 0; v_from text[] := '{}';
begin
  perform private.require(jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) between 1 and 5000, 'Tick the lines to reclassify.');
  perform private.require(v_acc is not null or v_tax is not null, 'Choose an account, a sales tax code, or both.');
  if v_acc is not null then
    if v_bankfile then
      select * into v_chart from public.cb_chart_accounts where number = v_acc;
      perform private.require(v_chart.number is not null, 'Choose an account from the chart.');
      perform private.require(not private.cb_bank_chart(p_file, v_acc), 'Bank, card and loan accounts change in step 3 and step 4, not here.');
      v_label := v_chart.number || ' ' || v_chart.name;
    else
      perform private.require(v_acc ~ '^[0-9a-f-]{36}$' and exists (select 1 from public.cb_accounts where id = v_acc::uuid and file_id = p_file and line_no is not null),
        'Choose one of this file''s accounts with a GIFI line.');
      v_target := v_acc::uuid; v_label := private.cb_account_label(v_target);
    end if;
  end if;
  perform private.require(v_tax is null or exists (select 1 from public.cb_sales_tax_codes where code = v_tax), 'Choose a sales tax code from the list.');
  insert into public.cb_reclass_batches (file_id, created_by, target, target_label, tax, total)
  values (p_file, (select auth.uid()), coalesce(v_acc, ''), v_label, v_tax, coalesce(p_total, 0)) returning id into v_batch;

  for it in select * from jsonb_array_elements(p_items) loop
    if it ->> 'kind' = 'bank' then
      perform private.require(v_bankfile, 'Line not found.');
      select * into l from public.cb_bank_lines where id = (it ->> 'id')::uuid and file_id = p_file for update;
      perform private.require(l.id is not null, 'Line not found. Nothing was changed.');
      perform private.require(l.status in ('done', 'reviewer') and not private.cb_line_pending(l), format('%s: only a posted line changes here. Post it in step 4 first. Nothing was changed.', left(l.description, 40)));
      perform private.require(l.transfer_account is null and coalesce(l.source, '') not in ('transfer', 'outstanding')
        and not exists (select 1 from public.cb_bank_transfers t where t.out_line = l.id or t.in_line = l.id), format('%s is a transfer: change it in step 4. Nothing was changed.', left(l.description, 40)));
      perform private.require(not l.is_split, format('%s is split: change it with Split. Nothing was changed.', left(l.description, 40)));
      perform private.require(l.chart_account is not null, 'Line not found. Nothing was changed.');
      v_new_acc := coalesce(v_acc, l.chart_account); v_new_tax := coalesce(v_tax, l.tax_code);
      if v_new_acc is distinct from l.chart_account or v_new_tax is distinct from l.tax_code then
        insert into public.cb_reclass_items (batch_id, kind, item_id, old_account, old_tax, old_source, old_rule, new_account, new_tax)
        values (v_batch, 'bank', l.id, l.chart_account, l.tax_code, l.source, l.rule_id, v_new_acc, v_new_tax);
        v_from := array_append(v_from, l.chart_account);
        -- The line's own trigger logs "Coding changed" (old and new), and cb_changed removes step 4's sign-off.
        update public.cb_bank_lines set chart_account = v_new_acc, tax_code = v_new_tax, source = 'manual', rule_id = null where id = l.id;
        v_bn := v_bn + 1;
      end if;
    elsif it ->> 'kind' = 'entry' then
      select * into el from public.cb_entry_lines where id = (it ->> 'id')::uuid for update;
      select * into e from public.cb_entries where id = el.entry_id;
      perform private.require(e.id is not null and e.file_id = p_file, 'Entry line not found. Nothing was changed.');
      perform private.require(not coalesce(el.is_tax, false), format('Entry %s: a sales tax line follows its entry. Change the entry in step 5. Nothing was changed.', private.cb_entry_label(e.id)));
      perform private.require(coalesce(e.origin, '') = '', format('Entry %s comes from a working paper: change it there. Nothing was changed.', private.cb_entry_label(e.id)));
      if v_acc is null then continue; end if;   -- an entry line keeps its sales tax (its tax line is worked out in step 5)
      if v_bankfile and v_target is null then
        insert into public.cb_accounts (file_id, account_key, number, name, this_year, line_no, mapping_source, mapped_at)
        values (p_file, 'chart:' || v_chart.number, v_chart.number, v_chart.name, 0, v_chart.line_no, 'chart', now())
        on conflict (file_id, account_key) do nothing;
        select id into v_target from public.cb_accounts where file_id = p_file and account_key = 'chart:' || v_chart.number;
      end if;
      if v_target is distinct from el.account_id then
        insert into public.cb_reclass_items (batch_id, kind, item_id, old_account, old_tax, new_account, new_tax)
        values (v_batch, 'entry', el.id, el.account_id::text, el.tax_code, v_target::text, el.tax_code);
        v_from := array_append(v_from, coalesce(private.cb_account_label(el.account_id), ''));
        perform private.cb_log_event(p_file, 'entry_line_reclassified', 'entries', format('Entry %s line reclassified', private.cb_entry_label(e.id)), null, null,
          private.cb_entry_label(e.id), coalesce(nullif(el.memo, ''), ''), coalesce(private.cb_account_label(el.account_id), ''), v_label);
        update public.cb_entry_lines set account_id = v_target where id = el.id;   -- cb_changed removes step 5's sign-off
        v_en := v_en + 1;
      end if;
    else
      raise exception 'Line not found. Nothing was changed.' using errcode = 'P0001';
    end if;
  end loop;
  perform private.require(v_bn + v_en > 0, 'Nothing to change: the ticked lines already have this account and sales tax.');
  update public.cb_reclass_batches set n = v_bn + v_en where id = v_batch;
  perform private.cb_log_event(p_file, 'reclassified', case when v_bn = 0 then 'entries' else 'code' end,
    format('Reclassified %s line%s', v_bn + v_en, case when v_bn + v_en = 1 then '' else 's' end), null, null,
    format('%s line%s, %s', v_bn + v_en, case when v_bn + v_en = 1 then '' else 's' end, to_char(coalesce(p_total, 0), 'FM999,999,999,990.00')),
    concat_ws(', ', case when v_bn > 0 then format('%s bank line%s', v_bn, case when v_bn = 1 then '' else 's' end) end,
      case when v_en > 0 then format('%s entry line%s', v_en, case when v_en = 1 then '' else 's' end) end),
    (select string_agg(distinct x, ', ') from unnest(v_from) x),
    concat_ws(', ', nullif(v_label, ''), case when v_tax is not null then 'sales tax ' || v_tax end));
  return v_batch;
end;
$$;

-- Undo: each line goes back as it was, unless it changed again since (then it is left and counted).
create or replace function public.cb_reclassify_undo(p_batch uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare b public.cb_reclass_batches; v_file public.cb_files; i public.cb_reclass_items; l public.cb_bank_lines; el public.cb_entry_lines; v_n int := 0; v_skip int := 0;
begin
  select * into b from public.cb_reclass_batches where id = p_batch for update;
  perform private.require(b.id is not null, 'Not found.');
  v_file := private.cb_file_open(b.file_id);
  perform private.require(b.undone_at is null, 'This was already undone.');
  for i in select * from public.cb_reclass_items where batch_id = p_batch loop
    if i.kind = 'bank' then
      select * into l from public.cb_bank_lines where id = i.item_id for update;
      if l.id is not null and l.chart_account is not distinct from i.new_account and l.tax_code is not distinct from i.new_tax and l.status in ('done', 'reviewer') then
        update public.cb_bank_lines set chart_account = i.old_account, tax_code = i.old_tax, source = i.old_source, rule_id = i.old_rule where id = l.id;
        v_n := v_n + 1;
      else v_skip := v_skip + 1; end if;
    else
      select * into el from public.cb_entry_lines where id = i.item_id for update;
      if el.id is not null and el.account_id::text = i.new_account then
        perform private.cb_log_event(b.file_id, 'entry_line_reclassified', 'entries', format('Entry %s line reclassified (undo)', private.cb_entry_label(el.entry_id)), null, null,
          private.cb_entry_label(el.entry_id), '', coalesce(private.cb_account_label(el.account_id), ''), coalesce(private.cb_account_label(i.old_account::uuid), ''));
        update public.cb_entry_lines set account_id = i.old_account::uuid where id = el.id;
        v_n := v_n + 1;
      else v_skip := v_skip + 1; end if;
    end if;
  end loop;
  update public.cb_reclass_batches set undone_at = now(), undone_by = (select auth.uid()) where id = p_batch;
  perform private.cb_log_event(b.file_id, 'reclass_undone', 'code', format('Reclassify undone: %s line%s back', v_n, case when v_n = 1 then '' else 's' end), null, null,
    format('%s line%s', b.n, case when b.n = 1 then '' else 's' end), case when v_skip > 0 then format('%s changed since and left as they are', v_skip) else '' end,
    b.target_label, 'as before');
  return v_n;
end;
$$;
revoke all on function public.cb_reclassify(uuid, jsonb, text, text, numeric), public.cb_reclassify_undo(uuid) from public, anon;
grant execute on function public.cb_reclassify(uuid, jsonb, text, text, numeric), public.cb_reclassify_undo(uuid) to authenticated;

-- ---------- Lead sheets: two more reasons ("Other" with a note, as every reason has).
alter table public.cb_flag_notes drop constraint if exists cb_flag_notes_reason_check;
alter table public.cb_flag_notes add constraint cb_flag_notes_reason_check
  check (reason in ('new_asset', 'new_loan', 'revenue_grew', 'revenue_fell', 'one_time', 'reclassified', 'error_fixed', 'other'));
