// Streams one stored PDF version from the private vault, for staff who may see documents.
// Row level security decides: the version row and the file are read with the person's session.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return new NextResponse("Not found", { status: 404 });
  const supabase = await createClient();
  const { data: v } = await supabase.from("document_versions").select("file_path, file_name").eq("id", versionId).maybeSingle();
  if (!v) return new NextResponse("Not found", { status: 404 });
  const { data: file, error } = await supabase.storage.from("documents").download(v.file_path);
  if (error || !file) return new NextResponse("Not found", { status: 404 });
  const download = new URL(request.url).searchParams.get("download") === "1";
  const name = v.file_name.replace(/[^A-Za-z0-9._-]+/g, "_");
  return new NextResponse(file, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
