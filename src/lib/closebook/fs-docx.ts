// Step 9, the year-end package as Word, for the reviewer only (round 11): for a rare hand edit. A port of
// Appendix C's own scripts (render_fs.js, render_mal.js, render_lawyer.js) with the same docx library,
// the same styles and the same wording (fs-text.ts). The client gets the PDF.
import { AlignmentType, BorderStyle, Document, Footer, Header, ImageRun, LevelFormat, Packer, PageBreak, PageNumber, Paragraph, Table, TableCell, TableRow, TabStopType, TextRun, WidthType } from "docx";
import { n, type FsModel, type FsRow } from "./fs-model.ts";
import { addressLines, CONFIDENTIAL, DRAFT, FIRM, FIRM_ADDRESS, FIRM_FOOTER, lawyerGroups, lawyerRows, malParagraphs, money, noteBlocks, reportParagraphs, UNAUDITED, type Lawyer } from "./fs-text.ts";
import type { FsCtx } from "./fs-pdf.ts";

const F = "Arial", SZ = 18;
const t = (s: string, o: { bold?: boolean; it?: boolean; size?: number; color?: string } = {}) => new TextRun({ text: s, font: F, size: o.size || SZ, bold: o.bold, italics: o.it, color: o.color });
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NB = { top: none, bottom: none, left: none, right: none };
const PAGE = { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1440, right: 1440 } } };
const png = (dataUrl: string) => Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
const draftHeader = (draft: boolean) => (draft ? { default: new Header({ children: [new Paragraph({ children: [t(DRAFT, { bold: true, size: 16, color: "C00000" })] })] }) } : undefined);

type CellOpts = { top?: boolean; dbl?: boolean; under?: boolean; right?: boolean; center?: boolean; indent?: boolean; bold?: boolean };
function statementTable(m: FsModel) {
  const W = m.hasPrior ? [5460, 600, 1650, 1650] : [6660, 600, 2100];
  const cell = (text: string, w: number, o: CellOpts = {}) => {
    const b = { ...NB } as Record<string, unknown>;
    if (o.top) b.top = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    if (o.dbl) b.bottom = { style: BorderStyle.DOUBLE, size: 6, color: "000000" };
    if (o.under) b.bottom = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
    return new TableCell({ width: { size: w, type: WidthType.DXA }, borders: b, margins: { top: 20, bottom: 20, left: 60, right: 60 },
      children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : o.center ? AlignmentType.CENTER : AlignmentType.LEFT, indent: o.indent ? { left: 240 } : undefined, children: [t(text, { bold: o.bold })] })] });
  };
  const row = (cap: string, cur: number | string, pri: number | string, o: CellOpts & { note?: string; text?: boolean } = {}) => {
    const c = [cell(cap, W[0], { bold: o.bold, indent: o.indent }), cell(o.note || "", W[1], { center: true })];
    const vo = { right: true, bold: o.bold, top: o.top, dbl: o.dbl, under: o.under };
    c.push(cell(o.text ? String(cur) : n(cur as number), W[2], { ...vo, bold: o.bold || true }));
    if (m.hasPrior) c.push(cell(o.text ? String(pri) : n(pri as number), W[3], vo));
    return new TableRow({ children: c });
  };
  const blank = () => row("", "", "", { text: true });
  const hdr = () => row("", m.y, m.py, { text: true, bold: true, under: true });
  const dollar = (cap: string) => row(cap, "$", "$", { text: true, bold: true });
  const S = (rs: { cur: number; pri: number }[], k: "cur" | "pri") => rs.reduce((a, r) => a + r[k], 0);
  const tbl = (rows: TableRow[]) => new Table({ width: { size: W.reduce((a, b) => a + b), type: WidthType.DXA }, columnWidths: W, rows });
  const section = (label: string, rs: FsRow[], tot: string) => [row(label, "", "", { text: true, bold: true }), ...rs.map((x) => row(x.cap, x.cur, x.pri, { indent: true, note: x.note || "" })),
    row(tot, S(rs, "cur"), S(rs, "pri"), { bold: true, top: true })];
  return { row, blank, hdr, dollar, S, tbl, section };
}
function title(m: FsModel, sub: string, line: string) {
  return [new Paragraph({ alignment: AlignmentType.RIGHT, children: [t(m.name, { bold: true, size: 22 })] }), new Paragraph({ alignment: AlignmentType.RIGHT, children: [t(sub, { bold: true, size: 20 })] }),
    new Paragraph({ alignment: AlignmentType.RIGHT, children: [t(line, { it: true })] }), new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { after: 200 }, children: [t(UNAUDITED, { it: true, size: 15 })] })];
}

export async function packageDocx(m: FsModel, ctx: FsCtx, letterhead: string): Promise<Buffer> {
  const T = statementTable(m), b = m.bs, I = m.is;
  let bs = [T.hdr(), T.dollar("ASSETS"), ...T.section("CURRENT ASSETS", b.ca, "TOTAL CURRENT ASSETS")];
  if (b.nca.length) bs = bs.concat([T.blank()], T.section("NON-CURRENT ASSETS", b.nca, "TOTAL NON-CURRENT ASSETS"));
  const A = b.ca.concat(b.nca), L = b.cl.concat(b.ncl);
  bs.push(T.row("TOTAL ASSETS", T.S(A, "cur"), T.S(A, "pri"), { bold: true, dbl: true }), T.blank(), T.row("LIABILITIES", "", "", { text: true, bold: true }));
  bs = bs.concat(T.section("CURRENT LIABILITIES", b.cl, "TOTAL CURRENT LIABILITIES"));
  if (b.ncl.length) bs = bs.concat([T.blank()], T.section("NON-CURRENT LIABILITIES", b.ncl, "TOTAL NON-CURRENT LIABILITIES"));
  bs.push(T.row("TOTAL LIABILITIES", T.S(L, "cur"), T.S(L, "pri"), { bold: true, top: true }), T.blank());
  bs = bs.concat(T.section("SHAREHOLDERS' EQUITY", b.eq, "TOTAL EQUITY"));
  bs.push(T.blank(), T.row("TOTAL LIABILITIES AND SHAREHOLDERS' EQUITY", T.S(L, "cur") + T.S(b.eq, "cur"), T.S(L, "pri") + T.S(b.eq, "pri"), { bold: true, dbl: true }));

  let is = [T.hdr(), T.dollar(""), ...T.section("REVENUE", I.rev, "TOTAL REVENUE")];
  let gp = T.S(I.rev, "cur"), gpp = T.S(I.rev, "pri");
  if (I.cos.length) { is = is.concat([T.blank()], T.section("COST OF SALES", I.cos, "TOTAL COST OF SALES")); gp -= T.S(I.cos, "cur"); gpp -= T.S(I.cos, "pri"); is.push(T.row("GROSS PROFIT", gp, gpp, { bold: true })); }
  is = is.concat([T.blank()], T.section("EXPENSES", I.exp, "TOTAL EXPENSES"));
  is.push(T.blank(), T.row("INCOME BEFORE INCOME TAXES", gp - T.S(I.exp, "cur"), gpp - T.S(I.exp, "pri"), { bold: true }), T.row("Provision for income taxes", I.tax.cur, I.tax.pri, { indent: true }),
    T.row("NET INCOME (LOSS)", I.ni.cur, I.ni.pri, { bold: true, top: true }), T.blank(), T.row("RETAINED EARNINGS, BEGINNING OF PERIOD", I.reOpen.cur, I.reOpen.pri, { bold: true }));
  if (I.ppa.cur || I.ppa.pri) is.push(T.row(`Prior period adjustment (Note ${m.notes.ppa?.n ?? 2})`, I.ppa.cur, I.ppa.pri, { indent: true }), T.row("As restated", I.reOpen.cur + I.ppa.cur, I.reOpen.pri + I.ppa.pri, { top: true }));
  is.push(T.row("Net income (loss)", I.ni.cur, I.ni.pri, { indent: true }));
  if (I.other.cur || I.other.pri) is.push(T.row("Other items", I.other.cur, I.other.pri, { indent: true }));
  if (I.div.cur || I.div.pri) is.push(T.row("Dividends", -I.div.cur, -I.div.pri, { indent: true }));
  is.push(T.row("RETAINED EARNINGS, END OF PERIOD", I.reClose.cur, I.reClose.pri, { bold: true, top: true, dbl: true }));

  const para = (s: string) => new Paragraph({ spacing: { after: 120 }, children: [t(s)] });
  const h = (s: string) => new Paragraph({ spacing: { before: 200, after: 80 }, children: [t(s, { bold: true })] });
  const bullet = (s: string) => new Paragraph({ numbering: { reference: "b", level: 0 }, children: [t(s)] });
  const nt: (Paragraph | Table)[] = [];
  for (const blk of noteBlocks(m)) {
    nt.push(h(blk.heading), ...blk.paras.map(para), ...(blk.bullets ?? []).map(bullet));
    if (blk.table) {
      const rs = blk.table === "shareholder" ? m.notes.shareholder!.rows : m.notes.related!.rows;
      nt.push(T.tbl([T.hdr(), T.dollar(""), ...rs.map((x) => T.row(x.cap, x.cur, x.pri, { indent: true })), T.row("", T.S(rs, "cur"), T.S(rs, "pri"), { bold: true, top: true, dbl: true })]));
    }
  }
  const [street, city] = addressLines(m);
  const pr = (runs: TextRun[], o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {}) => new Paragraph({ alignment: o.align ?? AlignmentType.JUSTIFIED, spacing: { after: o.after ?? 160, line: 276 }, children: runs });
  const paras = reportParagraphs(m);
  const report = [new Paragraph({ children: [new ImageRun({ type: "png", data: png(letterhead), transformation: { width: 624, height: 93 } })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 360, after: 360 }, children: [t("COMPILATION ENGAGEMENT REPORT", { bold: true, size: 24 })] }),
    pr([t(ctx.reportDate)], { align: AlignmentType.LEFT, after: 240 }), pr([t(ctx.officer.name)], { align: AlignmentType.LEFT, after: 0 }), pr([t(m.name)], { align: AlignmentType.LEFT, after: 0 }),
    pr([t(street)], { align: AlignmentType.LEFT, after: 0 }), pr([t(city)], { align: AlignmentType.LEFT, after: 240 }), pr([t(`To Management of ${m.name}`)], { align: AlignmentType.LEFT, after: 240 }),
    ...paras.map((runs, i) => pr(runs.map((r) => t(r.text, { bold: r.bold })), { after: i === paras.length - 1 ? 600 : 160 })),
    pr([t(FIRM, { bold: true, color: "1A3C7C" })], { align: AlignmentType.RIGHT, after: 0 }), pr([t("Chartered Professional Accountants", { it: true })], { align: AlignmentType.RIGHT, after: 0 }),
    pr([t("Kitchener, Ontario", { it: true })], { align: AlignmentType.RIGHT, after: 0 })];
  const footer = new Footer({ children: [new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 6, color: "86BC26", space: 4 } }, tabStops: [{ type: TabStopType.RIGHT, position: 9360 }],
    children: [t(CONFIDENTIAL, { it: true, size: 14, color: "666666" }), new TextRun({ children: ["\tPage ", PageNumber.CURRENT], font: F, size: 14, color: "666666" })] }),
    new Paragraph({ children: [t(FIRM_FOOTER, { size: 14, color: "888888" })] })] });
  const pb = () => new Paragraph({ children: [new PageBreak()] });
  const cover = [...Array(12)].map(() => new Paragraph({ children: [] })).concat([new Paragraph({ alignment: AlignmentType.CENTER, children: [t(m.name, { bold: true, size: 32 })] }), new Paragraph({ children: [] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [t("Compiled Financial Information", { bold: true, size: 24 })] }), new Paragraph({ alignment: AlignmentType.CENTER, children: [t(m.period, { it: true, size: 20 })] })]);
  const doc = new Document({ numbering: { config: [{ reference: "b", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
    styles: { default: { document: { run: { font: F, size: SZ } } } },
    sections: [{ properties: PAGE, headers: draftHeader(ctx.draft), footers: { default: footer },
      children: [...cover, pb(), ...report, pb(), ...title(m, "Balance Sheet", m.asat), T.tbl(bs), pb(), ...title(m, "Statement of Earnings and Retained Earnings", m.period), T.tbl(is), pb(),
        ...title(m, "Notes to the Compiled Financial Information", m.period), ...nt] }] });
  return Packer.toBuffer(doc);
}

export async function malDocx(m: FsModel, ctx: FsCtx): Promise<Buffer> {
  const T = (s: string, o: { bold?: boolean; size?: number } = {}) => new TextRun({ text: s, font: F, size: o.size || 20, bold: o.bold });
  const p = (runs: TextRun[] | string, o: { after?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; line?: boolean } = {}) => new Paragraph({ spacing: { after: o.after ?? 160, line: 276 }, alignment: o.align ?? AlignmentType.LEFT,
    border: o.line ? { top: { style: BorderStyle.SINGLE, size: 6, color: "000000", space: 4 } } : undefined, children: Array.isArray(runs) ? runs : [T(runs)] });
  const [street, city] = addressLines(m);
  const [a, b] = malParagraphs(m);
  const body = [p([T(m.name, { bold: true, size: 24 })], { after: 0 }), p(street, { after: 0 }), p(city, { after: 360 }),
    p([T("Management Responsibility Acknowledgement", { bold: true, size: 24 })], { align: AlignmentType.CENTER, after: 360 }), p(ctx.reportDate, { after: 240 }),
    p(FIRM, { after: 0 }), p(FIRM_ADDRESS[0], { after: 0 }), p(FIRM_ADDRESS[1], { after: 240 }), p(`To: ${FIRM}`, { after: 240 }),
    p(a, { align: AlignmentType.JUSTIFIED }), p(b, { align: AlignmentType.JUSTIFIED, after: 480 }), p("Yours truly,", { after: 960 }),
    p(ctx.officer.name, { line: true, after: 0 }), p(m.name, { after: 0 }), p(ctx.officer.position, { after: 240 }), p(`Date: ${ctx.reportDate}`)];
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: F, size: 20 } } } }, sections: [{ properties: PAGE, headers: draftHeader(ctx.draft), children: body }] }));
}

export async function lawyerDocx(m: FsModel, ctx: FsCtx, l: Lawyer, letterhead: string): Promise<Buffer> {
  const T = (s: string, o: { bold?: boolean } = {}) => new TextRun({ text: s, font: F, size: 20, bold: o.bold });
  const p = (runs: TextRun[] | string, after = 160) => new Paragraph({ spacing: { after }, children: Array.isArray(runs) ? runs : [T(runs)] });
  const bd = { style: BorderStyle.SINGLE, size: 4, color: "999999" }, B = { top: bd, bottom: bd, left: bd, right: bd };
  const cell = (s: string, w: number, o: { head?: boolean; right?: boolean } = {}) => new TableCell({ width: { size: w, type: WidthType.DXA }, borders: B, shading: o.head ? { fill: "E8EDF5", type: "clear", color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 }, children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [T(s, { bold: o.head })] })] });
  const tbl = (W: number[], rows: string[][], rc = -1) => new Table({ width: { size: W.reduce((a, b) => a + b), type: WidthType.DXA }, columnWidths: W,
    rows: rows.map((r, i) => new TableRow({ children: r.map((c, j) => cell(c, W[j], { head: i === 0, right: i > 0 && j === rc })) })) });
  const [street, city] = addressLines(m);
  const body: (Paragraph | Table)[] = [new Paragraph({ children: [new ImageRun({ type: "png", data: png(letterhead), transformation: { width: 624, height: 93 } })] }),
    p(" "), p(ctx.reportDate, 240), p(ctx.officer.name, 0), p(m.name, 0), p(street, 0), p(city, 240), p(`Dear ${ctx.officer.name},`, 240), p([T(`Re: ${m.name} minute book`, { bold: true })]),
    p("This letter lists the information needed to update the corporation's minute book for the year. Please forward a copy to your lawyer."),
    p([T("Summary of key information", { bold: true })]), tbl([4200, 5160], [["Item", "Detail"], ...lawyerRows(m, ctx.reportDate, l)]), p(" ")];
  for (const [h, ds] of lawyerGroups(l)) {
    if (!ds.length) continue;
    body.push(p([T(h, { bold: true })]), tbl([2600, 2000, 2380, 2380], [["Share class", "Total dividend", "Date declared", "Date paid"], ...ds.map((d) => [d.cls, money(d.amount), d.declared, d.paid])], 1), p(" "));
  }
  body.push(p([T("Request for minutes", { bold: true })]), p("Please ask your lawyer to send us a copy of any signed resolutions prepared from this letter."),
    p("If you have questions, email contact@conceptaccounting.ca or call 226-789-9591.", 360), p("Yours truly,", 720), p([T("Hashim Awad, CPA", { bold: true })], 0), p(FIRM));
  return Packer.toBuffer(new Document({ styles: { default: { document: { run: { font: F, size: 20 } } } }, sections: [{ properties: PAGE, headers: draftHeader(ctx.draft), children: body }] }));
}
