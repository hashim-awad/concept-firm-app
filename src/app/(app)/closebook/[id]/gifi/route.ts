// The GIFI file for ProFile (Hashim, Nov 13, 2026): only when the required totals tie and nothing is
// left to decide. Read with the person's own session, so the database decides who may.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAccess, canView } from "@/lib/access";
import { gifiFor } from "@/lib/closebook/gifi-server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await getAccess();
  if (!access || !canView(access, "closebook")) return new NextResponse("Not found", { status: 404 });
  if (!/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const g = await gifiFor(await createClient(), id);
  if (!g) return new NextResponse("Not found", { status: 404 });
  if (g.problems.length) return new NextResponse(`The GIFI file cannot be exported yet:\n- ${g.problems.join("\n- ")}`, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  return new NextResponse(g.file, {
    headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${g.fileName}"`, "Cache-Control": "private, no-store" },
  });
}
