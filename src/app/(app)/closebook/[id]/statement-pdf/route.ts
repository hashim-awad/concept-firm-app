// Round 22 correction: "Download PDF" in a statement's "..." menu on step 3. The statement as uploaded (a PDF
// or photo), kept with it on import. Closebook viewers only; the statement must belong to this file. Round 24:
// h=<id> an earlier file of a statement (Replace file keeps it), x=<id> the file of an excluded statement.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const s = q.get("s") ?? q.get("h") ?? q.get("x") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(s)) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  let st: { file_name: string; attachment_path: string | null } | null = null;
  if (q.get("h")) st = (await supabase.from("cb_statement_files").select("file_name, attachment_path").eq("id", s).eq("file_id", id).maybeSingle()).data;
  else if (q.get("x")) {
    const { data: x } = await supabase.from("cb_excluded_statements").select("file_name, statement").eq("id", s).eq("file_id", id).maybeSingle();
    st = x ? { file_name: x.file_name as string, attachment_path: ((x.statement as { attachment_path?: string | null }).attachment_path ?? null) } : null;
  } else st = (await supabase.from("cb_bank_statements").select("file_name, attachment_path").eq("id", s).eq("file_id", id).maybeSingle()).data;
  if (!st?.attachment_path) return new Response("Not found", { status: 404 });
  const { data, error } = await createAdminClient().storage.from("documents").download(st.attachment_path as string);
  if (error || !data) return new Response("The file could not be read.", { status: 500 });
  const ext = (st.attachment_path as string).split(".").pop()?.toLowerCase() ?? "pdf";
  const type = ext === "pdf" ? "application/pdf" : ext === "png" ? "image/png" : "image/jpeg";
  const name = String(st.file_name || `statement.${ext}`).replace(/[^\w.\- ]+/g, "_");
  return new Response(data, { headers: { "content-type": type, "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
