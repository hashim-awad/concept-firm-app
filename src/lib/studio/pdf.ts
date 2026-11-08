import "server-only";
import { createHash } from "node:crypto";
// pdfmake 0.2.7: the same library and version Concept Studio uses in the browser.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake/src/printer");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const vfs = require("pdfmake/build/vfs_fonts.js").pdfMake.vfs as Record<string, string>;

// Same fonts as pdfmake's browser default (Roboto), so pages match Studio's.
const font = (name: string) => Buffer.from(vfs[name], "base64");
const printer = new PdfPrinter({
  Roboto: { normal: font("Roboto-Regular.ttf"), bold: font("Roboto-Medium.ttf"), italics: font("Roboto-Italic.ttf"), bolditalics: font("Roboto-MediumItalic.ttf") },
});

export const REGENERATED_LABEL = "Regenerated from Studio records, not the signed original";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Adds the regenerated label to the top of every page (decision 28).
function withRegeneratedLabel(def: any) {
  const prior = def.header;
  return {
    ...def,
    header: (cur: number, total: number, size: any) => {
      const label = { text: REGENERATED_LABEL, alignment: "center", fontSize: 8, bold: true, color: "#b3261e", margin: [0, 14, 0, 0] };
      const p = typeof prior === "function" ? prior(cur, total, size) : prior;
      return p ? { stack: [label, p] } : label;
    },
  };
}

export async function renderPdf(def: any, opts: { regenerated?: boolean } = {}): Promise<{ bytes: Buffer; sha256: string }> {
  const doc = printer.createPdfKitDocument(opts.regenerated ? withRegeneratedLabel(def) : def);
  const chunks: Buffer[] = [];
  const bytes: Buffer = await new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
