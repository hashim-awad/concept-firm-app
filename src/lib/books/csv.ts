// CB2-1 PR B (Hashim, Nov 21, 2026): QBO's "Upload from file" for a bank or card CSV. Pure and tested.
// - Reads any CSV a bank gives: quoted fields, descriptions over two lines, a trailing empty column, headers with spaces.
// - Maps the columns once (date, description, one amount column or money in and money out, the date format); the mapping
//   is kept per account, so the next upload needs no mapping.
// - Amounts with 0 to 2 decimals, commas, a dollar sign, brackets or a minus for negatives.
import { parseAmount } from "../closebook/amount.ts";

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  const s = text.replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field.trim() === "") { quoted = true; field = ""; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      if (c === "\r" && s[i + 1] === "\n") i++;
      i++; continue;
    }
    field += c; i++;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  // A trailing column that is empty on every row (a comma at the end of each line) is dropped.
  const width = Math.max(0, ...rows.map((r) => r.length));
  let keep = width;
  while (keep > 0 && rows.every((r) => (r[keep - 1] ?? "").trim() === "")) keep--;
  return rows.map((r) => Array.from({ length: keep }, (_, k) => r[k] ?? ""));
}

export type DateFormat = "YYYY-MM-DD" | "MM/DD/YYYY" | "DD/MM/YYYY" | "MMM D, YYYY";
export const DATE_FORMATS: DateFormat[] = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "MMM D, YYYY"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const iso = (y: number, m: number, d: number) => {
  if (y < 100) y += 2000;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
export function parseDate(text: string, fmt: DateFormat): string | null {
  const s = text.trim();
  if (fmt === "YYYY-MM-DD") { const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s); return m ? iso(+m[1], +m[2], +m[3]) : null; }
  if (fmt === "MM/DD/YYYY" || fmt === "DD/MM/YYYY") {
    const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (!m) return null;
    return fmt === "MM/DD/YYYY" ? iso(+m[3], +m[1], +m[2]) : iso(+m[3], +m[2], +m[1]);
  }
  // "Jan 5, 2026", "5 Jan 2026", "05-Jan-2026"
  const a = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{2,4})/i.exec(s);
  if (a && MONTHS.includes(a[1].toLowerCase())) return iso(+a[3], MONTHS.indexOf(a[1].toLowerCase()) + 1, +a[2]);
  const b = /^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-](\d{2,4})/i.exec(s);
  if (b && MONTHS.includes(b[2].toLowerCase())) return iso(+b[3], MONTHS.indexOf(b[2].toLowerCase()) + 1, +b[1]);
  return null;
}

// Column numbers; amount, or money in and money out. header: the first row holds the column names.
export type CsvMapping = { header: boolean; date: number; description: number; amount: number | null; moneyIn: number | null; moneyOut: number | null; dateFormat: DateFormat;
  flip?: boolean };   // the amounts come with the opposite sign (some card exports: a charge positive is money out)
export type CsvRow = { line: number; date: string; description: string; cents: number };

export const headersOf = (rows: string[][], header: boolean) => (header && rows.length ? rows[0].map((h) => h.trim()) : (rows[0] ?? []).map((_, i) => `Column ${i + 1}`));

// A first guess from the column names: Date, Description, Amount, or Debit/Credit (Withdrawal/Deposit, Money out/Money in).
export function guessMapping(rows: string[][]): CsvMapping {
  const h = (rows[0] ?? []).map((x) => x.trim().toLowerCase());
  const header = h.some((x) => /date|description|amount|debit|credit|withdraw|deposit/.test(x));
  const find = (re: RegExp) => { const i = h.findIndex((x) => re.test(x)); return i < 0 ? null : i; };
  const date = find(/date/) ?? 0;
  const description = find(/desc|detail|memo|payee|transaction|narrative|name/) ?? 1;
  const moneyOut = find(/debit|withdraw|money out|paid out/);
  const moneyIn = find(/credit|deposit|money in|paid in/);
  const amount = moneyIn !== null && moneyOut !== null ? null : find(/amount|value/) ?? (rows[0]?.length ? rows[0].length - 1 : 2);
  const sample = rows.slice(header ? 1 : 0, header ? 6 : 5).map((r) => (r[date] ?? "").trim());
  const dateFormat = DATE_FORMATS.find((f) => sample.length && sample.every((s) => parseDate(s, f))) ?? "YYYY-MM-DD";
  return { header, date, description, amount, moneyIn: amount === null ? moneyIn : null, moneyOut: amount === null ? moneyOut : null, dateFormat };
}

export function rowsOf(rows: string[][], m: CsvMapping): { rows: CsvRow[]; problems: string[] } {
  const out: CsvRow[] = [], problems: string[] = [];
  rows.slice(m.header ? 1 : 0).forEach((r, i) => {
    const line = i + (m.header ? 2 : 1);
    const date = parseDate(r[m.date] ?? "", m.dateFormat);
    const description = (r[m.description] ?? "").replace(/\s+/g, " ").trim();
    let cents: number | null;
    if (m.amount !== null) cents = parseAmount(r[m.amount] ?? "");
    else {
      const inc = (r[m.moneyIn ?? -1] ?? "").trim() ? parseAmount(r[m.moneyIn!]) : 0;
      const outc = (r[m.moneyOut ?? -1] ?? "").trim() ? parseAmount(r[m.moneyOut!]) : 0;
      cents = inc === null || outc === null ? null : Math.abs(inc) - Math.abs(outc);
    }
    if (!date) { problems.push(`Line ${line}: the date "${(r[m.date] ?? "").trim()}" does not read as ${m.dateFormat}.`); return; }
    if (cents === null) { problems.push(`Line ${line}: the amount does not read as a number.`); return; }
    if (!description) { problems.push(`Line ${line}: no description.`); return; }
    if (cents === 0) return;
    out.push({ line, date, description, cents: m.flip ? -cents : cents });
  });
  return { rows: out, problems };
}

// A line already uploaded for the account: same date, amount and description.
export const dupKey = (r: { date: string; cents: number; description: string }) => `${r.date}|${r.cents}|${r.description.replace(/\s+/g, " ").trim().toUpperCase()}`;
