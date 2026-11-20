// Closebook function parity (round 15, Hashim, Nov 14, 2026): "nothing about how anything works changes".
// Crawls every Closebook screen of the local dummy files as the dummy preparer and the dummy owner and
// records, per screen, the functions it offers:
//   - each server action a form or button posts to (Next.js renders "$ACTION_ID_<id>"; the id is fixed
//     by the action's file and name, so it is the same before and after a layout change), with the
//     names of the fields it sends;
//   - each download or export address (report exports, packages, workpapers, PDFs).
// Run it on the build before a layout change and after, then compare:
//   node scripts/checks/closebook-function-parity.mjs capture before.json
//   node scripts/checks/closebook-function-parity.mjs capture after.json
//   node scripts/checks/closebook-function-parity.mjs compare before.json after.json
//   PARITY_FILES=<id>,<id> limits the crawl to those files (UI1).
// Local only: it needs the app on http://localhost:3300 and the dummy accounts and files (no client data).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { checkBuildKey } from "./parity-key.mjs";

// UI1: the default port is the one scripts/dev/up.sh serves on.
const BASE = process.env.APP_URL ?? "http://localhost:3301";
const USERS = { staff: "staff.dummy@example.test", owner: "owner.dummy@example.test" };
const PASS = process.env.DUMMY_PASS ?? "dummy-pass-123";
// Piece 10 renamed step 6 "mapping" to "compare" (UI1 spec-checker item 15).
const STEPS = ["setup", "opening", "records", "code", "entries", "compare", "review", "t2", "statements", "lock"];
// Round 15b: steps hold working papers, and entries open in a dialog on the Entries tab.
const PAPERS = { entries: ["revenue", "sh", "expenses"], t2: ["gifi", "taxwp", "tie", "gst"], statements: ["package", "mal"], lock: ["checklist", "email", "documents", "filing"] };
const REPORTS = ["tb", "bs", "pl", "gl", "journal"];
const ENDPOINT = /\/(report-export|package|gst-workpaper|tax-workpaper|opening-pdf|gifi|close|client-entries)(\/|\?|$)|\/admin\/closebook\/.+\/(export|download)/;

// The screens of one file: every step (step 6's two views), every report, and the file history. Old
// addresses keep working after round 15 (they open the matching tab), so the same list covers both.
const fileScreens = (id) => [
  ...STEPS.map((s) => `/closebook/${id}?step=${s}`), `/closebook/${id}?step=review&view=lead`,
  ...Object.entries(PAPERS).flatMap(([s, ps]) => ps.map((p) => `/closebook/${id}?step=${s}&paper=${p}`)),
  `/closebook/${id}?area=entries`, `/closebook/${id}?area=entries&new=journal`, `/closebook/${id}?area=entries&new=revenue`, "OPEN_FIRST_ENTRY",
  ...REPORTS.map((r) => `/closebook/${id}?report=${r}`), `/closebook/${id}?history=1`,
];
const SETTINGS = ["thresholds", "gifi-lines", "lead-sheets", "policy", "standard-entries", "tax-codes", "vendor-rules", "gst"].map((p) => `/admin/closebook/${p}`);

async function login(browser, who) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#email", USERS[who]); await p.fill("#password", PASS);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button[type=submit]")]);
  return p;
}

async function inventory(p, url) {
  await p.goto(BASE + url, { waitUntil: "networkidle" });
  return p.evaluate((endpointSrc) => {
    const endpoint = new RegExp(endpointSrc);
    const actions = new Map();
    for (const el of document.querySelectorAll('[name^="$ACTION_ID_"]')) {
      const id = el.getAttribute("name").slice("$ACTION_ID_".length);
      const form = el.closest("form");
      const fields = form ? [...new Set([...form.querySelectorAll("[name]")].map((x) => x.getAttribute("name")).filter((n) => n && !n.startsWith("$ACTION")))].sort() : [];
      const prev = actions.get(id) ?? new Set();
      fields.forEach((f) => prev.add(f));
      actions.set(id, prev);
    }
    const ends = new Set();
    for (const a of document.querySelectorAll("a[href]")) {
      const u = new URL(a.getAttribute("href"), location.href);
      if (endpoint.test(u.pathname + u.search)) ends.add(u.pathname.replace(/[0-9a-f-]{36}/g, ":id") + (u.searchParams.get("format") ? `?format=${u.searchParams.get("format")}` : "") + (u.searchParams.get("doc") ? `&doc=${u.searchParams.get("doc")}` : "") + (u.searchParams.get("report") ? `&report=${u.searchParams.get("report")}` : ""));
    }
    return { actions: Object.fromEntries([...actions].map(([k, v]) => [k, [...v].sort()])), endpoints: [...ends].sort() };
  }, ENDPOINT.source);
}

async function capture(out) {
  checkBuildKey();
  const browser = await chromium.launch();
  const result = {};
  for (const who of Object.keys(USERS)) {
    const p = await login(browser, who);
    await p.goto(`${BASE}/closebook/files`);
    const listed = await p.locator('a[href^="/closebook/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")).filter((h) => /^\/closebook\/[0-9a-f-]{36}$/.test(h)).map((h) => h.slice(11)))]);
    // UI1: the local database holds hundreds of dummy files (about 40 screens each). PARITY_FILES (ids, comma-separated)
    // limits the crawl to a sample that covers each kind of file; the same sample must be used before and after.
    const only = (process.env.PARITY_FILES ?? "").split(",").filter(Boolean);
    // With no PARITY_FILES and a large dummy set, the first PARITY_SAMPLE files listed (default 6) are crawled: the list is in
    // a fixed order, so a before and an after on the same data crawl the same files. Name files with PARITY_FILES to cover
    // each kind (bank-statement, trial balance, locked).
    const sample = Number(process.env.PARITY_SAMPLE ?? 6);
    const files = only.length ? listed.filter((f) => only.includes(f)) : listed.length > 20 ? listed.slice(0, sample) : listed;
    if (!only.length && listed.length > 20) console.warn(`${who}: ${listed.length} files listed; crawling the first ${files.length} (set PARITY_FILES or PARITY_SAMPLE).`);
    const urls = ["/closebook", "/closebook/files", "/closebook/notes", ...SETTINGS, ...files.flatMap(fileScreens)];
    for (let u of urls) {
      if (u === "OPEN_FIRST_ENTRY") continue;
      // The first entry of the file, opened read-only and in Edit, when the file has entries.
      if (/area=entries$/.test(u)) {
        try {
          result[`${who} ${u}`] = await inventory(p, u);
          const open = await p.locator('a[href*="&open="]').first().getAttribute("href", { timeout: 2000 }).catch(() => null);
          if (open) for (const x of [open, `${open}&edit=1`]) result[`${who} ${x.replace(/open=[0-9a-f-]{36}/, "open=:first")}|${u.split("?")[0]}`] = await inventory(p, x);
        } catch (e) { result[`${who} ${u}`] = { error: String(e).slice(0, 200) }; }
        continue;
      }
      try { result[`${who} ${u}`] = await inventory(p, u); } catch (e) { result[`${who} ${u}`] = { error: String(e).slice(0, 200) }; }
    }
    console.log(who, urls.length, "screens");
  }
  await browser.close();
  writeFileSync(out, JSON.stringify(result, null, 1));
}

// Every function on every screen before is still on that screen after (more is allowed). A screen's
// functions may sit in a panel or popover on the same screen; it is the same address either way.
function compare(a, b) {
  const A = JSON.parse(readFileSync(a, "utf8")), B = JSON.parse(readFileSync(b, "utf8"));
  let missing = 0, screens = 0;
  for (const [k, v] of Object.entries(A)) {
    screens++;
    const w = B[k];
    if (!w || w.error) { console.log(`MISSING SCREEN ${k} ${w?.error ?? ""}`); missing++; continue; }
    for (const [id, fields] of Object.entries(v.actions ?? {})) {
      if (!w.actions[id]) { console.log(`MISSING ACTION ${k}: ${id} (${fields.join(", ")})`); missing++; continue; }
      const lost = fields.filter((f) => !w.actions[id].includes(f));
      if (lost.length) { console.log(`FIELDS LOST ${k}: ${id} (${lost.join(", ")})`); missing++; }
    }
    for (const e of v.endpoints ?? []) if (!w.endpoints.includes(e)) { console.log(`MISSING EXPORT ${k}: ${e}`); missing++; }
  }
  const count = (X) => Object.values(X).reduce((n, v) => n + Object.keys(v.actions ?? {}).length + (v.endpoints ?? []).length, 0);
  console.log(`${screens} screens; functions before ${count(A)}, after ${count(B)}; ${missing ? `${missing} missing` : "every function still on its screen"}.`);
  process.exit(missing ? 1 : 0);
}

// Round 15b: functions move between screens by design (papers, the entry dialog), so compare each file's
// functions as a whole: every function a file offered before, it still offers somewhere after. Screens
// outside a file are still compared one by one.
function compareByFile(a, b) {
  const A = JSON.parse(readFileSync(a, "utf8")), B = JSON.parse(readFileSync(b, "utf8"));
  const group = (X) => {
    const g = new Map();
    for (const [k, v] of Object.entries(X)) {
      if (v.error) continue;
      const m = /^(\w+) \/closebook\/([0-9a-f-]{36})/.exec(k) ?? /^(\w+) .*\|\/closebook\/([0-9a-f-]{36})$/.exec(k);
      const key = m ? `${m[1]} file ${m[2]}` : k;
      const cur = g.get(key) ?? { actions: {}, endpoints: new Set() };
      for (const [id, fields] of Object.entries(v.actions ?? {})) cur.actions[id] = [...new Set([...(cur.actions[id] ?? []), ...fields])];
      (v.endpoints ?? []).forEach((e) => cur.endpoints.add(e));
      g.set(key, cur);
    }
    return g;
  };
  const GA = group(A), GB = group(B);
  let missing = 0;
  for (const [k, v] of GA) {
    const w = GB.get(k);
    if (!w) { console.log(`MISSING ${k}`); missing++; continue; }
    for (const [id, fields] of Object.entries(v.actions)) {
      if (!w.actions[id]) { console.log(`MISSING ACTION ${k}: ${id} (${fields.join(", ")})`); missing++; continue; }
      const lost = fields.filter((f) => !w.actions[id].includes(f));
      if (lost.length) { console.log(`FIELDS LOST ${k}: ${id} (${lost.join(", ")})`); missing++; }
    }
    for (const e of v.endpoints) if (!w.endpoints.has(e)) { console.log(`MISSING EXPORT ${k}: ${e}`); missing++; }
  }
  console.log(`${GA.size} files and pages; ${missing ? `${missing} missing` : "every function still offered"}.`);
  process.exit(missing ? 1 : 0);
}

const [cmd, x, y] = process.argv.slice(2);
if (cmd === "capture") await capture(x);
else if (cmd === "compare") compare(x, y);
else if (cmd === "compare-files") compareByFile(x, y);
else { console.log("usage: capture <out.json> | compare <before.json> <after.json>"); process.exit(2); }
