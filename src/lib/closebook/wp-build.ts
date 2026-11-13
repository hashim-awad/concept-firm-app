// Builds a Closebook report PDF in the working paper package layout (src/lib/closebook/wp-doc.ts), live
// from the postings: the trial balance by group with the entries (or flat), the balance sheet, the
// income statement, the general ledger, the journal, and the client entry list (Hashim, Nov 15, 2026).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFile, loadReference } from "./server";
import { loadReportData } from "./report-data";
import { entryNo, journal, KIND_LABEL, ledger, netIncomeBox, statements, tbByGroup, trialBalance } from "./reports";
import { entriesSection, journalSection, ledgerSection, newAccountsSection, statementSection, tbFlatSection, tbGroupSection, wpDocument, type EntryDoc, type WpCtx } from "./wp-doc";
import { generatedAt, renderWpPdf } from "./wp-pdf";
import { CB_CLIENT, cbText } from "./client-wording";
import { loadWordingState } from "../studio/wording-state";

export const WP_STAMP = "Working paper: not for the client";
export const CLIENT_STAMP = "Entries to record in your books";
export { keepsOwnBooks } from "./books";

export type PdfQuery = { report: string; view?: string; account?: string; from?: string; to?: string; source?: string };

export async function buildReportPdf(supabase: SupabaseClient, fileId: string, q: PdfQuery, mode: "wp" | "client" = "wp"): Promise<{ bytes: Buffer; filename: string } | null> {
  const f = await loadFile(supabase, fileId);
  if (!f) return null;
  const ref = await loadReference(supabase);
  const data = await loadReportData(supabase, f.file, f.accounts, f.entries, ref.lines, ref.sheets);
  const tb = trialBalance(data.accounts, data.postings);
  const box = netIncomeBox(data.accounts, data.postings, data.info);
  const client = f.client?.legal_name ?? "";
  // "DRAFT FOR REVIEW" until the reviewer signs step 6 (Review). Step 6 has no sign-off yet, so the
  // client's copy stays a draft until that sign-off is built.
  const reviewSigned = false;
  const texts = mode === "client" ? (await loadWordingState(supabase)).live?.texts ?? {} : {};
  const ctx: WpCtx = {
    client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "",
    // Nothing goes to a client before review: until every entry is approved the list says so.
    stamp: mode === "client" ? CLIENT_STAMP : WP_STAMP, client_copy: mode === "client" ? { draft: !reviewSigned } : undefined,
    preparedBy: f.names.get(f.file.preparer_id) ?? "", reviewedBy: "", wpBox: mode === "wp",
  };
  const name = (key: string) => { const a = data.accounts.find((x) => x.key === key); return a ? `${a.number ? `${a.number} ` : ""}${a.name}` : key; };
  const entries: EntryDoc[] = f.entries.map((e) => {
    const [no, kind] = entryNo(f.file.year_end, e).split(" ");
    return { no, kind, wpRef: e.wp_ref || "–", memo: e.note, lines: e.lines.map((l) => {
      const a = data.acctOf(l.account_id);
      // On the working paper, an entry on a GIFI line with no account of its own says so. The client's copy
      // only ever shows the client's accounts (new ones are listed first), never a GIFI line.
      const raw = f.accounts.find((x) => x.id === l.account_id);
      const name = !a ? "" : a.number || mode === "client" || raw?.client_new ? a.name : `${a.name} (GIFI ${a.gifi})`;
      return { number: a?.number ?? "", name, cents: Math.round(l.amount * 100) };
    }) };
  });
  let sections: unknown[][];
  let title: string;
  if (mode === "client" || (q.report === "tb" && q.view !== "flat")) {
    const g = tbByGroup(tb, data.info);
    // Plain words for the client: no GIFI wording in a group heading.
    if (mode === "client") for (const x of g.groups) if (x.code === "50") { x.name = "Income taxes"; x.total.name = "Total income taxes"; }
    title = ctx.packageName = mode === "client" ? CLIENT_STAMP : "Trial balance by group and journal entries";
    sections = [tbGroupSection(ctx, g.groups, g.total, "TB.1", mode === "client" ? cbText(texts, CB_CLIENT.tbNote) : undefined), entriesSection(ctx, entries, box, "TB.2")];
    if (mode === "client") {
      const used = new Set(f.entries.flatMap((e) => e.lines.map((l) => l.account_id)));
      const fresh = f.accounts.filter((a) => a.client_new && used.has(a.id)).map((a) => ({ name: a.name, type: a.qbo_type ?? "" }));
      if (fresh.length) sections.unshift(newAccountsSection(ctx, fresh, cbText(texts, CB_CLIENT.newAccountsIntro)));
    }
  } else if (q.report === "tb") {
    title = ctx.packageName = "Trial balance";
    sections = [tbFlatSection(ctx, tb, tbByGroup(tb, data.info).total, "TB.1")];
  } else if (q.report === "bs" || q.report === "pl") {
    title = ctx.packageName = q.report === "bs" ? "Balance sheet" : "Income statement";
    sections = [statementSection(ctx, statements(tb, data.info), q.report, q.report === "bs" ? "BS.1" : "IS.1")];
  } else if (q.report === "gl") {
    title = ctx.packageName = "General ledger";
    const source = (l: { kind: keyof typeof KIND_LABEL; ref: string }) => (l.kind === "entry" ? data.entryLabel.get(l.ref) ?? KIND_LABEL.entry : KIND_LABEL[l.kind]);
    sections = [ledgerSection(ctx, ledger(data.accounts, data.postings, { key: q.account, from: q.from, to: q.to }), source, "GL.1", q.from)];
  } else {
    title = ctx.packageName = "Journal";
    const kind = (["opening", "bank", "entry", "import"].includes(q.source ?? "") ? q.source : "") as "" | "opening" | "bank" | "entry" | "import";
    const source = (t: { kind: keyof typeof KIND_LABEL; ref: string }) => (t.kind === "entry" ? data.entryLabel.get(t.ref) ?? KIND_LABEL.entry : KIND_LABEL[t.kind]);
    sections = [journalSection(ctx, journal(data.postings, kind), source, name, box, "JE.1")];
  }
  const bytes = await renderWpPdf(wpDocument(ctx, sections as never[][]));
  const filename = `${client} ${mode === "client" ? "Entries to record" : title} ${f.file.year_end}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim() + ".pdf";
  return { bytes, filename };
}
