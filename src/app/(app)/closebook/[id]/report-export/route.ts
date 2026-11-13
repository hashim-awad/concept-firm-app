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

const STAMP = "Working paper: not for the client";
const REPORTS = ["tb", "bs", "pl", "gl", "journal"];

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
