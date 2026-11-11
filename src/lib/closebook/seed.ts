// Closebook's reference data from the Phase 3 batch appendices (docs/phase3/):
// A: GIFI-Concept-RC4088-Rev23.csv (404 GIFI codes); B: Closebook-master-lines-APPROVED.xlsx
// (419 master lines, 11 tax codes, 20 lead sheets). Pure: reads the files' contents, returns rows.
// scripts/gen-closebook-seed.ts writes them into the migration; a test checks they still match.
import { readXlsx, type Cell } from "./xlsx.ts";

export type GifiCode = { code: string; name: string; section: string; generic: boolean; required: boolean; description: string };
export type TaxCode = { code: string; name: string; schedule1: string; usedFor: string; sort: number };
export type LeadSheet = { code: string; name: string; sort: number };
export type MasterLine = {
  line: string; name: string; gifi: string; gifiName: string; section: string; type: string; leadSheet: string | null;
  statementLine: string | null; taxCode: string | null; mappable: boolean; pair: string | null; required: boolean; note: string; sort: number;
};

// Today's year-end package captions (Appendix C, scripts/build_model.py CAP). Batch section 6: the
// caption overrides now live on the master lines' statement line, so clients see no change in wording.
// Applied to every line that shares the GIFI code's statement line; 1000 covers the merged cash codes.
export const PACKAGE_CAPTIONS: Record<string, string> = {
  "1000": "Cash and cash equivalents", "1060": "Accounts receivable", "1062": "Allowance for doubtful accounts", "1480": "Prepaid expenses and deposits",
  "2620": "Accounts payable and accrued liabilities", "2680": "Income taxes payable", "3260": "Due to shareholder", "2780": "Due to shareholder",
  "3500": "Share capital", "8000": "Revenue", "8523": "Meals and entertainment", "8690": "Insurance", "8715": "Interest and bank charges",
  "8810": "Office expenses", "9060": "Salaries and wages", "9225": "Telecommunications", "9281": "Vehicle", "8520": "Advertising", "8860": "Professional fees",
  "8910": "Rent", "9270": "Other expenses", "8670": "Amortization",
};

// A small CSV reader (quoted fields, commas and new lines inside quotes).
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], f = "", q = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

const str = (c: Cell) => (c === null || c === undefined ? "" : String(c).trim());
const yes = (c: Cell) => str(c).toLowerCase() === "yes";
const leadCode = (s: string) => s.split(" ")[0];

export function gifiFromCsv(text: string): GifiCode[] {
  const [head, ...rows] = parseCsv(text);
  const i = (k: string) => head.indexOf(k);
  return rows.map((r) => ({
    code: r[i("gifi_code")].trim(), name: r[i("gifi_name")].trim(), section: r[i("section")].trim(),
    generic: r[i("generic_item")].trim() === "Yes", required: r[i("required_in_every_gifi")].trim() === "Yes", description: r[i("cra_description")].trim(),
  }));
}

export function fromWorkbook(data: Uint8Array): { lines: MasterLine[]; taxCodes: TaxCode[]; leadSheets: LeadSheet[] } {
  const sheets = readXlsx(data);
  const sheet = (n: string) => sheets.find((s) => s.name === n)?.rows ?? [];
  const taxCodes = sheet("Tax codes").slice(1).filter((r) => str(r[0])).map((r, k) => ({ code: str(r[0]), name: str(r[1]), schedule1: str(r[2]), usedFor: str(r[3]), sort: k + 1 }));
  const leadSheets = sheet("Lead sheets").slice(1).filter((r) => str(r[0])).map((r, k) => {
    const full = str(r[0]);
    return { code: leadCode(full), name: full.slice(leadCode(full).length + 1), sort: k + 1 };
  });
  const raw = sheet("Master lines").slice(1).filter((r) => str(r[0]));
  const lines: MasterLine[] = raw.map((r, k) => {
    const lead = str(r[6]), tax = str(r[8]), stmt = str(r[7]);
    return {
      line: str(r[0]), name: str(r[1]), gifi: str(r[2]), gifiName: str(r[3]), section: str(r[4]), type: str(r[5]),
      leadSheet: lead && lead !== "n/a" ? leadCode(lead) : null, statementLine: stmt && stmt !== "n/a" ? stmt : null,
      taxCode: tax && tax !== "n/a" ? tax : null, mappable: yes(r[9]), pair: str(r[10]) || null, required: yes(r[11]), note: str(r[12]), sort: k + 1,
    };
  });
  // Today's package captions, on the statement lines they belong to.
  for (const [code, caption] of Object.entries(PACKAGE_CAPTIONS)) {
    const main = lines.find((l) => l.line === `${code}.00`);
    if (!main?.statementLine) continue;
    const from = main.statementLine;
    for (const l of lines) {
      const n = Number(l.gifi);
      const inBlock = code === "1000" ? n >= 1000 && n <= 1059 : l.gifi === code;
      if (inBlock && l.statementLine === from) l.statementLine = caption;
    }
  }
  return { lines, taxCodes, leadSheets };
}

// SQL literal.
const q = (v: string | null) => (v === null ? "null" : `'${v.replace(/'/g, "''")}'`);
const b = (v: boolean) => (v ? "true" : "false");

export function seedSql(gifi: GifiCode[], wb: ReturnType<typeof fromWorkbook>): string {
  const out: string[] = [];
  out.push(`insert into public.cb_gifi_versions (id, label, source, is_current) values ('rc4088-rev23', 'RC4088 Rev. 23 (Aug 23, 2023)', 'docs/phase3/GIFI-Concept-RC4088-Rev23.csv', true);`);
  out.push(`insert into public.cb_gifi_codes (version_id, code, name, section, generic, required, description) values\n` +
    gifi.map((g) => `  ('rc4088-rev23', ${q(g.code)}, ${q(g.name)}, ${q(g.section)}, ${b(g.generic)}, ${b(g.required)}, ${q(g.description)})`).join(",\n") + ";");
  out.push(`insert into public.cb_tax_codes (code, name, schedule1_effect, used_for, sort_order) values\n` +
    wb.taxCodes.map((t) => `  (${q(t.code)}, ${q(t.name)}, ${q(t.schedule1)}, ${q(t.usedFor)}, ${t.sort})`).join(",\n") + ";");
  out.push(`insert into public.cb_lead_sheets (code, name, sort_order) values\n` +
    wb.leadSheets.map((l) => `  (${q(l.code)}, ${q(l.name)}, ${l.sort})`).join(",\n") + ";");
  out.push(`insert into public.cb_master_lines (line_no, name, gifi_code, gifi_name, section, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, required_gifi, note, sort_order) values\n` +
    wb.lines.map((l) => `  (${q(l.line)}, ${q(l.name)}, ${q(l.gifi)}, ${q(l.gifiName)}, ${q(l.section)}, ${q(l.type)}, ${q(l.leadSheet)}, ${q(l.statementLine)}, ${q(l.taxCode)}, ${b(l.mappable)}, ${q(l.pair)}, ${b(l.required)}, ${q(l.note)}, ${l.sort})`).join(",\n") + ";");
  return out.join("\n\n");
}
