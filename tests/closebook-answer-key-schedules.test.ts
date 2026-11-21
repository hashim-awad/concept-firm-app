// Run with: npm test
// CloseBook2 piece CB2-0: the schedules of every CSV answer key (tests/answer-keys/<folder>/source/schedule_inputs.json)
// worked out by the app's schedule calculators and checked against the key's "expected" blocks. The inputs and the
// expected figures are read from the answer-key folder; none is copied here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { calcHome, COST_ROWS, emptyHomeInputs, type HomeInputs } from "../src/lib/closebook/home-office.ts";
import { calcExpenses, type ExpAcct, type ExpInputs } from "../src/lib/closebook/expenses-schedule.ts";
import { calcVehicle, emptyInputs, type VehicleInputs } from "../src/lib/closebook/vehicle-schedule.ts";

const root = path.resolve("tests/answer-keys");
const keys = readdirSync(root).filter((f) => existsSync(path.join(root, f, "source", "schedule_inputs.json")));
const c = (n: number | null | undefined) => (n === null || n === undefined ? null : Math.round(n * 100));
const factorOf = (s: string) => { const m = /(\d+)\/(\d+)/.exec(s); return m ? { numerator: +m[1], denominator: +m[2] } : null; };

for (const folder of keys) {
  const s = JSON.parse(readFileSync(path.join(root, folder, "source", "schedule_inputs.json"), "utf8"));
  const chart = new Map<string, string>(readFileSync(path.join(root, folder, "source", "chart.csv"), "utf8").trim().split("\n").slice(1)
    .map((l) => { const [n, ...rest] = l.split(","); return [n, rest.slice(0, -1).join(",").replace(/^"|"$/g, "")]; }));

  if (s.home_office) test(`${folder}: home office schedule matches the answer key`, () => {
    const h = s.home_office, f = factorOf(h.itc_rate);
    const inp: HomeInputs = { ...emptyHomeInputs(), homeSqft: h.home_sq_ft, officeSqft: h.office_sq_ft, itc: h.claim_itc, costs: {} };
    for (const r of h.costs) {
      const row = COST_ROWS.find((x) => x.label === r.cost);
      assert.ok(row, `No home office row named ${r.cost}`);
      inp.costs[row!.key] = { paid: c(r.paid), gst: r.gst_hst === null ? (row!.gst === "auto" ? 0 : null) : c(r.gst_hst) };
    }
    const res = calcHome(inp, { province: "ON", regular: true, factor: f, taxCode: "HST_ON" });
    const e = h.expected;
    assert.equal(res.totalPaid, c(e.total_paid), "total paid");
    assert.equal(res.totalGst, c(e.total_gst_hst), "total GST/HST");
    assert.equal(res.itc, c(e.itc), "ITC");
    assert.equal(res.expense, c(e.expense), "expense");
    assert.equal(res.owed, c(e.owed_to_owner), "owed to the owner");
  });

  if (s.expenses_paid_personally) test(`${folder}: expenses paid personally schedule matches the answer key`, () => {
    const x = s.expenses_paid_personally;
    const accts: Record<string, ExpAcct> = {};
    for (const l of x.lines) accts[l.account] = { label: chart.get(l.account) ?? l.account, tax: "taxable", meals: /meal/i.test(l.note ?? "") };
    const inp: ExpInputs = { itc: x.claim_itc, lines: x.lines.map((l: { account: string; what?: string; paid: number; gst_hst: number; business_pct: number }) =>
      ({ acct: l.account, what: l.what ?? "", paid: c(l.paid), gst: c(l.gst_hst), pctBp: Math.round(l.business_pct * 100) })) };
    const res = calcExpenses(inp, { province: "ON", regular: true, factor: factorOf(x.itc_rate), taxCode: "HST_ON", mealsCode: "MEALS_HST_50", accts });
    assert.equal(res.expense, c(x.expected.expenses), "expenses");
    assert.equal(res.itc, c(x.expected.itc), "ITC");
    assert.equal(res.owed, c(x.expected.owed_to_owner), "owed to the owner");
  });

  if (s.vehicle) test(`${folder}: vehicle schedule matches the answer key`, () => {
    const v = s.vehicle, e = v.expected;
    const [ys, ye] = String(v.period).split(" to ");
    const rates = Object.entries(v.cra_rates as Record<string, { first_5000: number; after: number }>).map(([y, r]) =>
      ({ year: +y, first_prov: r.first_5000, after_prov: r.after, first_terr: r.first_5000, after_terr: r.after }));
    const inp: VehicleInputs = { ...emptyInputs(), method: v.mode === "Prorated" ? "prorated" : "detailed", businessKm: v.business_km, totalKm: v.total_km,
      ownerPaid: c(v.owner_paid_personally), ownerGst: c(v.owner_paid_gst_hst), itc: v.claim_itc };
    const company = [{ account: "company", number: "70600", name: "Vehicle expenses", cost: c(e.company_paid_before_tax)!, gst: c(e.company_paid_gst_hst)! }];
    const res = calcVehicle(inp, { yearStart: ys, yearEnd: ye, province: "ON", rates, factor: factorOf(v.itc_rate), regular: true, company, taxCode: "HST_ON" });
    assert.equal(res.company.total, c(e.company_paid), "company paid");
    assert.equal(res.allowance, c(e.per_km_allowance), "per-km allowance");
    assert.equal(res.itc, c(e.itc_on_allowance), "ITC on the allowance");
    assert.equal(res.actual, c(e.actual_costs_95pct), "actual costs, business share");
    assert.equal(res.used, /allowance/.test(e.used) ? "allowance" : "actual", "the method used");
  });
}
