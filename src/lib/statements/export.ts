// Downloads of a statement read from a PDF (round 20, Hashim, Nov 15, 2026). Pure.
// One CSV (or Excel file) per account, in Concept's bank upload template (docs/phase3/Sample-bank-upload-TestCo.csv):
// Date, Description, Amount, signed as on upload (src/lib/closebook/bank-upload.ts): bank money in positive,
// card charges positive, payments negative. Several files go in one zip. Downloads refuse while the
// account's Difference is not 0.00.

import JSZip from "jszip";
import { reportXlsx } from "../closebook/xlsx-write.ts";
import type { ReportTable } from "../closebook/report-table.ts";
import { checkAccount, money } from "./checks.ts";
import { printedCents, signedCents, typeLabel, type ReadResult, type StatementAccount } from "./types.ts";

export type ExportFormat = "csv" | "xlsx";
export type ExportFile = { name: string; body: Uint8Array; contentType: string };

export const CONTENT_TYPE: Record<ExportFormat | "zip", string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

const amount = (c: number) => `${c < 0 ? "-" : ""}${Math.floor(Math.abs(c) / 100)}.${String(Math.abs(c) % 100).padStart(2, "0")}`;
const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// The CSV, with Windows line ends like the template. Lines in statement order.
export function accountCsv(acc: StatementAccount): string {
  // Round 28: a line with no effect on the balance is left out of the CSV (it would be counted twice on import).
  const rows = ["Date,Description,Amount", ...acc.lines.filter((l) => !l.noEffect).map((l) => [l.date, cell(l.description.replace(/\s+/g, " ").trim()), amount(signedCents(l))].join(","))];
  return rows.join("\r\n") + "\r\n";
}

// The Excel file: the statement details on top, then Date, Description, Amount (and the type, in words).
export function accountXlsx(acc: StatementAccount, bank: string): Uint8Array {
  const t: ReportTable = {
    title: [bank, acc.name, acc.last4 ? `ending ${acc.last4}` : ""].filter(Boolean).join(" "),
    columns: ["Date", "Description", "Type", "Amount"],
    numeric: [false, false, false, true],
    rows: acc.lines.map((l) => ({ cells: [l.date, l.description, l.noEffect ? "No effect on balance" : typeLabel(acc.kind, l.dir), l.noEffect ? printedCents(l) : signedCents(l)] })),
  };
  const head = [
    `Statement period: ${acc.periodStart} to ${acc.periodEnd}`,
    `Opening balance: ${money(acc.opening)}`,
    `Closing balance: ${money(acc.closing)}`,
  ];
  return new Uint8Array(reportXlsx(t, head, "Read from the statement. Opening + lines = closing. Difference: 0.00."));
}

// "<bank> <last4> <periodStart> to <periodEnd>.csv", safe on Windows and macOS.
export function fileName(bank: string, acc: StatementAccount, format: ExportFormat): string {
  const base = [bank.trim() || "Statement", acc.last4.trim(), acc.periodStart, "to", acc.periodEnd].filter(Boolean).join(" ");
  return `${base.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 150)}.${format}`;
}

// Why an account cannot be downloaded, or null.
export function downloadBlock(acc: StatementAccount): string | null {
  const d = checkAccount(acc).differenceCents;
  if (d === 0) return null;
  return `${acc.name || "This account"}${acc.last4 ? ` ending ${acc.last4}` : ""} does not balance yet: the difference is ${money(d)}. It must be 0.00 to download.`;
}

export function accountFile(data: ReadResult, acc: StatementAccount, format: ExportFormat): ExportFile {
  const body = format === "csv" ? new TextEncoder().encode(accountCsv(acc)) : accountXlsx(acc, data.bank);
  return { name: fileName(data.bank, acc, format), body, contentType: CONTENT_TYPE[format] };
}

// Every account of every statement, one file each; the same name twice gets " (2)".
export async function zipFiles(files: ExportFile[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const used = new Set<string>();
  for (const f of files) {
    let name = f.name;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = f.name.replace(/(\.[a-z]+)$/i, ` (${n})$1`);
    used.add(name.toLowerCase());
    zip.file(name, f.body, { binary: true });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

// The zip's own name: one statement's name, or "Bank statements <date>".
export function zipName(datas: ReadResult[], today: string): string {
  if (datas.length === 1 && datas[0].accounts.length) {
    const a = datas[0].accounts[0];
    return fileName(datas[0].bank, { ...a, last4: "" }, "csv").replace(/\.csv$/, ".zip");
  }
  return `Bank statements ${today}.zip`;
}
