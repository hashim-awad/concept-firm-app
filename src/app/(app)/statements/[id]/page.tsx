// Round 20 (Hashim, Nov 15, 2026; mocks 02 and 03): Verify details for one uploaded statement, from
// Closebook step 3 or from the standalone tool (gear > Tools > Bank statement PDF to CSV). The reads go
// through the user's own Supabase client, so the statement's row-level security decides who sees it.
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { getStatement, listStatements } from "@/lib/statements/server";
import { closebookWarnings } from "@/lib/statements/checks";
import { Verify, type Nav } from "./verify";

export default async function VerifyPage({ params }: PageProps<"/statements/[id]">) {
  const access = await requireAccess("closebook", "view");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const st = await getStatement(id);
  if (!st) notFound();
  const { row, data, fileUrl, file } = st;
  const fileId = row.file_id;

  // "Statement 10 of 13": this file's (or my standalone) statements still to check, in the list's order.
  const list = await listStatements(fileId);
  const todo = list.filter((r) => r.status === "ready" || r.status === "needs_look" || r.id === id);
  const at = todo.findIndex((r) => r.id === id);
  const nav: Nav = at < 0 ? { index: 0, total: 0, prev: null, next: null }
    : { index: at + 1, total: todo.length, prev: todo[at - 1]?.id ?? null, next: todo[at + 1]?.id ?? null };

  const backHref = fileId ? `/closebook/${fileId}?step=records` : "/admin/bank-pdf";
  let header: React.ReactNode = null;
  if (fileId) {
    const supabase = await createClient();
    const { data: f } = await supabase.from("cb_files").select("year_end, phase, client:client_id(legal_name)").eq("id", fileId).maybeSingle();
    const client = (f as unknown as { client: { legal_name: string } | null } | null)?.client?.legal_name ?? "";
    header = (
      <div className="-mx-4 -mt-6 mb-1 flex h-[50px] items-center gap-3.5 bg-navy-950 px-4 text-white md:-mx-8 md:-mt-8 md:px-8">
        <Link href="/closebook" className="text-xs text-[#9fb0d4] hover:text-white">My files ›</Link>
        <Link href={backHref} className="truncate text-[15px] font-bold hover:underline">{client}</Link>
        {f?.year_end && <span className="text-[12.5px] whitespace-nowrap text-[#c8d2e8]">{formatDate(f.year_end as string)}</span>}
      </div>
    );
  }
  const eyebrow = (
    <>
      {header}
      <p className="text-[12px] font-extrabold tracking-[.1em] text-navy-900 uppercase">
        {fileId ? <><Link href={backHref} className="hover:underline">3 · Bank statements</Link> › Verify details</>
          : <><Link href={backHref} className="hover:underline">Bank statement PDF to CSV</Link> › Verify details</>}
      </p>
    </>
  );

  if (!data || !["ready", "needs_look", "imported"].includes(row.status)) {
    return (
      <div className="grid gap-3">
        {eyebrow}
        <h1 className="text-[22px] font-semibold tracking-tight">Verify details</h1>
        <p className="card text-sm text-ink-2">{row.file_name}: {row.status === "failed" ? row.error || "The statement could not be read." : "This statement is still being read. Come back when its status is Ready to check."}{" "}
          <Link href={backHref} className="text-navy-700 underline">Back to the list</Link></p>
      </div>
    );
  }

  // Standalone jobs belong to the person who uploaded them: anyone with Closebook view may use the tool.
  const warnings = file ? closebookWarnings(data, file) : [];
  return (
    <Verify id={id} row={row} initial={data} fileUrl={fileUrl} file={file} nav={nav} backHref={backHref}
      canEdit={fileId ? canEdit(access, "closebook") : true} warnings={warnings} eyebrow={eyebrow} />
  );
}
