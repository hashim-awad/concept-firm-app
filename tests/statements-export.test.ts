// Run with: npm test
// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026): the CSV and Excel downloads, names and the zip.
import { test } from "node:test";
import assert from "node:assert/strict";
import JSZip from "jszip";
import { readBankUpload, balanceCheck } from "../src/lib/closebook/bank-upload.ts";
import { readXlsx } from "../src/lib/closebook/xlsx.ts";
import { accountCsv, accountFile, accountXlsx, downloadBlock, fileName, zipFiles, zipName } from "../src/lib/statements/export.ts";
import type { ReadResult, StatementAccount } from "../src/lib/statements/types.ts";

const card = (): StatementAccount => ({
  key: "a1", last4: "9034", name: "Visa Business", kind: "card", periodStart: "2026-02-16", periodEnd: "2026-03-15",
  opening: 341267, closing: 341267, summary: null,
  lines: [
    { id: "l1", date: "2026-02-20", description: "DUMMY PRINT SHOP, GUELPH ON", amountCents: 100000, dir: "in", balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read" },
    { id: "l2", date: "2026-02-24", description: 'PAYMENT - "THANK YOU"', amountCents: 150000, dir: "out", balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "read" },
    { id: "l3", date: "2026-03-01", description: "DUMMY CAFE\nAMT 5.00 USD", amountCents: 104, dir: "in", balanceCents: null, page: 2, unsure: false, unsureReason: "", source: "edited" },
    { id: "l4", date: "2026-03-02", description: "INTEREST", amountCents: 49896, dir: "in", balanceCents: null, page: 2, unsure: false, unsureReason: "", source: "added" },
  ],
});
const data = (accounts: StatementAccount[]): ReadResult => ({ bank: "Northern Dummy Bank", pages: 2, accounts });

test("the CSV is Concept's bank upload template, signed, and reads back through the CSV upload to the cent", () => {
  const a = card();
  const csv = accountCsv(a);
  assert.equal(csv.split("\r\n")[0], "Date,Description,Amount");
  assert.equal(csv.split("\r\n")[1], '2026-02-20,"DUMMY PRINT SHOP, GUELPH ON",1000.00');
  assert.equal(csv.split("\r\n")[2], '2026-02-24,"PAYMENT - ""THANK YOU""",-1500.00');
  assert.equal(csv.split("\r\n")[3], "2026-03-01,DUMMY CAFE AMT 5.00 USD,1.04");
  assert.ok(csv.endsWith("\r\n"));
  const back = readBankUpload(csv);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.rows.map((r) => r.cents), [100000, -150000, 104, 49896]);
  assert.equal(back.rows[1].description, 'PAYMENT - "THANK YOU"');
  assert.equal(balanceCheck(a.opening, a.closing, back.rows).ok, true);
});

test("bank signs: money in positive, money out negative", () => {
  const a: StatementAccount = { ...card(), kind: "bank", lines: card().lines.slice(0, 2), closing: 341267 - 50000 };
  assert.deepEqual(readBankUpload(accountCsv(a)).rows.map((r) => r.cents), [100000, -150000]);
});

test("file names: <bank> <last4> <start> to <end>, safe for any computer", () => {
  assert.equal(fileName("Northern Dummy Bank", card(), "csv"), "Northern Dummy Bank 9034 2026-02-16 to 2026-03-15.csv");
  assert.equal(fileName("North/Dummy: Bank", { ...card(), last4: "" }, "xlsx"), "North Dummy Bank 2026-02-16 to 2026-03-15.xlsx");
  assert.equal(fileName("", card(), "csv"), "Statement 9034 2026-02-16 to 2026-03-15.csv");
});

test("downloads refuse while the difference is not 0.00", () => {
  assert.equal(downloadBlock(card()), null);
  assert.match(downloadBlock({ ...card(), closing: 341268 })!, /^Visa Business ending 9034 does not balance yet: the difference is \$0\.01\. It must be 0\.00 to download\.$/);
});

test("the Excel file: the statement details, then Date, Description, Type, Amount in dollars", () => {
  const sheet = readXlsx(accountXlsx(card(), "Northern Dummy Bank"))[0];
  const rows = sheet.rows.map((r) => r.map((c) => String(c ?? "")));
  assert.equal(rows[0][0], "Northern Dummy Bank Visa Business ending 9034");
  assert.ok(rows.some((r) => r[0] === "Statement period: 2026-02-16 to 2026-03-15"));
  assert.ok(rows.some((r) => r[0] === "Opening balance: $3,412.67"));
  const head = rows.findIndex((r) => r[0] === "Date");
  assert.deepEqual(rows[head].slice(0, 4), ["Date", "Description", "Type", "Amount"]);
  assert.deepEqual(rows[head + 1].slice(0, 4), ["2026-02-20", "DUMMY PRINT SHOP, GUELPH ON", "Charge", "1000"]);
  assert.deepEqual(rows[head + 2].slice(2, 4), ["Payment", "-1500"]);
});

test("one file per account; the zip holds them all, with a number added to a repeated name", async () => {
  const d = data([card(), { ...card(), key: "a2" }]);
  const files = d.accounts.map((a) => accountFile(d, a, "csv"));
  assert.equal(files[0].contentType, "text/csv; charset=utf-8");
  const zip = await JSZip.loadAsync(await zipFiles(files));
  assert.deepEqual(Object.keys(zip.files).sort(), ["Northern Dummy Bank 9034 2026-02-16 to 2026-03-15 (2).csv", "Northern Dummy Bank 9034 2026-02-16 to 2026-03-15.csv"]);
  assert.equal((await zip.file("Northern Dummy Bank 9034 2026-02-16 to 2026-03-15.csv")!.async("string")).split("\r\n")[0], "Date,Description,Amount");
  assert.equal(zipName([d], "2026-11-15"), "Northern Dummy Bank 2026-02-16 to 2026-03-15.zip");
  assert.equal(zipName([d, d], "2026-11-15"), "Bank statements 2026-11-15.zip");
});
