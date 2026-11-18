// Piece 3 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud's working paper): "Print schedule (PDF)". One page: the
// standard header block (client, schedule name, year end, W/P ref, prepared by, reviewed by), the inputs, the
// working and the entry's lines, stamped "Working paper: not for the client". The figures are the saved schedule's,
// worked out again from what it was saved with (its rates, ITC factor and company-paid figures). History records it.
// Piece 4: the Home office schedule prints the same way (its areas or share, the cost rows and the working).
// Piece 4b: the Expenses paid personally schedule lists every line (account, what it was, amount paid, GST/HST,
// business %, expense, ITC).
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
import { calcHome, readHomeInputs, HOME_NATURE } from "@/lib/closebook/home-office";
import type { HomeSnapshot } from "@/lib/closebook/home-office-server";
import { calcExpenses, pctText, readExpInputs, EXP_NATURE } from "@/lib/closebook/expenses-schedule";
import type { ExpSnapshot } from "@/lib/closebook/expenses-schedule-server";

const STAMP = "Working paper: not for the client";
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const entryId = new URL(req.url).searchParams.get("entry") ?? "";
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(entryId)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const [f, { data: s }] = await Promise.all([loadFile(supabase, id),
    supabase.from("cb_schedules").select("id, entry_id, kind, inputs, snapshot, itc_claim").eq("file_id", id).eq("entry_id", entryId).maybeSingle()]);
  const e = f?.entries.find((x) => x.id === entryId);
  if (!f || !s || !e) return new Response("Not found", { status: 404 });
  const home = s.kind === "home_office", exp = s.kind === "expenses";
  const schedName = home ? "Home office schedule" : exp ? "Expenses paid personally schedule" : "Vehicle schedule";
  const client = f.client?.legal_name ?? "";
  const no = entryNo(f.file.year_end, e).split(" ")[0];
  const ctx: WpCtx = { client, yearEnd: f.file.year_end, yearStart: f.file.year_start, generated: generatedAt(), packageName: schedName, stamp: STAMP,
    preparedBy: f.names.get(e.created_by ?? "") ?? "", reviewedBy: e.reviewed_by ? f.names.get(e.reviewed_by) ?? "" : "", wpBox: true };

  const NO = [false, false, false, false];
  const cell = (text: string, extra: Record<string, unknown> = {}) => ({ text, border: NO, ...extra });
  const head = (text: string, right = false) => ({ text, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: NO, fontSize: 8.5 });
  const km = (n: number | null) => (n === null ? "Not entered" : n.toLocaleString("en-CA"));
  const money = (c: number | null) => (c === null ? "Not entered" : formatAmount(c));
  const layout = { hLineWidth: () => 0.4, vLineWidth: () => 0, hLineColor: () => C.border, paddingTop: () => 2.5, paddingBottom: () => 2.5 };

  // The schedule's own part: its inputs and working, and the figures for the GST/HST record.
  let top: any[], rec: { amountLabel: string; amount: number; gst: number; claim: boolean; payee: string; nature: string };
  if (exp) {
    const xs = (s.snapshot ?? {}) as ExpSnapshot;
    const xin = { ...readExpInputs(s.inputs), itc: s.itc_claim as boolean };
    const xr = calcExpenses(xin, { province: xs.province, regular: xs.regular, factor: xs.factor, taxCode: xs.taxCode, mealsCode: xs.mealsCode, accts: xs.accts ?? {} });
    const used = xr.rows.filter((x) => x.paid);
    const right = { alignment: "right" };
    const tot = { alignment: "right", bold: true, border: [false, true, false, false] };
    const body = [[head("Account"), head("What it was"), head("Amount paid", true), ...(xs.regular ? [head("GST/HST", true)] : []), head("Business %", true), head("Expense", true), ...(xs.regular ? [head("ITC", true)] : [])],
      ...used.map((x) => [cell(`${x.label}${x.meals && xs.regular ? " (meals: half the GST/HST)" : ""}`), cell(x.what, { color: C.grey }), cell(formatAmount(x.paid), right),
        ...(xs.regular ? [cell(x.gstText || "0.00", right)] : []), cell(pctText(x.pctBp), right), cell(formatAmount(x.expense), right), ...(xs.regular ? [cell(formatAmount(x.itc), right)] : [])]),
      [cell("Total", { bold: true }), cell(""), cell(formatAmount(used.reduce((n, x) => n + x.paid, 0)), tot), ...(xs.regular ? [cell(formatAmount(used.reduce((n, x) => n + x.gst, 0)), tot)] : []),
        cell(""), cell(formatAmount(xr.expense), tot), ...(xs.regular ? [cell(formatAmount(xr.itc), tot)] : [])]];
    const facts: [string, string][] = [xs.regular ? ["Claim the ITC", `${xin.itc ? "Yes" : "No"} (${xs.factor ? `${xs.factor.numerator}/${xs.factor.denominator}` : "no factor"}, ${PROVINCE_NAMES[xs.province] ?? xs.province})`]
      : ["GST/HST", "Not registered, or on the quick method: amounts are tax included"], ["Owed to the owner", formatAmount(xr.owed)]];
    top = [
      { table: { widths: [120, "*"], body: facts.map(([a, b]) => [cell(a, { color: C.grey }), cell(b)]) }, layout, fontSize: 8.5, margin: [0, 0, 0, 8] },
      { text: "Lines", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
      { table: { headerRows: 1, widths: xs.regular ? [150, "*", 60, 55, 50, 60, 50] : [170, "*", 70, 60, 70], body }, layout, fontSize: 8.5 },
      { text: xr.working, fontSize: 8, color: C.grey, margin: [0, 6, 0, 12] },
    ];
    rec = { amountLabel: "Amount of the reimbursement", amount: xr.record.amount, gst: xr.record.gst, claim: xr.record.claim, payee: xs.payee?.name ?? "", nature: EXP_NATURE };
  } else if (home) {
    const hs = (s.snapshot ?? {}) as HomeSnapshot;
    const hin = { ...readHomeInputs(s.inputs), itc: s.itc_claim as boolean };
    const hr = calcHome(hin, { province: hs.province, regular: hs.regular, factor: hs.factor, taxCode: hs.taxCode });
    const rows: [string, string][] = hin.mode === "area"
      ? [["Home area (sq ft)", (hin.homeSqft ?? 0).toLocaleString("en-CA")], ["Office area (sq ft)", (hin.officeSqft ?? 0).toLocaleString("en-CA")], ["Business share", hr.sharePct]]
      : [["Business share (typed)", hr.sharePct]];
    rows.push(hs.regular ? ["Claim the ITC", `${hin.itc ? "Yes" : "No"} (${hs.factor ? `${hs.factor.numerator}/${hs.factor.denominator}` : "no factor"}, ${PROVINCE_NAMES[hs.province] ?? hs.province})`]
      : ["GST/HST", "Not registered, or on the quick method: amounts are tax included"]);
    const costBody = [[head("Cost"), head("Amount paid", true), ...(hs.regular ? [head("GST/HST in it", true)] : []), head(`Business ${hr.sharePct}`, true)],
      ...hr.rows.map((x) => [cell(x.label), cell(x.paid ? formatAmount(x.paid) : "–", { alignment: "right" }), ...(hs.regular ? [cell(x.gstText || "–", { alignment: "right" })] : []),
        cell(x.paid ? formatAmount(x.business) : "–", { alignment: "right" })]),
      [cell("Total", { bold: true }), cell(formatAmount(hr.totalPaid), { alignment: "right", bold: true, border: [false, true, false, false] }),
        ...(hs.regular ? [cell(formatAmount(hr.totalGst), { alignment: "right", bold: true, border: [false, true, false, false] })] : []),
        cell(formatAmount(hr.totalBusiness), { alignment: "right", bold: true, border: [false, true, false, false] })]];
    top = [{ columns: [
      { width: 250, stack: [{ text: "Inputs", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
        { table: { widths: [120, "*"], body: rows.map(([a, b]) => [cell(a, { color: C.grey }), cell(b)]) }, layout, fontSize: 8.5 }] },
      { width: "*", stack: [{ text: "Costs", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
        { table: { headerRows: 1, widths: hs.regular ? ["*", 75, 75, 80] : ["*", 90, 90], body: costBody }, layout, fontSize: 8.5 },
        { text: hr.working, fontSize: 8, color: C.grey, margin: [0, 6, 0, 0] }] },
    ], columnGap: 24, margin: [0, 0, 0, 12] }];
    rec = { amountLabel: "Amount of the reimbursement", amount: hr.record.amount, gst: hr.record.gst, claim: hr.record.claim, payee: hs.payee?.name ?? "", nature: HOME_NATURE };
  } else {
  const snap = s.snapshot as VehicleSnapshot;
  const inputs = { ...readInputs(s.inputs), itc: s.itc_claim as boolean };
  const r = calcVehicle(inputs, ctxOfSnapshot(f.file, snap));
  const y = yearParts(f.file.year_start, f.file.year_end);
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
  top = [{ columns: [
      { width: 330, stack: [{ text: "Inputs", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
        { table: { widths: [190, "*"], body: inputRows.map(([a, b]) => [cell(a, { color: C.grey }), cell(b)]) }, layout, fontSize: 8.5 }] },
      { width: "*", stack: [{ text: "Working", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
        { table: { widths: ["*", 80], body: [
          [cell("Per-km allowance", { bold: true }), cell(money(r.allowance), { alignment: "right", bold: true })],
          [cell(r.actual === null ? "Actual costs" : `Actual costs, ${r.sharePct}`, { bold: true }), cell(money(r.actual), { alignment: "right", bold: true })],
        ] }, layout, fontSize: 9 },
        { ul: r.working, fontSize: 8, lineHeight: 1.3, color: C.grey, margin: [0, 6, 0, 0] }] },
    ], columnGap: 24, margin: [0, 0, 0, 12] }];
  rec = { amountLabel: r.used === "allowance" ? "Amount of the allowance" : "Amount of the reimbursement", amount: r.record.amount, gst: r.record.gst, claim: r.record.claim,
    payee: snap.payee?.name ?? "", nature: recordNature(r.used, r.record.claim) };
  }

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
  // Version 2b: the record prints only where the ITC is claimed (registered, regular method, "Claim the ITC" ticked).
  const recordBox = registered && rec.claim ? [
    { text: "GST/HST record", bold: true, color: C.navy, margin: [0, 0, 0, 4] },
    { table: { widths: [150, "*"], body: [
      ["Corporation", `${client}, GST/HST number ${f.client?.business_number || "not on the client record"} ${setup.gst_rt || "RT0001"}`],
      ["Paid to", rec.payee || "Not on the client record"],
      [rec.amountLabel, formatAmount(rec.amount)],
      ["GST/HST deemed paid", formatAmount(rec.gst)],
      ["Reporting period", period ? `${shortDate(period.start)} to ${shortDate(period.end)}` : "Filing frequency not set in step 1"],
      ["Nature", rec.nature],
    ].map(([a, b]) => [cell(a, { color: C.grey }), cell(b)]) }, layout: { ...layout, hLineWidth: () => 0.6, vLineWidth: () => 0.6, vLineColor: () => C.border }, fontSize: 8.5, margin: [0, 0, 0, 12] },
  ] : [];

  const def = wpDocument(ctx, [[
    headerBlock(ctx, home ? "Home office schedule" : exp ? "Expenses paid personally" : "Vehicle schedule (owner's car)", schedName),
    ...top,
    ...recordBox,
    { text: `Entry ${no} ${e.kind}: ${e.note}`, bold: true, color: C.navy, margin: [0, 0, 0, 4] },
    { table: { headerRows: 1, widths: [200, "*", 80, 80], body: [[head("Account"), head("Description"), head("Debit", true), head("Credit", true)], ...lineRows,
      [cell("Total", { bold: true }), cell(""), cell(formatAmount(total), { alignment: "right", bold: true, border: [false, true, false, false] }), cell(formatAmount(total), { alignment: "right", bold: true, border: [false, true, false, false] })]] },
      layout: { ...layout, hLineColor: (i: number, node: any) => (i === node.table.body.length - 1 ? C.ink : C.border) }, fontSize: 8.5 },
  ]]);
  const pdf = await renderWpPdf(def);
  await supabase.rpc("cb_schedule_printed", { p_schedule: s.id });
  const base = `${client} ${schedName} ${no}`.replace(/[^\w .-]+/g, "").replace(/\s+/g, " ").trim();
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
