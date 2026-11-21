// Which rows make up a client's files, found from the schema (no list to keep up to date): the client row, its
// files, every table with a client_id or file_id column, and the child tables keyed by an entry, a reclass batch or
// a review note. History and logs are left out: they hold no figures.
import { json } from "./db.ts";

export type TableKey = { table: string; by: "client" | "file" | "entry" | "batch" | "note" | "self" };
const SKIP = new Set(["cb_file_history", "cb_master_line_log"]);
const CHILD: Record<string, TableKey["by"]> = { cb_entry_lines: "entry", cb_reclass_items: "batch", cb_review_note_replies: "note" };

export function fileTables(): TableKey[] {
  const rows = json<{ t: string; f: boolean; c: boolean }[]>(`
    select coalesce(json_agg(json_build_object('t', t, 'f', f, 'c', c) order by t), '[]') from (
      select table_name t, bool_or(column_name = 'file_id') f, bool_or(column_name = 'client_id') c
      from information_schema.columns where table_schema = 'public' and (table_name like 'cb\\_%' or table_name = 'clients')
        and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
      group by table_name) x`);
  const out: TableKey[] = [{ table: "clients", by: "self" }, { table: "cb_files", by: "client" }];
  for (const r of rows) {
    if (SKIP.has(r.t) || r.t === "clients" || r.t === "cb_files") continue;
    if (CHILD[r.t]) out.push({ table: r.t, by: CHILD[r.t] });
    else if (r.f) out.push({ table: r.t, by: "file" });
    else if (r.c) out.push({ table: r.t, by: "client" });
  }
  return out;
}

export function whereOf(k: TableKey, client: string): string {
  const files = `(select id from public.cb_files where client_id = '${client}')`;
  switch (k.by) {
    case "self": return `id = '${client}'`;
    case "client": return `client_id = '${client}'`;
    case "file": return `file_id in ${files}`;
    case "entry": return `entry_id in (select id from public.cb_entries where file_id in ${files})`;
    case "batch": return `batch_id in (select id from public.cb_reclass_batches where file_id in ${files})`;
    case "note": return `note_id in (select id from public.cb_review_notes where file_id in ${files})`;
  }
}
