import "server-only";
// Step 10, "Deliver and lock" (round 12): the email's figures, the client email (Appendix C), the
// documents for TaxDome, the filing record and the lock. Benchmark: CaseWare's completion and lockdown.
import type { SupabaseClient } from "@supabase/supabase-js";
import JSZip from "jszip";
import { createHash } from "node:crypto";
import { loadPackage, type PackageData } from "./fs-server";
import { buildEmail, type Email, type InstalmentRow } from "./fs-email";
import { packageDef, lawyerDef } from "./fs-pdf";
import { renderWpPdf } from "./wp-pdf";
import { FS_LETTERHEAD } from "./fs-letterhead.generated";
import { buildReportPdf } from "./wp-build";
import { keepsOwnBooks } from "./books";
import { createAdminClient } from "@/lib/supabase/admin";
import { signedPdfBytes } from "@/lib/t1-quote/sign";
import { todayToronto } from "@/lib/dates";

export type CloseRow = {
  tax_balance: number | null; tax_due: string | null; filed_on: string | null; noa_issued: boolean | null; noa_penalty: number; noa_interest: number;
  hst_filed: boolean; hst_balance: number | null; hst_due: string | null; hst_rt: string;
  fed_tax: number | null; prov_tax: number | null; fed_tax_prior: number | null; prov_tax_prior: number | null; instalments: InstalmentRow[];
  checklist_opened_at: string | null; delivered_at: string | null; delivered_by: string | null; delivered_path: string | null; delivered_email: Email | null;
  t183_signed_on: string | null; efile_number: string; locked_at: string | null; locked_by: string | null;
};
const EMPTY: CloseRow = { tax_balance: null, tax_due: null, filed_on: null, noa_issued: null, noa_penalty: 0, noa_interest: 0, hst_filed: false, hst_balance: null, hst_due: null, hst_rt: "RT 0001",
  fed_tax: null, prov_tax: null, fed_tax_prior: null, prov_tax_prior: null, instalments: [], checklist_opened_at: null, delivered_at: null, delivered_by: null, delivered_path: null, delivered_email: null,
  t183_signed_on: null, efile_number: "", locked_at: null, locked_by: null };
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// File names for TaxDome: Client_Document_YearEnd, e.g. "BirchDummyRealty_Financial-Statements_2026-12-31.pdf".
export const shortName = (legal: string) => legal.replace(/\b(incorporated|inc|ltd|limited|corp|corporation|co|ltee|ltée)\b\.?/gi, "").replace(/[^A-Za-z0-9]+/g, "");
export const DOC_NAMES = { fs: "Financial-Statements", signed: "MAL-Signed", letter: "Minute-Book-Letter", entries: "Client-Entry-List" } as const;
export const docFile = (legal: string, doc: keyof typeof DOC_NAMES, ye: string) => `${shortName(legal)}_${DOC_NAMES[doc]}_${ye}.pdf`;
export const zipFile = (legal: string, ye: string) => `${shortName(legal)}_TaxDome-Documents_${ye}.zip`;

export async function loadClose(supabase: SupabaseClient, fileId: string) {
  const pk = await loadPackage(supabase, fileId);
  if (!pk) return null;
  const { file } = pk.data;
  const [{ data: row }, { data: st }, { data: set }, { data: cl }, { data: signs }] = await Promise.all([
    supabase.from("cb_file_close").select("*").eq("file_id", fileId).maybeSingle(),
    supabase.rpc("cb_close_status", { p_file: fileId }),
    supabase.from("cb_settings").select("instalment_threshold").maybeSingle(),
    supabase.from("clients").select("business_number, legal_name").eq("id", file.client_id).maybeSingle(),
    supabase.from("cb_step_signoffs").select("step, reviewed_at").eq("file_id", fileId).eq("step", "lock").maybeSingle(),
  ]);
  const r = row as Record<string, unknown> | null;
  const c: CloseRow = r ? { ...EMPTY, ...(r as unknown as CloseRow), tax_balance: num(r.tax_balance), noa_penalty: Number(r.noa_penalty ?? 0), noa_interest: Number(r.noa_interest ?? 0),
    hst_balance: num(r.hst_balance), fed_tax: num(r.fed_tax), prov_tax: num(r.prov_tax), fed_tax_prior: num(r.fed_tax_prior), prov_tax_prior: num(r.prov_tax_prior),
    instalments: ((r.instalments ?? []) as { date: string; amount: number }[]).map((x) => ({ date: x.date, amount: Number(x.amount) })) } : EMPTY;
  const status = (st ?? {}) as { mal_signed_at: string | null; mal_signed_name: string | null; mal_signed_title: string | null; step10: string[]; lock: string[] };
  const threshold = Number((set as { instalment_threshold?: number } | null)?.instalment_threshold ?? 3000);
  const bn9 = ((cl as { business_number?: string } | null)?.business_number ?? "").replace(/\s+/g, "").slice(0, 9);
  const reviewed = !!(signs as { reviewed_at?: string } | null)?.reviewed_at;
  const ready = c.tax_balance !== null && !!c.tax_due && c.noa_issued !== null && c.fed_tax !== null && c.prov_tax !== null && (!c.hst_filed || (c.hst_balance !== null && !!c.hst_due));
  // The email: as sent once delivered; otherwise built now, a draft until the reviewer signs step 10.
  const email: Email | null = c.delivered_email ?? (ready ? buildEmail({
    name: pk.m.name, yearEnd: file.year_end, days: pk.m.days, officerFirst: (pk.fields.officer_name.trim().split(/\s+/)[0] ?? ""), bn9, today: todayToronto(),
    tax: { balance: c.tax_balance!, due: c.tax_due!, filed: c.filed_on ?? "", noaIssued: !!c.noa_issued, noaPenalty: c.noa_penalty, noaInterest: c.noa_interest },
    hst: c.hst_filed ? { balance: c.hst_balance!, due: c.hst_due, rt: c.hst_rt } : null,
    inst: { fedTax: c.fed_tax!, provTax: c.prov_tax!, fedTaxPrior: c.fed_tax_prior ?? 0, provTaxPrior: c.prov_tax_prior ?? 0, threshold, schedule: c.instalments },
    minuteLetter: true, draft: !reviewed,
  }) : null);
  const legal = (cl as { legal_name?: string } | null)?.legal_name ?? pk.m.name;
  const own = keepsOwnBooks(file);
  const docs = [docFile(legal, "fs", file.year_end), docFile(legal, "signed", file.year_end), docFile(legal, "letter", file.year_end), ...(own ? [docFile(legal, "entries", file.year_end)] : [])];
  // Step 8's total income tax, to check the federal and provincial figures typed here.
  const { data: tie } = await supabase.from("cb_t2_tieouts").select("income_tax").eq("file_id", fileId).maybeSingle();
  const step8Tax = (tie as { income_tax?: number } | null)?.income_tax ?? null;
  return { pk, close: c, status, threshold, bn9, reviewed, email, docs, zipName: zipFile(legal, file.year_end), legal, own, locked: file.phase === "locked", step8Tax: step8Tax === null ? null : Number(step8Tax) };
}
export type CloseData = NonNullable<Awaited<ReturnType<typeof loadClose>>>;

// The documents for TaxDome, as one zip of the final PDFs. Refused until the MAL is signed (the package
// is final only then).
export async function buildDocumentsZip(supabase: SupabaseClient, d: CloseData): Promise<{ bytes: Uint8Array; sha256: string; files: string[] } | { error: string }> {
  const { pk } = d;
  if (!pk.signed || !pk.mal.mal_quote_id) return { error: "The documents are final once the MAL is signed." };
  if (pk.blocked.length) return { error: `The package is stopped: ${pk.blocked[0]}` };
  const ye = pk.data.file.year_end;
  const zip = new JSZip();
  const fsPdf = await renderWpPdf({ ...packageDef(pk.m, pk.ctx, FS_LETTERHEAD), info: { title: `${pk.m.name} Financial statements`, author: "Concept Accounting & Advisory Professional Corporation" } });
  zip.file(docFile(d.legal, "fs", ye), fsPdf);
  const signed = await signedPdfBytes(pk.mal.mal_quote_id);
  if (!signed) return { error: "The signed MAL could not be read." };
  zip.file(docFile(d.legal, "signed", ye), new Uint8Array(await signed.arrayBuffer()));
  zip.file(docFile(d.legal, "letter", ye), await renderWpPdf({ ...lawyerDef(pk.m, pk.ctx, pk.lawyer, FS_LETTERHEAD), info: { title: `${pk.m.name} Minute book letter`, author: "Concept Accounting & Advisory Professional Corporation" } }));
  if (d.own) {
    const list = await buildReportPdf(supabase, pk.data.file.id, { report: "tb" }, "client");
    if (!list) return { error: "The client entry list could not be built." };
    zip.file(docFile(d.legal, "entries", ye), list.bytes);
  }
  // Fixed file dates, so the same documents give the same zip.
  zip.forEach((_p, f) => { f.date = new Date(`${ye}T12:00:00Z`); });
  const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), files: Object.keys(zip.files) };
}

// The delivered zip, as stored when the preparer recorded the delivery (a locked file's documents).
export async function deliveredZip(path: string): Promise<Uint8Array | null> {
  const { data } = await createAdminClient().storage.from("documents").download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}
export async function deliveredFile(path: string, name: string): Promise<Uint8Array | null> {
  const z = await deliveredZip(path);
  if (!z) return null;
  const f = (await JSZip.loadAsync(z)).file(name);
  return f ? await f.async("uint8array") : null;
}
export type { PackageData };
