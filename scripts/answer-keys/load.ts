// Load a fixture folder into the LOCAL database as a new client "AK <folder>", with fresh ids. Rows go in exactly as
// saved (triggers and foreign-key checks off for the load), so the engine sees the file as it was. Columns added after
// the fixture was saved take their defaults; private.cb_fixture_upgrade, when it exists, brings older data up to date
// the way the migrations brought Live up to date.
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { json, lit, sql } from "./db.ts";
import { fileTables, whereOf } from "./tables.ts";

type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function remap(v: unknown, ids: Map<string, string>): unknown {
  if (typeof v === "string") return UUID.test(v) && ids.has(v) ? ids.get(v) : v;
  if (Array.isArray(v)) return v.map((x) => remap(x, ids));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, remap(x, ids)]));
  return v;
}

export function removeLoaded(folder: string) {
  const old = json<string[]>(`select coalesce(json_agg(id), '[]') from public.clients where legal_name = ${lit(`AK ${folder}`)}`);
  const tables = fileTables().reverse();
  // CB2-1: the loaded client's Books client (its chart and History go with it).
  for (const id of old) sql(`begin; set local session_replication_role = replica;\n${tables.map((k) => `delete from public.${k.table} where ${whereOf(k, id)};`).join("\n")}
delete from public.cb_client_accounts where cb_client_id in (select id from public.cb_clients where studio_client_id = '${id}');
delete from public.cb_books_history where cb_client_id in (select id from public.cb_clients where studio_client_id = '${id}');
delete from public.cb_clients where studio_client_id = '${id}';\ncommit;`);
}

export function loadFixture(folder: string): string {
  const dir = path.resolve("tests/answer-keys", folder, "tables");
  if (!existsSync(dir)) throw new Error(`No fixture tables in ${dir}`);
  removeLoaded(folder);
  const data = new Map<string, Row[]>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) data.set(f.slice(0, -5), JSON.parse(readFileSync(path.join(dir, f), "utf8")) as Row[]);
  const ids = new Map<string, string>();
  for (const rows of data.values()) for (const r of rows) if (typeof r.id === "string" && UUID.test(r.id)) ids.set(r.id, randomUUID());
  const client = data.get("clients")?.[0];
  if (!client) throw new Error(`${folder}: no clients.json`);
  const clientId = ids.get(client.id as string)!;
  const cols = json<Record<string, string[]>>(`select json_object_agg(table_name, cols) from (select table_name, json_agg(column_name) cols from information_schema.columns
    where table_schema = 'public' and is_generated = 'NEVER' group by table_name) x`);
  const parts = ["begin;", "set local session_replication_role = replica;"];
  for (const [table, rows] of data) {
    const have = new Set(cols[table] ?? []);
    if (!have.size) throw new Error(`${folder}: table ${table} no longer exists`);
    const fixed = rows.map((r) => remap(r, ids) as Row);
    if (table === "clients") for (const r of fixed) { r.legal_name = `AK ${folder}`; r.taxdome_account_id = null; if (r.business_number) r.business_number = `8${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`; }
    // Saved before CB2-0 v7 item 3: the "Reclass entry" box follows the entry type, as the migration sets it.
    if (table === "cb_entries") for (const r of fixed) if (!("is_reclass" in r)) r.is_reclass = r.kind === "RJE";
    const keys = [...new Set(fixed.flatMap((r) => Object.keys(r)))].filter((k) => have.has(k));
    const list = keys.map((k) => `"${k}"`).join(", ");
    parts.push(`insert into public.${table} (${list}) overriding system value select ${list} from jsonb_populate_recordset(null::public.${table}, ${lit(JSON.stringify(fixed))}::jsonb);`);
  }
  // CB2-1: the fixture's Books client (the trigger that makes it is off while loading).
  parts.push(`do $$ declare v uuid; begin if to_regclass('public.cb_clients') is not null then
    insert into public.cb_clients (firm_id, studio_client_id, name, province) select f.firm_id, c.id, c.legal_name, coalesce(nullif(c.province, ''), 'ON')
      from public.clients c join public.cb_files f on f.client_id = c.id where c.id = '${clientId}' limit 1 returning id into v;
    update public.cb_files set cb_client_id = v where client_id = '${clientId}'; end if; end $$;`);
  parts.push(`do $$ begin if to_regprocedure('private.cb_fixture_upgrade(uuid)') is not null then perform private.cb_fixture_upgrade(f.id) from public.cb_files f where f.client_id = '${clientId}'; end if; end $$;`);
  parts.push("commit;");
  sql(parts.join("\n"));
  return clientId;
}
