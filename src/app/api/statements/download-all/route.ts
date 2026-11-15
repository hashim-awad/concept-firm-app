// "Download all" (round 20, Hashim, Nov 15, 2026): ?ids=a,b,c&format=csv|xlsx. One zip with a file per
// account of each statement. Refused while any of them has a Difference that is not 0.00. Standalone
// statements stay after the download (fix, Hashim, Nov 15, 2026); "Done" or 24 hours deletes them.
import { after, type NextRequest } from "next/server";
import { getAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { accountFile, CONTENT_TYPE, downloadBlock, zipFiles, zipName, type ExportFile, type ExportFormat } from "@/lib/statements/export";
import type { ReadResult } from "@/lib/statements/types";

export const maxDuration = 60;

const text = (msg: string, status: number) => new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });

export async function GET(req: NextRequest) {
  const a = await getAccess();
  if (!a || !canView(a, "closebook")) return text("You need Closebook to download statements.", 403);
  const format = (req.nextUrl.searchParams.get("format") ?? "csv") as ExportFormat;
  if (format !== "csv" && format !== "xlsx") return text("Choose CSV or Excel.", 400);
  const ids = [...new Set((req.nextUrl.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[0-9a-f-]{36}$/i.test(s)))];
  if (!ids.length) return text("Choose the statements to download.", 400);
  if (ids.length > 200) return text("Up to 200 statements at a time.", 400);
  const supabase = await createClient();
  const { data } = await supabase.from("cb_statement_imports").select("id, file_id, file_name, status, result, edited, created_at").in("id", ids).order("created_at");
  const rows = (data ?? []) as { id: string; file_id: string | null; file_name: string; status: string; result: ReadResult | null; edited: ReadResult | null }[];
  if (rows.length !== ids.length) return text("Some of these statements were not found.", 404);
  const problems: string[] = [];
  const files: ExportFile[] = [];
  const datas: ReadResult[] = [];
  for (const r of rows) {
    const d = r.edited ?? r.result;
    if (!d || !["ready", "needs_look", "imported"].includes(r.status)) { problems.push(`${r.file_name} is not read yet.`); continue; }
    const blocks = d.accounts.map(downloadBlock).filter(Boolean);
    if (blocks.length) { problems.push(`${r.file_name}: ${blocks.join(" ")}`); continue; }
    datas.push(d);
    files.push(...d.accounts.map((acc) => accountFile(d, acc, format)));
  }
  if (problems.length) return text(`Nothing was downloaded. ${problems.join(" ")}`, 409);
  if (!files.length) return text("These statements have no accounts to download.", 409);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
  const body = await zipFiles(files);
  const name = datas.length === 1 ? zipName(datas, today) : `Bank statements ${today}.zip`;
  const standalone = rows.filter((r) => !r.file_id).map((r) => r.id);
  if (standalone.length) after(async () => {
    const { error } = await (await createClient()).rpc("statement_mark_downloaded", { p_ids: standalone });
    if (error) console.error("statement download: could not note the download", error.message);
  });
  return new Response(new Blob([body as BlobPart]), {
    headers: { "Content-Type": CONTENT_TYPE.zip, "Content-Disposition": `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
