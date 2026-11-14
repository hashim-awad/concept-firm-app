// Step 8, the tax workpaper (round 10, Hashim, Nov 27, 2026): the Schedule 1 items from the tax codes
// (Appendix B), for each code in use its accounts, amounts and effect. Excel or PDF, stamped "Working
// paper: not for the client". The preparer enters these in ProFile.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { gifiFor } from "@/lib/closebook/gifi-server";
import { loadFile } from "@/lib/closebook/server";
import { reportXlsx } from "@/lib/closebook/xlsx-write";
import type { ReportTable } from "@/lib/closebook/report-table";
import { C, headerBlock, wpDocument, type WpCtx } from "@/lib/closebook/wp-doc";
import { generatedAt, renderWpPdf } from "@/lib/closebook/wp-pdf";
import { fmt } from "@/lib/closebook/t2";
import { formatDate } from "@/lib/dates";

const STAMP = "Working paper: not for the client";
const sign = (n: number | null) => (n === null ? "To set" : n === 0 ? "–" : `${n > 0 ? "+" : "−"} ${fmt(Math.abs(n))}`);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format");
  if (!/^[0-9a-f-]{36}$/.test(id) || (format !== "xlsx" && format !== "pdf")) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const [g, f] = await Promise.all([gifiFor(supabase, id), loadFile(supabase, id)]);
  if (!g || !f) return new Response("Not found", { status: 404 });
  const client = f.client?.legal_name ?? "";
  const base = `${client} Tax workpaper ${f.file.year_end}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  const net = g.workpaper.reduce((n, s) => n + s.effect, 0);

  if (format === "xlsx") {
    const t: ReportTable = { title: "Tax workpaper: Schedule 1 items", columns: ["Tax code and account", "GIFI", "Amount", "Schedule 1", "Effect"], numeric: [false, false, true, false, true], rows: [] };
    for (const s of g.workpaper) {
      t.rows.push({ cells: [`${s.code} ${s.name}`, "", null, s.rule, null], bold: true });
      for (const a of s.accounts) t.rows.push({ cells: [a.label, a.gifi, Math.round(a.amount * 100), a.note, a.effect === null ? "To set" : Math.round(a.effect * 100)], indent: 1 });
      t.rows.push({ cells: [`Total ${s.code}`, "", Math.round(s.total * 100), "", Math.round(s.effect * 100)], bold: true });
    }
    t.rows.push({ cells: ["Net Schedule 1 adjustment (+ adds to net income for tax)", "", null, "", Math.round(net * 100)], grand: true, bold: true });
    return new Response(new Uint8Array(reportXlsx(t, [client, `Year end ${formatDate(f.file.year_end)}`], STAMP)), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "private, no-store" } });
  }

  const ctx: WpCtx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "Tax workpaper", stamp: STAMP,
    preparedBy: f.names.get(f.file.preparer_id) ?? "", reviewedBy: "", wpBox: true };
  const cell = (text: string, extra: Record<string, unknown> = {}) => ({ text, border: [false, false, false, false], ...extra });
  const head = (text: string, right = false) => ({ text, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: [false, false, false, false], fontSize: 8.5 });
  const body: unknown[][] = [[head("Tax code and account"), head("GIFI"), head("Amount", true), head("Schedule 1"), head("Effect", true)]];
  for (const s of g.workpaper) {
    body.push([cell(`${s.code}  ${s.name}`, { bold: true, colSpan: 2 }), cell(""), cell(""), cell(s.rule, { color: C.grey, fontSize: 8 }), cell("")]);
    for (const a of s.accounts) body.push([cell(a.label, { margin: [10, 0, 0, 0] }), cell(a.gifi), cell(fmt(a.amount), { alignment: "right" }), cell(a.note), cell(sign(a.effect), { alignment: "right" })]);
    body.push([cell(`Total ${s.code}`, { bold: true }), cell(""), cell(fmt(s.total), { alignment: "right", bold: true, border: [false, true, false, false] }), cell(""),
      cell(sign(s.effect), { alignment: "right", bold: true, border: [false, true, false, false] })]);
  }
  body.push([cell("Net Schedule 1 adjustment (+ adds to net income for tax)", { bold: true, colSpan: 4 }), cell(""), cell(""), cell(""), cell(sign(Math.round(net * 100) / 100), { alignment: "right", bold: true })]);
  const def = wpDocument(ctx, [[headerBlock(ctx, "Tax workpaper: Schedule 1 items", "Income tax schedule"),
    { table: { headerRows: 1, widths: ["*", 40, 80, 220, 80], body }, layout: { hLineWidth: () => 0.7, vLineWidth: () => 0, hLineColor: () => C.ink, paddingTop: () => 3, paddingBottom: () => 3 } },
    { text: "The preparer enters these items on Schedule 1 in ProFile. CCA is claimed on Schedule 8.", color: C.grey, fontSize: 8, margin: [0, 10, 0, 0] }]]);
  const pdf = await renderWpPdf(def);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
