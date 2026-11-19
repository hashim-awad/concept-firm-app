// Piece R2 (item 5; Hashim, Nov 19, 2026; benchmark CaseWare Cloud's "Adjusting entries to record" report): the client entry
// list in Excel, beside the PDF, on every trial balance file. New accounts to create first, then each entry with the client's
// own account numbers and names, ready to book in QuickBooks. Amounts in cents (the Excel writer writes dollars). Pure.
import type { ReportTable, TableRow } from "./report-table.ts";

// A client entry list made while counted accounts are still unassigned in step 4 says its net income is not final.
type NoteAcct = { account_key: string; chart_account?: string | null; this_year?: number | string | null; last_year?: number | string | null; id: string };
export function unassignedCount(accts: NoteAcct[], used: Set<string>): number {
  return accts.filter((a) => !a.chart_account && !/^(line:|gifi:|chart:)/.test(a.account_key) && a.account_key !== "opening" && a.account_key !== "uncoded"
    && (Number(a.this_year ?? 0) !== 0 || Number(a.last_year ?? 0) !== 0 || used.has(a.id))).length;
}
export const notFinalNote = (n: number) => (n > 0 ? `${n} account${n === 1 ? "" : "s"} not yet assigned: net income is not final.` : null);

export type ListEntry = { no: string; kind: string; memo: string; date?: string | null; lines: { number: string; name: string; cents: number }[] };
export function clientListTable(title: string, fresh: { name: string; type: string }[], entries: ListEntry[], note?: string | null): ReportTable {
  const rows: TableRow[] = [];
  if (note) rows.push({ cells: [note, null, null], bold: true }, { cells: ["", null, null] });
  if (fresh.length) {
    rows.push({ cells: ["New accounts to create", null, null], bold: true });
    for (const a of fresh) rows.push({ cells: [`${a.name}${a.type ? ` (${a.type})` : ""}`, null, null], indent: 1 });
    rows.push({ cells: ["", null, null] });
  }
  rows.push({ cells: ["Entries to record", null, null], bold: true });
  for (const e of entries) {
    // An entry not dated the year end (an opening RJE, dated the first day of the year) says its date.
    rows.push({ cells: [`${e.no} ${e.kind}${e.date ? `, dated ${e.date}` : ""}: ${e.memo}`, null, null], bold: true });
    for (const l of e.lines) rows.push({ cells: [`${l.number ? `${l.number} ` : ""}${l.name}`, l.cents > 0 ? l.cents : null, l.cents < 0 ? -l.cents : null], indent: 1 });
    const dr = e.lines.reduce((s, l) => s + Math.max(l.cents, 0), 0);
    rows.push({ cells: ["Total", dr, dr], bold: true });
  }
  return { title, columns: ["Account", "Debit", "Credit"], numeric: [false, true, true], rows };
}
