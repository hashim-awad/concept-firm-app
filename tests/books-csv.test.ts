// Run with: npm test
// CB2-1 Part 4.5: bank upload. Dummy data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dupKey, guessMapping, parseCsv, parseDate, rowsOf } from "../src/lib/books/csv.ts";

test("a CSV with spaced headers, a trailing empty column, two-line quoted descriptions and 0 to 2 decimals uploads correctly", () => {
  const csv = ' Date , Description ,  Amount ,\r\n2026-03-01,"DUMMY COFFEE\nKITCHENER ON",-5,\r\n2026-03-02,"Deposit, thank you",1200.5,\r\n2026-03-03,"PAYMENT ""ONLINE""",-75.25,\r\n';
  const rows = parseCsv(csv);
  assert.equal(rows[0].length, 3);                       // the trailing empty column is gone
  assert.deepEqual(rows[0].map((h) => h.trim()), ["Date", "Description", "Amount"]);
  const m = guessMapping(rows);
  assert.equal(m.header, true);
  assert.equal(m.date, 0); assert.equal(m.description, 1); assert.equal(m.amount, 2);
  assert.equal(m.dateFormat, "YYYY-MM-DD");
  const r = rowsOf(rows, m);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.rows.map((x) => [x.date, x.description, x.cents]), [
    ["2026-03-01", "DUMMY COFFEE KITCHENER ON", -500],
    ["2026-03-02", "Deposit, thank you", 120050],
    ["2026-03-03", 'PAYMENT "ONLINE"', -7525],
  ]);
});

test("a debit and credit column CSV maps correctly (money out, money in)", () => {
  const csv = "Transaction Date,Details,Debit,Credit\n03/15/2026,DUMMY SUPPLIES,113.00,\n03/16/2026,CLIENT DEPOSIT,,2500\n03/17/2026,\"$1,050.10 TRANSFER\",\"1,050.10\",\n";
  const rows = parseCsv(csv);
  const m = guessMapping(rows);
  assert.equal(m.amount, null);
  assert.equal(m.moneyOut, 2); assert.equal(m.moneyIn, 3);
  assert.equal(m.dateFormat, "MM/DD/YYYY");
  const r = rowsOf(rows, m);
  assert.deepEqual(r.rows.map((x) => [x.date, x.cents]), [["2026-03-15", -11300], ["2026-03-16", 250000], ["2026-03-17", -105010]]);
});

test("dates in each format; impossible dates refused", () => {
  assert.equal(parseDate("2026-02-28", "YYYY-MM-DD"), "2026-02-28");
  assert.equal(parseDate("02/03/2026", "MM/DD/YYYY"), "2026-02-03");
  assert.equal(parseDate("02/03/2026", "DD/MM/YYYY"), "2026-03-02");
  assert.equal(parseDate("Mar 5, 2026", "MMM D, YYYY"), "2026-03-05");
  assert.equal(parseDate("05-Mar-26", "MMM D, YYYY"), "2026-03-05");
  assert.equal(parseDate("2026-02-30", "YYYY-MM-DD"), null);
});

test("a bad row is reported with its line number; duplicates match on date, amount and description", () => {
  const rows = parseCsv("Date,Description,Amount\n2026-03-01,A,1\nnot a date,B,2\n2026-03-02,C,abc\n");
  const r = rowsOf(rows, guessMapping(rows));
  assert.equal(r.rows.length, 1);
  assert.deepEqual(r.problems.map((p) => p.slice(0, 7)), ["Line 3:", "Line 4:"]);
  assert.equal(dupKey({ date: "2026-03-01", cents: 100, description: " dummy  coffee " }), dupKey({ date: "2026-03-01", cents: 100, description: "DUMMY COFFEE" }));
});
