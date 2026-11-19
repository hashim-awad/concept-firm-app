// A Closebook report as Excel or PDF (Hashim, Nov 15, 2026), stamped "Working paper: not for the
// client" on every page. Built live from the postings, with the same filters as the page. The PDF follows
// the working paper package layout (src/lib/closebook/wp-build.ts).
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadFile, loadReference } from "@/lib/closebook/server";
import { loadReportData } from "@/lib/closebook/report-data";
import { reportTable } from "@/lib/closebook/report-table";
import { reportXlsx } from "@/lib/closebook/xlsx-write";
import { buildReportPdf } from "@/lib/closebook/wp-build";
import { formatDate } from "@/lib/dates";
import { actionLabel, loadHistory } from "@/lib/closebook/history";
import { historySection, wpDocument } from "@/lib/closebook/wp-doc";
import { generatedAt, renderWpPdf } from "@/lib/closebook/wp-pdf";
import { C, headerBlock } from "@/lib/closebook/wp-doc";
import { loadShReport } from "@/lib/closebook/sh-report-server";
import { atYearEnd, cardTitle, entryLabel, openingLabel, resultLine, shown, SIGN_NOTE, type ShCard } from "@/lib/closebook/sh-report";
import { shReportXlsx } from "@/lib/closebook/sh-xlsx";

const STAMP = "Working paper: not for the client";
const REPORTS = ["tb", "bs", "pl", "gl", "journal", "history", "sh"];

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
  // Round 24 (rule 20): the file history in the working papers (the Review right reads it, R3a-1).
  if (report === "history") {
    const rows = await loadHistory(supabase, id, f.names, q.get("step"));
    const when = (iso: string) => `${formatDate(iso)} ${new Date(iso).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}`;
    const cells = rows.map((r) => [when(r.at), r.who, [actionLabel(r.action), r.detail].filter(Boolean).join(": "), r.step, r.ref, r.reason, r.old, r.new]);
    const client = f.client?.legal_name ?? "";
    const base = `${client} File history ${f.file.year_end}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
    if (format === "xlsx") {
      const t = { title: "File history", columns: ["When", "Who", "What", "Step", "Statement or line", "Reason", "Old", "New"], numeric: Array(8).fill(false), rows: cells.map((c) => ({ cells: c })) };
      return new Response(new Uint8Array(reportXlsx(t, [client, `${formatDate(f.file.year_start)} to ${formatDate(f.file.year_end)}`], STAMP)), { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "private, no-store" } });
    }
    const ctx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "File history", stamp: STAMP,
      preparedBy: f.names.get(f.file.preparer_id) ?? "", reviewedBy: "", wpBox: true };
    const bytes = await renderWpPdf(wpDocument(ctx, [historySection(ctx, cells)]));
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
  }
  const ref = await loadReference(supabase);
  // Piece 8: Shareholder loans (mocks J and K): the working paper header, the Summary (two or more accounts), then the cards.
  if (report === "sh") {
    const r = await loadShReport(supabase, f.file, f.accounts, f.entries, ref.lines, ref.sheets);
    const { data: so } = await supabase.from("cb_step_signoffs").select("reviewed_by").eq("file_id", id).eq("step", "review").maybeSingle();
    const client = f.client?.legal_name ?? "";
    const preparedBy = f.names.get(f.file.preparer_id) ?? "", reviewedBy = so?.reviewed_by ? f.names.get(so.reviewed_by) ?? "" : "";
    const base = `${client} Shareholder loans ${f.file.year_end}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
    if (format === "xlsx") {
      return new Response(new Uint8Array(shReportXlsx(r, { client, yearEnd: f.file.year_end, preparedBy, reviewedBy, stamp: STAMP })), { headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "private, no-store" } });
    }
    const ctx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "Shareholder loans", stamp: STAMP, preparedBy, reviewedBy, wpBox: true };
    const NO = [false, false, false, false];
    const cell = (text: string, x: Record<string, unknown> = {}) => ({ text, border: NO, ...x });
    const head = (text: string, right = false) => ({ text, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: NO });
    const R = { alignment: "right" };
    const dbl = [false, true, false, true];
    const layout = { hLineWidth: (i: number, node: { table: { body: unknown[] } }) => (i === node.table.body.length ? 1.5 : i === node.table.body.length - 1 ? 0.6 : 0),
      vLineWidth: () => 0, hLineColor: () => C.ink, paddingTop: () => 2.5, paddingBottom: () => 2.5 };
    const blocks: unknown[] = [headerBlock(ctx, "Shareholder loans", "Shareholder loans")];
    if (r.cards.length > 1) {
      blocks.push({ text: "Summary", bold: true, color: C.navy, fontSize: 10.5, margin: [0, 0, 0, 4] },
        { table: { headerRows: 1, widths: ["*", 58, 62, 62, 190], body: [[head("Account"), head("Opening", true), head("Movement", true), head("Closing", true), head("At year-end")],
          ...r.cards.map((c) => [cell(cardTitle(c)), cell(shown(c.openingCents), R), cell(shown(c.movementCents), R), cell(shown(c.closingCents), R), cell(atYearEnd(c))]),
          [cell("Total", { bold: true, border: dbl }), cell(shown(r.total.openingCents), { ...R, bold: true, border: dbl }), cell(shown(r.total.movementCents), { ...R, bold: true, border: dbl }),
            cell(shown(r.total.closingCents), { ...R, bold: true, border: dbl }), cell("", { border: dbl })]] },
          layout, fontSize: 8.5, margin: [0, 0, 0, 14] });
    }
    const card = (c: ShCard) => {
      const [b, rest] = resultLine(c);
      const body: unknown[][] = [[head("Line"), head("Amount", true)],
        [cell(openingLabel(c)), cell(shown(c.openingCents), R)], [cell("Paid to or for the shareholder"), cell(shown(c.paidToCents), R)],
        [cell("Paid in by the shareholder"), cell(shown(c.paidInCents), R)],
        ...(c.booksCents !== null ? [[cell("Movement in the client's books"), cell(shown(c.booksCents), R)]] : []),
        [cell("Credited through entries"), cell(shown(c.creditedCents), R)], ...c.credited.map((e) => [cell(entryLabel(e), { margin: [12, 0, 0, 0], color: C.grey }), cell(shown(e.cents), R)]),
        [cell("Debited through entries"), cell(shown(c.debitedCents), R)], ...c.debited.map((e) => [cell(entryLabel(e), { margin: [12, 0, 0, 0], color: C.grey }), cell(shown(e.cents), R)]),
        [cell("Closing balance", { bold: true, border: dbl }), cell(shown(c.closingCents), { ...R, bold: true, border: dbl })]];
      return [{ text: cardTitle(c), bold: true, color: C.navy, fontSize: 10.5, margin: [0, 0, 0, 4] },
        { table: { headerRows: 1, widths: ["*", 90], body }, layout, fontSize: 8.5 },
        { table: { widths: ["*"], body: [[{ text: [{ text: b, bold: true }, ` ${rest}`], fillColor: C.shade, border: NO, margin: [4, 3, 4, 3] }]] }, layout: "noBorders", fontSize: 8.5, margin: [0, 6, 0, 14] }];
    };
    for (const c of r.cards) blocks.push(...card(c));
    blocks.push({ text: SIGN_NOTE, fontSize: 7.5, color: C.grey });
    const bytes = await renderWpPdf(wpDocument(ctx, [blocks]));
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
  }
  const data = await loadReportData(supabase, f.file, f.accounts, f.entries, ref.lines, ref.sheets);
  const t = reportTable(data, { report, view: q.get("view") ?? undefined, yearEnd: f.file.year_end, account: q.get("account") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, source: q.get("source") ?? undefined });
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
  const pdf = await buildReportPdf(supabase, id, { report, view: q.get("view") ?? undefined, account: q.get("account") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, source: q.get("source") ?? undefined });
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${pdf.filename}"`, "cache-control": "private, no-store" } });
}
