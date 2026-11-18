// Piece 7 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud's working paper): the revenue check's "Print schedule (PDF)".
// One page, like the other schedules: the standard header block (client, name, year end, W/P ref, prepared by,
// reviewed by: step 5's sign-off), each source with its total and attachment, the totals and the differences with
// their explanation or acceptance. The GST/HST returns comparison is step 8's and is not on this page.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadFile } from "@/lib/closebook/server";
import { loadRevenue } from "@/lib/closebook/expenses-server";
import { C, headerBlock, wpDocument, type WpCtx } from "@/lib/closebook/wp-doc";
import { generatedAt, renderWpPdf } from "@/lib/closebook/wp-pdf";
import { bracketAmount } from "@/lib/closebook/amount";
import { formatDate } from "@/lib/dates";

const STAMP = "Working paper: not for the client";
const KIND: Record<string, string> = {
  commission_statement: "Brokerage commission statement (tax worksheet)", t4a: "T4A slip", sales_report: "Sales or invoice report",
  processor_report: "Card or online processor's annual report", slips: "T5018 or other slips",
};
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const [f, rev, { data: so }] = await Promise.all([loadFile(supabase, id), loadRevenue(supabase, id),
    supabase.from("cb_step_signoffs").select("prepared_by, reviewed_by").eq("file_id", id).eq("step", "entries").maybeSingle()]);
  if (!f || f.file.file_type !== "full" || !rev.state.added) return new Response("Not found", { status: 404 });
  const st = rev.state;
  const client = f.client?.legal_name ?? "";
  const name = (u: string | null | undefined) => (u ? f.names.get(u) ?? "" : "");
  const ctx: WpCtx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "Revenue check", stamp: STAMP,
    preparedBy: name(so?.prepared_by), reviewedBy: name(so?.reviewed_by), wpBox: true };

  const NO = [false, false, false, false];
  const money = (n: number) => bracketAmount(Math.round(n * 100));
  const cell = (text: string, extra: Record<string, unknown> = {}) => ({ text, border: NO, ...extra });
  const head = (text: string, right = false) => ({ text, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: NO, fontSize: 8.5 });
  const layout = { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => C.border, paddingTop: () => 2.5, paddingBottom: () => 2.5 };
  const right = { alignment: "right" };
  const tot = { alignment: "right", bold: true, border: [false, true, false, false] };
  const fileName = (p: string) => p.split("/").pop()!.replace(/^\d+-/, "");

  const srcs = rev.sources.filter((x) => x.kind !== "gst_returns");
  const primary = srcs.filter((x) => x.kind !== "t4a" || x.payer === "other");
  const t4a = srcs.filter((x) => x.kind === "t4a" && x.payer === "brokerage");
  const srcBody = [[head("Source"), head("Label"), head("Attachment"), head("Total", true)],
    ...srcs.map((x) => [cell(`${KIND[x.kind] ?? x.kind}${x.kind === "t4a" ? (x.payer === "brokerage" ? ", brokerage" : ", other payer") : ""}`), cell(x.label, { color: C.grey }),
      cell(fileName(x.attachment), { color: C.grey }), cell(money(x.amount), right)]),
    ...(srcs.length ? [] : [[cell("No source entered.", { color: C.grey, colSpan: 4 }), cell(""), cell(""), cell("")]])];

  // How each difference was cleared: none, explained (one line), or accepted by the reviewer.
  const cleared = (diff: number, text: string, explained: boolean, waiting: boolean, by: string | null, at: string | null, accepted: number | null) =>
    diff === 0 ? "Ties out"
      : !waiting && by && accepted === diff && Math.abs(diff) > st.threshold ? `${text} Accepted by ${name(by) || "the reviewer"}, ${formatDate(at)}.`
      : explained ? (waiting ? `${text} Waiting for the reviewer: over the review threshold.` : text)
      : "Not explained yet.";
  const checks: any[][] = [[head("Check"), head("Books", true), head("Source", true), head("Difference", true), head("Explanation")],
    [cell("Revenue to its source"), cell(money(st.tb), right), cell(primary.length ? money(st.sources) : "–", right), cell(primary.length ? money(st.diff) : "–", right),
      cell(primary.length ? cleared(st.diff, st.explanation, st.explained, st.waiting, st.accepted_by, st.accepted_at, st.accepted_diff) : "No source entered.")]];
  if (st.realtor) checks.push([cell("T4A to commission statement"), cell(st.n_commission ? money(st.commission) : "–", right), cell(t4a.length ? money(st.t4a) : "–", right),
    cell(t4a.length && st.n_commission ? money(st.t4a_diff) : "–", right),
    cell(!t4a.length ? (st.t4a_none ? "No T4A this year." : "No T4A yet.") : cleared(st.t4a_diff, st.t4a_explanation, st.t4a_explained, st.t4a_waiting, st.t4a_accepted_by, st.t4a_accepted_at, st.t4a_accepted_diff))]);

  const def = wpDocument(ctx, [[
    headerBlock(ctx, "Revenue check", "Revenue check"),
    { text: "Sources", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
    { table: { headerRows: 1, widths: [200, "*", 150, 80], body: [...srcBody,
      ...(srcs.length ? [[cell("Total of the sources", { bold: true }), cell(""), cell(""), cell(money(primary.reduce((n, x) => n + Number(x.amount), 0)), tot)]] : [])] }, layout, fontSize: 8.5, margin: [0, 0, 0, 12] },
    { text: "Totals and differences", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
    { table: { headerRows: 1, widths: [140, 75, 75, 75, "*"], body: checks }, layout, fontSize: 8.5 },
    { text: `Review threshold: ${money(st.threshold)}. A difference over it waits for the reviewer.`, fontSize: 8, color: C.grey, margin: [0, 6, 0, 0] },
  ]]);
  const pdf = await renderWpPdf(def);
  const base = `${client} Revenue check`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
