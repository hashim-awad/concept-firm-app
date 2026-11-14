// Step 10 downloads (round 12): the documents for TaxDome as one zip (the stored one once delivered), and
// the client email as .html for Outlook (or .txt).
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { buildDocumentsZip, deliveredZip, loadClose } from "@/lib/closebook/close-server";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  await requireAccess("closebook", "view");
  const { id } = await params;
  const doc = new URL(req.url).searchParams.get("doc");
  if (!/^[0-9a-f-]{36}$/.test(id) || !["zip", "html", "txt"].includes(doc ?? "")) return new Response("Not found", { status: 404 });
  const supabase = await createClient();
  const d = await loadClose(supabase, id);
  if (!d) return new Response("Not found", { status: 404 });
  const base = d.zipName.replace(/_TaxDome-Documents_/, "_Client-Email_").replace(/\.zip$/, "");
  if (doc === "html" || doc === "txt") {
    if (!d.email) return new Response("Fill in step 10's fields first.", { status: 409 });
    const body = doc === "html" ? `<!doctype html><html><head><meta charset="utf-8"><title>${d.email.subject.replace(/</g, "&lt;")}</title></head><body>\n${d.email.html}\n</body></html>` : `Subject: ${d.email.subject}\n\n${d.email.text}`;
    return new Response(body, { headers: { "content-type": doc === "html" ? "text/html; charset=utf-8" : "text/plain; charset=utf-8", "content-disposition": `attachment; filename="${base}.${doc}"`, "cache-control": "private, no-store" } });
  }
  let bytes: Uint8Array | null;
  if (d.close.delivered_path) bytes = await deliveredZip(d.close.delivered_path);
  else {
    const z = await buildDocumentsZip(supabase, d);
    if ("error" in z) return new Response(z.error, { status: 409 });
    bytes = z.bytes;
  }
  if (!bytes) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${d.zipName}"`, "cache-control": "private, no-store" } });
}
