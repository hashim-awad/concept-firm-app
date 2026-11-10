// Run with: npm test
// The full export's ZIP writer and CSV (decision 9, Phase 2 step 11): read the archive back.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import { crc32, toCsv, ZipWriter } from "../src/lib/export/zip.ts";

// A minimal reader: the central directory, then each file's data.
function readZip(buf: Buffer) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10), dirAt = buf.readUInt32LE(end + 16);
  const out = new Map<string, Buffer>();
  for (let i = 0, p = dirAt; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), size = buf.readUInt32LE(p + 20), raw = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const dataAt = at + 30 + buf.readUInt16LE(at + 26) + buf.readUInt16LE(at + 28);
    const body = buf.subarray(dataAt, dataAt + size);
    const data = method === 8 ? inflateRawSync(body) : Buffer.from(body);
    assert.equal(data.length, raw, name);
    assert.equal(crc32(data), crc, `crc ${name}`);
    out.set(name, data);
    p += 46 + nlen;
  }
  return out;
}

test("crc32 matches the standard check value", () => {
  assert.equal(crc32(Buffer.from("123456789")).toString(16), "cbf43926");
});

test("a ZIP with text and a binary file reads back exactly", () => {
  const chunks: Uint8Array[] = [];
  const z = new ZipWriter((c) => chunks.push(c), new Date("2026-11-10T12:00:00Z"));
  const pdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256))]);
  z.add("data/json/staff.json", JSON.stringify([{ a: 1 }]).repeat(200));
  z.add("files/documents/vault/c1/Café letter.pdf", pdf);
  z.add("empty.txt", "");
  z.finish();
  const files = readZip(Buffer.concat(chunks));
  assert.deepEqual([...files.keys()], ["data/json/staff.json", "files/documents/vault/c1/Café letter.pdf", "empty.txt"]);
  assert.ok(files.get("files/documents/vault/c1/Café letter.pdf")!.equals(pdf));
  assert.equal(files.get("data/json/staff.json")!.toString(), JSON.stringify([{ a: 1 }]).repeat(200));
  assert.equal(z.entries[1].sha256, createHash("sha256").update(pdf).digest("hex"));
  assert.ok(Buffer.concat(chunks).length < pdf.length + 2000, "text is compressed");
});

test("CSV for Excel: quotes, lists, accents and formula-looking text", () => {
  const csv = toCsv([{ id: 1, name: 'A "quoted", name', tags: ["x", "y"], note: "=SUM(A1)" }, { id: 2, amount: -5, phone: "+1 226 555 0100", extra: "Montréal" }]);
  assert.ok(csv.startsWith("﻿id,name,tags,note,amount,phone,extra\r\n"));
  assert.ok(csv.includes('"A ""quoted"", name"'));
  assert.ok(csv.includes('"[""x"",""y""]"'));
  assert.ok(csv.includes("'=SUM(A1)"), "a formula is shown as text");
  assert.ok(csv.includes(",-5,+1 226 555 0100,Montréal"), "numbers and phone numbers are left alone");
});
