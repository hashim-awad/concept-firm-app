// Piece R2 (item 5; Hashim, Nov 19, 2026; benchmark CaseWare Cloud's "Adjusting entries to record" report): the client entry
// list in Excel, beside the PDF, on every trial balance file. New accounts to create first, then each entry with the client's
// own account numbers and names, ready to book in QuickBooks. Amounts in cents (the Excel writer writes dollars). Pure.
import type { ReportTable, TableRow } from "./report-table.ts";

export type ListEntry = { no: string; kind: string; memo: string; date?: string | null; lines: { number: string; name: string; cents: number }[] };
export function clientListTable(title: string, fresh: { name: string; type: string }[], entries: ListEntry[]): ReportTable {
  const rows: TableRow[] = [];
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
