// The source PDF of a file's opening balances (the prior T2 or the CRA assessment). Closebook viewers only.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const { data: f } = await (await createClient()).from("cb_files").select("opening_pdf").eq("id", id).maybeSingle();
  if (!f?.opening_pdf) return new Response("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from("documents").download(f.opening_pdf as string);
  if (error || !data) return new Response("The PDF could not be read.", { status: 500 });
  return new Response(data, { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=\"opening-balances-source.pdf\"", "cache-control": "private, no-store" } });
}
