// The answer-key run (piece CB2-0, step 1). For every folder in tests/answer-keys: load the fixture into the LOCAL
// database as a fresh client, run the engine, and compare with answer.json. Any difference fails the run.
//   npm run answer-keys              compare every folder
//   npm run answer-keys -- --write   save today's results as the answer key (the baseline); give the reason in the PR
//   npm run answer-keys -- <folder>  one folder only; --keep leaves the loaded copy in the database to look at
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadFixture, removeLoaded } from "./load.ts";
import { computeClient, signIn, type FileResult } from "./compute.ts";

const args = process.argv.slice(2);
const write = args.includes("--write"), keep = args.includes("--keep");
const root = path.resolve("tests/answer-keys");
const named = args.filter((a) => !a.startsWith("--"));
const folders = (named.length ? named : readdirSync(root).filter((f) => existsSync(path.join(root, f, "tables")))).sort();

function diff(want: unknown, got: unknown, at: string, out: string[]) {
  if (typeof want === "number" && typeof got === "number") { if (Math.round(want * 100) !== Math.round(got * 100)) out.push(`${at}: expected ${want.toFixed(2)}, got ${got.toFixed(2)}`); return; }
  if (Array.isArray(want) && Array.isArray(got) && want.every((x) => x && typeof x === "object" && "account" in x)) {
    const key = (r: Record<string, unknown>) => `${r.account} ${r.name}`;
    const g = new Map(got.map((r) => [key(r), r])), w = new Map(want.map((r) => [key(r), r]));
    for (const [k, r] of w) diff(r, g.get(k) ?? null, `${at} ${k}`, out);
    for (const k of g.keys()) if (!w.has(k)) out.push(`${at} ${k}: not in the answer key`);
    return;
  }
  if (want && got && typeof want === "object" && typeof got === "object") {
    for (const k of new Set([...Object.keys(want), ...Object.keys(got)])) diff((want as Record<string, unknown>)[k] ?? null, (got as Record<string, unknown>)[k] ?? null, `${at}.${k}`, out);
    return;
  }
  if (JSON.stringify(want) !== JSON.stringify(got)) out.push(`${at}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
}

const sb = await signIn();
let failed = 0;
for (const folder of folders) {
  const client = loadFixture(folder);
  try {
    const got: FileResult[] = await computeClient(sb, client);
    const file = path.join(root, folder, "answer.json");
    if (write || !existsSync(file)) {
      writeFileSync(file, JSON.stringify(got, null, 1) + "\n");
      console.log(`${folder}: answer key saved (${got.length} file${got.length === 1 ? "" : "s"}).`);
      continue;
    }
    const out: string[] = [];
    diff(JSON.parse(readFileSync(file, "utf8")), got, folder, out);
    if (out.length) { failed++; console.log(`${folder}: FAIL, ${out.length} difference${out.length === 1 ? "" : "s"}`); for (const l of out.slice(0, 60)) console.log(`  ${l}`); }
    else console.log(`${folder}: pass (${got.length} file${got.length === 1 ? "" : "s"}, ${got.reduce((n, f) => n + f.tb.length, 0)} accounts, ${got.reduce((n, f) => n + Object.keys(f.gifi).length, 0)} GIFI lines)`);
  } finally { if (!keep) removeLoaded(folder); }
}
process.exit(failed ? 1 : 0);
