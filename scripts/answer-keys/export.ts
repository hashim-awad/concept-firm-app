// Save a LOCAL dummy client, with all its Closebook files, as an answer-key fixture folder:
//   node --import ./scripts/answer-keys/register.mjs scripts/answer-keys/export.ts <client id> <folder name>
// Writes tests/answer-keys/<folder>/tables/<table>.json. Dummy data only: never export a real client.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { json } from "./db.ts";
import { fileTables, whereOf } from "./tables.ts";

const [client, folder] = process.argv.slice(2);
if (!client || !folder) throw new Error("Usage: export.ts <client id> <folder name>");
const name = json<string | null>(`select to_json(legal_name) from public.clients where id = '${client}'`);
if (!name || !/dummy/i.test(name)) throw new Error(`Only dummy clients are exported (legal name must contain "Dummy"): ${name}`);

const dir = path.resolve("tests/answer-keys", folder, "tables");
mkdirSync(dir, { recursive: true });
let n = 0;
for (const k of fileTables()) {
  const order = json<boolean>(`select to_json(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = '${k.table}' and column_name = 'id'))`);
  const rows = json<unknown[]>(`select coalesce(json_agg(t ${order ? "order by t.id" : ""}), '[]') from public.${k.table} t where ${whereOf(k, client)}`);
  if (!rows.length) continue;
  writeFileSync(path.join(dir, `${k.table}.json`), JSON.stringify(rows, null, 1) + "\n");
  n += rows.length;
  console.log(`${k.table}: ${rows.length}`);
}
console.log(`Saved ${n} rows of ${name} to tests/answer-keys/${folder}/tables.`);
