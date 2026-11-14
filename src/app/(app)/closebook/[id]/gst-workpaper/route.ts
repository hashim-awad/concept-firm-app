// Step 8, the GST/HST return working paper (round 13): each return's lines with their CRA line numbers,
// the postings behind each line, and the check against 21500. Excel or PDF, stamped "Working paper: not
// for the client", as the tax workpaper.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { gstFor } from "@/lib/closebook/gst-server";
import { loadFile } from "@/lib/closebook/server";
import { LINE_NAMES, type Line } from "@/lib/closebook/gst-return";
import { reportXlsx } from "@/lib/closebook/xlsx-write";
import type { ReportTable } from "@/lib/closebook/report-table";
import { C, headerBlock, wpDocument, type WpCtx } from "@/lib/closebook/wp-doc";
import { generatedAt, renderWpPdf } from "@/lib/closebook/wp-pdf";
import { formatDate } from "@/lib/dates";

const STAMP = "Working paper: not for the client";
const DRILL: Line[] = ["101", "103", "106"];
const m = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }));

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format");
  if (!/^[0-9a-f-]{36}$/.test(id) || (format !== "xlsx" && format !== "pdf")) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const [g, f] = await Promise.all([gstFor(supabase, id), loadFile(supabase, id)]);
  if (!g || !f) return new Response("Not found", { status: 404 });
  if (!g.applies) return new Response(g.reason, { status: 409 });
  const client = f.client?.legal_name ?? "";
  const base = `${client} GST-HST return ${f.file.year_end}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  const method = `${g.quick ? "Quick method" : "Regular method"}, ${g.freq}, ${g.rt}`;
  const c = g.check;
  const checkRows: [string, number][] = [["Last year's balance owing (step 2)", c.openingCents], ["Net tax on the year's returns (line 109)", c.netTaxCents],
    ["Less payments to the CRA in the year", -c.paymentsCents], ["Balances still owing", c.owingCents], ["GST/HST payable (21500) at year end", c.bookCents], ["Difference (21500 less the returns)", c.diffCents]];

  if (format === "xlsx") {
    const t: ReportTable = { title: `GST/HST return: ${method}`, columns: ["Line", "Description", ...g.returns.map((r) => r.period.label)], numeric: [false, false, ...g.returns.map(() => true)], rows: [] };
    for (const [k, name] of LINE_NAMES) t.rows.push({ cells: [k, name, ...g.returns.map((r) => r.lines[k as Line])], bold: ["105", "108", "109", "112", "113"].includes(k) });
    t.rows.push({ cells: ["", "Due", ...g.returns.map(() => null)] });
    t.rows.push({ cells: ["", "Check against 21500", ...g.returns.map(() => null)], bold: true });
    for (const [k, v] of checkRows) t.rows.push({ cells: ["", k, v, ...g.returns.slice(1).map(() => null)] });
    for (const r of g.returns) for (const k of DRILL) {
      const items = r.drill[k] ?? [];
      if (!items.length) continue;
      t.rows.push({ cells: [k, `${r.period.label}: line ${k}, the postings behind it (${items.length})`, ...g.returns.map(() => null)], bold: true });
      for (const x of items) t.rows.push({ cells: ["", `${x.date}  ${x.source === "bank" ? "Bank" : "Entry"}  ${x.label}  ${x.account} ${x.accountName}  ${x.code}  before tax ${m(x.netCents)}`, x.taxCents, ...g.returns.slice(1).map(() => null)], indent: 1 });
    }
    return new Response(new Uint8Array(reportXlsx(t, [client, `Year end ${formatDate(f.file.year_end)}`, method], STAMP)), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "private, no-store" } });
  }

  const ctx: WpCtx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "GST/HST return", stamp: STAMP,
    preparedBy: f.names.get(f.file.preparer_id) ?? "", reviewedBy: "", wpBox: true };
  const cell = (text: string, extra: Record<string, unknown> = {}) => ({ text, border: [false, false, false, false], ...extra });
  const head = (text: string, right = false) => ({ text, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: [false, false, false, false], fontSize: 8.5 });
  const layout = { hLineWidth: () => 0.7, vLineWidth: () => 0, hLineColor: () => C.ink, paddingTop: () => 3, paddingBottom: () => 3 };
  const lines: unknown[][] = [[head("Line"), head("Description"), ...g.returns.map((r) => head(g.returns.length > 1 ? r.period.label.split(":")[0] : "Year", true))]];
  for (const [k, name] of LINE_NAMES) { const b = ["105", "108", "109", "112", "113"].includes(k); lines.push([cell(k, { bold: b }), cell(name, { bold: b }), ...g.returns.map((r) => cell(m(r.lines[k as Line]), { alignment: "right", bold: b }))]); }
  lines.push([cell(""), cell("Due", { color: C.grey }), ...g.returns.map((r) => cell(formatDate(r.period.due), { alignment: "right", color: C.grey }))]);
  const check: unknown[][] = [[head("Check against GST/HST payable (21500)"), head("Amount", true)], ...checkRows.map(([k, v], i) => [cell(k, { bold: i === 3 || i === 5 }), cell(m(v), { alignment: "right", bold: i === 3 || i === 5 })])];
  const drill: unknown[] = [];
  for (const r of g.returns) for (const k of DRILL) {
    const items = r.drill[k] ?? [];
    if (!items.length) continue;
    const body: unknown[][] = [[head("Date"), head("Source"), head("Description"), head("Account"), head("Code"), head("Before tax", true), head("GST/HST", true)],
      ...items.map((x) => [cell(formatDate(x.date)), cell(x.source === "bank" ? "Bank" : "Entry"), cell(x.label), cell(`${x.account} ${x.accountName}`), cell(x.code), cell(m(x.netCents), { alignment: "right" }), cell(m(x.taxCents), { alignment: "right" })]),
      [cell("Total", { bold: true, colSpan: 5 }), cell(""), cell(""), cell(""), cell(""), cell(m(items.reduce((n, x) => n + x.netCents, 0)), { alignment: "right", bold: true }), cell(m(items.reduce((n, x) => n + x.taxCents, 0)), { alignment: "right", bold: true })]];
    drill.push({ text: `${r.period.label}: line ${k}, ${LINE_NAMES.find(([a]) => a === k)?.[1]}`, bold: true, margin: [0, 12, 0, 4] }, { table: { headerRows: 1, widths: [55, 35, "*", 110, 60, 60, 55], body }, layout, fontSize: 8 });
  }
  const def = wpDocument(ctx, [[headerBlock(ctx, `GST/HST return: ${method}`, "GST/HST"),
    { table: { headerRows: 1, widths: [30, "*", ...g.returns.map(() => g.returns.length > 2 ? 62 : 85)], body: lines }, layout },
    { text: " ", margin: [0, 6, 0, 0] }, { table: { headerRows: 1, widths: ["*", 100], body: check }, layout }, ...drill,
    { text: "Figures to the cent, as QuickBooks Online's GST/HST return. The preparer files the return from these lines.", color: C.grey, fontSize: 8, margin: [0, 10, 0, 0] }]]);
  const pdf = await renderWpPdf(def);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
