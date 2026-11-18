import "server-only";
// Piece 3 (Hashim, Nov 18, 2026): what the Vehicle schedule reads. The CRA rates and the province's ITC factor
// (Closebook rules › CRA rates), the client's GST/HST answers (step 1), the car costs the company paid (the year's
// postings in the vehicle accounts), the schedule already saved with the entry, and last year's inputs for the
// grey hints. The company-paid figure leaves out the lines of every schedule entry, every Expenses paid personally
// entry and every "Auto expenses" standard entry; bank and card lines and typed entries count. The GST/HST is what
// each line posted. Only the file's first Vehicle schedule takes them; a second car's shows where they are.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbFileRow } from "./files";
import type { CbAccount, CbEntry } from "./server";
import type { ReportData } from "./report-data";
import { entryNo } from "./reports";
import { defaultTaxCode } from "./sales-tax";
import { EXPENSE_ACCOUNT, ITC_ACCOUNT, SHAREHOLDER_ACCOUNT, VEHICLE_ACCOUNTS, VEHICLE_GIFI, emptyInputs, readInputs,
  type CompanyAccount, type KmRates, type VehicleCtx, type VehicleInputs, type VehicleSnapshot } from "./vehicle-schedule";

export type StoredSchedule = { id: string; entry_id: string; method: string; choice: string; itc_claim: boolean; inputs: VehicleInputs; snapshot: VehicleSnapshot | null;
  result: Record<string, unknown>; created_at: string };
export type VehicleData = {
  ctx: VehicleCtx;                       // live: today's rates and books
  companyIn: string;                     // "" or the first car's entry number when another schedule takes the company costs
  ledger: { number: string; href: string }[];
  ledgerAll: string; ledgerNumbers: string[];   // "Open the ledger": the general ledger on the vehicle accounts
  stored: StoredSchedule | null;         // the schedule saved with this entry
  hints: VehicleInputs | null;           // last year's inputs (never copied in)
  canItc: boolean;                       // the file's reviewer or an owner
  acct: Record<string, string>;          // the entry form's account for 70600, 21500 and 23000 on this file
  names: Record<string, string>;         // account numbers to names, for the lines
  provinceName: string;
};

const cents = (n: number) => Math.round(Number(n) * 100);

export async function loadVehicle(supabase: SupabaseClient, file: CbFileRow, province: string, entries: CbEntry[], accounts: CbAccount[], rdata: ReportData,
  entryId: string | null, canItc: boolean, opts: { value: string; line_no: string }[]): Promise<VehicleData> {
  const [{ data: rates }, { data: factor }, { data: auto }, { data: schedules }, { data: chart }, { data: prev }, { data: client }] = await Promise.all([
    supabase.from("cb_cra_km_rates").select("year, first_prov, after_prov, first_terr, after_terr").order("year"),
    supabase.from("cb_cra_itc_factors").select("numerator, denominator").eq("province", province).maybeSingle(),
    supabase.from("cb_standard_entries").select("id").eq("name", "Auto expenses").maybeSingle(),
    supabase.from("cb_schedules").select("id, entry_id, method, choice, itc_claim, inputs, snapshot, result, created_at").eq("file_id", file.id).eq("kind", "vehicle").order("created_at").order("id"),
    supabase.from("cb_chart_accounts").select("number, name, line_no"),
    supabase.from("cb_files").select("id").eq("client_id", file.client_id).lt("year_end", file.year_end).order("year_end", { ascending: false }).limit(1).maybeSingle(),
    // Version 2: the GST/HST record names the corporation's number and the person paid, from the client record.
    supabase.from("clients").select("legal_name, business_number, signing_officer, signer_title").eq("id", file.client_id).maybeSingle(),
  ]);
  const setup = (file.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  // The same reading of the GST/HST answers as Expenses paid personally and the entry form.
  const registered = setup.gst_registered !== false;
  const regular = registered && setup.quick_method !== true;
  // Piece 4: Paid to is the Signing officer with their Signer title, from the client record.
  const cl = (client ?? {}) as { signing_officer?: string; signer_title?: string };
  const payee = (cl.signing_officer ?? "").trim() ? { id: "signing-officer", name: [cl.signing_officer!.trim(), (cl.signer_title ?? "").trim()].filter(Boolean).join(", ") } : null;
  const bnMissing = registered && !((client as { business_number?: string } | null)?.business_number ?? "");
  const list = ((schedules ?? []) as StoredSchedule[]).map((s) => ({ ...s, inputs: readInputs(s.inputs) }));
  const stored = entryId ? list.find((s) => s.entry_id === entryId) ?? null : null;
  const first = list[0];
  const takesCompany = !first || (entryId !== null && first.entry_id === entryId);
  const firstEntry = first ? entries.find((e) => e.id === first.entry_id) : undefined;
  const companyIn = takesCompany || !firstEntry ? "" : entryNo(file.year_end, firstEntry).split(" ")[0];

  // ---------- The car costs the company paid.
  const byKey = new Map(accounts.map((a) => [a.account_key, a]));
  const isVehicle = (key: string) => {
    const a = rdata.accounts.find((x) => x.key === key);
    return !!a && (VEHICLE_ACCOUNTS.includes(a.number) || (!rdata.bankFile && VEHICLE_GIFI.includes(a.line_no ?? "")));
  };
  const vehicleKeys = new Set(rdata.accounts.map((a) => a.key).filter(isVehicle));
  const autoId = (auto as { id: string } | null)?.id ?? null;
  const skip = new Set(entries.filter((e) => e.origin === "schedule" || e.origin === "expenses_personal" || (autoId && e.standard_id === autoId)).map((e) => e.id));
  const per = new Map<string, { cost: number; gst: number }>();
  const add = (key: string, cost: number, gst: number) => { const r = per.get(key) ?? { cost: 0, gst: 0 }; r.cost += cost; r.gst += gst; per.set(key, r); };
  // Bank and card lines (and an imported trial balance): each line's cost, and the GST/HST it posted, shared over
  // its taxed amounts when a split line has several accounts.
  const refs = new Map<string, typeof rdata.postings>();
  for (const p of rdata.postings) {
    if (p.kind === "entry") continue;
    if (p.kind !== "bank") { if (vehicleKeys.has(p.key)) add(p.key, p.cents, 0); continue; }
    const r = refs.get(p.ref) ?? [];
    r.push(p); refs.set(p.ref, r);
  }
  for (const ps of refs.values()) {
    const veh = ps.filter((p) => vehicleKeys.has(p.key));
    if (!veh.length) continue;
    const tax = ps.filter((p) => p.key === `chart:${ITC_ACCOUNT}`).reduce((n, p) => n + p.cents, 0);
    const sign = Math.sign(veh.reduce((n, p) => n + p.cents, 0)) || 1;
    const base = ps.filter((p) => p.key !== `chart:${ITC_ACCOUNT}` && Math.sign(p.cents) === sign).reduce((n, p) => n + p.cents, 0);
    for (const p of veh) add(p.key, p.cents, base ? Math.round((tax * p.cents) / base) : 0);
  }
  // Typed entries: each vehicle line, with the GST/HST its entry posted shared over the entry's taxed lines.
  for (const e of entries) {
    if (skip.has(e.id)) continue;
    const keyOf = (id: string) => rdata.acctOf(id)?.key ?? "";
    const veh = e.lines.filter((l) => !l.is_tax && vehicleKeys.has(keyOf(l.account_id)));
    if (!veh.length) continue;
    const tax = e.lines.filter((l) => l.is_tax && keyOf(l.account_id) === `chart:${ITC_ACCOUNT}`).reduce((n, l) => n + cents(l.amount), 0);
    const taxed = e.lines.filter((l) => !l.is_tax && l.tax_code).reduce((n, l) => n + cents(l.amount), 0);
    for (const l of veh) add(keyOf(l.account_id), cents(l.amount), l.tax_code && taxed ? Math.round((tax * cents(l.amount)) / taxed) : 0);
  }
  const optOf = (key: string) => byKey.get(key)?.id ?? key;
  const company: CompanyAccount[] = takesCompany ? [...per.entries()].filter(([, v]) => v.cost || v.gst).map(([key, v]) => {
    const a = rdata.accounts.find((x) => x.key === key)!;
    return { account: optOf(key), number: a.number, name: a.name, cost: v.cost, gst: regular ? v.gst : 0 };
  }).sort((a, b) => a.number.localeCompare(b.number)) : [];
  const ledger = [...vehicleKeys].map((key) => ({ number: rdata.accounts.find((a) => a.key === key)?.number ?? "", key }))
    .filter((x) => x.number).sort((a, b) => a.number.localeCompare(b.number))
    .map((x) => ({ number: x.number, href: `/closebook/${file.id}?area=reporting&report=gl&account=${encodeURIComponent(x.key)}` }));

  // The ledger link: the standard vehicle accounts on a bank-statement file (whether or not they have postings yet),
  // and every account found on the vehicle lines.
  const allKeys = [...new Set([...(rdata.bankFile ? VEHICLE_ACCOUNTS.map((n) => `chart:${n}`) : []), ...vehicleKeys])];

  // ---------- The entry form's account for each standard account the schedule posts to.
  const chartRows = (chart ?? []) as { number: string; name: string; line_no: string | null }[];
  const own = ["client_software", "bookkeeper"].includes(file.books);
  const acct: Record<string, string> = {}, names: Record<string, string> = {};
  for (const n of [EXPENSE_ACCOUNT, ITC_ACCOUNT, SHAREHOLDER_ACCOUNT]) {
    const c = chartRows.find((x) => x.number === n);
    names[n] = c?.name ?? n;
    if (!own) acct[n] = byKey.get(`chart:${n}`)?.id ?? `chart:${n}`;
    else acct[n] = opts.find((o) => o.line_no === c?.line_no)?.value ?? "";
  }
  if (own) for (const n of [EXPENSE_ACCOUNT, SHAREHOLDER_ACCOUNT]) { const o = opts.find((x) => x.value === acct[n]); const a = accounts.find((x) => x.id === o?.value); if (a) names[n] = a.name; }

  // ---------- Last year's inputs: the same car's schedule (first with first, second with second).
  let hints: VehicleInputs | null = null;
  if (prev) {
    const { data: last } = await supabase.from("cb_schedules").select("inputs").eq("file_id", (prev as { id: string }).id).eq("kind", "vehicle").order("created_at").order("id");
    const pos = stored ? list.indexOf(stored) : list.length;
    const row = ((last ?? []) as { inputs: unknown }[])[pos];
    if (row) hints = readInputs(row.inputs);
  }
  const f = factor as { numerator: number; denominator: number } | null;
  return {
    ctx: { yearStart: file.year_start, yearEnd: file.year_end, province, rates: ((rates ?? []) as KmRates[]).map((r) => ({ year: r.year, first_prov: Number(r.first_prov), after_prov: Number(r.after_prov), first_terr: Number(r.first_terr), after_terr: Number(r.after_terr) })),
      factor: f ? { numerator: f.numerator, denominator: f.denominator } : null, regular, company, taxCode: regular ? defaultTaxCode("GST/HST", province, EXPENSE_ACCOUNT) : null,
      payee, bnMissing },
    companyIn, ledger, stored, hints, canItc, acct, names, provinceName: province,
    ledgerAll: `/closebook/${file.id}?area=reporting&report=gl&account=${encodeURIComponent(allKeys.join(","))}`,
    ledgerNumbers: rdata.bankFile ? VEHICLE_ACCOUNTS : ledger.map((l) => l.number),
  };
}

// What the schedule was calculated with, kept with it.
export const snapshotOf = (d: VehicleData): VehicleSnapshot => ({
  province: d.ctx.province, regular: d.ctx.regular, factor: d.ctx.factor, taxCode: d.ctx.taxCode,
  rates: d.ctx.rates.filter((r) => r.year >= +d.ctx.yearStart.slice(0, 4) && r.year <= +d.ctx.yearEnd.slice(0, 4)), company: d.ctx.company, companyIn: d.companyIn,
  payee: null,
});
// The saved schedule's own context (the PDF, and "what was saved"): its snapshot, else today's.
export const ctxOfSnapshot = (file: CbFileRow, s: VehicleSnapshot): VehicleCtx => ({
  yearStart: file.year_start, yearEnd: file.year_end, province: s.province, rates: s.rates, factor: s.factor, regular: s.regular, company: s.company, taxCode: s.taxCode,
});
export { emptyInputs };
