// Piece 8: the Shareholder loans Excel file (mock K). One sheet, "Shareholder loans": the working paper header lines,
// the Summary (two or more accounts), then one block per account. Every amount is a number with two decimals and
// brackets for negatives; each closing balance and the Summary's columns and totals are formulas giving the same
// figures as the screen (the computed value is stored too, so the file reads right before Excel recalculates).
import { ZipWriter } from "../export/zip.ts";
import { hfText } from "./xlsx-hf.ts";
import { cardTitle, openingLabel, type ShCard, type ShReport } from "./sh-report.ts";
// As mock K: dates as YYYY-MM-DD, and the result line without the amount (the amount is the closing balance above it).
const atYearEnd = (c: ShCard) => (c.owedBy ? `Owed by the shareholder · repay by ${c.dueOn}` : "Owed to the shareholder");
const result = (c: ShCard) => `${c.owedBy ? `Owed by the shareholder at year-end. Repay by ${c.dueOn}.` : "Owed to the shareholder at year-end."}${c.tied ? " Ties to the trial balance." : ""}`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const COLS = ["A", "B", "C", "D", "E"];
// Styles: 0 plain, 1 bold, 2 amount, 3 bold amount, 4 red bold stamp, 5 navy bold (client), 6 table head, 7 table head right,
// 8 bold, double underline, 9 bold amount, double underline, 10 plain right, 11 large bold (report name).
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00);&quot;–&quot;"/></numFmts>
<fonts count="6"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFB3261E"/><name val="Arial"/></font>
<font><b/><sz val="11"/><color rgb="FF1E3A8A"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="11"/><name val="Arial"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><top style="thin"/><bottom style="double"/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

type Cell = { t: string; s: number } | { n: number; s: number; f?: string } | null;

export function shReportXlsx(r: ShReport, h: { client: string; yearEnd: string; preparedBy: string; reviewedBy: string; stamp: string }): Buffer {
  const rows: Cell[][] = [];
  const add = (cells: Cell[]) => { rows.push(cells); return rows.length; };
  const T = (t: string, s = 0): Cell => ({ t, s });
  const N = (cents: number, s = 2, f?: string): Cell => ({ n: cents / 100, s, f });
  const longEnd = (() => { const d = new Date(`${h.yearEnd}T12:00:00Z`); return `${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; })();
  add([T(h.stamp.toUpperCase(), 4)]);
  add([T(h.client, 5)]);
  add([T("Shareholder loans", 1)]);
  add([T(`Year end: ${longEnd}`)]);
  add([T("W/P ref: Shareholder loans"), T(`Prepared by: ${h.preparedBy}`), null, T(`Reviewed by: ${h.reviewedBy}`)]);
  add([]);
  // Each card's opening and closing cells, for the Summary's formulas.
  const at: { opening: number; closing: number }[] = [];
  let summaryFirst = 0;
  if (r.cards.length > 1) {
    add([T("Summary", 1)]);
    add([T("Account", 6), T("Opening", 7), T("Movement", 7), T("Closing", 7), T("At year-end", 6)]);
    summaryFirst = rows.length + 1;
    for (const c of r.cards) add([T(cardTitle(c)), null, null, null, T(atYearEnd(c))]);   // amounts filled once the cards are placed
    add([]);
    add([]);
  }
  for (const c of r.cards) {
    add([T(cardTitle(c), 1)]);
    add([T("Line", 6), T("Entry", 7), T("Amount", 7)]);
    const first = add([T(openingLabel(c)), null, N(c.openingCents)]);
    add([T("Paid to or for the shareholder"), null, N(c.paidToCents)]);
    add([T("Paid in by the shareholder"), null, N(c.paidInCents)]);
    if (c.booksCents !== null) add([T("Movement in the client's books"), null, N(c.booksCents)]);
    if (c.credited.length) for (const e of c.credited) add([T("Credited through entries"), T(e.no, 10), N(e.cents)]);
    else add([T("Credited through entries"), null, N(0)]);
    if (c.debited.length) for (const e of c.debited) add([T("Debited through entries"), T(e.no, 10), N(e.cents)]);
    else add([T("Debited through entries"), null, N(0)]);
    const last = rows.length;
    const closing = add([T("Closing balance", 8), T("", 8), N(c.closingCents, 9, `SUM(C${first}:C${last})`)]);
    add([T(result(c))]);
    add([]);
    at.push({ opening: first, closing });
  }
  if (summaryFirst) {
    r.cards.forEach((c, i) => {
      const row = rows[summaryFirst - 1 + i], n = summaryFirst + i;
      row[1] = N(c.openingCents, 2, `C${at[i].opening}`);
      row[2] = N(c.movementCents, 2, `D${n}-B${n}`);
      row[3] = N(c.closingCents, 2, `C${at[i].closing}`);
    });
    const lastRow = summaryFirst + r.cards.length - 1;
    rows[lastRow] = [T("Total", 8), N(r.total.openingCents, 9, `SUM(B${summaryFirst}:B${lastRow})`), N(r.total.movementCents, 9, `SUM(C${summaryFirst}:C${lastRow})`),
      N(r.total.closingCents, 9, `SUM(D${summaryFirst}:D${lastRow})`), T("", 8)];
  }
  const xml = rows.map((cells, i) => `<row r="${i + 1}">${cells.map((c, j) => {
    if (!c) return "";
    const ref = `${COLS[j]}${i + 1}`;
    if ("t" in c) return `<c r="${ref}" t="inlineStr" s="${c.s}"><is><t xml:space="preserve">${esc(c.t)}</t></is></c>`;
    return `<c r="${ref}" s="${c.s}">${c.f ? `<f>${c.f}</f>` : ""}<v>${c.n.toFixed(2)}</v></c>`;
  }).join("")}</row>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="56" customWidth="1"/><col min="2" max="2" width="18" customWidth="1"/>
<col min="3" max="4" width="16" customWidth="1"/><col min="5" max="5" width="44" customWidth="1"/></cols><sheetData>${xml}</sheetData>
<headerFooter><oddHeader>&amp;C&amp;"Arial,Bold"&amp;KB3261E${esc(hfText(h.stamp))}</oddHeader></headerFooter></worksheet>`;
  const chunks: Buffer[] = [];
  const z = new ZipWriter((c) => chunks.push(Buffer.from(c)));
  z.add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  z.add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Shareholder loans" sheetId="1" r:id="rId1"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>`);
  z.add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.add("xl/styles.xml", STYLES);
  z.add("xl/worksheets/sheet1.xml", sheet);
  z.finish();
  return Buffer.concat(chunks);
}
