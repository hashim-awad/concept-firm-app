// Staff: the signed PDF for a lead's T1 quote. Needs Pricing and Leads (the quote row is read with
// the person's own session, so the database decides); the file is fetched with the server key.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signedPdfBytes } from "@/lib/t1-quote/sign";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: q } = await supabase.from("t1_quotes").select("id, tax_year, status").eq("lead_id", id).maybeSingle();
  if (!q || q.status !== "signed") return new NextResponse("Not found", { status: 404 });
  const file = await signedPdfBytes(q.id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="T1-quote-${q.tax_year}-signed.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
