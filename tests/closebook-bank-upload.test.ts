// Run with: npm test
// Concept's bank upload template (Hashim, Nov 13, 2026): one format, QuickBooks signs, balance check.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { amountCents, balanceCheck, csvRecords, readBankUpload, typedCents, validDate } from "../src/lib/closebook/bank-upload.ts";

const sample = readFileSync(new URL("../docs/phase3/Sample-bank-upload-TestCo.csv", import.meta.url), "utf8");

test("the sample template: 36 transactions, two-line descriptions joined, blank rows skipped", () => {
  const r = readBankUpload(sample);
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 36);
  assert.deepEqual(r.rows[0], { line: 2, date: "2026-01-01", description: "SAMPLE PIZZA WATERLOO ON", cents: 29483 });
  const two = r.rows.find((x) => x.line === 6)!;
  assert.equal(two.description, "SAMPLE PRINT SHOP GUELPH ON AMT 589.82 USD");
  assert.equal(two.cents, 81919);
  // The record after a two-line description starts on the right file line.
  assert.equal(r.rows[5].line, 8);
  assert.equal(r.rows.find((x) => x.description.startsWith("PAYMENT"))!.cents, -100000);
  assert.equal(r.rows.find((x) => x.description === "SAMPLE ADS SERVICE ONLINE" && x.line === 14)!.cents, 5790);
});

test("the balance check: opening + amounts = closing to the cent, else the difference", () => {
  const r = readBankUpload(sample);
  const total = r.rows.reduce((n, x) => n + x.cents, 0);
  assert.equal(total, 155456);
  assert.equal(balanceCheck(100000, 100000 + total, r.rows).ok, true);
  const off = balanceCheck(100000, 100000 + total - 1, r.rows);
  assert.equal(off.ok, false);
  assert.equal(off.differenceCents, -1);
});

test("tolerances: spaced headers, CRLF, no trailing column, any header case", () => {
  const r = readBankUpload("﻿  date , DESCRIPTION ,Amount\r\n2026-02-01,Rent,-1500\r\n2026-02-02,\"Deposit, cheque\",250.5\r\n");
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.rows.map((x) => [x.description, x.cents]), [["Rent", -150000], ["Deposit, cheque", 25050]]);
});

test("refusals: other columns, bad dates and amounts name the line", () => {
  assert.match(readBankUpload("Date,Description,Debit,Credit\n").errors[0], /must be Date, Description, Amount/);
  const r = readBankUpload("Date,Description,Amount\n2026/01/05,A,1\n2026-02-30,B,1\n2026-01-05,,1.234\n2026-01-06,D,\"1,000.00\"\n2026-01-07,E,$5\n");
  assert.equal(r.rows.length, 0);
  assert.equal(r.errors.length, 5);
  assert.match(r.errors[0], /^Line 2: the date "2026\/01\/05"/);
  assert.match(r.errors[1], /^Line 3: the date "2026-02-30"/);
  assert.match(r.errors[2], /^Line 4: the description is blank; the amount "1.234"/);
  assert.match(r.errors[3], /^Line 5: the amount "1,000.00"/);
  assert.equal(readBankUpload("Date,Description,Amount\n,,,\n").errors[0], "The file has the right columns but no transactions.");
});

test("helpers", () => {
  assert.equal(amountCents("7"), 700);
  assert.equal(amountCents("-0.5"), -50);
  assert.equal(amountCents("1."), null);
  assert.equal(typedCents("$1,234.56"), 123456);
  assert.equal(typedCents("(1,234.56)"), -123456);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate("2026-02-29"), false);
  assert.equal(csvRecords("a,\"b\nc\",d\ne,f,g").map((r) => r.line).join(), "1,3");
});
