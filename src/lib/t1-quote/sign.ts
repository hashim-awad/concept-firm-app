import "server-only";
// Signing a T1 quote through a private link (batch sections 7 and 9), and the signed PDF.
// Runs with the server key; the database checks every rule again (record_t1_signature).
import { createAdminClient } from "@/lib/supabase/admin";
import { renderPdf } from "@/lib/studio/pdf";
import { LETTERHEAD_URL, renderQuote } from "./render";
import { documentHash } from "./document";
import { signedPdfDef } from "./pdf-def";
import { letterSigner, loadQuoteByToken, toCorpData, toQuoteData, type QuoteRow, type SignerRow } from "./server";
import { corpPartBBlocks, renderCorpQuote } from "@/lib/corporate/render";
import { LETTERHEAD } from "@/lib/studio/assets.generated";

// The quote exactly as the client sees it (no watermark), from what was saved when it was sent.
export async function clientParts(q: QuoteRow, signers: SignerRow[]) {
  if (q.kind === "corporate") return renderCorpQuote(q.wording ?? {}, toCorpData(q, signers, { preparedBy: q.sender?.name ?? "", signer: await letterSigner() }), { letterhead: LETTERHEAD_URL });
  return renderQuote(q.wording ?? {}, toQuoteData(q, signers, { preparedBy: q.sender?.name ?? "", signer: await letterSigner() }), { letterhead: LETTERHEAD_URL });
}

export async function signByToken(token: string, input: { name: string; title?: string; consent: boolean; forOther: boolean; ip: string; agent: string }): Promise<{ error?: string }> {
  const found = await loadQuoteByToken(token);
  if (!found) return { error: "This link does not work." };
  const { quote, signers, me } = found;
  if (!input.consent) return { error: "Tick the box to agree to your quote and the engagement terms." };
  if (input.name.trim().length < 2) return { error: "Type your full name to sign." };
  if (quote.kind === "corporate" && (input.title ?? "").trim().length < 2) return { error: "Type your title at the company to sign." };
  // Same device (section 7): after one spouse signs, the other can sign here, on the first one's link.
  let person = me.person;
  if (input.forOther) {
    const other = signers.find((s) => s.person !== me.person);
    if (!other || !me.signed_at || other.signed_at) return { error: "Nothing to sign here." };
    person = other.person;
  }
  const hash = documentHash(await clientParts(quote, signers));
  const db = createAdminClient();
  const { data: all, error } = await db.rpc("record_t1_signature", {
    p_quote: quote.id, p_person: person, p_name: input.name.trim(), p_ip: input.ip, p_agent: input.agent, p_hash: hash, p_same_device: input.forOther, p_title: quote.kind === "corporate" ? (input.title ?? "").trim() : null,
  });
  if (error) return { error: error.message };
  if (all === true) await makeSignedPdf(quote.id).catch(() => undefined); // retried on download if it fails
  return {};
}

// The signed PDF with its audit page, stored once in the private vault bucket.
export async function makeSignedPdf(quoteId: string): Promise<string | null> {
  const db = createAdminClient();
  const { data: q } = await db.from("t1_quotes").select("id, lead_id, tax_year, couple, lines, total_cents, status, sent_at, valid_until, sender, signer, wording, wording_label, kind, company_name, year_end, details, pdf_path").eq("id", quoteId).maybeSingle();
  if (!q || q.status !== "signed") return null;
  if (q.pdf_path) return q.pdf_path as string;
  const { data: s } = await db.from("t1_quote_signers").select("person, first_name, last_name, email, token, signed_at, signed_name, signed_ip, signed_agent, document_hash, same_device, signed_title").eq("quote_id", quoteId).order("person");
  const signers = (s ?? []) as (SignerRow & { signed_name: string; signed_ip: string; signed_agent: string; document_hash: string; same_device: boolean; signed_title: string | null })[];
  const parts = await clientParts(q as QuoteRow, signers);
  // Corporate: Part B is the master letter, laid out by Studio's own engine (pdfDoc), word for word.
  let partB: { content: unknown[]; images: Record<string, string> } | undefined;
  if (q.kind === "corporate") {
    const d = toCorpData(q as QuoteRow, signers, { preparedBy: q.sender?.name ?? "", signer: await letterSigner() });
    const { e, s: st, blocks } = corpPartBBlocks(q.wording ?? {}, d);
    const dd = e.pdfDoc(st, blocks, LETTERHEAD);
    partB = { content: dd.content, images: dd.images };
  }
  const { bytes, sha256 } = await renderPdf(signedPdfDef(parts, {
    quoteId: q.id, taxYear: q.tax_year, sentAt: q.sent_at ?? "", validUntil: q.valid_until ?? "", wordingLabel: q.wording_label ?? "",
    clientNames: q.kind === "corporate" ? `${q.company_name}` : signers.map((x) => `${x.first_name} ${x.last_name}`).join(" and "),
    company: q.kind === "corporate" ? q.company_name ?? "" : undefined,
    signers: signers.map((x) => ({ name: `${x.first_name} ${x.last_name}`, signedName: x.signed_name, email: x.email, signedAt: x.signed_at ?? "", ip: x.signed_ip, agent: x.signed_agent, sameDevice: x.same_device, documentHash: x.document_hash, title: x.signed_title ?? undefined })),
  }, partB));
  const path = `t1-quotes/${q.id}/signed-${sha256.slice(0, 12)}.pdf`;
  const up = await db.storage.from("documents").upload(path, bytes, { contentType: "application/pdf", upsert: false });
  if (up.error && !/exists/i.test(up.error.message)) throw new Error(up.error.message);
  await db.rpc("store_t1_signed_pdf", { p_quote: q.id, p_path: path, p_sha256: sha256 });
  return path;
}

export async function signedPdfBytes(quoteId: string): Promise<Blob | null> {
  const path = await makeSignedPdf(quoteId);
  if (!path) return null;
  const { data } = await createAdminClient().storage.from("documents").download(path);
  return data ?? null;
}
