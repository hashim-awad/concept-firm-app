// The client's signed copy (PDF with the audit page), by private link, once everyone has signed.
import { NextResponse } from "next/server";
import { loadQuoteByToken } from "@/lib/t1-quote/server";
import { signedPdfBytes } from "@/lib/t1-quote/sign";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await loadQuoteByToken(token);
  if (!found || found.quote.status !== "signed") return new NextResponse("Not found", { status: 404 });
  const file = await signedPdfBytes(found.quote.id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Concept-Accounting-quote-${found.quote.tax_year}-signed.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
