// Run with: npm test
// Closebook reports built live from the postings (Hashim, Nov 15, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLedger, type Posting } from "../src/lib/closebook/tb-build.ts";
import { journal, ledger, netIncomeBox, NI_LAST, pctChange, statements, tbByGroup, trialBalance, type LineInfo, type RepAccount } from "../src/lib/closebook/reports.ts";

const chart = new Map([
  ["10000", { name: "Chequing", account_type: "Asset", line_no: "1002.00" }],
  ["21500", { name: "GST/HST payable", account_type: "Liability", line_no: "2680.00" }],
  ["40200", { name: "Commission income", account_type: "Revenue", line_no: "8120.00" }],
  ["65100", { name: "Office expenses", account_type: "Expense", line_no: "8810.00" }],
]);
const codes = new Map([["HST_ON", { code: "HST_ON", name: "HST ON", parts: [{ name: "HST ON", rate: 0.13, recoverable: true, liability: "gst_hst" as const, effective_from: "2000-01-01" }] }]]);
const ctx = { registered: true, quick: false };
const INFO: Record<string, LineInfo> = {
  "1002.00": { type: "Asset", sheet: "A", sheetName: "Cash and bank" }, "2680.00": { type: "Liability", sheet: "AA", sheetName: "Payables" },
  "8120.00": { type: "Revenue", sheet: "20", sheetName: "Revenue" }, "8810.00": { type: "Expense", sheet: "40", sheetName: "Operating expenses" },
};
const info = (l: string | null) => (l ? INFO[l] ?? null : null);

function sample() {
  const { rows, postings } = buildLedger([{ id: "b", name: "TD chequing", kind: "bank", chart: "10000", openingCents: 500000 }], [
    { id: "l1", date: "2026-02-03", description: "SAMPLE COMMISSION", account_id: "b", cents: 113000, status: "done", chart_account: "40200", tax_code: "HST_ON" },
    { id: "l2", date: "2026-03-09", description: "SAMPLE STAPLES", account_id: "b", cents: -11300, status: "done", chart_account: "65100", tax_code: "HST_ON" },
    { id: "l3", date: "2026-04-01", description: "SAMPLE UNKNOWN", account_id: "b", cents: -2000, status: "new", chart_account: null, tax_code: null },
  ], chart, codes, ctx, null, "2026-01-01");
  const accounts: RepAccount[] = rows.map((r) => ({ key: r.key, number: r.number, name: r.name, line_no: r.line_no, lastCents: r.lastCents }));
  return { rows, postings, accounts };
}

test("the postings add up to the trial balance, account by account", () => {
  const { rows, postings } = sample();
  for (const r of rows) assert.equal(postings.filter((p) => p.key === r.key).reduce((n, p) => n + p.cents, 0), r.cents, r.key);
  assert.equal(postings.reduce((n, p) => n + p.cents, 0), 0);
  // One bank line posts its bank side, its account and its tax, all pointing back to the line.
  assert.deepEqual(postings.filter((p) => p.ref === "l1").map((p) => [p.key, p.cents]), [["chart:10000", 113000], ["chart:40200", -100000], ["chart:21500", -13000]]);
});

test("trial balance columns: prelim, adjust (AJE and TJE), reclass (RJE), final, prior, change", () => {
  const { postings, accounts } = sample();
  const e = (key: string, cents: number, entryKind: "AJE" | "RJE" | "TJE", ref: string): Posting => ({ key, cents, date: "2026-12-31", kind: "entry", ref, label: "", entryKind });
  const tb = trialBalance(accounts.map((a) => (a.key === "chart:10000" ? { ...a, lastCents: 480000 } : a)),
    [...postings, e("chart:65100", 5000, "AJE", "e1"), e("chart:10000", -5000, "AJE", "e1"), e("chart:65100", 700, "TJE", "e2"), e("chart:10000", -700, "TJE", "e2"), e("chart:21500", 300, "RJE", "e3"), e("chart:10000", -300, "RJE", "e3")]);
  const bank = tb.find((t) => t.key === "chart:10000")!;
  assert.deepEqual([bank.prelim, bank.adjust, bank.reclass, bank.final, bank.last, bank.diff], [500000 + 113000 - 11300 - 2000, -5700, -300, 593700, 480000, 113700]);
  assert.deepEqual(tb.map((t) => t.number), ["10000", "21500", "40200", "65100", "", "", ""], "by account number; holding accounts and last year's net income last");
  assert.equal(tb.reduce((n, t) => n + t.final, 0), 0);
  // Last year's column balances: what is missing (here 4,800.00 debit) shows as last year's net income.
  const ni = tb.find((t) => t.key === NI_LAST)!;
  assert.equal(ni.name, "Net income last year (from the T2)");
  assert.equal(ni.last, -480000);
  assert.equal(tb.reduce((n, t) => n + t.last, 0), 0);
});

test("% change compares the size of the balance; n/a when prior is zero; n/m when the side changed", () => {
  // The reference package's figures.
  assert.equal(pctChange(12000000, 3000000), "300.0%");
  assert.equal(pctChange(2560000, 3200000), "-20.0%");
  assert.equal(pctChange(-1050000, -1000000), "5.0%", "a growing liability is positive");
  assert.equal(pctChange(-2000000, -3000000), "-33.3%");
  assert.equal(pctChange(-30000000, -21500000), "39.5%", "a growing revenue is positive");
  assert.equal(pctChange(4000000, 4000000), "0.0%");
  assert.equal(pctChange(640000, 0), "n/a");
  assert.equal(pctChange(-5000, 7000), "n/m");
});

test("Birch Dummy: equity shows share capital, retained earnings at the start, net income, dividends", () => {
  const I: Record<string, LineInfo> = {
    "1002.00": { type: "Asset", sheet: "A", sheetName: "Cash and bank" }, "1062.00": { type: "Asset", sheet: "B", sheetName: "Receivables" },
    "1774.00": { type: "Asset", sheet: "F", sheetName: "Capital assets" }, "1775.00": { type: "Asset", sheet: "F", sheetName: "Capital assets" },
    "2620.00": { type: "Liability", sheet: "AA", sheetName: "Payables and accruals" }, "2680.00": { type: "Liability", sheet: "BB", sheetName: "Taxes payable" },
    "2781.10": { type: "Liability", sheet: "CC", sheetName: "Shareholder balances" }, "3500.00": { type: "Equity", sheet: "FF", sheetName: "Share capital and surplus" },
    "3600.00": { type: "Equity", sheet: "GG", sheetName: "Retained earnings and dividends" }, "3700.00": { type: "Equity", sheet: "GG", sheetName: "Retained earnings and dividends" },
    "8121.00": { type: "Revenue", sheet: "10", sheetName: "Revenue" }, "8523.00": { type: "Expense", sheet: "30", sheetName: "Operating expenses" },
    "8811.00": { type: "Expense", sheet: "30", sheetName: "Operating expenses" }, "9225.00": { type: "Expense", sheet: "30", sheetName: "Operating expenses" },
  };
  const rows: [string, string, number, number][] = [["10000", "1002.00", 5500450, 4821000], ["11000", "1062.00", 650000, 650000], ["15000", "1774.00", 980000, 980000], ["15050", "1775.00", -392000, -392000],
    ["21100", "2620.00", -435000, -425000], ["21400", "2680.00", 0, -211000], ["21500", "2680.00", -125775, 0], ["23000", "2781.10", -1040000, -1240000], ["30000", "3500.00", -10000, -10000],
    ["31000", "3600.00", -4173000, -2948000], ["", "3700.00", 0, 800000], ["40250", "8121.00", -1000000, 0], ["60200", "8523.00", 5325, 0], ["65000", "8811.00", 20000, 0], ["70500", "9225.00", 20000, 0]];
  const accounts: RepAccount[] = rows.map(([n, l, , last]) => ({ key: n ? `chart:${n}` : "gifi:3700", number: n, name: n || "Dividends declared", line_no: l, lastCents: last }));
  const postings: Posting[] = rows.filter(([, , now]) => now).map(([n, , now]) => ({ key: `chart:${n}`, cents: now, date: "2026-12-31", kind: "bank", ref: "", label: "" }));
  postings.push({ key: "uncoded", cents: -50000, date: "2026-12-15", kind: "bank", ref: "", label: "" }, { key: "chart:10000", cents: 50000, date: "2026-12-15", kind: "bank", ref: "", label: "" });
  const tb = trialBalance(accounts, postings);
  const s = statements(tb, (l) => (l ? I[l] ?? null : null));
  assert.deepEqual(s.bs.equity.groups.map((g) => [g.name, g.now, g.last]), [
    ["Share capital", 10000, 10000], ["Retained earnings, start of year", 4173000, 2948000], ["Prior period adjustment", 0, 0], ["Net income", 954675, 2025000], ["Dividends", 0, -800000]]);
  assert.deepEqual([s.bs.equity.now, s.bs.equity.last], [5137675, 4183000]);
  assert.equal(s.bs.totalLE.last, s.bs.assets.last);
  // The trial balance's last-year column balances with last year's net income from the T2 (20,250.00 credit).
  assert.equal(tb.find((t) => t.key === NI_LAST)!.last, -2025000);
  // By group, in the statements' order; retained earnings holds last year's net income line.
  const g = tbByGroup(tb, (l) => (l ? I[l] ?? null : null));
  assert.deepEqual(g.groups.map((x) => x.name), ["Cash and bank", "Receivables", "Capital assets", "Payables and accruals", "Taxes payable", "Shareholder balances",
    "Share capital", "Retained earnings", "Dividends", "Revenue", "Operating expenses", "Last year's income statement", "Not yet sorted"]);
  // Last year's net income from the T2 has its own group after the income statement groups, so
  // retained earnings show last year's real opening balance (29,480.00), not a balance that never existed.
  assert.deepEqual(g.groups.find((x) => x.code === "RE")!.rows.map((r) => r.name), ["31000"]);
  assert.equal(g.groups.find((x) => x.code === "RE")!.total.last, -2948000);
  assert.equal(g.groups[0].total.name, "Total cash and bank");
  assert.deepEqual([g.total.prelim, g.total.final, g.total.last, g.total.diff], [0, 0, 0, 0], "every column totals zero");
});

test("statements: grouped by lead sheet, net income in equity, not yet sorted until zero", () => {
  const { postings, accounts } = sample();
  const s = statements(trialBalance(accounts, postings), info);
  assert.equal(s.pl.revenue.now, 100000);
  assert.equal(s.pl.expenses.now, 10000);
  assert.equal(s.pl.net.now, 90000);
  assert.deepEqual(s.bs.assets.groups.map((g) => [g.name, g.now]), [["A Cash and bank", 599700]]);
  assert.deepEqual(s.bs.equity.groups.map((g) => [g.code, g.now]), [["SC", 0], ["RE", 0], ["PPA", 0], ["net-income", 90000], ["DIV", 0]]);
  // Opening balances to enter (5,000.00 credit) and the uncoded payment (20.00 debit) are not yet sorted.
  assert.equal(s.bs.unsorted!.now, 500000 - 2000);   // shown on the credit side: the uncoded payment is a debit
  assert.ok(s.bs.balanced);
  // Everything sorted: the section goes.
  const sorted = postings.filter((p) => p.key !== "uncoded" && p.key !== "opening");
  const fixed: Posting[] = [...sorted, { key: "chart:65100", cents: 2000, date: "2026-04-01", kind: "bank", ref: "l3", label: "" }, { key: "chart:31000", cents: -500000, date: "2026-01-01", kind: "opening", ref: "gifi:3849", label: "" }];
  const s2 = statements(trialBalance([...accounts, { key: "chart:31000", number: "31000", name: "Retained earnings", line_no: "3600.00", lastCents: 0 }], fixed), (l) => info(l) ?? (l === "3600.00" ? { type: "Equity", sheet: "GG", sheetName: "Retained earnings and dividends" } : null));
  assert.equal(s2.bs.unsorted, null);
});

test("general ledger: date order, running balance, date filter carries the balance before", () => {
  const { postings, accounts } = sample();
  const [bank] = ledger(accounts, postings, { key: "chart:10000" });
  assert.deepEqual(bank.lines.map((l) => [l.date, l.kind, l.running]), [["2026-01-01", "opening", 500000], ["2026-02-03", "bank", 613000], ["2026-03-09", "bank", 601700], ["2026-04-01", "bank", 599700]]);
  const [march] = ledger(accounts, postings, { key: "chart:10000", from: "2026-03-01", to: "2026-03-31" });
  assert.equal(march.before, 613000);
  assert.deepEqual(march.lines.map((l) => [l.ref, l.running]), [["l2", 601700]]);
  assert.ok(ledger(accounts, postings).length >= 5, "every account");
});

test("journal: one transaction per source, filter by source", () => {
  const { postings } = sample();
  const all = journal(postings);
  assert.equal(all[0].label, "Opening balances");
  assert.deepEqual(all.map((t) => t.kind), ["opening", "bank", "bank", "bank"]);
  for (const t of all) assert.equal(t.lines.reduce((n, l) => n + l.cents, 0), 0, "every transaction balances");
  assert.deepEqual(journal(postings, "bank").map((t) => t.ref), ["l1", "l2", "l3"]);
  assert.deepEqual(journal(postings, "entry"), []);
});

test("exports: the same table as the page, and an Excel file with the stamp that reads back", async () => {
  const { reportTable } = await import("../src/lib/closebook/report-table.ts");
  const { reportXlsx } = await import("../src/lib/closebook/xlsx-write.ts");
  const { readXlsx } = await import("../src/lib/closebook/xlsx.ts");
  const { postings, accounts } = sample();
  const d = { accounts, postings, info, bankFile: true, entryLabel: new Map<string, string>() };
  const t = reportTable(d, { report: "tb" });
  assert.deepEqual(t.columns.slice(0, 3), ["Number", "Account", "GIFI"], "the number once, the GIFI line in its own column");
  assert.deepEqual(t.rows[0].cells.slice(0, 2), ["Cash and bank", null], "by group: the group's name first");
  assert.deepEqual(t.rows[1].cells.slice(0, 3), ["10000", "Chequing", "1002"]);
  assert.equal(t.rows.at(-1)!.cells[6], 0, "the final column totals zero");
  assert.equal(t.rows.at(-1)!.grand, true);
  const [sheet] = readXlsx(reportXlsx(t, ["Birch Dummy Realty Inc.", "Jan 1, 2026 to Dec 31, 2026"], "Working paper: not for the client"));
  assert.equal(sheet.rows[0][0], "Trial balance by group");
  assert.equal(sheet.rows[3][0], "Working paper: not for the client");
  assert.deepEqual(sheet.rows[5].slice(0, 3), ["Number", "Account", "GIFI"]);
  assert.equal(sheet.rows[7][6], 5997, "amounts in dollars, as numbers");
  assert.equal(reportTable(d, { report: "tb", view: "flat" }).rows[0].cells[0], "10000", "flat: no groups");
  const j = reportTable(d, { report: "journal" });
  assert.deepEqual(j.rows.slice(-4).map((r) => [r.cells[2], r.cells[4]]), [["Net income before entries", 90000], ["Adjusting and tax entries (AJE, TJE)", 0], ["Reclassifying entries (RJE)", 0], ["Adjusted net income", 90000]]);
  for (const r of ["bs", "pl", "gl", "journal"]) assert.ok(reportTable(d, { report: r }).rows.length > 0, r);
  assert.deepEqual(reportTable(d, { report: "journal", source: "bank" }).rows.filter((r) => r.bold).map((r) => r.cells[2]).slice(0, 3), ["SAMPLE COMMISSION", "SAMPLE STAPLES", "SAMPLE UNKNOWN"]);
});

test("last year without Schedule 125: net income is the figure that ties last year's balance sheet", () => {
  // Board figures in cents: assets 60,590, liabilities 18,760, shares 100, RE start 29,480, dividends 8,000, typed 9999 20,250.
  const acc = (key: string, line_no: string, lastCents: number): RepAccount => ({ key, number: "", name: key, line_no, lastCents });
  const I: Record<string, LineInfo> = { "1002.00": INFO["1002.00"], "2620.00": { type: "Liability", sheet: "AA", sheetName: "AA" }, "3500.00": { type: "Equity", sheet: "FF", sheetName: "FF" },
    "3600.00": { type: "Equity", sheet: "FF", sheetName: "FF" }, "3700.00": { type: "Equity", sheet: "GG", sheetName: "GG" } };
  const s = statements(trialBalance([acc("a", "1002.00", 6059000), acc("l", "2620.00", -1876000), acc("sh", "3500.00", -10000), acc("re", "3600.00", -2948000), acc("dv", "3700.00", 800000)], []), (l) => (l ? I[l] ?? null : null));
  assert.equal(s.pl.lastFromT2, true);
  assert.equal(s.pl.net.last, 2025000);
  assert.equal(s.bs.totalLE.last, s.bs.assets.last, "last year balances");
});

test("journal box: net income before entries, adjusting and tax entries, reclassifying entries, adjusted", () => {
  const { postings, accounts } = sample();
  const e = (key: string, cents: number, entryKind: "AJE" | "RJE" | "TJE"): Posting => ({ key, cents, date: "2026-12-31", kind: "entry", ref: entryKind, label: "", entryKind });
  const b = netIncomeBox(accounts, [...postings, e("chart:65100", 5000, "AJE"), e("chart:21500", -5000, "AJE"), e("chart:65100", 1000, "TJE"), e("chart:21500", -1000, "TJE")], info);
  assert.deepEqual(b, { before: 90000, adjust: -6000, reclass: 0, after: 84000 });
});

test("working paper PDF: stamp, header block with the W/P box, footer with the time generated and the page", async () => {
  const { wpDocument, tbGroupSection, entriesSection } = await import("../src/lib/closebook/wp-doc.ts");
  const { postings, accounts } = sample();
  const g = tbByGroup(trialBalance(accounts, postings), info);
  const ctx = { client: "Birch Dummy Realty Inc.", yearEnd: "2026-12-31", yearStart: "2026-01-01", packageName: "Trial balance by group and journal entries",
    stamp: "Working paper: not for the client", generated: "Nov 15, 2026, 9:00 AM", preparedBy: "Dummy Owner", reviewedBy: "", wpBox: true };
  const doc = wpDocument(ctx, [tbGroupSection(ctx, g.groups, g.total, "TB.1"), entriesSection(ctx, [{ no: "2026-001", kind: "AJE", wpRef: "Capital assets schedule", memo: "To record amortization.", lines: [{ number: "61500", name: "Amortization", cents: 640000 }, { number: "15050", name: "Accumulated amortization", cents: -640000 }] }],
    { before: 1, adjust: 0, reclass: 0, after: 1 }, "TB.2")]);
  assert.equal(doc.header.text, "WORKING PAPER: NOT FOR THE CLIENT");
  assert.equal(doc.pageOrientation, "landscape");
  assert.deepEqual(doc.footer(3).columns.map((c: { text: string }) => c.text), ["Birch Dummy Realty Inc. · Trial balance by group and journal entries · Generated Nov 15, 2026, 9:00 AM", "Page 3"]);
  const text = JSON.stringify(doc.content);
  for (const t of ["Trial balance by group", "Year end: December 31, 2026", "W/P ref", "TB.1", "Prepared by", "Dummy Owner", "Reviewed by", "Prelim 2026", "Prior 2025", "% change",
    "Total (debits less credits)", "Adjusting and reclass journal entries", "Period: January 1, 2026 to December 31, 2026", "2026-001", "W/P ref: Capital assets schedule", "Memo: ", "Adjusted net income"]) assert.ok(text.includes(t), t);
  // The $ change and % change columns are shaded the full length of the table.
  const table = doc.content.find((c: { table?: unknown }) => c.table);
  assert.equal(table.layout.fillColor(5, null, 7), "#F3F5F9");
  assert.equal(table.layout.fillColor(5, null, 8), "#F3F5F9");
  assert.equal(table.layout.fillColor(5, null, 6), null);
});

test("Birch after the entries: a prior period adjustment on 31500 has its own equity line; retained earnings in the trial balance", () => {
  const I: Record<string, LineInfo> = { "1002.00": INFO["1002.00"], "3500.00": { type: "Equity", sheet: "FF", sheetName: "Share capital and surplus" },
    "3600.00": { type: "Equity", sheet: "GG", sheetName: "Retained earnings and dividends" }, "3720.00": { type: "Equity", sheet: "GG", sheetName: "Retained earnings and dividends" },
    "2620.00": { type: "Liability", sheet: "AA", sheetName: "Payables and accruals" } };
  const accounts: RepAccount[] = [
    { key: "chart:10000", number: "10000", name: "Chequing", line_no: "1002.00", lastCents: 2958000 },
    { key: "chart:30000", number: "30000", name: "Common shares", line_no: "3500.00", lastCents: -10000 },
    { key: "chart:31000", number: "31000", name: "Retained earnings", line_no: "3600.00", lastCents: -2948000 },
    { key: "chart:31500", number: "31500", name: "Prior period adjustments", line_no: "3720.00", lastCents: 0 },
    { key: "chart:21100", number: "21100", name: "Accrued liabilities", line_no: "2620.00", lastCents: 0 },
  ];
  const post = (key: string, cents: number, kind: Posting["kind"] = "opening"): Posting => ({ key, cents, date: "2026-01-01", kind, ref: "", label: "" });
  const tb = trialBalance(accounts, [post("chart:10000", 4183000), post("chart:30000", -10000), post("chart:31000", -4173000),
    { ...post("chart:31500", 25000, "entry"), entryKind: "AJE" }, { ...post("chart:21100", -25000, "entry"), entryKind: "AJE" }]);
  const s = statements(tb, (l) => (l ? I[l] ?? null : null));
  assert.deepEqual(s.bs.equity.groups.map((g) => [g.name, g.now]), [["Share capital", 10000], ["Retained earnings, start of year", 4173000], ["Prior period adjustment", -25000], ["Net income", 0], ["Dividends", 0]]);
  const re = tbByGroup(tb, (l) => (l ? I[l] ?? null : null)).groups.find((g) => g.code === "RE")!;
  assert.deepEqual(re.rows.map((r) => r.number), ["31000", "31500"]);
  assert.deepEqual([re.total.final, re.total.last, re.total.diff, pctChange(re.total.final, re.total.last)], [-4148000, -2948000, -1200000, "40.7%"], "Hashim's figures: (41,480.00), (29,480.00), (12,000.00), 40.7%");
});

test("client entry list: DRAFT FOR REVIEW and the firm's name on every page; plain-words note, no em dashes", async () => {
  const { wpDocument, tbGroupSection, FIRM_LINE } = await import("../src/lib/closebook/wp-doc.ts");
  const { CB_CLIENT } = await import("../src/lib/closebook/client-wording.ts");
  const { postings, accounts } = sample();
  const g = tbByGroup(trialBalance(accounts, postings), info);
  const ctx = { client: "Cedar Dummy Realty Inc.", yearEnd: "2026-12-31", yearStart: "2026-01-01", packageName: "Entries to record in your books",
    stamp: "Entries to record in your books", generated: "Nov 15, 2026, 9:00 AM", preparedBy: "", reviewedBy: "", wpBox: false, client_copy: { draft: true } };
  const doc = wpDocument(ctx, [tbGroupSection(ctx, g.groups, g.total, "TB.1", CB_CLIENT.tbNote.text)]);
  assert.equal(doc.header.columns[0].text, "DRAFT FOR REVIEW");
  const foot = doc.footer(2);
  assert.equal(foot.stack[0].canvas[0].lineColor, "#86BC26", "the package's green rule");
  assert.equal(foot.stack[1].columns[0].text, "Cedar Dummy Realty Inc. · Entries to record in your books · Generated Nov 15, 2026, 9:00 AM");
  assert.equal(foot.stack[2].text, FIRM_LINE);
  assert.match(FIRM_LINE, /Concept Accounting & Advisory Professional Corporation/);
  const text = JSON.stringify(doc.content);
  assert.ok(text.includes("How to read this page."));
  assert.ok(!text.includes("Prelim ="), "not the working paper's note");
  for (const p of Object.values(CB_CLIENT)) assert.ok(!/[—]/.test(p.text), "no em dashes");
});
