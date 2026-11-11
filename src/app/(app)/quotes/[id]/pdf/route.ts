// Staff: the signed PDF of a proposal (or any quote). The quote row is read with the person's own
// session, so the database decides who may; the file is fetched with the server key.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { signedPdfBytes } from "@/lib/t1-quote/sign";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const { data: q } = await (await createClient()).from("quotes").select("id, status, kind").eq("id", id).maybeSingle();
  if (!q || q.status !== "signed") return new NextResponse("Not found", { status: 404 });
  const file = await signedPdfBytes(q.id);
  if (!file) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${q.kind === "proposal" ? "Proposal" : "Quote"}-signed.pdf"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
