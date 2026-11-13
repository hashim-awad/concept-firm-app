// A small Excel (.xlsx) writer for the report exports: one sheet, text and number cells, bold rows, an
// indent, and amounts in the accounting format with brackets. No outside library (the same ZIP writer
// as the full export). Amounts arrive in cents and are written as dollars, so Excel can add them up.
import { ZipWriter } from "../export/zip.ts";
import type { ReportTable } from "./report-table.ts";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i: number) => { let s = ""; for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };

// Styles: 0 plain, 1 bold, 2 amount, 3 bold amount, 4 red bold (the stamp), 5 indented, 6 indented twice, 7 title.
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00;(#,##0.00);&quot;–&quot;"/></numFmts>
<fonts count="4"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFB3261E"/><name val="Arial"/></font><font><b/><sz val="14"/><name val="Arial"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border/></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="8">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment indent="2"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
</styleSheet>`;

export function reportXlsx(t: ReportTable, head: string[], stamp: string): Buffer {
  const lines: string[] = [];
  let r = 0;
  const text = (c: number, v: string, s: number) => `<c r="${col(c)}${r}" t="inlineStr" s="${s}"><is><t xml:space="preserve">${esc(v)}</t></is></c>`;
  const num = (c: number, v: number, s: number) => `<c r="${col(c)}${r}" s="${s}"><v>${(v / 100).toFixed(2)}</v></c>`;
  const row = (cells: string[]) => lines.push(`<row r="${r}">${cells.join("")}</row>`);
  r++; row([text(0, t.title, 7)]);
  for (const h of head) { r++; row([text(0, h, 0)]); }
  r++; row([text(0, stamp, 4)]);
  r++;
  r++; row(t.columns.map((c, i) => text(i, c, 1)));
  for (const x of t.rows) {
    r++;
    row(x.cells.map((v, i) => v === null || v === "" ? "" : typeof v === "number" && t.numeric[i] ? num(i, v, x.bold ? 3 : 2)
      : text(i, String(v), x.bold ? 1 : i === 0 && x.indent ? 4 + x.indent : 0)));
  }
  const widths = t.columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${t.numeric[i] ? 16 : i === 0 && t.columns.length <= 3 ? 56 : t.columns[i] === "Description" || t.columns[i] === "Account" ? 44 : 14}" customWidth="1"/>`).join("");
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${widths}</cols><sheetData>${lines.join("")}</sheetData>
<headerFooter><oddHeader>&amp;C&amp;"Arial,Bold"&amp;K B3261E${esc(stamp)}</oddHeader></headerFooter></worksheet>`;
  const chunks: Buffer[] = [];
  const z = new ZipWriter((c) => chunks.push(Buffer.from(c)));
  z.add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  z.add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  z.add("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(t.title.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  z.add("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  z.add("xl/styles.xml", STYLES);
  z.add("xl/worksheets/sheet1.xml", sheet);
  z.finish();
  return Buffer.concat(chunks);
}
