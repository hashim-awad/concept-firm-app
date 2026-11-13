// The client entry list (Hashim, Nov 15, 2026): for full-file clients who keep their own books, the trial
// balance by group, then the entries, then adjusted net income, stamped "Entries to record in your books"
// (and "Draft for review" until every entry is approved).
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buildReportPdf, keepsOwnBooks } from "@/lib/closebook/wp-build";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: f } = await supabase.from("cb_files").select("file_type, books").eq("id", id).maybeSingle();
  if (!f) return new Response("Not found", { status: 404 });
  if (!keepsOwnBooks(f)) return new Response("The client entry list is for full files whose client keeps their own books.", { status: 400 });
  const pdf = await buildReportPdf(supabase, id, { report: "tb" }, "client");
  if (!pdf) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(pdf.bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${pdf.filename}"`, "cache-control": "private, no-store" } });
}
