// A small streaming ZIP writer (PKZIP 2.0, no ZIP64): each file is written as soon as it is added,
// so a large export never sits in memory all at once. Text is compressed (deflate); PDFs and images
// are stored as they are (they are already compressed). Opens in Windows, macOS and 7-Zip.
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABLE[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// MS-DOS date and time (local Toronto time is close enough for file dates; UTC is used for stability).
function dos(d: Date) {
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2);
  const date = ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  return { time, date };
}

const LIMIT = 0xfffffffe; // no ZIP64: one file and the whole archive stay under 4 GB

export type ZipEntry = { path: string; bytes: number; sha256: string };

export class ZipWriter {
  private offset = 0;
  private central: Buffer[] = [];
  readonly entries: ZipEntry[] = [];
  private write: (chunk: Uint8Array) => void;
  private when: Date;
  constructor(write: (chunk: Uint8Array) => void, when = new Date()) { this.write = write; this.when = when; }

  add(path: string, data: Uint8Array | string, compress = typeof data === "string") {
    const raw = typeof data === "string" ? Buffer.from(data, "utf8") : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const name = Buffer.from(path.replace(/^\/+/, ""), "utf8");
    const crc = crc32(raw);
    const deflated = compress ? deflateRawSync(raw) : null;
    const body = deflated && deflated.length < raw.length ? deflated : raw;
    const method = body === raw ? 0 : 8;
    if (raw.length > LIMIT || this.offset + body.length > LIMIT) throw new Error("The export is larger than 4 GB. Ask for a ZIP64 export.");
    const { time, date } = dos(this.when);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6); cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(method, 10); cen.writeUInt16LE(time, 12); cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16); cen.writeUInt32LE(body.length, 20); cen.writeUInt32LE(raw.length, 24);
    cen.writeUInt16LE(name.length, 28); cen.writeUInt32LE(this.offset, 42);
    this.central.push(cen, name);
    this.write(local); this.write(name); this.write(body);
    this.offset += local.length + name.length + body.length;
    this.entries.push({ path: name.toString("utf8"), bytes: raw.length, sha256: createHash("sha256").update(raw).digest("hex") });
  }

  finish() {
    const dir = Buffer.concat(this.central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(this.offset, 16);
    if (this.entries.length > 0xffff) throw new Error("The export has more than 65,535 files. Ask for a ZIP64 export.");
    this.write(dir); this.write(end);
  }
}

// Rows as CSV for Excel: one column per key, objects and lists as JSON text, a UTF-8 mark so
// accents show correctly.
export function toCsv(rows: Record<string, unknown>[]): string {
  const cols: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!cols.includes(k)) cols.push(k);
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // Cells that start like a formula are prefixed so Excel shows them as text, not run them.
    // Numbers, and text like "-5" or "+1 226", are left alone.
    const safe = typeof v === "string" && (/^[=@\t\r]/.test(s) || /^[+-][^\d\s.]/.test(s)) ? `'${s}` : s;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [cols.map(cell).join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n") + "\r\n";
}
