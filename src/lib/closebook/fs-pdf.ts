// Step 9, the year-end package as PDF for the client (round 11). The layout of Appendix C's Word files
// (render_fs.js, render_mal.js, render_lawyer.js), converted unit for unit: letter size, margins 0.75 in
// top and bottom and 1 in each side, Arial 9 pt (Helvetica here, the same metrics), the same spacing,
// rules, header and footer. Pure: builds pdfmake definitions. Client documents carry the firm's name.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { n, type FsModel, type FsRow } from "./fs-model.ts";
import { addressLines, CONFIDENTIAL, DRAFT, FIRM, FIRM_ADDRESS, FIRM_FOOTER, lawyerGroups, lawyerRows, malParagraphs, money, noteBlocks, reportParagraphs, UNAUDITED, type Lawyer } from "./fs-text.ts";

export type FsCtx = { draft: boolean; reportDate: string; officer: { name: string; position: string } };
const PAGE = { pageSize: "LETTER", pageMargins: [72, 54, 72, 54] as number[] };
const BLACK = "#000000";

const header = (draft: boolean) => (draft ? () => ({ text: DRAFT, bold: true, fontSize: 8, color: "#C00000", margin: [72, 36, 72, 0] }) : undefined);
const footer = () => (cur: number) => ({ margin: [72, 8, 72, 0], stack: [
  { canvas: [{ type: "line", x1: 0, y1: 0, x2: 468, y2: 0, lineWidth: 0.75, lineColor: "#86BC26" }] },
  { columns: [{ text: CONFIDENTIAL, italics: true, fontSize: 7, color: "#666666" }, { text: `Page ${cur}`, alignment: "right", fontSize: 7, color: "#666666", width: 60 }], margin: [0, 3, 0, 0] },
  { text: FIRM_FOOTER, fontSize: 7, color: "#888888" }] });

// The statements' table: caption, note, this year (always bold), last year when there is one.
function statementTable(m: FsModel, rows: any[]) {
  const W = m.hasPrior ? [273, 30, 82.5, 82.5] : [333, 30, 105];
  return { table: { widths: W, body: rows }, layout: { defaultBorder: false, paddingLeft: () => 3, paddingRight: () => 3, paddingTop: () => 1, paddingBottom: () => 1 }, fontSize: 9 };
}
type RowOpts = { bold?: boolean; indent?: boolean; note?: string; top?: boolean; dbl?: boolean; under?: boolean; text?: boolean };
function row(m: FsModel, cap: string, cur: number | string, pri: number | string, o: RowOpts = {}): any[] {
  const val = (v: number | string, bold: boolean) => {
    const text = o.text ? String(v) : n(v as number);
    const cell: any = { text, alignment: "right", bold, border: [false, !!o.top, false, !!o.under], borderColor: [BLACK, BLACK, BLACK, BLACK] };
    // A double rule under a grand total: two thin lines under the figure.
    if (o.dbl) return { stack: [{ text, alignment: "right", bold }, { canvas: [{ type: "line", x1: 0, y1: 1, x2: 76, y2: 1, lineWidth: 0.5 }, { type: "line", x1: 0, y1: 3, x2: 76, y2: 3, lineWidth: 0.5 }], alignment: "right" }],
      border: [false, !!o.top, false, false] };
    return cell;
  };
  const out = [{ text: cap, bold: !!o.bold, margin: [o.indent ? 12 : 0, 0, 0, 0] }, { text: o.note ?? "", alignment: "center" }, val(cur, !!o.bold || true)];
  if (m.hasPrior) out.push(val(pri, !!o.bold));
  return out;
}
const blank = (m: FsModel) => row(m, "", "", "", { text: true });
const hdr = (m: FsModel) => row(m, "", m.y, m.py, { text: true, bold: true, under: true });
const dollar = (m: FsModel, cap: string) => row(m, cap, "$", "$", { text: true, bold: true });
const S = (rs: { cur: number; pri: number }[], k: "cur" | "pri") => rs.reduce((a, r) => a + r[k], 0);
function section(m: FsModel, label: string, rs: FsRow[], total: string) {
  return [row(m, label, "", "", { text: true, bold: true }), ...rs.map((x) => row(m, x.cap, x.cur, x.pri, { indent: true, note: x.note })),
    row(m, total, S(rs, "cur"), S(rs, "pri"), { bold: true, top: true })];
}
function title(m: FsModel, sub: string, line: string) {
  return [{ text: m.name, bold: true, fontSize: 11, alignment: "right" }, { text: sub, bold: true, fontSize: 10, alignment: "right" },
    { text: line, italics: true, fontSize: 9, alignment: "right" }, { text: UNAUDITED, italics: true, fontSize: 7.5, alignment: "right", margin: [0, 0, 0, 10] }];
}

export function balanceSheetRows(m: FsModel) {
  const b = m.bs;
  let bs: any[] = [hdr(m), dollar(m, "ASSETS"), ...section(m, "CURRENT ASSETS", b.ca, "TOTAL CURRENT ASSETS")];
  if (b.nca.length) bs = bs.concat([blank(m)], section(m, "NON-CURRENT ASSETS", b.nca, "TOTAL NON-CURRENT ASSETS"));
  const A = b.ca.concat(b.nca), L = b.cl.concat(b.ncl);
  bs.push(row(m, "TOTAL ASSETS", S(A, "cur"), S(A, "pri"), { bold: true, dbl: true }), blank(m), row(m, "LIABILITIES", "", "", { text: true, bold: true }));
  bs = bs.concat(section(m, "CURRENT LIABILITIES", b.cl, "TOTAL CURRENT LIABILITIES"));
  if (b.ncl.length) bs = bs.concat([blank(m)], section(m, "NON-CURRENT LIABILITIES", b.ncl, "TOTAL NON-CURRENT LIABILITIES"));
  bs.push(row(m, "TOTAL LIABILITIES", S(L, "cur"), S(L, "pri"), { bold: true, top: true }), blank(m));
  bs = bs.concat(section(m, "SHAREHOLDERS' EQUITY", b.eq, "TOTAL EQUITY"));
  bs.push(blank(m), row(m, "TOTAL LIABILITIES AND SHAREHOLDERS' EQUITY", S(L, "cur") + S(b.eq, "cur"), S(L, "pri") + S(b.eq, "pri"), { bold: true, dbl: true }));
  return bs;
}
export function earningsRows(m: FsModel) {
  const I = m.is;
  let is: any[] = [hdr(m), dollar(m, ""), ...section(m, "REVENUE", I.rev, "TOTAL REVENUE")];
  let gp = S(I.rev, "cur"), gpp = S(I.rev, "pri");
  if (I.cos.length) { is = is.concat([blank(m)], section(m, "COST OF SALES", I.cos, "TOTAL COST OF SALES")); gp -= S(I.cos, "cur"); gpp -= S(I.cos, "pri"); is.push(row(m, "GROSS PROFIT", gp, gpp, { bold: true })); }
  is = is.concat([blank(m)], section(m, "EXPENSES", I.exp, "TOTAL EXPENSES"));
  is.push(blank(m), row(m, "INCOME BEFORE INCOME TAXES", gp - S(I.exp, "cur"), gpp - S(I.exp, "pri"), { bold: true }),
    row(m, "Provision for income taxes", I.tax.cur, I.tax.pri, { indent: true }), row(m, "NET INCOME (LOSS)", I.ni.cur, I.ni.pri, { bold: true, top: true }), blank(m),
    row(m, "RETAINED EARNINGS, BEGINNING OF PERIOD", I.reOpen.cur, I.reOpen.pri, { bold: true }));
  if (I.ppa.cur || I.ppa.pri) is.push(row(m, `Prior period adjustment (Note ${m.notes.ppa?.n ?? 2})`, I.ppa.cur, I.ppa.pri, { indent: true }),
    row(m, "As restated", I.reOpen.cur + I.ppa.cur, I.reOpen.pri + I.ppa.pri, { top: true }));
  is.push(row(m, "Net income (loss)", I.ni.cur, I.ni.pri, { indent: true }));
  if (I.other.cur || I.other.pri) is.push(row(m, "Other items", I.other.cur, I.other.pri, { indent: true }));
  if (I.div.cur || I.div.pri) is.push(row(m, "Dividends", -I.div.cur, -I.div.pri, { indent: true }));
  is.push(row(m, "RETAINED EARNINGS, END OF PERIOD", I.reClose.cur, I.reClose.pri, { bold: true, top: true, dbl: true }));
  return is;
}
function notesContent(m: FsModel) {
  const out: any[] = [];
  for (const b of noteBlocks(m)) {
    out.push({ text: b.heading, bold: true, margin: [0, 10, 0, 4] });
    for (const p of b.paras) out.push({ text: p, margin: [0, 0, 0, 6] });
    if (b.bullets?.length) out.push({ ul: b.bullets, margin: [13.5, 0, 0, 6] });
    if (b.table) {
      const rs = b.table === "shareholder" ? m.notes.shareholder!.rows : m.notes.related!.rows;
      out.push(statementTable(m, [hdr(m), dollar(m, ""), ...rs.map((x) => row(m, x.cap, x.cur, x.pri, { indent: true })),
        row(m, "", S(rs, "cur"), S(rs, "pri"), { bold: true, top: true, dbl: true })]));
    }
  }
  return out;
}
const para = (runs: any, align = "justify", after = 8) => ({ text: runs, alignment: align, margin: [0, 0, 0, after], lineHeight: 1.15 });

export function packageDef(m: FsModel, ctx: FsCtx, letterhead: string): any {
  const cover = [{ text: "", margin: [0, 124, 0, 0] }, { text: m.name, bold: true, fontSize: 16, alignment: "center" }, { text: " ", fontSize: 9 },
    { text: "Compiled Financial Information", bold: true, fontSize: 12, alignment: "center" }, { text: m.period, italics: true, fontSize: 10, alignment: "center" }];
  const [street, city] = addressLines(m);
  const report = [{ image: "lh", width: 468 },
    { text: "COMPILATION ENGAGEMENT REPORT", bold: true, fontSize: 12, alignment: "center", margin: [0, 18, 0, 18] },
    para(ctx.reportDate, "left", 12), para(ctx.officer.name, "left", 0), para(m.name, "left", 0), para(street, "left", 0), para(city, "left", 12),
    para(`To Management of ${m.name}`, "left", 12),
    ...reportParagraphs(m).map((runs, i, all) => para(runs.map((r) => ({ text: r.text, bold: r.bold })), "justify", i === all.length - 1 ? 30 : 8)),
    para({ text: FIRM, bold: true, color: "#1A3C7C" }, "right", 0), para({ text: "Chartered Professional Accountants", italics: true }, "right", 0),
    para({ text: "Kitchener, Ontario", italics: true }, "right", 0)];
  return {
    ...PAGE, defaultStyle: { font: "Helvetica", fontSize: 9 }, images: { lh: letterhead }, header: header(ctx.draft), footer: footer(),
    content: [...cover, { text: "", pageBreak: "after" }, ...report, { text: "", pageBreak: "after" },
      ...title(m, "Balance Sheet", m.asat), statementTable(m, balanceSheetRows(m)), { text: "", pageBreak: "after" },
      ...title(m, "Statement of Earnings and Retained Earnings", m.period), statementTable(m, earningsRows(m)), { text: "", pageBreak: "after" },
      ...title(m, "Notes to the Compiled Financial Information", m.period), ...notesContent(m)],
  };
}

// The MAL: management's letter on plain paper, the corporation's name and address at the top.
export function malDef(m: FsModel, ctx: FsCtx): any {
  const [street, city] = addressLines(m);
  const p = (t: any, o: { align?: string; after?: number; line?: boolean } = {}) => ({ text: t, alignment: o.align ?? "left", margin: [0, 0, 0, o.after ?? 8], lineHeight: 1.15 });
  return {
    ...PAGE, defaultStyle: { font: "Helvetica", fontSize: 10 }, header: header(ctx.draft),
    content: [p({ text: m.name, bold: true, fontSize: 12 }, { after: 0 }), p(street, { after: 0 }), p(city, { after: 18 }),
      p({ text: "Management Responsibility Acknowledgement", bold: true, fontSize: 12 }, { align: "center", after: 18 }),
      p(ctx.reportDate, { after: 12 }), p(FIRM, { after: 0 }), p(FIRM_ADDRESS[0], { after: 0 }), p(FIRM_ADDRESS[1], { after: 12 }),
      p(`To: ${FIRM}`, { after: 12 }), p(malParagraphs(m)[0], { align: "justify" }), p(malParagraphs(m)[1], { align: "justify", after: 24 }),
      p("Yours truly,", { after: 48 }),
      { canvas: [{ type: "line", x1: 0, y1: 0, x2: 468, y2: 0, lineWidth: 0.6 }] }, p(ctx.officer.name, { after: 0 }), p(m.name, { after: 0 }), p(ctx.officer.position, { after: 12 }),
      p(`Date: ${ctx.reportDate}`)],
  };
}

// The minute book letter, on letterhead, signed Hashim Awad, CPA. Produced with or without dividends.
export function lawyerDef(m: FsModel, ctx: FsCtx, l: Lawyer, letterhead: string): any {
  const [street, city] = addressLines(m);
  const p = (t: any, after = 8) => ({ text: t, margin: [0, 0, 0, after] });
  const grid = (widths: number[], rows: string[][], right = -1) => ({ table: { widths, body: rows.map((r, i) => r.map((c, j) => ({ text: c, bold: i === 0, fillColor: i === 0 ? "#E8EDF5" : undefined, alignment: i > 0 && j === right ? "right" : "left" }))) },
    layout: { hLineColor: () => "#999999", vLineColor: () => "#999999", hLineWidth: () => 0.4, vLineWidth: () => 0.4, paddingTop: () => 3, paddingBottom: () => 3, paddingLeft: () => 5, paddingRight: () => 5 } });
  const content: any[] = [{ image: "lh", width: 468 }, p(" "), p(ctx.reportDate, 12), p(ctx.officer.name, 0), p(m.name, 0), p(street, 0), p(city, 12),
    p(`Dear ${ctx.officer.name},`, 12), p({ text: `Re: ${m.name} minute book`, bold: true }),
    p("This letter lists the information needed to update the corporation's minute book for the year. Please forward a copy to your lawyer."),
    p({ text: "Summary of key information", bold: true }), grid([210, 258], [["Item", "Detail"], ...lawyerRows(m, ctx.reportDate, l)]), p(" ")];
  for (const [h, ds] of lawyerGroups(l)) {
    if (!ds.length) continue;
    content.push(p({ text: h, bold: true }), grid([130, 100, 119, 119], [["Share class", "Total dividend", "Date declared", "Date paid"], ...ds.map((d) => [d.cls, money(d.amount), d.declared, d.paid])], 1), p(" "));
  }
  content.push(p({ text: "Request for minutes", bold: true }), p("Please ask your lawyer to send us a copy of any signed resolutions prepared from this letter."),
    p("If you have questions, email contact@conceptaccounting.ca or call 226-789-9591.", 18), p("Yours truly,", 36), p({ text: "Hashim Awad, CPA", bold: true }, 0), p(FIRM));
  return { ...PAGE, defaultStyle: { font: "Helvetica", fontSize: 10 }, images: { lh: letterhead }, header: header(ctx.draft), content };
}
