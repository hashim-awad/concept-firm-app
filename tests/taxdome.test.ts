// TaxDome Accounts import: made-up rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { bn9, parseYearEnd, planImport, province, readAccounts, type Existing } from "../src/lib/taxdome/accounts.ts";

const HEAD = 'id,Account Name,State,Account Type,Tags,"CRA BN ""9 digits"" (RC)",SIN #,Notes,Fiscal Year-End,Alberta Finance â€“ Corporate Income Tax (AT1),T2 Filing Deadline,Company Street Address,Company State / Province,Client contact';
const row = (...v: string[]) => v.map((x) => (/[",]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x)).join(",");

test("year-end: free text read, anything unclear left blank", () => {
  assert.equal(parseYearEnd("Dec 31"), "12-31");
  assert.equal(parseYearEnd("October 31"), "10-31");
  assert.equal(parseYearEnd("july 31"), "07-31");
  assert.equal(parseYearEnd("31 Mar"), "03-31");
  assert.equal(parseYearEnd("Sept. 30th"), "09-30");
  assert.equal(parseYearEnd("2025-06-30"), "06-30");
  assert.equal(parseYearEnd("12/31"), "", "numeric day/month order is ambiguous: flag");
  assert.equal(parseYearEnd("Feb 30"), "");
  assert.equal(parseYearEnd("Feb 29"), "");
  assert.equal(parseYearEnd("year end"), "");
  assert.equal(parseYearEnd(""), "");
});

test("business number: first 9 digits", () => {
  assert.equal(bn9("725603690 RC0001"), "725603690");
  assert.equal(bn9("736174566 RC 0001"), "736174566");
  assert.equal(bn9("12345"), "");
  assert.equal(province("Ontario"), "ON");
  assert.equal(province("AB"), "AB");
  assert.equal(province("Quebec"), "OTHER");
});

test("reads only T2 companies; individuals with T2 are flagged; private columns never come out", () => {
  const csv = [HEAD,
    row("101", "Alpha Realty Inc.", "Active", "Company", "T2, BK", "725603690 RC0001", "123-456-789", "secret note", "Dec 31", "", "Jun 30", "1 Main St", "Ontario", "Jane"),
    row("102", "Pat Person", "Active", "Individual", "T2", "", "987-654-321", "", "Dec 31", "", "", "", "Ontario", ""),
    row("103", "Beta Holdings Ltd.", "Active", "Company", "T1", "736174566", "", "", "Mar 31", "", "", "", "Ontario", ""),
    row("104", "Gamma Corp", "Active", "Company", "T2", "", "", "", "sometime", "", "", "", "Alberta", ""),
  ].join("\n");
  const r = readAccounts(csv);
  assert.deepEqual(r.missingColumns, []);
  assert.deepEqual(r.accounts.map((a) => a.taxdomeId), ["101", "104"]);
  assert.equal(r.flags.length, 1);
  assert.match(r.flags[0].reason, /Individual/);
  const a = r.accounts[0];
  assert.equal(a.bn, "725603690"); assert.equal(a.fye, "12-31"); assert.equal(a.province, "ON");
  assert.deepEqual(Object.keys(a).sort(), ["bn", "bnRaw", "fye", "fyeRaw", "legalName", "province", "row", "tags", "taxdomeId", "type"]);
  assert.ok(!JSON.stringify(r).includes("123-456-789") && !JSON.stringify(r).includes("secret note") && !JSON.stringify(r).includes("Main St"));
  assert.equal(r.accounts[1].fye, "");
});

test("invisible characters are removed from names; real dashes kept", () => {
  const csv = [HEAD, row("501", "Example Co. \u2014 1000000 Ontario Inc.\uFEFF", "Active", "Company", "T2", "", "", "", "Dec 31", "", "", "", "Ontario", "")].join("\n");
  assert.equal(readAccounts(csv).accounts[0].legalName, "Example Co. \u2014 1000000 Ontario Inc.");
});

test("missing columns stop the import", () => {
  assert.ok(readAccounts("id,Account Name\n1,X").missingColumns.length > 0);
});

const acct = (id: string, name: string, bn = "", fye = "12-31") => ({ row: 2, taxdomeId: id, legalName: name, type: "Company", tags: ["T2"], bnRaw: bn, bn, fyeRaw: fye, fye, province: "ON" });
const client = (id: string, name: string, extra: Partial<Existing> = {}): Existing => ({ id, kind: "corporation", legal_name: name, business_number: "", taxdome_account_id: null, year_end_md: "", taxdome_tags: [], ...extra });

test("match order: TaxDome id, then Business Number, then legal name; new ones inserted", () => {
  const existing = [client("c1", "Alpha Realty Inc.", { taxdome_account_id: "101" }), client("c2", "Old Name Ltd.", { business_number: "736174566" }), client("c3", "Gamma Corp")];
  const { planned, flags } = planImport([acct("101", "Alpha Realty Inc.", "725603690"), acct("102", "Beta Holdings Ltd.", "736174566"), acct("103", "GAMMA corp"), acct("104", "Delta Inc.", "111222333")], existing);
  assert.deepEqual(flags, []);
  assert.deepEqual(planned.map((p) => [p.account.taxdomeId, p.action, p.clientId ?? "", p.matchedBy ?? ""]),
    [["101", "update", "c1", "taxdome id"], ["102", "update", "c2", "business number"], ["103", "update", "c3", "legal name"], ["104", "insert", "", ""]]);
  assert.ok(planned[1].changes.some((c) => c.field === "Legal name" && c.to === "Beta Holdings Ltd."), "TaxDome is the master for the name");
  assert.ok(planned[2].notes.some((n) => /name only/.test(n)) && planned[2].notes.some((n) => /No Business Number/.test(n)));
});

test("never guesses: two name matches, duplicate BN in file, or a client already linked elsewhere", () => {
  const twins = [client("c1", "Same Name Inc."), client("c2", "Same Name Inc.")];
  assert.match(planImport([acct("201", "Same Name Inc.")], twins).flags[0].reason, /More than one Studio client/);
  const dupe = planImport([acct("301", "A Inc.", "123456789"), acct("302", "B Inc.", "123456789")], []);
  assert.equal(dupe.planned.length, 0); assert.equal(dupe.flags.length, 2);
  const linked = planImport([acct("401", "X Inc.", "999888777")], [client("c9", "X Inc.", { business_number: "999888777", taxdome_account_id: "400" })]);
  assert.match(linked.flags[0].reason, /different TaxDome account/);
});

test("re-import with nothing new makes no changes", () => {
  const existing = [client("c1", "Alpha Realty Inc.", { taxdome_account_id: "101", business_number: "725603690", year_end_md: "12-31", taxdome_tags: ["T2"] })];
  const { planned } = planImport([acct("101", "Alpha Realty Inc.", "725603690")], existing);
  assert.deepEqual(planned[0].changes, []);
});
