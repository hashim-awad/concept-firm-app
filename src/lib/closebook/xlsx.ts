// A small Excel (.xlsx) reader: no outside library. An .xlsx file is a ZIP of XML files; this reads
// the workbook's sheet names, the shared strings and each sheet's cells, and returns each sheet as rows
// of plain values (text or number). Enough for trial balance exports and the master lines workbook:
// no formulas are evaluated (the saved value is used), no styles, no dates beyond the stored number.
import { inflateRawSync } from "node:zlib";

type Entry = { name: string; method: number; size: number; offset: number };

function entries(buf: Buffer): Entry[] {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("This is not an Excel (.xlsx) file.");
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("The Excel file is damaged.");
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    out.push({ name: buf.subarray(p + 46, p + 46 + nlen).toString("utf8"), method, size, offset: buf.readUInt32LE(p + 42) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

function read(buf: Buffer, e: Entry): string {
  const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
  const body = buf.subarray(start, start + e.size);
  return (e.method === 8 ? inflateRawSync(body) : body).toString("utf8");
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&");
// Text inside <t> elements (rich text has several runs).
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");

// Column letters to a 0-based index: A=0, Z=25, AA=26.
const col = (ref: string) => [...ref.replace(/\d+$/, "")].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

export function readXlsx(data: Uint8Array): Sheet[] {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const all = entries(buf);
  const file = (n: string) => { const e = all.find((x) => x.name === n); return e ? read(buf, e) : ""; };
  const shared = [...file("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rels = Object.fromEntries([...file("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [
    /Id="([^"]+)"/.exec(m[0])?.[1], /Target="([^"]+)"/.exec(m[0])?.[1]]));
  const sheets = [...file("xl/workbook.xml").matchAll(/<sheet\b[^>]*>/g)].map((m) => ({
    name: unxml(/name="([^"]*)"/.exec(m[0])?.[1] ?? ""), rid: /r:id="([^"]+)"/.exec(m[0])?.[1] ?? "" }));
  return sheets.map(({ name, rid }) => {
    const target = String(rels[rid] ?? "").replace(/^\/?(xl\/)?/, "");
    const xml = file(`xl/${target}`);
    const rows: Cell[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const rn = Number(/r="(\d+)"/.exec(r[1])?.[1] ?? rows.length + 1) - 1;
      const row: Cell[] = [];
      for (const c of r[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = c[1], inner = c[2] ?? "";
        const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
        const i = ref ? col(ref) : row.length;
        const t = /t="([^"]+)"/.exec(attrs)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        let val: Cell = null;
        if (t === "s" && v !== undefined) val = shared[Number(v)] ?? "";
        else if (t === "inlineStr") val = texts(inner);
        else if (t === "str" || t === "e") val = v !== undefined ? unxml(v) : "";
        else if (t === "b") val = v === "1" ? "TRUE" : "FALSE";
        else if (v !== undefined) val = Number(v);
        while (row.length < i) row.push(null);
        row[i] = val;
      }
      rows[rn] = row;
    }
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    return { name, rows };
  });
}
