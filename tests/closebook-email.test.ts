// Run with: npm test
// Step 10's client email (round 12): Appendix C's render_email.py ported line for line. The fixtures are
// render_email.py's own output for six dummy cases (tests/fixtures/appendix-c-email); the port must give
// the same text and HTML, except the signature, "Hashim Awad, CPA" (Hashim, Nov 14, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { addMonths, buildEmail, money, type EmailInput } from "../src/lib/closebook/fs-email.ts";

const dir = new URL("./fixtures/appendix-c-email/", import.meta.url);
type Case = { id: string; m: { name: string; year_end: string; officer: { first: string }; bn15: string; balance: number; sbd: number; days: number; fed_tax: number; prov_tax: number; instalments: { date: string; required: number }[] };
  E: { today: string; filed_date: string; noa_issued?: boolean; noa_penalty?: number; noa_interest?: number; minute_letter?: boolean; hst?: { balance: number; due?: string; rt?: string } } };
const cases = JSON.parse(readFileSync(new URL("cases.json", dir), "utf8")) as Case[];
const input = (c: Case, over: Partial<EmailInput> = {}): EmailInput => ({
  name: c.m.name, yearEnd: c.m.year_end, days: c.m.days, officerFirst: c.m.officer.first, bn9: c.m.bn15.replace(" RC 0001", ""), today: c.E.today,
  // Appendix C worked the due date from the year end (3 months with the small business deduction, else 2); step 10 types it.
  tax: { balance: c.m.balance, due: addMonths(new Date(`${c.m.year_end}T12:00:00Z`), c.m.sbd > 0 ? 3 : 2).toISOString().slice(0, 10), filed: c.E.filed_date,
    noaIssued: !!c.E.noa_issued, noaPenalty: c.E.noa_penalty ?? 0, noaInterest: c.E.noa_interest ?? 0 },
  hst: c.E.hst ? { balance: c.E.hst.balance, due: c.E.hst.due ?? null, rt: c.E.hst.rt ?? "RT 0001" } : null,
  inst: { fedTax: c.m.fed_tax, provTax: c.m.prov_tax, fedTaxPrior: 0, provTaxPrior: 0, threshold: 3000, schedule: c.m.instalments.map((x) => ({ date: x.date, amount: x.required })) },
  minuteLetter: !!c.E.minute_letter, draft: false, ...over });
const fixture = (id: string, ext: string) => readFileSync(new URL(`${id}.${ext}`, dir), "utf8")
  .replace("Hashim Awad, CPA (ON), CPA (US), MFin", "Hashim Awad, CPA").replace("<b>Hashim Awad</b>, CPA (ON), CPA (US), MFin", "<b>Hashim Awad</b>, CPA");

for (const c of cases) {
  test(`Appendix C's email, word for word: ${c.id}`, () => {
    const e = buildEmail(input(c));
    assert.equal(`Subject: ${e.subject}\n\n${e.text}`, fixture(c.id, "txt"));
    assert.equal(e.html, fixture(c.id, "html"));
  });
}
const byId = (id: string) => cases.find((c) => c.id === id)!;

test("owing, filed late, with the NOA's penalty and interest: pay the total now", () => {
  const e = buildEmail(input(byId("owing_noa_late")));
  assert.match(e.text, /The return itself was due April 30, 2027 and was filed late\. The CRA's Notice of Assessment adds \$150 for late filing and \$42\.17 interest to date\./);
  assert.match(e.text, /Please pay \$4,513\.67 now\./, "4,321.50 + 150 + 42.17");
  assert.doesNotMatch(e.text, /forward it to us/, "the NOA is in: no request for it");
});
test("refund: no action, and the NOA requested", () => {
  const e = buildEmail(input(byId("refund")));
  assert.match(e.text, /shows a refund of \$1,250\. The CRA will send it/);
  assert.doesNotMatch(e.text, /How to pay/);
});
test("nil: no balance and no refund, no How to pay", () => {
  const e = buildEmail(input(byId("nil")));
  assert.match(e.text, /shows no balance owing and no refund\. No action is needed\./);
  assert.doesNotMatch(e.text, /How to pay/);
});
test("GST/HST owing: its own section and RT account, a separate payment", () => {
  const e = buildEmail(input(byId("hst_owing")));
  assert.match(e.text, /We filed the corporation's T2 return and its GST\/HST return with the CRA\./);
  assert.match(e.text, /Pay to business number 000000001 RT 0001\. This is a different account from A/);
  assert.match(e.text, /CRA e-file confirmation, GST\/HST return and minute book letter/);
});
test("instalments payable: monthly, the catch-up worked out, the due dates listed", () => {
  const e = buildEmail(input(byId("instalments")));
  assert.match(e.text, /3 x \$700 = \$2,100/);
  assert.match(e.text, /- March 31, 2027: \$2,100\n- April 30, 2027: \$700/);
  assert.deepEqual(e.review, []);
});
test("instalments: a short first year stretched to a full year; the threshold is the setting", () => {
  const c = byId("short_inst_q");
  assert.match(buildEmail(input(c)).text, /open for only 6 months\. Stretched to a full year, its tax comes to more than \$3,000\./);
  assert.match(buildEmail(input(c)).text, /a little every three months/);
  const e = buildEmail(input(c, { inst: { ...input(c).inst, threshold: 5000 } }));
  assert.match(e.text, /expected to be more than \$5,000/);
  assert.equal(e.review.length, 1);
});
test("draft for review until the reviewer signs step 10", () => {
  const e = buildEmail(input(byId("nil"), { draft: true }));
  assert.match(e.subject, /^DRAFT FOR REVIEW: /);
  assert.match(e.text, /^DRAFT FOR REVIEW\n/);
  assert.match(e.html, /DRAFT FOR REVIEW/);
});
test("money and month arithmetic as Appendix C", () => {
  assert.equal(money(1234), "$1,234");
  assert.equal(money(1234.5), "$1,234.50");
  assert.equal(addMonths(new Date("2026-10-31T12:00:00Z"), 6).toISOString().slice(0, 10), "2027-04-30");
  assert.equal(addMonths(new Date("2026-05-15T12:00:00Z"), 3).toISOString().slice(0, 10), "2026-08-15");
});
