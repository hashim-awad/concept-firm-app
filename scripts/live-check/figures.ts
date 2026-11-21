// CB2-0 v7 item 11: the figures of every file in the LOCAL database (a read-only copy of Live, made by copy-live.sh on a
// throwaway runner), worked out by this branch's engine exactly as the answer keys do. It writes keyed hashes only, never a
// figure: each figure is hashed with a secret key, so the file kept between the before and after runs shows which figures
// moved, not what they are. Run: node --import ./scripts/answer-keys/register.mjs scripts/live-check/figures.ts <out.json>
import { createHmac } from "node:crypto";
import { writeFileSync } from "node:fs";
import { computeClient, signIn, type FileResult } from "../answer-keys/compute.ts";
import { json } from "../answer-keys/db.ts";

const key = process.env.LIVE_CHECK_KEY ?? "";
if (key.length < 12) throw new Error("LIVE_CHECK_KEY is missing.");
const out = process.argv[2];
if (!out) throw new Error("Give the output file.");
const h = (s: string) => createHmac("sha256", key).update(s).digest("hex").slice(0, 32);

// Every figure of a file, by name: trial balance columns per account, net income, GIFI lines, GST/HST return lines.
export function flatten(f: FileResult): Record<string, string> {
  const r: Record<string, string> = {};
  for (const t of f.tb) for (const c of ["prior", "prelim", "adj", "reclass", "final"] as const) r[`tb.${t.account}|${t.name}.${c}`] = String(t[c]);
  r.net_income = String(f.net_income);
  for (const [c, v] of Object.entries(f.gifi)) r[`gifi.${c}`] = String(v);
  (f.gst ?? []).forEach((p, i) => { for (const [l, v] of Object.entries(p.lines)) r[`gst.${i}.${l}`] = String(v); });
  return r;
}

const files = json<{ id: string; client_id: string; year_end: string; paid21500: boolean }[]>(`select coalesce(json_agg(x order by x.client_id, x.year_end), '[]') from (
  select f.id, f.client_id, f.year_end,
    exists (select 1 from public.cb_bank_lines l where l.file_id = f.id and l.status in ('done', 'reviewer') and l.chart_account = '21500')
    or exists (select 1 from public.cb_line_splits s join public.cb_bank_lines l on l.id = s.line_id where l.file_id = f.id and s.chart_account = '21500') as paid21500
  from public.cb_files f) x`);
const sb = await signIn();
const result: Record<string, { paid21500: boolean; figures: Record<string, string> }> = {};
for (const client of [...new Set(files.map((f) => f.client_id))]) {
  const mine = files.filter((f) => f.client_id === client);   // computeClient works the files out by year end, as here
  const got = await computeClient(sb, client);
  mine.forEach((f, i) => {
    const flat = got[i] ? flatten(got[i]) : {};
    result[f.id] = { paid21500: f.paid21500, figures: Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, h(`${f.id}|${k}|${v}`)])) };
  });
}
writeFileSync(out, JSON.stringify(result));
console.log(`Figures worked out for ${Object.keys(result).length} files (hashes only).`);
