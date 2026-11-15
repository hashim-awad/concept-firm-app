// Download one statement read from a PDF (round 20, Hashim, Nov 15, 2026): ?format=csv|xlsx, and
// &account=a1 for one account. A statement with several accounts and no account named comes as a zip.
// Refused while an account's Difference is not 0.00. A standalone statement is deleted once the whole
// statement has been downloaded (a log row stays: who, when, pages, cost).
import { after, type NextRequest } from "next/server";
import { getAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { removeStored } from "@/lib/statements/server";
import { accountFile, CONTENT_TYPE, downloadBlock, zipFiles, zipName, type ExportFormat } from "@/lib/statements/export";
import type { ReadResult } from "@/lib/statements/types";

const text = (msg: string, status: number) => new Response(msg, { status, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "private, no-store" } });
const disposition = (name: string) => `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'")}"; filename*=UTF-8''${encodeURIComponent(name)}`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await getAccess();
  if (!a || !canView(a, "closebook")) return text("You need Closebook to download statements.", 403);
  const format = (req.nextUrl.searchParams.get("format") ?? "csv") as ExportFormat;
  if (format !== "csv" && format !== "xlsx") return text("Choose CSV or Excel.", 400);
  const key = req.nextUrl.searchParams.get("account");
  const supabase = await createClient();
  const { data: row } = await supabase.from("cb_statement_imports").select("id, file_id, status, result, edited").eq("id", id).maybeSingle();
  if (!row) return text("Statement not found.", 404);
  const data = (row.edited ?? row.result) as ReadResult | null;
  if (!data || !["ready", "needs_look", "imported"].includes(row.status as string)) return text("This statement is not read yet.", 409);
  const accounts = key ? data.accounts.filter((x) => x.key === key) : data.accounts;
  if (!accounts.length) return text("That account is not on this statement.", 404);
  const blocks = accounts.map(downloadBlock).filter((b): b is string => !!b);
  if (blocks.length) return text(blocks.join(" "), 409);

  let body: Uint8Array, name: string, type: string;
  if (accounts.length === 1) {
    const file = accountFile(data, accounts[0], format);
    body = file.body; name = file.name; type = file.contentType;
  } else {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto" }).format(new Date());
    body = await zipFiles(accounts.map((acc) => accountFile(data, acc, format)));
    name = zipName([data], today); type = CONTENT_TYPE.zip;
  }
  // Standalone: nothing is kept once the whole statement is downloaded.
  if (!row.file_id && accounts.length === data.accounts.length) {
    after(async () => {
      const { data: path, error } = await (await createClient()).rpc("statement_finish_standalone", { p_id: id });
      if (error) console.error("statement download: could not delete the standalone statement", error.message);
      else await removeStored([path as string]);
    });
  }
  return new Response(new Blob([body as BlobPart]), {
    headers: { "Content-Type": type, "Content-Disposition": disposition(name), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
