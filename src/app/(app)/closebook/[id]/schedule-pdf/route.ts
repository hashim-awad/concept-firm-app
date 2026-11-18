// Piece 3 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud's working paper): "Print schedule (PDF)". One page: the
// standard header block (client, schedule name, year end, W/P ref, prepared by, reviewed by), the inputs, the
// working and the entry's lines, stamped "Working paper: not for the client". The figures are the saved schedule's,
// worked out again from what it was saved with (its rates, ITC factor and company-paid figures). History records it.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadFile } from "@/lib/closebook/server";
import { C, headerBlock, wpDocument, type WpCtx } from "@/lib/closebook/wp-doc";
import { generatedAt, renderWpPdf } from "@/lib/closebook/wp-pdf";
import { formatAmount } from "@/lib/closebook/amount";
import { calcVehicle, choiceName, methodName, readInputs, recordNature, shortDate, yearParts, PROVINCE_NAMES, type VehicleSnapshot } from "@/lib/closebook/vehicle-schedule";
import { gstPeriods, type Frequency } from "@/lib/closebook/gst-return";
import { ctxOfSnapshot } from "@/lib/closebook/vehicle-server";
import { entryNo } from "@/lib/closebook/reports";

const STAMP = "Working paper: not for the client";
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const entryId = new URL(req.url).searchParams.get("entry") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(entryId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const [f, { data: s }] = await Promise.all([loadFile(supabase, id),
    supabase.from("cb_schedules").select("id, entry_id, inputs, snapshot, itc_claim").eq("file_id", id).eq("entry_id", entryId).maybeSingle()]);
  const e = f?.entries.find((x) => x.id === entryId);
  if (!f || !s || !e) return new Response("Not found", { status: 404 });
  const snap = s.snapshot as VehicleSnapshot;
  const inputs = { ...readInputs(s.inputs), itc: s.itc_claim as boolean };
  const r = calcVehicle(inputs, ctxOfSnapshot(f.file, snap));
  const y = yearParts(f.file.year_start, f.file.year_end);
  const client = f.client?.legal_name ?? "";
  const no = entryNo(f.file.year_end, e).split(" ")[0];
  const ctx: WpCtx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: "Vehicle schedule", stamp: STAMP,
    preparedBy: f.names.get(e.created_by ?? "") ?? "", reviewedBy: e.reviewed_by ? f.names.get(e.reviewed_by) ?? "" : "", wpBox: true };

  const NO = [false, false, false, false];
  const cell = (text: string, extra: Record<string, unknown> = {}) => ({ text, border: NO, ...extra });
  const head = (text: string, right = false) => ({ text, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: NO, fontSize: 8.5 });
  const km = (n: number | null) => (n === null ? "Not entered" : n.toLocaleString("en-CA"));
  const money = (c: number | null) => (c === null ? "Not entered" : formatAmount(c));
  const layout = { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => C.border, paddingTop: () => 2.5, paddingBottom: () => 2.5 };

  const inputRows: [string, string][] = [["Method", methodName(inputs.method)]];
  if (inputs.method === "prorated") inputRows.push(["Business km in the year", km(inputs.businessKm)]);
  else {
    if (!y.startsJan1) inputRows.push([`Business km already driven (${y.beforeLabel})`, km(inputs.alreadyKm ?? 0)]);
    y.parts.forEach((p, i) => inputRows.push([`Business km, ${p.label}`, km(inputs.partKm[i] ?? null)]));
  }
  inputRows.push(["Total km in the year", km(inputs.totalKm)], ["Car costs the owner paid personally (tax included)", money(inputs.ownerPaid)]);
  if (snap.regular) inputRows.push(["GST/HST in those costs", money(inputs.ownerGst)]);
  inputRows.push(["Car costs the company paid (tax included, from the books)", snap.companyIn ? `0.00, in the first car's schedule (${snap.companyIn})`
    : `${formatAmount(r.company.total)}${snap.company.length ? ` (${snap.company.map((a) => a.number).join(", ")})` : ""}`]);
  inputRows.push(["CRA rates used", snap.rates.map((x) => { const t = ["YT", "NT", "NU"].includes(snap.province); return `${x.year}: ${(t ? x.first_terr : x.first_prov).toFixed(2)} / ${(t ? x.after_terr : x.after_prov).toFixed(2)}`; }).join("; ")]);
  if (snap.regular) inputRows.push(["Claim the ITC", `${inputs.itc ? "Yes" : "No"} (${snap.factor ? `${snap.factor.numerator}/${snap.factor.denominator}` : "no factor"}, ${PROVINCE_NAMES[snap.province] ?? snap.province})`]);
  else inputRows.push(["GST/HST", "Not registered, or on the quick method: amounts are tax included"]);
  inputRows.push(["Used", `${r.used === "allowance" ? "Per-km allowance" : `Actual costs, ${r.sharePct}`} (${choiceName(inputs.choice).toLowerCase()})`]);

  const acc = new Map(f.accounts.map((a) => [a.id, a]));
  const lineRows = e.lines.map((l) => { const a = acc.get(l.account_id); return [cell(`${a?.number ? `${a.number} ` : ""}${a?.name ?? ""}`), cell(l.memo ?? "", { color: C.grey }),
    cell(l.amount > 0 ? formatAmount(Math.round(l.amount * 100)) : "", { alignment: "right" }), cell(l.amount < 0 ? formatAmount(Math.round(-l.amount * 100)) : "", { alignment: "right" })]; });
  const total = e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + Math.round(l.amount * 100), 0);

  // Version 2: the GST/HST record CRA requires for an ITC on an allowance or reimbursement without invoices (GST/HST
  // Memorandum 9-3, para 66). Registered files only; printed, never typed.
  const setup = (f.file.setup ?? {}) as { gst_registered?: boolean; gst_frequency?: string; gst_rt?: string };
  const registered = setup.gst_registered !== false;
  const date = e.entry_date ?? f.file.year_end;
  const freq = (["annual", "quarterly", "monthly"].includes(setup.gst_frequency ?? "") ? setup.gst_frequency : null) as Frequency | null;
  const period = freq ? gstPeriods(f.file.year_start, f.file.year_end, freq, { annual: 3, period: 1 }).find((x) => date >= x.start && date <= x.end) : undefined;
  const rec = r.record;
  const recordBox = registered ? [
    { text: "GST/HST record", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
    { table: { widths: [150, "*"], body: [
      ["Corporation", `${client}, GST/HST number ${f.client?.business_number || "not on the client record"} ${setup.gst_rt || "RT0001"}`],
      ["Paid to", snap.payee?.name || "Not on the client record"],
      [r.used === "allowance" ? "Amount of the allowance" : "Amount of the reimbursement", formatAmount(rec.amount)],
      ["GST/HST deemed paid", formatAmount(rec.gst)],
      ["Reporting period", period ? `${shortDate(period.start)} to ${shortDate(period.end)}` : "Filing frequency not set in step 1"],
      ["Nature", recordNature(r.used, rec.claim)],
    ].map(([a, b]) => [cell(a, { color: C.grey }), cell(b)]) }, layout: { ...layout, hLineWidth: () => 0.6, vLineWidth: () => 0.6, vLineColor: () => C.border }, fontSize: 8.5, margin: [0, 0, 0, 12] },
  ] : [];

  const def = wpDocument(ctx, [[
    headerBlock(ctx, "Vehicle schedule (owner's car)", "Vehicle schedule"),
    { columns: [
      { width: 330, stack: [{ text: "Inputs", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
        { table: { widths: [190, "*"], body: inputRows.map(([a, b]) => [cell(a, { color: C.grey }), cell(b)]) }, layout, fontSize: 8.5 }] },
      { width: "*", stack: [{ text: "Working", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
        { table: { widths: ["*", 80], body: [
          [cell("Per-km allowance", { bold: true }), cell(money(r.allowance), { alignment: "right", bold: true })],
          [cell(r.actual === null ? "Actual costs" : `Actual costs, ${r.sharePct}`, { bold: true }), cell(money(r.actual), { alignment: "right", bold: true })],
        ] }, layout, fontSize: 9 },
        { ul: r.working, fontSize: 8, lineHeight: 1.3, color: C.grey, margin: [0, 6, 0, 0] }] },
    ], columnGap: 24, margin: [0, 0, 0, 12] },
    ...recordBox,
    { text: `Entry ${no} ${e.kind}: ${e.note}`, bold: true, color: C.navy, margin: [0, 0, 0, 4] },
    { table: { headerRows: 1, widths: [200, "*", 80, 80], body: [[head("Account"), head("Description"), head("Debit", true), head("Credit", true)], ...lineRows,
      [cell("Total", { bold: true }), cell(""), cell(formatAmount(total), { alignment: "right", bold: true, border: [false, true, false, false] }), cell(formatAmount(total), { alignment: "right", bold: true, border: [false, true, false, false] })]] },
      layout: { ...layout, hLineColor: (i: number, node: any) => (i === node.table.body.length - 1 ? C.ink : C.border) }, fontSize: 8.5 },
  ]]);
  const pdf = await renderWpPdf(def);
  await supabase.rpc("cb_schedule_printed", { p_schedule: s.id });
  const base = `${client} Vehicle schedule ${no}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
