// Reads a trial balance export (CSV or Excel rows) into accounts: number, name and amount (debits
// positive, credits negative). Works with QuickBooks Online's "Trial Balance" report export, Xero's
// trial balance and most bookkeeper exports: it finds the header row with Debit and Credit (or one
// Balance or Amount column), the account column, an optional account number or code column, and an
// optional account type column ("Type", "Account type": Xero and QuickBooks Online account list exports;
// round 5, Hashim, Nov 21, 2026), which step 7's type check uses.
// Total rows, blank rows and report footers are skipped. Pure: no database.
import type { Cell } from "./xlsx.ts";

export type TbRow = { number: string; name: string; amount: number; type?: string; parent?: string; path?: string; full_name?: string };

// Piece R2 (D10): QuickBooks writes a sub-account as "Parent:Sub", each part with its own number when numbers are on
// ("6000 Marketing - Digital:6000.01 Paid search ads"). Each sub-account is its own account: its own number, else its full
// name. The parent is named by its number, else by its full name, so the tree can be built. Pure.
export type PathParts = { number: string; name: string; parent?: string; path?: string; full_name?: string };
const keyName = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
export function splitPath(raw: string, ownNumber = ""): PathParts {
  const full = raw.trim().replace(/\s+/g, " ");
  const segs = full.split(/\s*:\s*/).filter(Boolean).map((seg) => { const m = NUMBERED.exec(seg); return m ? { number: m[1], name: m[2].trim() } : { number: "", name: seg }; });
  if (!segs.length) return { number: ownNumber, name: full };
  const leaf = segs[segs.length - 1];
  const number = ownNumber || leaf.number;
  const name = leaf.name || number;
  if (segs.length === 1) return { number, name };
  const names = segs.map((x) => x.name);
  const parentSeg = segs[segs.length - 2];
  const parent = parentSeg.number || keyName(names.slice(0, -1).join(":"));
  return { number, name, parent, path: names.join(":"), full_name: full };
}
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

// Round 8 item 9: a QuickBooks Account List uploaded in the trial balance box. It has a Type or Detail
// type column and no Debit and Credit columns; its balance column can even net to zero, so the balance
// check alone does not catch it.
export const ACCOUNT_LIST_IN_TB = "This is a QuickBooks Account List: upload it in the Account List box.";
function looksLikeAccountList(table: Cell[][]): boolean {
  for (let i = 0; i < Math.min(table.length, 30); i++) {
    const r = (table[i] ?? []).map((c) => txt(c).toLowerCase());
    const hasType = r.some((c) => /^(account\s*)?type$|^detail\s*type$/.test(c));
    const hasDrCr = r.some((c) => /^debit/.test(c)) && r.some((c) => /^credit/.test(c));
    if (hasType && !hasDrCr) return true;
    if (hasDrCr) return false;
  }
  return false;
}

export function readTrialBalance(table: Cell[][]): TbResult {
  if (looksLikeAccountList(table)) return { rows: [], debit: 0, credit: 0, skipped: [], error: ACCOUNT_LIST_IN_TB };
  const skipped: string[] = [];
  let head = -1, dr = -1, cr = -1, bal = -1, nameCol = -1, numCol = -1, typeCol = -1;
  for (let i = 0; i < Math.min(table.length, 30) && head < 0; i++) {
    const r = (table[i] ?? []).map((c) => txt(c).toLowerCase());
    const d = r.findIndex((c) => /^debit/.test(c)), k = r.findIndex((c) => /^credit/.test(c));
    const b = r.findIndex((c) => /^(balance|amount|net)\b/.test(c));
    if ((d >= 0 && k >= 0) || b >= 0) {
      head = i; dr = d; cr = k; bal = d >= 0 && k >= 0 ? -1 : b;
      numCol = r.findIndex((c) => /^(account\s*)?(code|number|no\.?|#)$/.test(c));
      typeCol = r.findIndex((c) => /^(account\s*)?type$/.test(c));
      nameCol = r.findIndex((c, j) => j !== numCol && j !== typeCol && /^(account( name)?|name|description)$/.test(c));
      if (nameCol < 0) nameCol = r.findIndex((c, j) => j !== numCol && j !== typeCol && j !== d && j !== k && j !== b && c === "");
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
    const parts = splitPath(name || number, number);
    number = parts.number; name = parts.name;
    if (!name) name = number;
    if (amount === 0) { skipped.push(`${name} (zero)`); continue; }
    const type = typeCol >= 0 ? txt(r[typeCol]).slice(0, 60) : "";
    const tree = parts.parent ? { parent: parts.parent, path: parts.path, full_name: parts.full_name } : {};
    rows.push(type ? { number, name, amount, type, ...tree } : { number, name, amount, ...tree });
    if (amount > 0) debit += amount; else credit -= amount;
  }
  debit = Math.round(debit * 100) / 100; credit = Math.round(credit * 100) / 100;
  if (!rows.length) return { rows, debit, credit, skipped, error: "No accounts with a balance were found under the header row." };
  return { rows, debit, credit, skipped, ...(debit !== credit ? { error: `The trial balance does not balance: debits ${debit.toFixed(2)}, credits ${credit.toFixed(2)}.` } : {}) };
}

// Round 6 (Hashim, Nov 22, 2026): the QuickBooks Online Account List export (Reports, Account List,
// Export to Excel or CSV): each account's number (its own "Account #" column, or in front of the name),
// name and Type. Piece R2 (D11): its Detail type too, and the Parent:Sub path (D10). Pure: no database.
export type ListRow = { number: string; name: string; type: string; detail?: string; parent?: string; path?: string; full_name?: string };
export type ListResult = { rows: ListRow[]; error?: string };

export function readAccountList(table: Cell[][]): ListResult {
  let head = -1, nameCol = -1, numCol = -1, typeCol = -1, detailCol = -1;
  for (let i = 0; i < Math.min(table.length, 30) && head < 0; i++) {
    const r = (table[i] ?? []).map((c) => txt(c).toLowerCase());
    detailCol = r.findIndex((c) => /^detail\s*type$/.test(c));
    const t = r.findIndex((c) => /^(account\s*)?type$/.test(c));
    const n = r.findIndex((c) => /^(account|account name|name|full name)$/.test(c));
    if (t >= 0 && n >= 0) { head = i; typeCol = t; nameCol = n; numCol = r.findIndex((c) => /^(account\s*)?(#|number|no\.?|code)$/.test(c)); }
  }
  if (head < 0) return { rows: [], error: "This is not a QuickBooks Account List: no Account and Type columns were found. In QuickBooks Online: Reports, Account List, Export to Excel." };
  const rows: ListRow[] = [];
  for (let i = head + 1; i < table.length; i++) {
    const r = table[i] ?? [];
    let name = txt(r[nameCol]);
    let number = numCol >= 0 ? txt(r[numCol]) : "";
    const type = txt(r[typeCol]).slice(0, 60);
    if (!name || !type || /^total\b/i.test(name)) continue;
    const parts = splitPath(name, number);
    number = parts.number; name = parts.name;
    const detail = detailCol >= 0 ? txt(r[detailCol]).slice(0, 80) : "";
    rows.push({ number, name, type, ...(detail ? { detail } : {}), ...(parts.parent ? { parent: parts.parent, path: parts.path, full_name: parts.full_name } : {}) });
  }
  if (!rows.length) return { rows, error: "No accounts with a Type were found under the header row." };
  return { rows };
}
