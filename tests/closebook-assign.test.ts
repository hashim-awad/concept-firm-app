// Run with: node --test tests/
// Piece R2 (Hashim, Nov 19, 2026): step 4 "Assign mapping" on trial balance files: the QuickBooks Parent:Sub reader, the tree,
// the accounts that count, the suggestions in order, "Accept last year's matches", the step names and module headings.
// Dummy names and figures.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTree, counted, lastYearMatches, suggest, actionText, qboClass, type ClientAcct, type MasterAcct, type PriorMatch } from "../src/lib/closebook/assign.ts";
import { readTrialBalance, readAccountList, splitPath } from "../src/lib/closebook/tb-import.ts";
import { stepModules, stepTitle, stepPapers, stepFromLegacy } from "../src/lib/closebook/steps.ts";

const M: MasterAcct[] = [
  { number: "10000", name: "Chequing", type: "Asset", line: "1002.00", sheet: "Cash and bank" },
  { number: "10100", name: "Savings", type: "Asset", line: "1002.00", sheet: "Cash and bank" },
  { number: "10200", name: "US dollar account", type: "Asset", line: "1003.00", sheet: "Cash and bank" },
  { number: "10900", name: "Clearing", type: "Asset", line: null, sheet: "" },
  { number: "40100", name: "Service revenue", type: "Revenue", line: "8000.00", sheet: "Revenue" },
  { number: "60000", name: "Advertising", type: "Expense", line: "8521.00", sheet: "Operating expenses" },
  { number: "60200", name: "Meals and entertainment", type: "Expense", line: "8523.00", sheet: "Operating expenses" },
  { number: "65200", name: "Software and subscriptions", type: "Expense", line: "9150.00", sheet: "Operating expenses" },
  { number: "66000", name: "Accounting fees", type: "Expense", line: "8862.00", sheet: "Operating expenses" },
];
const A = (o: Partial<ClientAcct> & { key: string; name: string }): ClientAcct => ({ id: o.key, number: "", thisYear: 100, lastYear: 0, ...o });

test("D10: a QuickBooks sub-account is its own account, under its parent", () => {
  assert.deepEqual(splitPath("6000 Marketing - Digital:6000.01 Paid search ads"),
    { number: "6000.01", name: "Paid search ads", parent: "6000", path: "Marketing - Digital:Paid search ads", full_name: "6000 Marketing - Digital:6000.01 Paid search ads" });
  assert.deepEqual(splitPath("Payment apps:Payment app clearing (USD)"), { number: "", name: "Payment app clearing (USD)", parent: "payment apps", path: "Payment apps:Payment app clearing (USD)", full_name: "Payment apps:Payment app clearing (USD)" });
  assert.deepEqual(splitPath("Undeposited Funds"), { number: "", name: "Undeposited Funds" });
  const tb = readTrialBalance([["Account", "Debit", "Credit"], ["6000 Marketing - Digital:6000.01 Paid search ads", "100.00", ""], ["6000 Marketing - Digital:6000.02 Social", "50.00", ""], ["1000 Chequing", "", "150.00"]]);
  assert.equal(tb.error, undefined);
  assert.deepEqual(tb.rows.map((r) => [r.number, r.name, r.parent ?? ""]), [["6000.01", "Paid search ads", "6000"], ["6000.02", "Social", "6000"], ["1000", "Chequing", ""]]);
});

test("D11: the Account List keeps the detail type and the parent", () => {
  const l = readAccountList([["Full name", "Type", "Detail type"], ["6000 Marketing - Digital:6000.01 Paid search ads", "Expenses", "Advertising/Promotional"]]);
  assert.deepEqual(l.rows[0], { number: "6000.01", name: "Paid search ads", type: "Expenses", detail: "Advertising/Promotional", parent: "6000", path: "Marketing - Digital:Paid search ads", full_name: "6000 Marketing - Digital:6000.01 Paid search ads" });
});

test("T1: the tree: a parent with its count; a parent with its own balance is an account too", () => {
  const accts = [A({ key: "6000.02", number: "6000.02", name: "Social", parentKey: "6000" }), A({ key: "6000.01", number: "6000.01", name: "Paid search", parentKey: "6000", fullName: "6000 Marketing:6000.01 Paid search" }),
    A({ key: "1000", number: "1000", name: "Chequing" }), A({ key: "7000", number: "7000", name: "Vehicle", thisYear: 50 }), A({ key: "7000.01", number: "7000.01", name: "Fuel", parentKey: "7000" })];
  const t = buildTree(accts);
  assert.deepEqual(t.map((n) => [n.key, n.name, n.children.map((c) => c.key), !!n.self]), [["1000", "Chequing", [], true], ["6000", "Marketing", ["6000.01", "6000.02"], false], ["7000", "Vehicle", ["7000.01"], true]]);
});

test("D9: an account counts with a balance this year or last year, or an entry", () => {
  assert.equal(counted(A({ key: "a", name: "a", thisYear: 0, lastYear: 5 })), true);
  assert.equal(counted(A({ key: "a", name: "a", thisYear: 0, lastYear: 0, hasEntry: true })), true);
  assert.equal(counted(A({ key: "a", name: "a", thisYear: 0, lastYear: 0, inList: true })), false);
});

test("D4: suggestions in order: last year, then the QuickBooks type and detail type, then the name", () => {
  const prior = new Map<string, PriorMatch>([["6100", { chart: "60200", name: "Client meals", line: "8523.00" }], ["6200", { chart: "60000", name: "Old name", line: "8521.00" }],
    ["stripe clearing", { chart: "10900", name: "Stripe clearing", line: null }], ["6300", { chart: null, name: null, line: "8521.00" }]]);
  assert.deepEqual(suggest(A({ key: "6100", number: "6100", name: "Client meals" }), prior, M), { chart: "60200", source: "last_year", why: "Last year's match", nameChanged: false });
  // By number only when the name also matches: otherwise shown as "Name changed" for review.
  const nc = suggest(A({ key: "6200", number: "6200", name: "Promotions" }), prior, M)!;
  assert.equal(nc.source, "last_year"); assert.equal(nc.nameChanged, true); assert.match(nc.why, /name changed/);
  // No number: matched by name.
  assert.equal(suggest(A({ key: "stripe clearing", name: "Stripe clearing" }), prior, M)!.chart, "10900");
  // First R2 year: last year's line only: the single master account on it.
  assert.equal(suggest(A({ key: "6300", number: "6300", name: "Ads" }), prior, M)!.chart, "60000");
  // The detail type, within the master accounts of the QuickBooks type.
  assert.deepEqual(suggest(A({ key: "6400", number: "6400", name: "Marketing - Digital", tbType: "Expenses", detail: "Advertising/Promotional" }), new Map(), M),
    { chart: "60000", source: "type", why: 'From the account name and QuickBooks type "Advertising/Promotional"' });
  // The name.
  assert.equal(suggest(A({ key: "6500", number: "6500", name: "Software subscriptions" }), new Map(), M)!.chart, "65200");
  assert.equal(suggest(A({ key: "zz", name: "Zebra" }), new Map(), M), null);
});

test("D2: clearing, Undeposited Funds and Opening Balance Equity to 10900; a US dollar bank account to 10200", () => {
  for (const n of ["Payment app clearing (USD)", "Undeposited Funds", "Commission cheque clearing", "Opening Balance Equity"])
    assert.equal(suggest(A({ key: n.toLowerCase(), name: n }), new Map(), M)!.chart, "10900", n);
  assert.equal(suggest(A({ key: "1010", number: "1010", name: "RBC USD account", tbType: "Bank" }), new Map(), M)!.chart, "10200");
});

test("T1b: Accept last year's matches takes every unchanged last-year match, the ones with no number by name", () => {
  const prior = new Map<string, PriorMatch>([["6100", { chart: "60200", name: "Client meals", line: null }], ["undeposited funds", { chart: "10900", name: "Undeposited Funds", line: null }],
    ["6200", { chart: "60000", name: "Old name", line: null }]]);
  const accts = [A({ key: "6100", number: "6100", name: "Client meals" }), A({ key: "undeposited funds", name: "Undeposited Funds" }), A({ key: "6200", number: "6200", name: "Promotions" }),
    A({ key: "6300", number: "6300", name: "Meals", chart: "60200" })];
  assert.deepEqual(lastYearMatches(accts, prior, M), [{ account: "6100", chart: "60200" }, { account: "undeposited funds", chart: "10900" }]);
});

test("T1c: the Undo label", () => {
  assert.equal(actionText(8, M[5]), "8 accounts to 60000 Advertising");
  assert.equal(actionText(1, null), "1 account unassigned");
  assert.equal(qboClass("Other Current Liabilities"), "Liability");
});

test("T8: module headings on both file types; step names on trial balance files; bank-statement names unchanged", () => {
  assert.deepEqual(stepModules("client_software").map((m) => [m.name, m.steps.join(",")]),
    [["PLANNING", "setup"], ["TRIAL BALANCE", "opening,records,code"], ["FIELDWORK", "entries,compare,review,t2"], ["COMPLETION", "statements,lock"]]);
  assert.equal(stepModules("statements")[1].name, "BOOKKEEPING");
  assert.equal(stepModules("concept_qbo")[1].name, "TRIAL BALANCE");
  assert.equal(stepTitle("records", "client_software"), "3. Import trial balance");
  assert.equal(stepTitle("code", "concept_qbo"), "4. Assign mapping");
  assert.equal(stepTitle("records", "statements"), "3. Banking");
  assert.equal(stepTitle("code", "paper"), "4. Code transactions");
});

test("T4: step 8's first paper is Match accounts to GIFI on every file; the old matching address opens step 4 on a trial balance file", () => {
  assert.equal(stepPapers("t2", { full: true, shareholders: false, ownerPaid: false, gst: false, bank: false })[0].name, "Match accounts to GIFI");
  assert.equal(stepFromLegacy("tb", "accounts", "client_software"), "code");
  assert.equal(stepFromLegacy("tb", "accounts", "statements"), "t2");
});

test("T7: no GIFI code on trial balance file screens before step 8 (step 4, the entry form, step 3's import note, the help)", async () => {
  const { readFileSync } = await import("node:fs");
  const code = (f: string) => readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).map((l) => l.replace(/\{\/\*.*?\*\/\}/g, "")).join("\n");
  for (const f of ["src/app/(app)/closebook/[id]/assign-step.tsx", "src/app/(app)/closebook/[id]/areas/booked-mark.tsx", "src/lib/closebook/assign.ts"])
    assert.doesNotMatch(code(f), /GIFI|\b\d{4}\.\d{2}\b/, f);
  const help = readFileSync("src/app/(app)/closebook/[id]/shell/help.tsx", "utf8");
  const line = (k: string) => help.split("\n").find((l) => l.trimStart().startsWith(`${k}: <>`)) ?? "";
  assert.match(line("code"), /"Assign each of the client's accounts to a master account/);
  assert.doesNotMatch(line("code").split('" : "')[1] ?? "", /GIFI/);
  assert.match(line("review"), /An account sent to the reviewer is decided in step 8/);
  const tb = readFileSync("src/app/(app)/closebook/[id]/tb-tab.tsx", "utf8");
  assert.match(tb, /Imported \{accounts\.length\} accounts \(.* with a balance\)\. Assign them in/);
  // The entry form names the master account for a new client account, not a GIFI line.
  assert.match(readFileSync("src/lib/closebook/entry-form.ts", "utf8"), /with its QuickBooks type and master account/);
});

test("T3: the client entry list: new accounts first, then each entry with the client's numbers and names; monthly files' title", async () => {
  const { clientListTable } = await import("../src/lib/closebook/client-list.ts");
  const { clientListTitle, takesClientEntryList } = await import("../src/lib/closebook/books.ts");
  const t = clientListTable("Entries to record in QuickBooks", [{ name: "Year-end accounting fee", type: "Expenses" }],
    [{ no: "2026-001", kind: "AJE", memo: "Accrue the fee", lines: [{ number: "", name: "Year-end accounting fee", cents: 350000 }, { number: "2100.02", name: "Accrued liabilities", cents: -350000 }] }]);
  assert.deepEqual(t.rows.map((r) => r.cells), [["New accounts to create", null, null], ["Year-end accounting fee (Expenses)", null, null], ["", null, null], ["Entries to record", null, null],
    ["2026-001 AJE: Accrue the fee", null, null], ["Year-end accounting fee", 350000, null], ["2100.02 Accrued liabilities", null, 350000], ["Total", 350000, 350000]]);
  assert.equal(clientListTitle({ books: "concept_qbo" }), "Entries to record in QuickBooks");
  assert.equal(clientListTitle({ books: "client_software" }), "Entries to record in your books");
  assert.equal(takesClientEntryList({ books: "concept_qbo" }), true);
  assert.equal(takesClientEntryList({ books: "statements" }), false);
});

test("accounting review: a fee account is never suggested as Clearing", () => {
  assert.notEqual(suggest(A({ key: "7400.03", number: "7400.03", name: "PayPal fees", tbType: "Expenses" }), new Map(), M)?.chart, "10900");
  assert.notEqual(suggest(A({ key: "square fees", name: "Square fees" }), new Map(), M)?.chart, "10900");
  assert.equal(suggest(A({ key: "paypal", name: "PayPal", tbType: "Bank" }), new Map(), M)?.chart, "10900");
});

test("D12b: a schedule's ITC line takes the client's single 12250 account when none is on 21500", async () => {
  const { optForChart } = await import("../src/lib/closebook/entry-form.ts");
  assert.equal(optForChart([{ value: "a", chart: "12250" }], "21500"), "a");
  assert.equal(optForChart([{ value: "a", chart: "21500" }, { value: "b", chart: "21500", picked: true }], "21500"), "b");
  assert.equal(optForChart([{ value: "a", chart: "21500" }, { value: "b", chart: "21500" }], "21500"), "");
});

test("decision 2A: Clearing accounts on a trial balance file have their own heading; others stay Not yet sorted", async () => {
  const { trialBalance, tbByGroup } = await import("../src/lib/closebook/reports.ts");
  const tb = trialBalance([{ key: "undeposited funds", number: "", name: "Undeposited Funds", line_no: null, lastCents: 0, chart: "10900" },
    { key: "9999", number: "9999", name: "Mystery", line_no: null, lastCents: 0 }],
    [{ key: "undeposited funds", cents: 125000, date: "2026-09-30", kind: "import", ref: "", label: "x" }, { key: "9999", cents: -125000, date: "2026-09-30", kind: "import", ref: "", label: "x" }] as never);
  const names = tbByGroup(tb, () => null).groups.map((g) => g.name);
  assert.ok(names.includes("Clearing accounts (must be nil at year end)"), names.join(", "));
  assert.ok(names.includes("Not yet sorted"), names.join(", "));
  // One label for the Clearing total everywhere.
  assert.equal(tbByGroup(tb, () => null).groups.find((g) => g.code === "clearing")?.total.name, "Total clearing accounts");
});

test("decision 2A: the balance sheet shows Clearing apart from Not yet sorted, also while accounts are mixed", async () => {
  const { trialBalance, statements } = await import("../src/lib/closebook/reports.ts");
  const tb = trialBalance([{ key: "undeposited funds", number: "", name: "Undeposited Funds", line_no: null, lastCents: 0, chart: "10900" },
    { key: "9999", number: "9999", name: "Mystery", line_no: null, lastCents: 0 }],
    [{ key: "undeposited funds", cents: 125000, date: "2026-09-30", kind: "import", ref: "", label: "x" }, { key: "9999", cents: -100000, date: "2026-09-30", kind: "import", ref: "", label: "x" }] as never);
  const s = statements(tb, () => null);
  assert.equal(s.bs.clearing?.title, "Clearing accounts (must be nil at year end)");
  assert.equal(s.bs.clearing?.now, -125000);
  assert.equal(s.bs.unsorted?.title, "Not yet sorted");
  assert.equal(s.bs.unsorted?.now, 100000);
  // Both count in total liabilities and equity.
  assert.equal(s.bs.totalLE.now, -25000);
});

test("dividends option A: the client entry list gives an opening RJE its own date", async () => {
  const { clientListTable } = await import("../src/lib/closebook/client-list.ts");
  const t = clientListTable("Entries to record in your books", [], [
    { no: "2026-001", kind: "RJE", memo: "Close last year's dividends to retained earnings", date: "2025-10-01",
      lines: [{ number: "3400", name: "Dividends", cents: -2000000 }, { number: "3100", name: "Retained earnings", cents: 2000000 }] },
    { no: "2026-002", kind: "AJE", memo: "Accrue the fee", date: null, lines: [{ number: "6600", name: "Fees", cents: 100 }, { number: "2100", name: "Accrued", cents: -100 }] }]);
  const heads = t.rows.filter((r) => r.bold).map((r) => r.cells[0]);
  assert.ok(heads.includes("2026-001 RJE, dated 2025-10-01: Close last year's dividends to retained earnings"), heads.join(" | "));
  assert.ok(heads.includes("2026-002 AJE: Accrue the fee"), heads.join(" | "));
});

test("client entry list: while counted accounts are unassigned, the net income is not final", async () => {
  const { unassignedCount, notFinalNote, clientListTable } = await import("../src/lib/closebook/client-list.ts");
  const accts = [
    { id: "a", account_key: "6000", chart_account: null, this_year: 100, last_year: 0 },
    { id: "b", account_key: "6100", chart_account: "66000", this_year: 100, last_year: 0 },
    { id: "c", account_key: "6200", chart_account: null, this_year: 0, last_year: 0 },
    { id: "d", account_key: "6300", chart_account: null, this_year: 0, last_year: 0 },
    { id: "e", account_key: "uncoded", chart_account: null, this_year: 5, last_year: 0 },
  ];
  assert.equal(unassignedCount(accts, new Set(["d"])), 2);   // a (balance) and d (an entry); c has neither; uncoded is a system row
  assert.equal(notFinalNote(2), "2 accounts not yet assigned: net income is not final.");
  assert.equal(notFinalNote(0), null);
  assert.equal(clientListTable("Entries", [], [], notFinalNote(1)).rows[0].cells[0], "1 account not yet assigned: net income is not final.");
});
