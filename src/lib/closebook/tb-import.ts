// Reads a trial balance export (CSV or Excel rows) into accounts: number, name and amount (debits
// positive, credits negative). Works with QuickBooks Online's "Trial Balance" report export, Xero's
// trial balance and most bookkeeper exports: it finds the header row with Debit and Credit (or one
// Balance or Amount column), the account column, and an optional account number or code column.
// Total rows, blank rows and report footers are skipped. Pure: no database.
import type { Cell } from "./xlsx.ts";

export type TbRow = { number: string; name: string; amount: number };
export type TbResult = { rows: TbRow[]; debit: number; credit: number; skipped: string[]; error?: string };

const txt = (c: Cell | undefined) => (c === null || c === undefined ? "" : String(c).trim());

// "1,234.56", "(1,234.56)", "-1234", "$1,234", "1 234,56"? (no: Canadian exports use dots). Empty is 0.
export function money(c: Cell | undefined): number | null {
  if (typeof c === "number") return c;
  const s = txt(c);
  if (s === "" || s === "-" || s === "—") return 0;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /-$/.test(s);
  const clean = s.replace(/[()$,\s-]/g, "").replace(/CR$/i, "");
  if (!/^\d*\.?\d+$/.test(clean)) return null;
  const v = Number(clean);
  return Math.round((neg || /CR$/i.test(s) ? -v : v) * 100) / 100;
}

const NUMBERED = /^(\d{3,6}(?:[.-]\d{1,4})?)\s+[-–]?\s*(.+)$/;

export function readTrialBalance(table: Cell[][]): TbResult {
  const skipped: string[] = [];
  let head = -1, dr = -1, cr = -1, bal = -1, nameCol = -1, numCol = -1;
  for (let i = 0; i < Math.min(table.length, 30) && head < 0; i++) {
    const r = (table[i] ?? []).map((c) => txt(c).toLowerCase());
    const d = r.findIndex((c) => /^debit/.test(c)), k = r.findIndex((c) => /^credit/.test(c));
    const b = r.findIndex((c) => /^(balance|amount|net)\b/.test(c));
    if ((d >= 0 && k >= 0) || b >= 0) {
      head = i; dr = d; cr = k; bal = d >= 0 && k >= 0 ? -1 : b;
      numCol = r.findIndex((c) => /^(account\s*)?(code|number|no\.?|#)$/.test(c));
      nameCol = r.findIndex((c, j) => j !== numCol && /^(account( name)?|name|description)$/.test(c));
      if (nameCol < 0) nameCol = r.findIndex((c, j) => j !== numCol && j !== d && j !== k && j !== b && c === "");
      if (nameCol < 0) nameCol = 0;
    }
  }
  if (head < 0) return { rows: [], debit: 0, credit: 0, skipped, error: "No Debit and Credit columns (or a Balance column) were found. Export the Trial Balance report as it comes, without changing its columns." };

  const rows: TbRow[] = [];
  let debit = 0, credit = 0;
  for (let i = head + 1; i < table.length; i++) {
    const r = table[i] ?? [];
    let name = txt(r[nameCol]);
    let number = numCol >= 0 ? txt(r[numCol]) : "";
    const amounts = bal >= 0 ? [money(r[bal])] : [money(r[dr]), money(r[cr])];
    if (!name && !number) continue;
    if (/^total\b/i.test(name) || /^(accrual|cash) basis/i.test(name)) { skipped.push(name); continue; }
    if (amounts.some((a) => a === null)) { skipped.push(name || number); continue; }
    const amount = bal >= 0 ? amounts[0]! : Math.round((amounts[0]! - amounts[1]!) * 100) / 100;
    if (!number) { const m = NUMBERED.exec(name); if (m) { number = m[1]; name = m[2].trim(); } }
    if (!name) name = number;
    if (amount === 0) { skipped.push(`${name} (zero)`); continue; }
    rows.push({ number, name, amount });
    if (amount > 0) debit += amount; else credit -= amount;
  }
  debit = Math.round(debit * 100) / 100; credit = Math.round(credit * 100) / 100;
  if (!rows.length) return { rows, debit, credit, skipped, error: "No accounts with a balance were found under the header row." };
  return { rows, debit, credit, skipped, ...(debit !== credit ? { error: `The trial balance does not balance: debits ${debit.toFixed(2)}, credits ${credit.toFixed(2)}.` } : {}) };
}
