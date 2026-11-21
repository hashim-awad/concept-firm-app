// CB2-1 Part 3d: a Books report as Excel or PDF, the same figures as the screen (today's export builders).
import { requireAccess } from "@/lib/access";
import { formatDate } from "@/lib/dates";
import { reportTable, type ReportTable } from "@/lib/closebook/report-table";
import { reportXlsx } from "@/lib/closebook/xlsx-write";
import { journalSection, ledgerSection, statementSection, tbFlatSection, tbGroupSection, wpDocument, type WpCtx } from "@/lib/closebook/wp-doc";
import { generatedAt, renderWpPdf } from "@/lib/closebook/wp-pdf";
import { acctLabel, getBooks, rangeOf } from "../../../../data";
import { computeReport, isReport, REPORTS, txnOf } from "../../compute";

const STAMP = "Working paper: not for the client";
const relabel = (t: ReportTable, title: string): ReportTable => ({
  ...t, title,
  rows: t.rows.map((r) => ({ ...r, cells: r.cells.map((c) => c === "Adjusting and tax entries (AJE, TJE)" ? "Adjusting entries" : c === "Reclassifying entries (RJE)" ? "Reclass entries" : c) })),
});

export async function GET(req: Request, { params }: { params: Promise<{ client: string; report: string }> }) {
  await requireAccess("closebook", "view");
  const { client, report } = await params;
  const q = new URL(req.url).searchParams;
  const format = q.get("format");
  if (!isReport(report) || (format !== "xlsx" && format !== "pdf")) return new Response("Not found", { status: 404 });
  const b = await getBooks(client);
  if (!b) return new Response("Not found", { status: 404 });
  const { from, to } = rangeOf(b, { from: q.get("from") ?? undefined, to: q.get("to") ?? undefined });
  const account = q.get("account") ?? undefined;
  const r = computeReport(b, report, from, to, account);
  const title = REPORTS[report];
  const period = report === "bs" ? `As of ${formatDate(to)}` : `${formatDate(from)} to ${formatDate(to)}`;
  const base = `${b.client.name} ${title} ${to}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  const entryLabel = new Map<string, string>();
  for (const p of r.input.postings) { const t = p.ref ? txnOf(b, p) : null; if (t) entryLabel.set(p.ref, t.no ? `${t.type} ${t.no}` : t.type); }
  if (format === "xlsx") {
    const t = reportTable({ accounts: r.input.accounts, postings: report === "journal" || report === "gl" ? r.input.postings.filter((p) => p.ref || report === "gl") : r.input.postings, info: b.info, bankFile: true, entryLabel },
      { report: report === "tbg" ? "tb" : report, view: report === "tb" ? "flat" : undefined, yearEnd: to, account, from, to });
    return new Response(new Uint8Array(reportXlsx(relabel(t, title), [b.client.name, period], STAMP)), { headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"`, "cache-control": "private, no-store" } });
  }
  const ctx: WpCtx = { client: b.client.name, yearEnd: to, yearStart: from, packageName: title, stamp: STAMP, generated: generatedAt(), preparedBy: "", reviewedBy: "", wpBox: false };
  const name = (key: string) => { const a = r.input.accounts.find((x) => x.key === key); return a ? acctLabel(a) : key; };
  const sec = report === "tbg" && r.groups ? tbGroupSection(ctx, r.groups.groups, r.groups.total, "TB")
    : report === "tb" ? tbFlatSection(ctx, r.tb, r.tb.reduce((t, x) => ({ ...t, final: t.final + x.final, last: t.last + x.last, prelim: t.prelim + x.prelim, adjust: t.adjust + x.adjust, reclass: t.reclass + x.reclass, diff: t.diff + x.diff }),
        { key: "total", number: "", name: "Total (debits less credits)", line_no: null, last: 0, opening: 0, activity: 0, prelim: 0, adjust: 0, reclass: 0, final: 0, diff: 0 }), "TB")
    : (report === "bs" || report === "pl") && r.stmts ? statementSection(ctx, r.stmts, report, report.toUpperCase())
    : report === "gl" && r.ledger ? ledgerSection(ctx, r.ledger, (l) => entryLabel.get(l.ref) ?? "", "GL", from)
    : r.journal && r.box ? journalSection(ctx, r.journal, (t) => entryLabel.get(t.ref) ?? "", name, r.box, "JNL") : [];
  const bytes = await renderWpPdf(wpDocument(ctx, [sec]));
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
