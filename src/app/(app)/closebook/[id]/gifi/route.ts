// Step 8 (round 10, Hashim, Nov 27, 2026): the GIFI file for ProFile. ?kind=before_tax or ?kind=final runs
// the checks, records the export (who, when, the trial balance it came from) and downloads it; a failed
// check or a missing Business Number refuses it, by name. ?export=<id> downloads a kept export again.
// Read with the person's own session, so the database decides who may.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccess, canView } from "@/lib/access";
import { gifiFor } from "@/lib/closebook/gifi-server";
import { withMessage } from "@/lib/messages";

const file = (body: string, name: string) => new NextResponse(body, {
  headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name.replace(/"/g, "")}"`, "Cache-Control": "private, no-store" },
});

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getAccess();
  if (!access || !canView(access, "closebook")) return new NextResponse("Not found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const supabase = await createClient();
  const back = (kind: "msg" | "error", text: string) => NextResponse.redirect(new URL(withMessage(`/closebook/${id}?step=t2`, kind, text), req.url), 303);

  const keptId = q.get("export");
  if (keptId) {
    if (!/^[0-9a-f-]{36}$/.test(keptId)) return new NextResponse("Not found", { status: 404 });
    const { data } = await supabase.from("cb_gifi_exports").select("file_name, content").eq("id", keptId).eq("file_id", id).maybeSingle();
    return data ? file(data.content as string, data.file_name as string) : new NextResponse("Not found", { status: 404 });
  }

  const kind = q.get("kind");
  if (kind !== "before_tax" && kind !== "final") return new NextResponse("Not found", { status: 404 });
  const g = await gifiFor(supabase, id);
  if (!g) return new NextResponse("Not found", { status: 404 });
  if (g.refused.length) return back("error", `Export refused. ${g.refused.join(" ")}`);
  const body = g.file(), name = g.fileName(kind);
  const { error } = await supabase.rpc("cb_record_gifi_export", { p_file: id, p_kind: kind, p_file_name: name, p_content: body, p_totals: g.totals,
    p_checks: g.checks.map((c) => ({ key: c.key, title: c.title, ok: c.ok, result: c.result })) });
  if (error) return back("error", error.message);
  return file(body, name);
}
