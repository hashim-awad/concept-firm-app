-- Round 31 (Hashim, Nov 17, 2026): every file uploaded gets a result in the upload window. A file that is another copy
-- of a statement already in the list is still removed (one copy of each statement, round 22), but it now says which
-- upload it is a copy of, so the window can say so and follow that upload instead of showing nothing.
-- Benchmark: QuickBooks Online "Upload from file", where every file sent gets a result line. Safe to run twice.

alter table public.cb_statement_imports add column if not exists copy_of uuid references public.cb_statement_imports(id) on delete set null;

create or replace function public.statement_keep_one(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.cb_statement_imports; k public.cb_statement_imports;
begin
  select * into v from public.cb_statement_imports where id = p_id for update;
  if v.id is null or v.file_id is null or v.status in ('discarded', 'imported', 'skipped', 'uploading') then return null; end if;
  select * into k from public.cb_statement_imports o
   where o.file_id = v.file_id and o.id <> v.id
     and o.status in ('queued', 'reading', 'ready', 'needs_look')
     and (o.created_at, o.id) < (v.created_at, v.id)
     and ((v.file_sha256 is not null and o.file_sha256 = v.file_sha256)
       or (v.summary ->> 'period_start' is not null
           and o.summary ->> 'period_start' = v.summary ->> 'period_start' and o.summary ->> 'period_end' = v.summary ->> 'period_end'
           and (o.target_account is null or v.target_account is null or o.target_account = v.target_account)
           and exists (select 1 from jsonb_array_elements(coalesce(v.summary -> 'found', '[]')) a, jsonb_array_elements(coalesce(o.summary -> 'found', '[]')) b
                        where length(regexp_replace(coalesce(a ->> 'last4', ''), '\D', '', 'g')) >= 2
                          and right(regexp_replace(a ->> 'last4', '\D', '', 'g'), 4) = right(regexp_replace(coalesce(b ->> 'last4', ''), '\D', '', 'g'), 4))))
   order by o.created_at, o.id limit 1;
  if k.id is null then return null; end if;
  update public.cb_statement_imports set status = 'discarded', result = null, edited = null, summary = null, finished_at = coalesce(finished_at, now()),
         error = 'Another copy of this statement is already in the list.', copy_of = k.id where id = v.id;   -- Round 31: which upload it is a copy of
  if k.target_account is null and v.target_account is not null then
    update public.cb_statement_imports set target_account = v.target_account where id = k.id;
  end if;
  return k.id;
end;
$$;
revoke all on function public.statement_keep_one(uuid) from public, anon, authenticated;
grant execute on function public.statement_keep_one(uuid) to service_role;
