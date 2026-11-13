// Bank and card upload (Hashim, Nov 13, 2026; BRIEF.md, replaces the per-bank CSV formats in
// PHASE3-BATCH.md): one format only, Concept's bank upload template (docs/phase3/Sample-bank-upload-TestCo.csv).
// Columns: Date (YYYY-MM-DD), Description, Amount. Signs follow QuickBooks:
// - bank accounts: money in positive, money out negative;
// - credit cards and lines of credit: charges positive, payments negative.
// Either way the statement balance moves by the amount, so opening + amounts = closing, to the cent.
// It tolerates spaces in header names, an empty trailing column, two-line descriptions in quotes,
// amounts with 0 to 2 decimals, and blank rows. Pure: no database. Money is kept in cents.

export type BankKind = "bank" | "card";
export type BankRow = { line: number; date: string; description: string; cents: number };
export type BankRead = { rows: BankRow[]; errors: string[] };

// CSV with quoted fields that may hold commas, doubled quotes and line breaks. Each record keeps the
// file line it starts on, so a problem can name the line the preparer sees in Excel or a text editor.
export function csvRecords(text: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], cell = "", quoted = false, line = 1, start = 1;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === "\n") line++; cell += c; }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { cells.push(cell); cell = ""; }
    else if (c === "\r") continue;
    else if (c === "\n") { cells.push(cell); out.push({ line: start, cells }); cells = []; cell = ""; line++; start = line; }
    else cell += c;
  }
  if (cell !== "" || cells.length) { cells.push(cell); out.push({ line: start, cells }); }
  return out;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const AMOUNT = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

export function validDate(d: string): boolean {
  const m = DATE.exec(d);
  if (!m) return false;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return dt.getUTCFullYear() === +m[1] && dt.getUTCMonth() === +m[2] - 1 && dt.getUTCDate() === +m[3];
}

// "57.9" is 5790 cents, "-1000" is -100000. Anything else (commas, $, brackets, 3 decimals) is null.
export function amountCents(v: string): number | null {
  const m = AMOUNT.exec(v.trim());
  if (!m) return null;
  const c = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -c : c;
}

export function readBankUpload(text: string): BankRead {
  const recs = csvRecords(text);
  const errors: string[] = [];
  const headAt = recs.findIndex((r) => r.cells.some((c) => c.trim() !== ""));
  if (headAt < 0) return { rows: [], errors: ["The file is empty."] };
  const head = recs[headAt].cells.map((c) => c.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const [dc, sc, ac] = [col("date"), col("description"), col("amount")];
  const extra = head.filter((h) => h !== "" && !["date", "description", "amount"].includes(h));
  if (dc < 0 || sc < 0 || ac < 0 || extra.length) {
    return { rows: [], errors: [`Line ${recs[headAt].line}: the columns must be Date, Description, Amount (Concept's bank upload template). This file has: ${recs[headAt].cells.filter((c) => c.trim()).map((c) => c.trim()).join(", ") || "nothing"}.`] };
  }
  const rows: BankRow[] = [];
  for (const r of recs.slice(headAt + 1)) {
    const get = (i: number) => (r.cells[i] ?? "").trim();
    // Blank rows (",,," at the end of the template) are skipped; so is anything in an unnamed column.
    if (![dc, sc, ac].some((i) => get(i) !== "")) continue;
    const date = get(dc), description = get(sc).replace(/\s*\n\s*/g, " ").replace(/\s+/g, " "), raw = get(ac);
    const bad: string[] = [];
    if (!validDate(date)) bad.push(`the date "${date}" is not YYYY-MM-DD`);
    if (!description) bad.push("the description is blank");
    const cents = amountCents(raw);
    if (cents === null) bad.push(raw === "" ? "the amount is blank" : `the amount "${raw}" is not a number with up to 2 decimals (no $ or commas)`);
    if (bad.length) { errors.push(`Line ${r.line}: ${bad.join("; ")}.`); continue; }
    rows.push({ line: r.line, date, description, cents: cents! });
  }
  if (!rows.length && !errors.length) errors.push("The file has the right columns but no transactions.");
  return { rows, errors };
}

// The amounts with their signs turned over (a card read as a bank account, or the other way round).
export const flipRows = <T extends { cents: number }>(rows: T[]): T[] => rows.map((r) => ({ ...r, cents: -r.cents }));
// Layout item 3 (Hashim, Nov 15, 2026): when the check fails but opening - amounts = closing to the cent,
// the signs look reversed: the wrong account type, or a file exported the other way round.
export const REVERSED = "These amounts look like the opposite sign. Check you picked the right account, or flip the signs.";
export function looksReversed(openingCents: number, closingCents: number, rows: { cents: number }[]): boolean {
  return !balanceCheck(openingCents, closingCents, rows).ok && balanceCheck(openingCents, closingCents, flipRows(rows)).ok;
}

// Opening + amounts = closing, to the cent. difference = closing - (opening + amounts).
export function balanceCheck(openingCents: number, closingCents: number, rows: { cents: number }[]) {
  const total = rows.reduce((n, r) => n + r.cents, 0);
  const expected = openingCents + total;
  return { totalCents: total, expectedCents: expected, differenceCents: closingCents - expected, ok: expected === closingCents };
}

// A balance typed by the preparer: "1,234.56", "-1234.5", "$1,234", "(1,234.56)" for a negative.
export function typedCents(v: string): number | null {
  const s = v.trim().replace(/[$\s,]/g, "");
  const neg = /^\(.*\)$/.test(s);
  return amountCents(neg ? `-${s.slice(1, -1)}` : s);
}

export const dollars = (c: number) => `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
