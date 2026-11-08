// Builds a letter or proposal on the server from the screen's inputs, checks it with the same
// rules as the screen (and Studio), renders the PDF with Studio's layout, files it in the
// document vault as a new permanent version, and for Final documents records the engagement
// or proposal the way Studio's Record button did. Nothing is trusted from the browser except
// the form inputs: checks, wording and the PDF are rebuilt here.
import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canEdit, type Access } from "@/lib/access";
import { createStudioEngine, type StudioEngine } from "./engine.generated";
import type { Fee } from "./controllers";
import { loadSignature, loadStudioData } from "./data";
import { BLANK_PNG, engineFor, rebuild, type Built, type DocKind } from "./build";
import { renderPdf } from "./pdf";
import { todayToronto as today } from "@/lib/dates";

export type { DocKind };
export type SaveInput = { kind: DocKind; snapshot: any; clientId: string; documentId: string };
export type SaveResult = { ok: true; documentId: string; versionId: string; version: number; fileName: string; note?: string } | { ok: false; error: string };

export async function saveDocument(supabase: SupabaseClient, access: Access, input: SaveInput): Promise<SaveResult> {
  if (!canEdit(access, "documents")) return { ok: false, error: "You do not have permission to make documents." };
  if (!["corporate_letter", "t1_letter", "proposal"].includes(input.kind)) return { ok: false, error: "Unknown document type." };
  const data = await loadStudioData(supabase, access);
  const client = input.clientId ? data.clients.find((c) => c.url === input.clientId) ?? null : null;
  if (input.clientId && !client) return { ok: false, error: "That client record was not found." };
  const final = input.snapshot?.mode === "final";

  let sig = BLANK_PNG;
  if (final) {
    if (!access.is_owner) return { ok: false, error: input.kind === "proposal" ? "Only Hashim can issue a Final proposal." : "Only Hashim can issue a Final letter." };
    const loaded = input.kind === "proposal" ? BLANK_PNG : await loadSignature(supabase);
    if (!loaded) return { ok: false, error: "Upload the signature image under Settings before issuing a Final letter." };
    sig = loaded;
  }

  let b: Built;
  try { b = rebuild(input.kind, engineFor(input.kind, data, sig), input.snapshot, client, access.is_owner, today()); }
  catch (err) { return { ok: false, error: err instanceof Error ? err.message : "Could not build the document." }; }
  if (!b.scr.ok) return { ok: false, error: b.scr.message || "Fix the items listed first." };

  // Final documents are recorded first, so a refusal (e.g. already signed) stops before filing.
  let engagementId: string | null = null, proposalId: string | null = null, note = "";
  if (final) {
    const r = input.kind === "proposal" ? await recordProposal(supabase, b, input.clientId) : input.kind === "t1_letter" ? await recordT1(supabase, b, access, input.clientId) : await recordCorporate(supabase, b, access, input.clientId);
    if (!r.ok) return r;
    engagementId = r.engagementId ?? null; proposalId = r.proposalId ?? null; note = r.note;
  }

  // The document (one per letter or proposal) and its next version.
  let documentId = input.documentId;
  let current = 0;
  if (documentId) {
    const { data: doc } = await supabase.from("documents").select("id, kind, current_version").eq("id", documentId).maybeSingle();
    if (!doc || doc.kind !== input.kind) return { ok: false, error: "That document was not found." };
    current = doc.current_version;
    const link: Record<string, string> = {};
    if (engagementId) link.engagement_id = engagementId;
    if (proposalId) link.proposal_id = proposalId;
    if (input.clientId) link.client_id = input.clientId;
    if (Object.keys(link).length) await supabase.from("documents").update(link).eq("id", documentId);
  } else {
    const { data: doc, error } = await supabase.from("documents").insert({
      kind: input.kind, title: b.title, client_id: input.clientId || null, engagement_id: engagementId, proposal_id: proposalId,
    }).select("id").single();
    if (error || !doc) return { ok: false, error: "Could not create the document record." };
    documentId = doc.id;
  }

  const pdf = await renderPdf(b.def);
  const path = `${documentId}/${randomUUID()}.pdf`;
  const up = await supabase.storage.from("documents").upload(path, pdf.bytes, { contentType: "application/pdf", upsert: false });
  if (up.error) return { ok: false, error: "Could not store the PDF in the vault." };
  const { data: ver, error: vErr } = await supabase.from("document_versions").insert({
    document_id: documentId, version: current + 1, mode: final ? "final" : "draft", el_version: b.e.EL_VERSION,
    inputs: b.inputs, file_path: path, file_name: b.fileName, file_sha256: pdf.sha256, file_size: pdf.bytes.length,
  }).select("id, version").single();
  if (vErr || !ver) return { ok: false, error: "Could not save the new version. Try again." };
  return { ok: true, documentId: documentId!, versionId: ver.id, version: ver.version, fileName: b.fileName, note };
}

type Rec = { ok: true; engagementId?: string; proposalId?: string; note: string } | { ok: false; error: string };

// Studio onRecord(): the engagement row for a Final corporate letter, status "EL sent".
async function recordCorporate(supabase: SupabaseClient, b: Built, access: Access, clientId: string): Promise<Rec> {
  const { s, e } = b;
  if (!clientId) return { ok: false, error: "Final needs a client record with a verified legal name." };
  const fye = s.ye;
  const { data: found } = await supabase.from("engagements").select("id, el_signed, notes").eq("client_id", clientId).eq("fiscal_year_end", fye).neq("type", "T1 personal").limit(1);
  const exists = found?.[0];
  if (exists?.el_signed) return { ok: false, error: "This engagement already has a signed letter on file. Use Engagements, Update, if a new letter replaced it." };
  let oT = 0, mT = 0; const sumL: string[] = [];
  s.fees.filter((x: Fee) => e.trim(x.svc)).forEach((x: Fee) => {
    const v = e.feeVal(x.amt);
    if (v.k === "num" && !(x.tag === "catchup" && s.catchTBD)) { if (x.kind === "month") mT += v.n; else if (x.kind !== "quarter") oT += v.n; }
    sumL.push(e.trim(x.svc) + ": " + (v.k === "num" ? e.money(v.n) + ({ month: "/month", quarter: "/quarter", year: " each year end", once: " one-time" } as Record<string, string>)[x.kind] : "included"));
  });
  const PI = e.payInfo(s);
  const notes = ["Services: " + e.svcList(s).join(", ") + ". Fee schedule: " + sumL.join("; ") + ". One-time billing: " + ({ sign: "on signing", split: "50% on signing, 50% on completion", complete: "on completion" } as Record<string, string>)[s.billOnce] + ". Payment method: " + e.PAY_LABEL[PI.method] + "."];
  if (e.trim(s.revOf)) notes.push("Revised letter dated " + s.letterDate + "; replaces the letter dated " + s.revOf + ".");
  const issued = "Final " + e.EL_VERSION + " issued " + s.letterDate + ".";
  const row: Record<string, unknown> = {
    type: e.TYPE_NOTION[s.type], el_version: e.EL_VERSION, status: "EL sent", fiscal_year_end: fye, el_issued: s.letterDate,
    period_start: s.firstYear && s.periodStart ? s.periodStart : null, fee: oT || null, monthly_fee: mT || null,
    monthly_billing_starts: mT && s.startMonth ? s.startMonth + "-01" : null, payment_method: e.PAY_NOTION[PI.method] ?? "",
    letter_data: { v: 1, f: letterFields(e, b.inputs.f), fees: (b.inputs.fees as Fee[]).map((x) => [x.tag || "", x.svc || "", x.detail || "", x.kind || "", x.amt || ""]) },
    registration_confirmed: (s.province === "AB" || s.province === "BC") && !!b.inputs.acks[s.province.toLowerCase()],
    issued_by: access.staff_id,
  };
  if (exists) {
    row.notes = [exists.notes, notes.join(" "), issued].filter((x) => x).join(" ");
    const { error } = await supabase.from("engagements").update(row).eq("id", exists.id);
    if (error) return { ok: false, error: "Could not update the engagement record." };
    return { ok: true, engagementId: exists.id, note: "Engagement updated as EL sent. When the client signs, enter the signed date under Engagements." };
  }
  row.notes = [notes.join(" "), issued].join(" ");
  const { data: ins, error } = await supabase.from("engagements").insert({ ...row, client_id: clientId, title: e.trim(s.company) + " FYE " + fye }).select("id").single();
  if (error || !ins) return { ok: false, error: "Could not record the engagement." };
  return { ok: true, engagementId: ins.id, note: "Engagement recorded as EL sent. When the client signs, enter the signed date under Engagements." };
}

// Studio elSnapshot(): the letter fields kept for a revised letter (not type, reviewed, dates of issue).
function letterFields(e: StudioEngine, f: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of e.IDS as string[]) if (!["type", "reviewed", "letterDate", "revOf"].includes(k)) out[k] = f[k];
  return out;
}

// Studio t1Record().
async function recordT1(supabase: SupabaseClient, b: Built, access: Access, clientId: string): Promise<Rec> {
  const { s, e } = b;
  if (!clientId) return { ok: false, error: "Final needs a client record with a verified name." };
  const fye = s.taxYear + "-12-31";
  const { data: found } = await supabase.from("engagements").select("id, el_signed, notes").eq("client_id", clientId).eq("type", "T1 personal").eq("fiscal_year_end", fye).limit(1);
  const exists = found?.[0];
  if (exists?.el_signed) return { ok: false, error: "This T1 engagement already has a signed letter. Use Engagements, Update, if a new letter replaced it." };
  const note = "Final " + e.EL_VERSION + " T1 letter issued " + s.letterDate + " for " + e.t1Names(s) + ". Company client, included under " + e.trim(s.corp) + ". CRA access: instructions in the TaxDome organizer.";
  const row: Record<string, unknown> = {
    type: "T1 personal", el_version: e.EL_VERSION, status: "EL sent", t1_individual: e.t1Names(s), t1_tax_year: Number(s.taxYear),
    fiscal_year_end: fye, el_issued: s.letterDate, cra_authorization: "Requested", letter_data: { v: 1, t1: b.inputs.f }, issued_by: access.staff_id,
  };
  if (exists) {
    row.notes = [exists.notes, note].filter((x) => x).join(" ");
    const { error } = await supabase.from("engagements").update(row).eq("id", exists.id);
    if (error) return { ok: false, error: "Could not update the engagement record." };
    return { ok: true, engagementId: exists.id, note: "Engagement updated as EL sent. Enter the signed date under Engagements." };
  }
  const primary = s.people[0]?.name ?? "";
  const { data: ins, error } = await supabase.from("engagements").insert({ ...row, client_id: clientId, title: primary + " T1 " + s.taxYear, notes: note }).select("id").single();
  if (error || !ins) return { ok: false, error: "Could not record the engagement." };
  return { ok: true, engagementId: ins.id, note: "Engagement recorded as EL sent. Enter the signed date under Engagements." };
}

// Studio pRecord(): a Final proposal is recorded as sent.
async function recordProposal(supabase: SupabaseClient, b: Built, clientId: string): Promise<Rec> {
  const { s, e } = b;
  const { data: ins, error } = await supabase.from("proposals").insert({
    client_id: clientId || null, title: s.name + " proposal " + s.date, prospect_name: s.name, contact: s.contact,
    province: ["ON", "AB", "BC"].includes(s.province) ? s.province : "OTHER", segment: s.segment, status: "Sent",
    date_sent: s.date, valid_until: e.pValidUntil(s),
    options_summary: s.opts.map((o: any) => { const t = e.pTotals(o); return o.name + ": " + e.money(t.m) + "/month, " + e.money(t.y) + " year end, " + e.money(t.once) + " one-time, annual " + e.money(t.annual); }).join("; "),
    recommended: s.opts.length > 1 ? s.opts[s.rec].name : s.opts[0].name, options_data: JSON.parse(e.pPack(s)),
  }).select("id").single();
  if (error || !ins) return { ok: false, error: "Could not record the proposal." };
  return { ok: true, proposalId: ins.id, note: "Recorded as sent. When the client replies, mark the result under Proposals." };
}

// Studio "Save client to Concept Studio": a new client record, name not yet verified.
export async function saveClientFromDocument(supabase: SupabaseClient, access: Access, kind: DocKind, snap: any): Promise<{ ok: true; clientId: string } | { ok: false; error: string }> {
  if (!canEdit(access, "clients")) return { ok: false, error: "You do not have permission to add clients." };
  const e = createStudioEngine({});
  const t = (v: unknown) => e.trim(String(v ?? ""));
  const f = snap?.f ?? {};
  const prov = ["ON", "AB", "BC"].includes(f.province) ? f.province : "OTHER";
  let row: Record<string, unknown>;
  if (kind === "t1_letter") {
    const primary = t(f.name0);
    if (!primary) return { ok: false, error: "Enter the primary taxpayer's name first." };
    row = { kind: "individual", legal_name: primary, entity_type: "Individual", signing_officer: primary, signer_title: "Individual", salutation: t(f.salutation),
      street_address: t(f.addr1), address_line2: t(f.addr2), city: t(f.city), postal_code: t(f.postal).toUpperCase(), province: prov, year_end_md: "12-31" };
  } else {
    const name = t(f.company);
    if (!name) return { ok: false, error: "Enter the company legal name first." };
    row = { kind: "corporation", legal_name: name, signing_officer: t(f.signer), signer_title: t(f.signerTitle), salutation: t(f.salutation),
      street_address: t(f.addr1), address_line2: t(f.addr2), city: t(f.city), postal_code: t(f.postal).toUpperCase(), province: prov,
      year_end_md: /^\d{4}-\d{2}-\d{2}$/.test(String(f.ye)) ? String(f.ye).slice(5) : "", basis: ["standard", "cash", "custom"].includes(f.basis) ? f.basis : "standard",
      custom_basis_wording: f.basis === "custom" ? t(f.basisCustom) : "", third_party_user: f.thirdParty ? t(f.tpName) : "" };
  }
  // Studio reused a record with the same legal name instead of making a duplicate.
  const { data: dup } = await supabase.from("clients").select("id").ilike("legal_name", String(row.legal_name).replace(/[%_\\]/g, "\\$&")).limit(1);
  if (dup?.[0]) return { ok: true, clientId: dup[0].id };
  const { data: ins, error } = await supabase.from("clients").insert({ ...row, name_verified: false }).select("id").single();
  if (error || !ins) return { ok: false, error: "Could not save the client." };
  return { ok: true, clientId: ins.id };
}
