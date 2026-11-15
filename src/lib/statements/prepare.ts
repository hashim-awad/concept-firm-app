// Get an uploaded statement ready for the reader (round 20, Hashim, Nov 15, 2026). Server side only.
// - PDF: count the pages; a PDF locked with an empty password (most bank PDFs that only stop printing or
//   copying) is unlocked first, so the reader can open it. A PDF that needs a real password is refused.
// - HEIC/HEIF photos (iPhone) become JPEG. JPG and PNG go as they are.
// Limits (Claude API): a request up to 32 MB (base64 adds a third, so a PDF up to 20 MB), up to 600 pages;
// an image up to 5 MB.
// Libraries: qpdf compiled to WebAssembly (@neslinesli93/qpdf-wasm, ISC; qpdf itself Apache-2.0) and
// heic-convert (ISC). Both are pure JavaScript/WebAssembly; nothing AGPL.

import { createRequire } from "node:module";
import path from "node:path";
import { existsSync } from "node:fs";

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_PAGES = 600;

export type MediaType = "application/pdf" | "image/jpeg" | "image/png" | "image/heic" | "image/heif";
export type Prepared = {
  kind: "pdf" | "image";
  bytes: Uint8Array;            // what the reader gets: unlocked PDF, or the image (HEIC as JPEG)
  mediaType: "application/pdf" | "image/jpeg" | "image/png";
  pages: number;
  unlocked: boolean;            // the PDF had an empty password
  converted: boolean;           // the photo was HEIC/HEIF
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

// ---------- qpdf (WebAssembly), loaded once per server instance

type Qpdf = { callMain: (args: string[]) => number; FS: { writeFile: (p: string, d: Uint8Array) => void; readFile: (p: string) => Uint8Array; unlink: (p: string) => void } };
let qpdfPromise: Promise<Qpdf> | null = null;

function wasmPath(): string | undefined {
  // The package's own folder in node_modules (the server runs from the project folder).
  const p = path.join(process.cwd(), "node_modules", "@neslinesli93", "qpdf-wasm", "dist", "qpdf.wasm");
  return existsSync(p) ? p : undefined;
}

function qpdf(): Promise<Qpdf> {
  if (!qpdfPromise) {
    const req = createRequire(path.join(process.cwd(), "package.json"));
    const create = req("@neslinesli93/qpdf-wasm") as (o: Record<string, unknown>) => Promise<Qpdf>;
    const wasm = wasmPath();
    qpdfPromise = create({ noInitialRun: true, ...(wasm ? { locateFile: () => wasm } : {}) });
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
  if (bytes.length > MAX_PDF_BYTES) throw new PrepareError("The PDF is over 20 MB. Split it into smaller files and upload them.");
  if (!isPdf(bytes)) throw new PrepareError("This file is not a PDF the reader can open. Save it again as a PDF and upload it.");
  const q = await qpdf();
  const n = ++seq;
  const inP = `/in-${n}.pdf`, outP = `/out-${n}.pdf`, jsonP = `/pages-${n}.json`;
  q.FS.writeFile(inP, bytes);
  try {
    // qpdf exit codes: 0 done, 3 done with warnings, 2 error. --is-encrypted: 0 locked, 2 not.
    const done = (rc: number) => rc === 0 || rc === 3;
    let use = inP, unlocked = false;
    if (run(q, ["--is-encrypted", inP]) === 0) {
      // Opens only when the password to open it is empty; a real password fails here.
      if (!done(run(q, ["--decrypt", inP, outP]))) throw new PrepareError("The PDF is locked with a password. Open it, print it to a new PDF without the password, and upload that.");
      use = outP; unlocked = true;
    }
    if (!done(run(q, ["--json=2", "--json-key=pages", use, jsonP]))) {
      // qpdf could not open it. A PDF with an /Encrypt entry that would not open needs a real password.
      if (!unlocked && hasEncrypt(bytes)) throw new PrepareError("The PDF is locked with a password. Open it, print it to a new PDF without the password, and upload that.");
      throw new PrepareError("The PDF could not be opened. Save it again as a PDF and upload it.");
    }
    const pages = (JSON.parse(new TextDecoder().decode(q.FS.readFile(jsonP))) as { pages?: unknown[] }).pages?.length ?? 0;
    if (!pages) throw new PrepareError("The PDF has no pages.");
    if (pages > MAX_PAGES) throw new PrepareError(`The PDF has ${pages} pages. The reader takes up to ${MAX_PAGES}. Split it and upload the parts.`);
    const out = unlocked ? q.FS.readFile(outP).slice() : bytes;
    if (out.length > MAX_PDF_BYTES) throw new PrepareError("The PDF is over 20 MB. Split it into smaller files and upload them.");
    return { kind: "pdf", bytes: out, mediaType: "application/pdf", pages, unlocked, converted: false };
  } finally {
    for (const p of [inP, outP, jsonP]) { try { q.FS.unlink(p); } catch { /* not there */ } }
  }
}

const hasEncrypt = (b: Uint8Array) => Buffer.from(b.buffer, b.byteOffset, b.byteLength).includes("/Encrypt", 0, "latin1");
export const isPdf = (b: Uint8Array) => b.length > 4 && new TextDecoder().decode(b.subarray(0, Math.min(b.length, 1024))).includes("%PDF-");
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

async function heicToJpeg(bytes: Uint8Array): Promise<Uint8Array> {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const convert = req("heic-convert") as (o: { buffer: Uint8Array; format: "JPEG"; quality: number }) => Promise<ArrayBuffer | Uint8Array>;
  for (const quality of [0.85, 0.6]) {
    const out = new Uint8Array(await convert({ buffer: bytes, format: "JPEG", quality }));
    if (out.length <= MAX_IMAGE_BYTES || quality === 0.6) return out;
  }
  throw new Error("unreachable");
}

export async function prepare(bytes: Uint8Array, mediaType: string): Promise<Prepared> {
  if (bytes.length === 0) throw new PrepareError("The file is empty.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new PrepareError("The file is over 20 MB.");
  if (mediaType === "application/pdf") return preparePdf(bytes);
  if (mediaType === "image/heic" || mediaType === "image/heif") {
    let jpeg: Uint8Array;
    try { jpeg = await heicToJpeg(bytes); } catch { throw new PrepareError("The photo could not be opened. Take it again, or send it as a JPG or PDF."); }
    if (jpeg.length > MAX_IMAGE_BYTES) throw new PrepareError("The photo is over 5 MB after conversion. Take it again at a smaller size, or scan it to PDF.");
    return { kind: "image", bytes: jpeg, mediaType: "image/jpeg", pages: 1, unlocked: false, converted: true };
  }
  if (mediaType === "image/jpeg" || mediaType === "image/png") {
    if (mediaType === "image/jpeg" ? !isJpeg(bytes) : !isPng(bytes)) throw new PrepareError("The photo could not be opened. Save it again as a JPG or PNG.");
    if (bytes.length > MAX_IMAGE_BYTES) throw new PrepareError("The photo is over 5 MB. Take it again at a smaller size, or scan it to PDF.");
    return { kind: "image", bytes, mediaType, pages: 1, unlocked: false, converted: false };
  }
  throw new PrepareError("Upload a PDF, or a photo (JPG, PNG or HEIC).");
}
