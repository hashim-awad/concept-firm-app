-- Phase 2 step 8: signing the T1 quote (batch sections 7 and 9, Appendix A Part C).
-- Each signer signs through their own private link: typed full name, consent ticked. The signing
-- record keeps who, when, the IP address, the browser, a fingerprint of the exact document signed,
-- and whether a spouse signed on the other's device. The quote counts as signed only when every
-- signer has signed; then the signed PDF (with an audit page) is stored and the lead shows Signed.

alter table public.t1_quote_signers
  add column signed_name   text,
  add column signed_ip     text,
  add column signed_agent  text,
  add column document_hash text check (document_hash is null or document_hash ~ '^[0-9a-f]{64}$'),
  add column same_device   boolean not null default false;

alter table public.t1_quotes
  add column signed_at  timestamptz,
  add column pdf_path   text,
  add column pdf_sha256 text check (pdf_sha256 is null or pdf_sha256 ~ '^[0-9a-f]{64}$');

-- Record one signature. Server only (the client's page signs through the server).
create or replace function public.record_t1_signature(p_quote uuid, p_person int, p_name text, p_ip text, p_agent text, p_hash text, p_same_device boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_q public.t1_quotes;
  v_all boolean;
begin
  select * into v_q from public.t1_quotes where id = p_quote for update;
  perform private.require(v_q.id is not null, 'Quote not found.');
  perform private.require(v_q.status = 'sent', 'This quote cannot be signed.');
  perform private.require(v_q.valid_until >= (now() at time zone 'America/Toronto')::date, 'This quote has expired.');
  perform private.require(length(btrim(coalesce(p_name, ''))) between 2 and 120, 'Type your full name to sign.');
  perform private.require(coalesce(p_hash, '') ~ '^[0-9a-f]{64}$', 'The document could not be checked.');
  update public.t1_quote_signers
     set signed_at = now(), signed_name = btrim(p_name), signed_ip = left(coalesce(p_ip, ''), 100),
         signed_agent = left(coalesce(p_agent, ''), 400), document_hash = p_hash, same_device = coalesce(p_same_device, false)
   where quote_id = p_quote and person = p_person and signed_at is null;
  perform private.require(found, 'Already signed.');
  v_all := not exists (select 1 from public.t1_quote_signers where quote_id = p_quote and signed_at is null);
  if v_all then
    update public.t1_quotes set status = 'signed', signed_at = now() where id = p_quote;
    update public.leads set status = 'signed' where id = v_q.lead_id;
  end if;
  return v_all;
end;
$$;

-- Keep the signed PDF's place and fingerprint. Server only.
create or replace function public.store_t1_signed_pdf(p_quote uuid, p_path text, p_sha256 text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.t1_quotes set pdf_path = p_path, pdf_sha256 = p_sha256 where id = p_quote and status = 'signed' and pdf_path is null;
end;
$$;

revoke all on function public.record_t1_signature(uuid, int, text, text, text, text, boolean), public.store_t1_signed_pdf(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_t1_signature(uuid, int, text, text, text, text, boolean), public.store_t1_signed_pdf(uuid, text, text) to service_role;

-- GST/HST rate for the PTX-100 invoice line (staff page). Approved rates only.
create or replace function public.t1_invoice_tax(p_province text)
returns table (tax text, rate_percent numeric) language sql stable security definer set search_path = '' as $$
  select r.tax, r.rate_percent from public.tax_rates r
  where (select private.can_view('pricing')) and r.province = p_province and r.status = 'approved'
    and r.effective_from <= (now() at time zone 'America/Toronto')::date
  order by r.effective_from desc limit 1
$$;
revoke all on function public.t1_invoice_tax(text) from public, anon;
grant execute on function public.t1_invoice_tax(text) to authenticated;
