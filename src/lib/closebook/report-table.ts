// A report as a plain table, for the Excel and PDF exports (Hashim, Nov 15, 2026). The same builders as
// the screens (src/lib/closebook/reports.ts), so an export always matches what the page shows. Pure.
import type { Posting, PostingKind } from "./tb-build.ts";
import { journal, KIND_LABEL, ledger, NET_INCOME, netIncomeBox, pctChange, statements, tbByGroup, trialBalance, type LineInfo, type RepAccount, type StmtSection, type TbLine } from "./reports.ts";

export type Cell = string | number | null;      // numbers are cents
// grand: the grand total, where a zero shows as 0.00 (the reference), not "–".
export type TableRow = { cells: Cell[]; bold?: boolean; indent?: number; grand?: boolean };
export type ReportTable = { title: string; columns: string[]; numeric: boolean[]; rows: TableRow[] };
export type TableInput = { accounts: RepAccount[]; postings: Posting[]; info: (l: string | null) => LineInfo | null; bankFile: boolean; entryLabel: Map<string, string> };
export type TableParams = { report: string; account?: string; from?: string; to?: string; source?: string; view?: string; yearEnd?: string };

const gifi = (l: string | null) => (l ? l.replace(/\.00$/, "") : "");
const acct = (a: { number: string; name: string }) => `${a.number ? `${a.number} ` : ""}${a.name}`;

export function reportTable(d: TableInput, p: TableParams): ReportTable {
  const tb = trialBalance(d.accounts, d.postings);
  const source = (kind: PostingKind, ref: string) => (kind === "entry" ? d.entryLabel.get(ref) ?? KIND_LABEL.entry : KIND_LABEL[kind]);
  if (p.report === "tb") {
    // By group (the default) or flat, with the reference columns.
    const vals = (t: TbLine) => [t.prelim, t.adjust, t.reclass, t.final, t.last, t.diff];
    const rows: TableRow[] = [];
    if (p.view === "flat") for (const t of tb) rows.push({ cells: [t.number, t.name, gifi(t.line_no), ...vals(t), pctChange(t.final, t.last)] });
    else for (const g of tbByGroup(tb, d.info).groups) {
      rows.push({ bold: true, cells: [g.name, null, null, null, null, null, null, null, null, null] });
      for (const t of g.rows) rows.push({ indent: 1, cells: [t.number, t.name, gifi(t.line_no), ...vals(t), pctChange(t.final, t.last)] });
      rows.push({ bold: true, cells: ["", g.total.name, "", ...vals(g.total), pctChange(g.total.final, g.total.last)] });
    }
    const total = tbByGroup(tb, d.info).total;
    rows.push({ bold: true, grand: true, cells: ["", total.name, "", ...vals(total), ""] });
    const y = (p.yearEnd ?? "").slice(0, 4);
    return { title: p.view === "flat" ? "Trial balance" : "Trial balance by group", columns: ["Number", "Account", "GIFI", `Prelim ${y}`, "Adjust", "Reclass", `Final ${y}`, `Prior ${Number(y) - 1}`, "$ change", "% change"],
      numeric: [false, false, false, true, true, true, true, true, true, false], rows };
  }
  if (p.report === "bs" || p.report === "pl") {
    const s = statements(tb, d.info);
    const rows: TableRow[] = [];
    const sec = (x: StmtSection, total: string) => {
      rows.push({ bold: true, cells: [x.title.toUpperCase(), null, null] });
      for (const g of x.groups) {
        rows.push({ indent: 1, bold: g.code !== NET_INCOME, cells: [g.name, g.now, g.last] });
        for (const a of g.accounts) rows.push({ indent: 2, cells: [`${acct(a)}${a.line_no ? `  (GIFI ${gifi(a.line_no)})` : ""}`, a.now, a.last] });
      }
      rows.push({ bold: true, cells: [total, x.now, x.last] });
    };
    if (p.report === "bs") {
      sec(s.bs.assets, "Total assets"); sec(s.bs.liabilities, "Total liabilities"); sec(s.bs.equity, "Total equity");
      if (s.bs.unsorted) sec(s.bs.unsorted, "Total not yet sorted");
      rows.push({ bold: true, cells: ["Total liabilities and equity", s.bs.totalLE.now, s.bs.totalLE.last] });
    } else {
      sec(s.pl.revenue, "Total revenue"); sec(s.pl.expenses, "Total expenses");
      rows.push({ bold: true, cells: ["Net income", s.pl.net.now, s.pl.net.last] });
    }
    return { title: p.report === "bs" ? "Balance sheet" : "Income statement", columns: ["", "This year", "Last year"], numeric: [false, true, true], rows };
  }
  if (p.report === "gl") {
    const rows: TableRow[] = [];
    for (const a of ledger(d.accounts, d.postings, { key: p.account, from: p.from, to: p.to })) {
      rows.push({ bold: true, cells: [`${acct(a)}${a.line_no ? `  (GIFI ${gifi(a.line_no)})` : ""}`, null, null, null, null] });
      if (p.from) rows.push({ cells: [p.from, "", "Balance before this date", null, a.before] });
      for (const l of a.lines) rows.push({ cells: [l.date, source(l.kind, l.ref), l.label, l.cents, l.running] });
      rows.push({ bold: true, cells: ["", "", "Balance", null, a.end] });
    }
    return { title: "General ledger", columns: ["Date", "Source", "Description", "Amount", "Balance"], numeric: [false, false, false, true, true], rows };
  }
  const name = new Map(d.accounts.map((a) => [a.key, acct(a)]));
  const rows: TableRow[] = [];
  const kind = (["opening", "bank", "entry", "import"].includes(p.source ?? "") ? p.source : "") as PostingKind | "";
  for (const t of journal(d.postings, kind)) {
    rows.push({ bold: true, cells: [t.date, t.kind === "opening" ? KIND_LABEL.opening : source(t.kind, t.ref), t.label, null, null] });
    for (const l of t.lines) rows.push({ indent: 1, cells: ["", "", name.get(l.key) ?? l.key, l.cents > 0 ? l.cents : null, l.cents < 0 ? -l.cents : null] });
  }
  const b = netIncomeBox(d.accounts, d.postings, d.info);
  rows.push({ cells: ["", "", "", null, null] });
  rows.push({ cells: ["", "", "Net income before entries", null, b.before] }, { cells: ["", "", "Adjusting and tax entries (AJE, TJE)", null, b.adjust] },
    { cells: ["", "", "Reclassifying entries (RJE)", null, b.reclass] }, { bold: true, cells: ["", "", "Adjusted net income", null, b.after] });
  return { title: "Journal", columns: ["Date", "Source", "Account", "Debit", "Credit"], numeric: [false, false, false, true, true], rows };
}
