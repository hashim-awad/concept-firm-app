import "server-only";
// Round 18: the client's Closebook files for the client page (Closebook files and Documents tabs). The
// step works out as on the Closebook lists (file-list.tsx); delivery and lock come from cb_file_close, and
// "MAL signed" from cb_fs_status (the MAL quote on cb_file_fs, signed by the signing officer).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ListedFile } from "@/lib/closebook/server";
import { fileSteps, SIGNED_STEPS, STEP_KEYS } from "@/lib/closebook/steps";
import { accountCoverage, missingText } from "@/lib/closebook/coverage";
import { keepsOwnBooks } from "@/lib/closebook/books";

const DOC_COLS = "code, phase, title, detail, sort_order, status, prepared_by, prepared_at, reviewed_by, reviewed_at";

export type ClientFile = { id: string; yearEnd: string; step: string; preparer: string; reviewer: string; locked: boolean;
  lockedAt: string | null; deliveredAt: string | null; malSignedAt: string | null; ownBooks: boolean };

export async function loadClientFiles(supabase: SupabaseClient, clientId: string, names: Map<string, string>): Promise<{ files: ClientFile[]; error: string | null }> {
  const { data, error } = await supabase.from("cb_files").select(`id, client_id, year_start, year_end, year_change_reason, file_type, books, preparer_id, reviewer_id, phase, created_at, docs:cb_documents(${DOC_COLS}), stmts:cb_bank_statements(account_id, period_start, period_end, opening, closing), baccts:cb_bank_accounts(id, name), imps:cb_imports(target), accts:cb_accounts(line_no, needs_reviewer), ents:cb_entries(id), signs:cb_step_signoffs(step, prepared_at, reviewed_at), rnotes:cb_review_notes(step, status)`)
    .eq("client_id", clientId).order("year_end", { ascending: false });
  if (error) return { files: [], error: `Closebook files could not be read: ${error.message}` };
  const rows = (data ?? []) as unknown as ListedFile[];
  if (!rows.length) return { files: [], error: null };
  const ids = rows.map((f) => f.id);
  const [{ data: closes }, ...mals] = await Promise.all([
    supabase.from("cb_file_close").select("file_id, delivered_at, locked_at").in("file_id", ids),
    ...ids.map((id) => supabase.rpc("cb_fs_status", { p_file: id })),
  ]);
  const close = new Map(((closes ?? []) as { file_id: string; delivered_at: string | null; locked_at: string | null }[]).map((c) => [c.file_id, c]));
  const files = rows.map((f, i) => {
    const people = { preparer: names.get(f.preparer_id) ?? "", reviewer: names.get(f.reviewer_id) ?? "" };
    const accts = f.accts ?? [];
    // As the Closebook list: statement periods only, to stay light.
    const bankGaps = missingText((f.baccts ?? []).map((a) => ({ name: a.name,
      gaps: accountCoverage(f.year_start, f.year_end, (f.stmts ?? []).filter((x) => x.account_id === a.id).map((x) => ({ ...x, opening: Number(x.opening), closing: Number(x.closing) }))).gaps })));
    const { steps, current } = fileSteps({ bankGaps,
      books: f.books, docs: f.docs, statements: f.stmts?.length ?? 0, imported: (f.imps ?? []).some((x) => x.target === "this_year"), accounts: accts.length,
      unmatched: accts.filter((a) => !a.line_no && !a.needs_reviewer).length, waiting: accts.filter((a) => a.needs_reviewer).length, entries: f.ents?.length ?? 0, people,
      signs: Object.fromEntries(SIGNED_STEPS.map((k) => { const x = f.signs?.find((y) => y.step === k);
        return [k, { prepared: !!x?.prepared_at, reviewed: !!x?.reviewed_at, notes: (f.rnotes ?? []).filter((n) => n.step === k && n.status !== "cleared").length }]; })),
    });
    const cur = steps.find((s) => s.key === current)!;
    const c = close.get(f.id);
    const mal = (mals[i]?.data ?? {}) as { mal_quote_id?: string | null; mal_signed_at?: string | null };
    return { id: f.id, yearEnd: f.year_end, step: `${cur.n} of ${STEP_KEYS.length} · ${cur.name}`, preparer: people.preparer, reviewer: people.reviewer,
      locked: f.phase === "locked", lockedAt: c?.locked_at ?? null, deliveredAt: c?.delivered_at ?? null,
      malSignedAt: mal.mal_quote_id && mal.mal_signed_at ? mal.mal_signed_at : null, ownBooks: keepsOwnBooks(f) };
  });
  return { files, error: null };
}
