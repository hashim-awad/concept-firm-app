// Download full export (decision 9). Owners only. Streams one ZIP: every table and every stored file.
import { getAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ZipWriter } from "@/lib/export/zip";
import { writeFullExport } from "@/lib/export/full";

export const maxDuration = 300;

export async function GET() {
  const access = await getAccess();
  if (!access?.is_owner) return new Response("Only an owner can download the full export.", { status: 403 });
  const owner = await createClient();
  const when = new Date();
  const stamp = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "America/Toronto" }).format(when);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const zip = new ZipWriter((c) => controller.enqueue(c), when);
        const s = await writeFullExport(owner, zip, access.full_name, when);
        zip.finish();
        await owner.rpc("record_full_export", { p_tables: s.tables, p_rows: s.rows, p_files: s.files });
        controller.close();
      } catch (e) {
        console.error("full export failed", e);
        controller.error(e);
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="concept-studio-export-${stamp}.zip"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
