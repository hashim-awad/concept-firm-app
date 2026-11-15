// Get an uploaded statement ready for the reader (round 20, Hashim, Nov 15, 2026). Server side only.
// - PDF: count the pages; a PDF locked with an empty password (most bank PDFs that only stop printing or
//   copying) is unlocked first, so the reader can open it. A PDF that needs a real password is refused.
// - Photos: HEIC/HEIF (iPhone) become JPEG. A photo over the reader's image limit (5 MB, or larger than
//   2576 pixels on its long edge, which the model would shrink anyway) is scaled down and saved as JPEG.
// Limits: an upload up to 30 MB. The Claude API takes a request up to 32 MB, and the PDF travels as base64
// (a third larger), so a PDF up to 22 MB; up to 600 pages. An image up to 5 MB and 8000 pixels a side.
// Libraries (all permissive, pure JavaScript or WebAssembly; nothing AGPL): qpdf compiled to WebAssembly
// (@neslinesli93/qpdf-wasm, ISC; qpdf itself Apache-2.0), heic-convert (ISC), jpeg-js (BSD-3-Clause),
// pngjs (MIT).

import path from "node:path";
import { existsSync } from "node:fs";

export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
export const MAX_PDF_BYTES = 22 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_EDGE = 2576;
export const MAX_PAGES = 600;

export type MediaType = "application/pdf" | "image/jpeg" | "image/png" | "image/heic" | "image/heif";
export type Prepared = {
  kind: "pdf" | "image";
  bytes: Uint8Array;            // what the reader gets: the (unlocked) PDF, or the image
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
  pages: number;
  unlocked: boolean;            // the PDF had an empty password
  converted: boolean;           // the photo was changed (HEIC to JPEG, or scaled down): keep this copy
};

// A problem the person can fix; the message is shown on the statement as it is.
export class PrepareError extends Error {}

// The media type of an upload, from its name and the browser's type. Null: not accepted.
export function mediaTypeOf(name: string, type: string): MediaType | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const t = type.toLowerCase();
  if (ext === "pdf" || t === "application/pdf") return "application/pdf";
  if (ext === "jpg" || ext === "jpeg" || t === "image/jpeg") return "image/jpeg";
  if (ext === "png" || t === "image/png") return "image/png";
  if (ext === "heic" || t === "image/heic") return "image/heic";
  if (ext === "heif" || t === "image/heif") return "image/heif";
  return null;
}
export const EXTENSION: Record<MediaType, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/heic": "heic", "image/heif": "heif" };

// A CommonJS package's export, whether the loader wraps it in { default } or not.
const cjs = <T,>(m: unknown): T => ((m as { default?: T }).default ?? m) as T;

// ---------- qpdf (WebAssembly), loaded once per server instance

type Qpdf = { callMain: (args: string[]) => number; FS: { writeFile: (p: string, d: Uint8Array) => void; readFile: (p: string) => Uint8Array; unlink: (p: string) => void } };
let qpdfPromise: Promise<Qpdf> | null = null;

function qpdf(): Promise<Qpdf> {
  if (!qpdfPromise) {
    qpdfPromise = (async () => {
      const create = cjs<(o: Record<string, unknown>) => Promise<Qpdf>>(await import("@neslinesli93/qpdf-wasm"));
      // The .wasm file from the package's folder in node_modules (the server runs from the project folder).
      const wasm = path.join(process.cwd(), "node_modules", "@neslinesli93", "qpdf-wasm", "dist", "qpdf.wasm");
      return create({ noInitialRun: true, ...(existsSync(wasm) ? { locateFile: () => wasm } : {}) });
    })();
    qpdfPromise.catch(() => { qpdfPromise = null; });
  }
  return qpdfPromise;
}

// qpdf's main() sets process.exitCode when it returns; keep the server's own.
function run(q: Qpdf, args: string[]): number {
  const before = process.exitCode;
  try { return q.callMain(args); } catch { return 2; } finally { process.exitCode = before; }
}

let seq = 0;
async function preparePdf(bytes: Uint8Array): Promise<Prepared> {
  const tooBig = "The PDF is over 22 MB, more than the reader takes. Split it into smaller files and upload them.";
  if (bytes.length > MAX_PDF_BYTES) throw new PrepareError(tooBig);
  if (!isPdf(bytes)) throw new PrepareError("This file is not a PDF the reader can open. Save it again as a PDF and upload it.");
  const q = await qpdf();
  const n = ++seq;
  const inP = `/in-${n}.pdf`, outP = `/out-${n}.pdf`, jsonP = `/pages-${n}.json`;
  const locked = "The PDF is locked with a password. Open it, print it to a new PDF without the password, and upload that.";
  q.FS.writeFile(inP, bytes);
  try {
    // qpdf exit codes: 0 done, 3 done with warnings, 2 error. --is-encrypted: 0 locked, 2 not (or cannot open).
    const done = (rc: number) => rc === 0 || rc === 3;
    let use = inP, unlocked = false;
    if (run(q, ["--is-encrypted", inP]) === 0) {
      // Opens only when the password to open it is empty; a real password fails here.
      if (!done(run(q, ["--decrypt", inP, outP]))) throw new PrepareError(locked);
      use = outP; unlocked = true;
    }
    if (!done(run(q, ["--json=2", "--json-key=pages", use, jsonP]))) {
      // qpdf could not open it. A PDF with an /Encrypt entry that would not open needs a real password.
      if (!unlocked && hasEncrypt(bytes)) throw new PrepareError(locked);
      throw new PrepareError("The PDF could not be opened. Save it again as a PDF and upload it.");
    }
    const pages = (JSON.parse(new TextDecoder().decode(q.FS.readFile(jsonP))) as { pages?: unknown[] }).pages?.length ?? 0;
    if (!pages) throw new PrepareError("The PDF has no pages.");
    if (pages > MAX_PAGES) throw new PrepareError(`The PDF has ${pages} pages. The reader takes up to ${MAX_PAGES}. Split it and upload the parts.`);
    const out = unlocked ? q.FS.readFile(outP).slice() : bytes;
    if (out.length > MAX_PDF_BYTES) throw new PrepareError(tooBig);
    return { kind: "pdf", bytes: out, mediaType: "application/pdf", pages, unlocked, converted: false };
  } finally {
    for (const p of [inP, outP, jsonP]) { try { q.FS.unlink(p); } catch { /* not there */ } }
  }
}

const hasEncrypt = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes("/Encrypt", 0, "latin1");
export const isPdf = (b: Uint8Array) => b.length > 4 && new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).includes("%PDF-");
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

// ---------- Images

// Width and height from the file header, without decoding the picture.
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (isPng(b) && b.length >= 24) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (isJpeg(b)) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      // Start of frame (baseline, progressive and the rest), not DHT (C4), JPG (C8) or DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] };
      i += 2 + len;
    }
  }
  return null;
}

// Shrink RGBA pixels so the long edge is at most maxEdge (each new pixel is the average of the block it
// covers); transparent pixels go on white.
export function shrinkRgba(src: Uint8Array, w: number, h: number, maxEdge: number): { data: Uint8Array; width: number; height: number } {
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  const W = Math.max(1, Math.round(w * scale)), H = Math.max(1, Math.round(h * scale));
  const out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * h) / H), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H));
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W));
      let r = 0, g = 0, bl = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const k = (yy * w + xx) * 4, a = src[k + 3] / 255;
          r += src[k] * a + 255 * (1 - a); g += src[k + 1] * a + 255 * (1 - a); bl += src[k + 2] * a + 255 * (1 - a); n++;
        }
      }
      const o = (y * W + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(bl / n); out[o + 3] = 255;
    }
  }
  return { data: out, width: W, height: H };
}

type Raw = { data: Uint8Array; width: number; height: number };
async function decodeImage(bytes: Uint8Array): Promise<Raw> {
  if (isPng(bytes)) {
    // @ts-expect-error pngjs ships no types
    const { PNG } = cjs<{ PNG: { sync: { read: (b: Buffer) => Raw } } }>(await import("pngjs"));
    const p = PNG.sync.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    return { data: new Uint8Array(p.data), width: p.width, height: p.height };
  }
  const jpeg = cjs<typeof import("jpeg-js")>(await import("jpeg-js"));
  const d = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 200, maxMemoryUsageInMB: 1024 });
  return { data: d.data, width: d.width, height: d.height };
}

// Scale a photo down to the reader's limits and save it as JPEG.
async function fitImage(bytes: Uint8Array): Promise<Uint8Array> {
  const raw = await decodeImage(bytes);
  const small = shrinkRgba(raw.data, raw.width, raw.height, MAX_IMAGE_EDGE);
  const jpeg = cjs<typeof import("jpeg-js")>(await import("jpeg-js"));
  for (const quality of [85, 70, 55]) {
    const out = new Uint8Array(jpeg.encode(small, quality).data);
    if (out.length <= MAX_IMAGE_BYTES) return out;
  }
  throw new PrepareError("The photo is too large for the reader even after it was made smaller. Scan the page to PDF and upload that.");
}

function needsFitting(bytes: Uint8Array): boolean {
  const size = imageSize(bytes);
  return bytes.length > MAX_IMAGE_BYTES || !size || Math.max(size.width, size.height) > MAX_IMAGE_EDGE;
}

async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  // @ts-expect-error heic-convert ships no types
  const convert = cjs<(o: { buffer: Uint8Array; format: "JPEG"; quality: number }) => Promise<ArrayBuffer | Uint8Array>>(await import("heic-convert"));
  return new Uint8Array(await convert({ buffer: bytes, format: "JPEG", quality: 0.92 }));
}

async function fitOrExplain(bytes: Uint8Array, unreadable: string): Promise<Uint8Array> {
  try { return await fitImage(bytes); } catch (e) { throw e instanceof PrepareError ? e : new PrepareError(unreadable); }
}

export async function prepare(bytes: Uint8Array, mediaType: string): Promise<Prepared> {
  if (bytes.length === 0) throw new PrepareError("The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new PrepareError("The file is over 30 MB. Split it, or scan it again at a lower resolution, and upload it.");
  if (mediaType === "application/pdf") return preparePdf(bytes);
  const unreadable = "The photo could not be opened. Take it again, or send it as a JPG or PDF.";
  if (mediaType === "image/heic" || mediaType === "image/heif") {
    let jpeg: Uint8Array;
    try { jpeg = await heicToJpeg(bytes); } catch { throw new PrepareError(unreadable); }
    if (needsFitting(jpeg)) jpeg = await fitOrExplain(jpeg, unreadable);
    return { kind: "image", bytes: jpeg, mediaType: "image/jpeg", pages: 1, unlocked: false, converted: true };
  }
  if (mediaType === "image/jpeg" || mediaType === "image/png") {
    if (mediaType === "image/jpeg" ? !isJpeg(bytes) : !isPng(bytes)) throw new PrepareError("The photo could not be opened. Save it again as a JPG or PNG.");
    if (!needsFitting(bytes)) return { kind: "image", bytes, mediaType, pages: 1, unlocked: false, converted: false };
    return { kind: "image", bytes: await fitOrExplain(bytes, unreadable), mediaType: "image/jpeg", pages: 1, unlocked: false, converted: true };
  }
  throw new PrepareError("Upload a PDF, or a photo (JPG, PNG or HEIC).");
}
