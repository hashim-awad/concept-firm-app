import "server-only";
// Download full export (decision 9; Phase 2 step 11). Every table (exact JSON and a CSV for Excel)
// and every stored file (the vault PDFs, signed quotes, the signature image), with a manifest of
// SHA-256 fingerprints and a README. Database backups do not include stored files; this does.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { toCsv, ZipWriter } from "./zip";

const PAGE = 1000;

export type ExportSummary = { tables: number; rows: number; files: number; missing: string[] };

// owner: the signed-in owner's own client (the database checks they are an owner).
export async function writeFullExport(owner: SupabaseClient, zip: ZipWriter, who: string, when: Date): Promise<ExportSummary> {
  const { data: tables, error } = await owner.rpc("export_tables");
  if (error) throw new Error(error.message);
  const counts: [string, number][] = [];
  let rows = 0;
  for (const t of (tables ?? []) as string[]) {
    const all: Record<string, unknown>[] = [];
    for (let off = 0; ; off += PAGE) {
      const { data, error: e } = await owner.rpc("export_rows", { p_table: t, p_offset: off, p_limit: PAGE });
      if (e) throw new Error(`${t}: ${e.message}`);
      const page = (data ?? []) as Record<string, unknown>[];
      all.push(...page);
      if (page.length < PAGE) break;
    }
    zip.add(`data/json/${t}.json`, JSON.stringify(all, null, 1));
    zip.add(`data/csv/${t}.csv`, toCsv(all));
    counts.push([t, all.length]);
    rows += all.length;
  }

  // Stored files, read with the server key (the owner check is done above and by the route).
  const { data: files, error: fe } = await owner.rpc("export_files");
  if (fe) throw new Error(fe.message);
  const storage = createAdminClient().storage;
  const missing: string[] = [];
  let n = 0;
  for (const f of (files ?? []) as { bucket: string; name: string }[]) {
    const { data, error: de } = await storage.from(f.bucket).download(f.name);
    if (de || !data) { missing.push(`${f.bucket}/${f.name}: ${de?.message ?? "no data"}`); continue; }
    zip.add(`files/${f.bucket}/${f.name}`, new Uint8Array(await data.arrayBuffer()), /\.(txt|csv|json|html|svg)$/i.test(f.name));
    n++;
  }

  const summary: ExportSummary = { tables: counts.length, rows, files: n, missing };
  zip.add("manifest.csv", toCsv(zip.entries.map((e) => ({ path: e.path, bytes: e.bytes, sha256: e.sha256 }))));
  zip.add("README.txt", readme(summary, counts, who, when));
  return summary;
}

function readme(s: ExportSummary, counts: [string, number][], who: string, when: Date): string {
  const at = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeStyle: "short", timeZone: "America/Toronto" }).format(when);
  return [
    "Concept Studio: full export",
    "",
    `Made ${at} (Toronto time) by ${who}.`,
    `${s.tables} tables, ${s.rows} rows, ${s.files} stored files.`,
    "",
    "CONFIDENTIAL. This file holds client information. Keep it only in the firm's secure storage,",
    "and delete old copies under the retention policy.",
    "",
    "What is inside:",
    "- data/json: every table, exactly as stored (one file per table). Use these to restore.",
    "- data/csv: the same tables for Excel. Lists and details are shown as JSON text.",
    "- files: every stored file (vault PDFs, signed quotes, the signature image), in the same folders as in the app.",
    "- manifest.csv: every file in this export with its size and SHA-256 fingerprint, to check nothing changed.",
    "",
    "Supabase keeps daily database backups. Those do not include stored files; this export does.",
    "",
    ...(s.missing.length ? ["Files that could not be included (try the export again; if they still fail, tell the developer):", ...s.missing.map((m) => `- ${m}`), ""] : []),
    "Rows per table:",
    ...counts.map(([t, c]) => `- ${t}: ${c}`),
    "",
  ].join("\r\n");
}
