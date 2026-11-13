// Renders the working paper PDFs (src/lib/closebook/wp-doc.ts) with Helvetica, the font of the
// reference package. pdfmake 0.2.7 on the server, with the standard PDF fonts (nothing to embed).
import "server-only";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const PdfPrinter = require("pdfmake/src/printer");

const printer = new PdfPrinter({ Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" } });

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function renderWpPdf(def: any): Promise<Buffer> {
  const doc = printer.createPdfKitDocument(def);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.end();
  });
}

// "Nov 15, 2026, 9:00 AM" in Ontario time.
export const generatedAt = (d = new Date()) => d.toLocaleString("en-US", { timeZone: "America/Toronto", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
