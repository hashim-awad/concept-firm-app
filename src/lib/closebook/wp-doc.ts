// Working paper PDFs in the layout of the reference package Hashim gave (Nov 15, 2026: a large firm's
// CaseWare "Trial balance by group and journal entries", invented figures): the stamp at the top of every
// page, the header block (client, report title, year end, and the W/P ref, Prepared by, Reviewed by box),
// a navy column band, group headings, bold totals with a rule above, shaded $ change and % change
// columns, entry boxes with their working paper reference, and the adjusted net income box. Footer: the
// client, the report name, the date and time generated, and the page. Pure: builds pdfmake definitions.
import { pctChange, type LedgerAccount, type JournalTxn, type NetIncomeBox, type Statements, type StmtSection, type TbGroup, type TbLine } from "./reports.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const C = { navy: "#1A3C7C", grey: "#5B6475", red: "#B91C1C", border: "#C9CED8", shade: "#F3F5F9", band: "#EEF1F6", ink: "#000000" };

export type WpCtx = {
  client: string; yearEnd: string; yearStart: string; packageName: string; stamp: string; generated: string;
  preparedBy: string; reviewedBy: string; wpBox: boolean;
};

const n2 = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Debits positive, credits in brackets, "–" for zero; the grand total shows 0.00.
export const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${n2(c)})` : n2(c));
const moneyTotal = (c: number) => (c === 0 ? "0.00" : money(c));
const monthDayYear = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
const year = (iso: string) => iso.slice(0, 4);
const priorYear = (iso: string) => String(Number(iso.slice(0, 4)) - 1);

// The header block at the start of each report: client, title, year end, and the W/P box.
export function headerBlock(ctx: WpCtx, title: string, wpRef: string): any {
  const left = { stack: [
    { text: ctx.client, color: C.navy, bold: true, fontSize: 14.5 },
    { text: title, bold: true, fontSize: 11.5, margin: [0, 2, 0, 0] },
    { text: `Year end: ${monthDayYear(ctx.yearEnd)}`, color: C.grey, fontSize: 9.5, margin: [0, 3, 0, 0] },
  ] };
  if (!ctx.wpBox) return { columns: [left], margin: [0, 0, 0, 14] };
  const cell = (t: string, grey = false) => ({ text: t, color: grey ? C.grey : C.ink, fontSize: 8, margin: [3, 2.5, 3, 2.5] });
  const box = { width: 172, table: { widths: [56, "*"], body: [[cell("W/P ref", true), cell(wpRef)], [cell("Prepared by", true), cell(ctx.preparedBy)], [cell("Reviewed by", true), cell(ctx.reviewedBy)]] },
    layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => C.border, vLineColor: () => C.border, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 0, paddingBottom: () => 0 } };
  return { columns: [{ width: "*", ...left }, box], margin: [0, 0, 0, 14] };
}

// Shared table look: no vertical lines; a rule only where a cell asks for one (border top).
const tableLayout = (shadeCols: number[] = []) => ({
  hLineWidth: () => 0.7, vLineWidth: () => 0, hLineColor: () => C.ink,
  paddingLeft: () => 5, paddingRight: () => 5, paddingTop: () => 3.2, paddingBottom: () => 3.2,
  fillColor: (row: number, _node: any, col: number) => (row > 0 && shadeCols.includes(col) ? C.shade : null),
});
const NO = [false, false, false, false];
const TOP = [false, true, false, false];
const head = (t: string, right = false, extra: any = {}) => ({ text: t, bold: true, color: "#FFFFFF", fillColor: C.navy, alignment: right ? "right" : "left", border: NO, fontSize: 8.5, ...extra });
const num = (c: number, bold = false, extra: any = {}) => ({ text: money(c), alignment: "right", bold, border: NO, ...extra });

// The client entry list opens with the accounts the client needs to create before recording the entries.
export function newAccountsSection(ctx: WpCtx, accounts: { name: string; type: string }[]): any[] {
  const body: any[] = [[head("Account name"), head("Account type")], ...accounts.map((a) => [{ text: a.name, border: NO }, { text: a.type, border: NO }])];
  return [headerBlock(ctx, "New accounts to create in your books", ""),
    { text: "Create these accounts in your books first. The entries that follow use them.", fontSize: 9.5, margin: [0, 0, 0, 10] },
    { table: { headerRows: 1, widths: [260, 200], body }, layout: { ...tableLayout(), hLineWidth: (i: number) => (i > 1 ? 0.4 : 0), hLineColor: () => C.border }, fontSize: 9.5 }];
}

// Trial balance by group (reference pages 1 and 2).
export function tbGroupSection(ctx: WpCtx, groups: TbGroup[], total: TbLine, wpRef: string, client = false): any[] {
  const ye = ctx.yearEnd;
  const body: any[] = [[head("Account", false, { colSpan: 2 }), {}, head(`Prelim ${year(ye)}`, true), head("Adjust", true), head("Reclass", true), head(`Final ${year(ye)}`, true),
    head(`Prior ${priorYear(ye)}`, true), head("$ change", true), head("% change", true)]];
  const values = (t: TbLine, bold: boolean, top: boolean) => [t.prelim, t.adjust, t.reclass, t.final, t.last, t.diff]
    .map((v) => num(v, bold, top ? { border: TOP } : {}));
  for (const g of groups) {
    // The heading spans the account columns only, so the shaded columns run the full length.
    body.push([{ text: g.name, colSpan: 2, bold: true, color: C.navy, border: NO, margin: [0, 4, 0, 0] }, {}, ...Array.from({ length: 7 }, () => ({ text: "", border: NO }))]);
    for (const r of g.rows) body.push([{ text: r.number, color: C.grey, border: NO, margin: [8, 0, 0, 0] }, { text: r.name, border: NO }, ...values(r, false, false),
      { text: pctChange(r.final, r.last), alignment: "right", border: NO }]);
    body.push([{ text: "", border: NO }, { text: g.total.name, bold: true, border: TOP }, ...values(g.total, true, true),
      { text: pctChange(g.total.final, g.total.last), alignment: "right", bold: true, border: TOP }]);
  }
  const dbl = (c: number) => ({ text: moneyTotal(c), alignment: "right", bold: true, border: TOP, decoration: "underline", decorationStyle: "double" });
  body.push([{ text: "", border: NO }, { text: total.name, bold: true, border: TOP, margin: [0, 2, 0, 0] }, dbl(total.prelim), dbl(total.adjust), dbl(total.reclass), dbl(total.final), dbl(total.last),
    dbl(total.diff), { text: "", border: TOP }]);
  const note = client
    ? "Debits are shown as positive and credits in brackets. % change compares the size of each balance (a growing liability or revenue shows a positive %); n/m when the balance changed side. Prelim = your balances before our entries; Adjust = adjusting and tax entries; Reclass = reclassifying entries."
    : "Debits are shown as positive and credits in brackets. % change compares the size of each balance (a growing liability or revenue shows a positive %); n/m when the balance changed side. Prelim = balances before Closebook entries; Adjust = adjusting and tax entries; Reclass = reclassifying entries.";
  return [headerBlock(ctx, "Trial balance by group", wpRef),
    { table: { headerRows: 1, dontBreakRows: true, widths: [44, "*", 62, 58, 58, 64, 64, 64, 50], body }, layout: tableLayout([7, 8]), fontSize: 8.5 },
    { text: note, fontSize: 7.5, color: C.grey, margin: [0, 10, 0, 0] }];
}

// Trial balance, flat (no groups).
export function tbFlatSection(ctx: WpCtx, tb: TbLine[], total: TbLine, wpRef: string): any[] {
  const ye = ctx.yearEnd;
  const body: any[] = [[head("Account", false, { colSpan: 2 }), {}, head("GIFI"), head(`Prelim ${year(ye)}`, true), head("Adjust", true), head("Reclass", true), head(`Final ${year(ye)}`, true),
    head(`Prior ${priorYear(ye)}`, true), head("$ change", true), head("% change", true)]];
  for (const r of tb) body.push([{ text: r.number, color: C.grey, border: NO }, { text: r.name, border: NO }, { text: (r.line_no ?? "").replace(/\.00$/, ""), color: C.grey, border: NO },
    ...[r.prelim, r.adjust, r.reclass, r.final, r.last, r.diff].map((v) => num(v)), { text: pctChange(r.final, r.last), alignment: "right", border: NO }]);
  const dbl = (c: number) => ({ text: moneyTotal(c), alignment: "right", bold: true, border: TOP, decoration: "underline", decorationStyle: "double" });
  body.push([{ text: "", border: NO }, { text: total.name, bold: true, border: TOP }, { text: "", border: TOP }, dbl(total.prelim), dbl(total.adjust), dbl(total.reclass), dbl(total.final), dbl(total.last), dbl(total.diff), { text: "", border: TOP }]);
  return [headerBlock(ctx, "Trial balance", wpRef), { table: { headerRows: 1, dontBreakRows: true, widths: [40, "*", 36, 60, 54, 54, 60, 60, 60, 46], body }, layout: tableLayout([8, 9]), fontSize: 8.5 }];
}

// Balance sheet or income statement: groups with their accounts, this year against last year.
export function statementSection(ctx: WpCtx, s: Statements, which: "bs" | "pl", wpRef: string): any[] {
  const ye = ctx.yearEnd;
  const body: any[] = [[head("Account", false, { colSpan: 2 }), {}, head(year(ye), true), head(priorYear(ye), true)]];
  const sec = (x: StmtSection, total: string) => {
    body.push([{ text: x.title, colSpan: 4, bold: true, color: C.navy, border: NO, margin: [0, 5, 0, 0] }, {}, {}, {}]);
    for (const g of x.groups) {
      if (!g.accounts.length) { body.push([{ text: "", border: NO }, { text: g.name, border: NO }, num(g.now), num(g.last)]); continue; }
      body.push([{ text: "", border: NO }, { text: g.name, bold: true, border: NO }, { text: "", border: NO }, { text: "", border: NO }]);
      for (const a of g.accounts) body.push([{ text: a.number, color: C.grey, border: NO, margin: [8, 0, 0, 0] }, { text: a.name, border: NO, margin: [8, 0, 0, 0] }, num(a.now), num(a.last)]);
      body.push([{ text: "", border: NO }, { text: `Total ${g.name.replace(/^[A-Z]{1,2} /, "").toLowerCase()}`, border: NO, margin: [8, 0, 0, 0] }, num(g.now, false, { border: TOP }), num(g.last, false, { border: TOP })]);
    }
    body.push([{ text: "", border: NO }, { text: total, bold: true, border: TOP }, num(x.now, true, { border: TOP }), num(x.last, true, { border: TOP })]);
  };
  const dbl = (label: string, v: { now: number; last: number }) => body.push([{ text: "", border: NO }, { text: label, bold: true, border: TOP, margin: [0, 2, 0, 0] },
    { text: money(v.now), alignment: "right", bold: true, border: TOP, decoration: "underline", decorationStyle: "double" },
    { text: money(v.last), alignment: "right", bold: true, border: TOP, decoration: "underline", decorationStyle: "double" }]);
  if (which === "bs") {
    sec(s.bs.assets, "Total assets"); sec(s.bs.liabilities, "Total liabilities"); sec(s.bs.equity, "Total equity");
    if (s.bs.unsorted) sec(s.bs.unsorted, "Total not yet sorted");
    dbl("Total liabilities and equity", s.bs.totalLE);
  } else {
    sec(s.pl.revenue, "Total revenue"); sec(s.pl.expenses, "Total expenses"); dbl("Net income", s.pl.net);
  }
  const out: any[] = [headerBlock(ctx, which === "bs" ? "Balance sheet" : "Income statement", wpRef),
    { table: { headerRows: 1, dontBreakRows: true, widths: [44, "*", 90, 90], body }, layout: tableLayout(), fontSize: 8.5 },
    { text: "Liabilities, equity and revenue show as positive; brackets are the opposite side.", fontSize: 7.5, color: C.grey, margin: [0, 10, 0, 0] }];
  if (which === "pl" && s.pl.lastFromT2) out.push({ text: `Last year's income statement (Schedule 125) was not entered, so last year shows only its net income, ${money(s.pl.net.last)}, the figure on last year's T2.`, fontSize: 7.5, color: C.grey, margin: [0, 3, 0, 0] });
  return out;
}

// General ledger.
export function ledgerSection(ctx: WpCtx, accts: LedgerAccount[], source: (l: LedgerAccount["lines"][number]) => string, wpRef: string, from?: string): any[] {
  const body: any[] = [[head("Date"), head("Source"), head("Description"), head("Amount", true), head("Balance", true)]];
  for (const a of accts) {
    body.push([{ text: `${a.number ? `${a.number}  ` : ""}${a.name}${a.line_no ? `   GIFI ${a.line_no.replace(/\.00$/, "")}` : ""}`, colSpan: 5, bold: true, color: C.navy, border: NO, margin: [0, 4, 0, 0] }, {}, {}, {}, {}]);
    if (from) body.push([{ text: from, border: NO }, { text: "", border: NO }, { text: "Balance before this date", border: NO }, { text: "", border: NO }, num(a.before)]);
    for (const l of a.lines) body.push([{ text: l.date, border: NO }, { text: source(l), border: NO }, { text: l.label, border: NO }, num(l.cents), num(l.running)]);
    body.push([{ text: "", border: NO }, { text: "", border: NO }, { text: "Balance", bold: true, border: TOP }, { text: "", border: TOP }, num(a.end, true, { border: TOP })]);
  }
  return [headerBlock(ctx, "General ledger", wpRef), { table: { headerRows: 1, dontBreakRows: true, widths: [58, 78, "*", 74, 74], body }, layout: tableLayout(), fontSize: 8.5 }];
}

// The adjusted net income box (reference page 3).
export function netIncomeBoxBlock(b: NetIncomeBox): any {
  const row = (label: string, v: number, last = false) => [
    { text: label, bold: last, fillColor: last ? C.band : null, fontSize: last ? 10 : 9.5, margin: [4, 3, 0, 3] },
    { text: money(v), alignment: "right", bold: last, fillColor: last ? C.band : null, fontSize: last ? 10 : 9.5, margin: [0, 3, 4, 3],
      ...(last ? { decoration: "underline", decorationStyle: "double" } : {}) }];
  return { columns: [{ width: "*", text: "" }, { width: 300, table: { widths: ["*", 110], body: [
    row("Net income before entries", b.before), row("Adjusting and tax entries (AJE, TJE)", b.adjust), row("Reclassifying entries (RJE)", b.reclass), row("Adjusted net income", b.after, true)] },
    layout: { hLineWidth: (i: number, node: any) => (i === 0 || i === node.table.body.length ? 0.6 : i === 3 ? 0.7 : 0), vLineWidth: (i: number, node: any) => (i === 0 || i === node.table.widths.length ? 0.6 : 0),
      hLineColor: (i: number) => (i === 3 ? C.ink : C.border), vLineColor: () => C.border, paddingLeft: () => 2, paddingRight: () => 2, paddingTop: () => 0, paddingBottom: () => 0 } }], margin: [0, 10, 0, 0], unbreakable: true };
}

// Journal: every posting by its source, then the net income box.
export function journalSection(ctx: WpCtx, txns: JournalTxn[], source: (t: JournalTxn) => string, name: (key: string) => string, box: NetIncomeBox, wpRef: string): any[] {
  const body: any[] = [[head("Date"), head("Source"), head("Account"), head("Debit", true), head("Credit", true)]];
  for (const t of txns) {
    body.push([{ text: t.date, bold: true, border: TOP, fillColor: C.band }, { text: source(t), bold: true, color: C.navy, border: TOP, fillColor: C.band },
      { text: t.label, colSpan: 3, color: C.grey, border: TOP, fillColor: C.band }, {}, {}]);
    for (const l of t.lines) body.push([{ text: "", border: NO }, { text: "", border: NO }, { text: name(l.key), border: NO, margin: [6, 0, 0, 0] },
      { text: l.cents > 0 ? money(l.cents) : "", alignment: "right", border: NO }, { text: l.cents < 0 ? money(-l.cents) : "", alignment: "right", border: NO }]);
  }
  return [headerBlock(ctx, "Journal", wpRef), { table: { headerRows: 1, dontBreakRows: true, widths: [58, 100, "*", 80, 80], body },
    layout: { ...tableLayout(), hLineColor: () => C.border }, fontSize: 8.5 }, netIncomeBoxBlock(box)];
}

// Adjusting and reclass journal entries (reference page 3).
export type EntryDoc = { no: string; kind: string; wpRef: string; memo: string; lines: { number: string; name: string; cents: number }[] };
export function entriesSection(ctx: WpCtx, entries: EntryDoc[], box: NetIncomeBox, wpRef: string): any[] {
  const out: any[] = [headerBlock(ctx, "Adjusting and reclass journal entries", wpRef),
    { text: `Period: ${monthDayYear(ctx.yearStart)} to ${monthDayYear(ctx.yearEnd)}`, color: C.grey, fontSize: 9.5, margin: [6, 0, 0, 10] }];
  if (!entries.length) out.push({ text: "No entries.", fontSize: 9, margin: [22, 0, 0, 10] });
  for (const e of entries) {
    const dr = e.lines.filter((l) => l.cents > 0).reduce((n, l) => n + l.cents, 0);
    const cell = (t: string, extra: any = {}) => ({ text: t, border: NO, ...extra });
    const colHead = (t: string, right = false) => ({ text: t, bold: true, color: C.grey, alignment: right ? "right" : "left", border: [false, false, false, true], fontSize: 8.5 });
    const body: any[] = [
      [{ text: [{ text: e.no.split(" ")[0], bold: true, color: C.navy }, { text: `   ${e.kind}`, bold: true, color: C.navy }], colSpan: 2, fillColor: C.band, border: NO, fontSize: 9.5 }, {},
        { text: `W/P ref: ${e.wpRef}`, colSpan: 3, alignment: "right", color: C.grey, fillColor: C.band, border: NO, fontSize: 9 }, {}, {}],
      [colHead("Date"), colHead("Account"), colHead("Account name"), colHead("Debit", true), colHead("Credit", true)],
      ...e.lines.map((l) => [cell(ctx.yearEnd), cell(l.number), cell(l.name), cell(l.cents > 0 ? money(l.cents) : "", { alignment: "right" }), cell(l.cents < 0 ? money(-l.cents) : "", { alignment: "right" })]),
      [cell(""), cell(""), cell("Total", { bold: true }), { text: money(dr), alignment: "right", bold: true, border: TOP }, { text: money(dr), alignment: "right", bold: true, border: TOP }],
      [{ text: [{ text: "Memo: ", italics: true }, { text: e.memo }], colSpan: 5, border: NO, fontSize: 8.5 }, {}, {}, {}, {}],
    ];
    const inner = { table: { widths: [70, 56, "*", 82, 82], body },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0, hLineColor: (i: number) => (i === 2 ? C.border : C.ink),
        paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 3.2, paddingBottom: () => 3.2 }, fontSize: 9 };
    // Each entry sits in a light box, as on the reference.
    out.push({ margin: [22, 0, 22, 9], unbreakable: true, table: { widths: ["*"], body: [[inner]] },
      layout: { hLineWidth: () => 0.6, vLineWidth: () => 0.6, hLineColor: () => C.border, vLineColor: () => C.border, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 } });
  }
  out.push(netIncomeBoxBlock(box));
  return out;
}

// The whole document: landscape letter, the stamp on every page, and the footer.
export function wpDocument(ctx: WpCtx, sections: any[][]): any {
  const content: any[] = [];
  sections.forEach((s, i) => { if (i > 0) content.push({ text: "", pageBreak: "before" }); content.push(...s); });
  return {
    pageSize: "LETTER", pageOrientation: "landscape", pageMargins: [43, 50, 43, 40],
    defaultStyle: { font: "Helvetica", fontSize: 9, color: C.ink },
    header: { text: ctx.stamp.toUpperCase(), alignment: "center", bold: true, fontSize: 7.5, color: C.red, margin: [0, 20, 0, 0], characterSpacing: 0.2 },
    footer: (cur: number) => ({ columns: [{ text: `${ctx.client} · ${ctx.packageName} · Generated ${ctx.generated}`, fontSize: 7, color: C.grey },
      { text: `Page ${cur}`, alignment: "right", fontSize: 7, color: C.grey, width: 60 }], margin: [36, 14, 36, 0] }),
    content,
  };
}
