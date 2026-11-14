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
// Local only: it needs the app on http://localhost:3300 and the dummy accounts and files (no client data).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://localhost:3300";
const USERS = { staff: "staff.dummy@example.test", owner: "owner.dummy@example.test" };
const PASS = process.env.DUMMY_PASS ?? "dummy-pass-123";
const STEPS = ["setup", "opening", "records", "code", "entries", "review", "mapping", "t2", "statements", "lock"];
const REPORTS = ["tb", "bs", "pl", "gl", "journal"];
const ENDPOINT = /\/(report-export|package|gst-workpaper|tax-workpaper|opening-pdf|gifi|close|client-entries)(\/|\?|$)|\/admin\/closebook\/.+\/(export|download)/;

// The screens of one file: every step (step 6's two views), every report, and the file history. Old
// addresses keep working after round 15 (they open the matching tab), so the same list covers both.
const fileScreens = (id) => [
  ...STEPS.map((s) => `/closebook/${id}?step=${s}`), `/closebook/${id}?step=review&view=lead`,
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
  const browser = await chromium.launch();
  const result = {};
  for (const who of Object.keys(USERS)) {
    const p = await login(browser, who);
    await p.goto(`${BASE}/closebook/files`);
    const files = await p.locator('a[href^="/closebook/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")).filter((h) => /^\/closebook\/[0-9a-f-]{36}$/.test(h)).map((h) => h.slice(11)))]);
    const urls = ["/closebook", "/closebook/files", "/closebook/notes", ...SETTINGS, ...files.flatMap(fileScreens)];
    for (const u of urls) {
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

const [cmd, x, y] = process.argv.slice(2);
if (cmd === "capture") await capture(x);
else if (cmd === "compare") compare(x, y);
else { console.log("usage: capture <out.json> | compare <before.json> <after.json>"); process.exit(2); }
