// Step 9, the year-end package (round 11): the financial statements, the MAL and the minute book
// letter, as Appendix C lays them out. PDF for the client; the Word copy is for the reviewer only.
// Stamped DRAFT FOR REVIEW and dated "[Date of signing]" until the signing officer signs the MAL.
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { loadPackage } from "@/lib/closebook/fs-server";
import { packageDef, malDef, lawyerDef } from "@/lib/closebook/fs-pdf";
import { packageDocx, malDocx, lawyerDocx } from "@/lib/closebook/fs-docx";
import { renderWpPdf } from "@/lib/closebook/wp-pdf";
import { FS_LETTERHEAD } from "@/lib/closebook/fs-letterhead.generated";
import { signedPdfBytes } from "@/lib/t1-quote/sign";
import { deliveredFile, docFile } from "@/lib/closebook/close-server";

const NAMES = { fs: "Financial statements", mal: "Management Responsibility Acknowledgement", letter: "Minute book letter", signed: "MAL signed" } as const;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireAccess("closebook", "view");
  const { id } = await params;
  const q = new URL(req.url).searchParams;
  const doc = q.get("doc") as keyof typeof NAMES, format = q.get("format") ?? "pdf";
  if (!/^[0-9a-f-]{36}$/.test(id) || !(doc in NAMES) || (format !== "pdf" && format !== "docx")) return new Response("Not found", { status: 404 });
  // The Word copy is for the reviewer (owners) only.
  if (format === "docx" && !access.is_owner) return new Response("The Word copy is for the reviewer only.", { status: 403 });
  const supabase = await createClient();
  // Delivered (and locked) files: the PDFs as delivered to TaxDome, never rebuilt (round 12).
  if (format === "pdf" && (doc === "fs" || doc === "signed" || doc === "letter")) {
    const [{ data: close }, { data: f }, { data: cl }] = await Promise.all([
      supabase.from("cb_file_close").select("delivered_path").eq("file_id", id).maybeSingle(),
      supabase.from("cb_files").select("year_end, client_id").eq("id", id).maybeSingle(),
      supabase.from("cb_files").select("client:client_id(legal_name)").eq("id", id).maybeSingle(),
    ]);
    const path = (close as { delivered_path?: string | null } | null)?.delivered_path;
    const legal = ((cl as unknown as { client?: { legal_name?: string } } | null)?.client?.legal_name) ?? "";
    if (path && f) {
      const name = docFile(legal, doc, (f as { year_end: string }).year_end);
      const bytes = await deliveredFile(path, name);
      if (bytes) return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store" } });
    }
  }
  const pk = await loadPackage(supabase, id);
  if (!pk) return new Response("Not found", { status: 404 });
  if (pk.blocked.length) return new Response(`The package is stopped:\n${pk.blocked.join("\n")}`, { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
  const base = `${pk.m.name} ${NAMES[doc]} ${pk.data.file.year_end}${pk.ctx.draft && doc !== "signed" ? " DRAFT" : ""}`.replace(/[^\w .&-]+/g, "").replace(/\s+/g, " ").trim();

  if (doc === "signed") {
    // The signed MAL with its signing record, from the signing engine.
    if (!pk.signed || !pk.mal.mal_quote_id) return new Response("The MAL is not signed yet.", { status: 404 });
    const b = await signedPdfBytes(pk.mal.mal_quote_id);
    if (!b) return new Response("Not found", { status: 404 });
    return new Response(b, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
  }
  if (format === "docx") {
    const bytes = doc === "fs" ? await packageDocx(pk.m, pk.ctx, FS_LETTERHEAD) : doc === "mal" ? await malDocx(pk.m, pk.ctx) : await lawyerDocx(pk.m, pk.ctx, pk.lawyer, FS_LETTERHEAD);
    return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${base}.docx"`, "cache-control": "private, no-store" } });
  }
  const def = doc === "fs" ? packageDef(pk.m, pk.ctx, FS_LETTERHEAD) : doc === "mal" ? malDef(pk.m, pk.ctx) : lawyerDef(pk.m, pk.ctx, pk.lawyer, FS_LETTERHEAD);
  const bytes = await renderWpPdf({ ...def, info: { title: `${pk.m.name} ${NAMES[doc]}`, author: "Concept Accounting & Advisory Professional Corporation" } });
  return new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${base}.pdf"`, "cache-control": "private, no-store" } });
}
