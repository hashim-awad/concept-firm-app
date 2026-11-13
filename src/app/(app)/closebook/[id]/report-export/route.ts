// A Closebook report as Excel or PDF (Hashim, Nov 15, 2026), stamped "Working paper: not for the
// client" on every page. Built live from the postings, with the same filters as the page.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { loadReportData } from "@/lib/closebook/report-data";
import { reportTable } from "@/lib/closebook/report-table";
import { reportXlsx } from "@/lib/closebook/xlsx-write";
import { renderPdf } from "@/lib/studio/pdf";
import { formatDate } from "@/lib/dates";

const STAMP = "Working paper: not for the client";
const REPORTS = ["tb", "bs", "pl", "gl", "journal"];
const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
  : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const report = q.get("report") ?? "";
  const format = q.get("format");
  if (!/^[0-9a-f-]{36}$/.test(id) || !REPORTS.includes(report) || (format !== "xlsx" && format !== "pdf")) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const f = await loadFile(supabase, id);
  if (!f) return new Response("Not found", { status: 404 });
  const ref = await loadReference(supabase);
  const data = await loadReportData(supabase, f.file, f.accounts, f.entries, ref.lines, ref.sheets);
  const t = reportTable(data, { report, account: q.get("account") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, source: q.get("source") ?? undefined });
  const client = f.client?.legal_name ?? "";
  const period = report === "bs" ? `As at ${formatDate(f.file.year_end)}` : `${formatDate(f.file.year_start)} to ${formatDate(f.file.year_end)}`;
  const filters = [q.get("account") && `Account: ${data.accounts.find((a) => a.key === q.get("account"))?.name ?? ""}`, q.get("from") && `From ${formatDate(q.get("from")!)}`,
    q.get("to") && `to ${formatDate(q.get("to")!)}`, q.get("source") && `Source: ${q.get("source")}`].filter(Boolean).join(" ");
  const head = [client, period, filters].filter(Boolean);
  const base = `${client} ${t.title} ${f.file.year_end}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();

  if (format === "xlsx") {
    return new Response(new Uint8Array(reportXlsx(t, head, STAMP)), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "private, no-store" } });
  }
  const wide = t.columns.length > 3;
  const body = [
    t.columns.map((c, i) => ({ text: c, bold: true, alignment: t.numeric[i] ? "right" : "left", fillColor: "#F2EFE8" })),
    ...t.rows.map((r) => r.cells.map((v, i) => ({
      text: v === null ? "" : typeof v === "number" && t.numeric[i] ? money(v) : String(v),
      bold: !!r.bold, alignment: t.numeric[i] ? "right" : "left", margin: [i === 0 && r.indent ? r.indent * 10 : 0, 0, 0, 0],
    }))),
  ];
  const widths = t.columns.map((c, i) => (t.numeric[i] ? 72 : i === 0 && !wide ? "*" : c === "Description" || c === "Account" ? "*" : "auto"));
  const def = {
    pageSize: "LETTER", pageOrientation: wide ? "landscape" : "portrait", pageMargins: [36, 54, 36, 40],
    defaultStyle: { fontSize: 8.5 },
    header: { text: STAMP, alignment: "center", bold: true, fontSize: 9, color: "#b3261e", margin: [0, 22, 0, 0] },
    footer: (cur: number, total: number) => ({ columns: [{ text: `${client} · ${t.title}`, fontSize: 7, color: "#666" }, { text: `Page ${cur} of ${total}`, alignment: "right", fontSize: 7, color: "#666" }], margin: [36, 12, 36, 0] }),
    content: [
      { text: t.title, fontSize: 14, bold: true },
      ...head.map((h) => ({ text: h, fontSize: 9, color: "#444" })),
      { text: " " },
      { table: { headerRows: 1, widths, body }, layout: { hLineWidth: (i: number) => (i <= 1 ? 0.8 : 0.2), vLineWidth: () => 0, hLineColor: () => "#BBB", paddingTop: () => 2, paddingBottom: () => 2 } },
    ],
  };
  const { bytes } = await renderPdf(def);
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
