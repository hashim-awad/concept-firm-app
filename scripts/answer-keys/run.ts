// The answer-key run (piece CB2-0, step 1). For every folder in tests/answer-keys: load the fixture into the LOCAL
// database as a fresh client, run the engine, and compare with answer.json. Any difference fails the run.
//   npm run answer-keys              compare every folder
//   npm run answer-keys -- --write   save today's results as the answer key (the baseline); give the reason in the PR
//   npm run answer-keys -- <folder>  one folder only; --keep leaves the loaded copy in the database to look at
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { loadFixture, removeLoaded } from "./load.ts";
import { computeClient, signIn, type FileResult } from "./compute.ts";
import { checkExternal } from "./external.ts";
import { checkBooks, saveOpeningAsEntry } from "../books/parity.ts";

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
    // CB2-0 v7 item 6: bug checks on every file (not user rules). The balance sheet balances (GIFI 2599 = 3499 + 3620;
    // the engine's GIFI totals are credit-positive from 2600) and the statements' net income (9999) equals the trial
    // balance's (revenue and expense accounts, GIFI 8000 and up, credit-positive).
    for (const f of got) {
      const g = (c: string) => Math.round((f.gifi[c] ?? 0) * 100);
      const bs = g("2599") - g("3499") - g("3620");
      const tbNi = -f.tb.filter((r) => Number(r.gifi.slice(0, 4)) >= 8000).reduce((n, r) => n + Math.round(r.final * 100), 0);
      const ni = Math.round(f.net_income * 100);
      const bad = [...(bs !== 0 ? [`total assets ${g("2599") / 100} do not equal total liabilities ${g("3499") / 100} plus equity ${g("3620") / 100}`] : []),
        ...(tbNi !== ni ? [`statement net income ${ni / 100} does not equal trial balance net income ${tbNi / 100}`] : [])];
      if (bad.length) { failed++; console.log(`${folder} ${f.year_end}: BUG CHECK FAILED`); for (const l of bad) console.log(`  ${l}`); }
      else console.log(`${folder} ${f.year_end}: balance sheet balances; net income ties to the trial balance`);
    }
    // CB2-1 Part 4.1 and 4.3: Books gives the same figures as today's reports; then the opening balances are saved as an
    // ordinary journal entry (as anyone saving a change to them in Books does) and the figures are the same again.
    const { data: bc } = await sb.from("cb_clients").select("id").eq("studio_client_id", client).maybeSingle();
    if (!bc) { failed++; console.log(`${folder}: BOOKS FAILED: no Books client`); }
    else {
      const b1 = await checkBooks(sb, bc.id as string);
      const saved = await saveOpeningAsEntry(sb, bc.id as string);
      const b2 = await checkBooks(sb, bc.id as string);
      const fails = [...b1.fails, ...saved.fails, ...b2.fails.map((l) => `after saving the opening entry: ${l}`)];
      if (fails.length) { failed++; console.log(`${folder}: BOOKS FAILED`); for (const l of fails.slice(0, 30)) console.log(`  ${l}`); }
      else console.log(`${folder}: Books reports equal today's (${b1.years} year${b1.years === 1 ? "" : "s"}); ${saved.note}`);
    }
    // A hand-written answer key in source/ (the CSV answer keys) is checked on every run, before the baseline.
    const ext = path.join(root, folder, "source", "answer_key.json");
    if (existsSync(ext)) {
      const kf = path.join(root, folder, "known-differences.json");
      const r = checkExternal(got[got.length - 1], JSON.parse(readFileSync(ext, "utf8")), existsSync(kf) ? JSON.parse(readFileSync(kf, "utf8")) : {});
      console.log(`${folder}: hand-written key, ${r.checked} figures, ${r.fails.length} difference${r.fails.length === 1 ? "" : "s"}${r.known.length ? `, ${r.known.length} known` : ""}`);
      for (const l of [...r.fails, ...r.known]) console.log(`  ${l}`);
      if (r.fails.length) failed++;
    }
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
