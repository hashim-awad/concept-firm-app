// Round 17 (the frame, Hashim, Nov 15, 2026): moving Settings into the gear menu and merging pages into
// tabs must not lose a function. Crawls every menu page, Settings page and tab as the dummy owner and the
// dummy staff member, and records the server actions each one offers (Next.js renders "$ACTION_ID_<id>";
// the id is fixed by the action's file and name) with the fields each form sends, and every link to a
// download or export. Pages move by design, so the compare is per person across all pages: every action
// and field a person had before, they still have somewhere after. It also opens each old address and
// records where it lands, so a redirect that breaks shows up.
//   node scripts/checks/frame-function-parity.mjs capture before.json
//   node scripts/checks/frame-function-parity.mjs capture after.json
//   node scripts/checks/frame-function-parity.mjs compare before.json after.json
// Local only: the app on http://localhost:3300 and the dummy accounts (no client data).
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.APP_URL ?? "http://localhost:3300";
const USERS = { staff: "staff.dummy@example.test", owner: "owner.dummy@example.test" };
const PASS = process.env.DUMMY_PASS ?? "dummy-pass-123";
const EXPORT = /\/(export|download|csv|xlsx|pdf)(\/|\?|$)|format=/;

// Every address that opened a page before round 17, and every page after it (with its tabs). Detail pages
// (one price, one screening set, one GIFI line, one template) are found from links on their list page.
const PAGES = [
  "/", "/leads", "/quotes", "/clients", "/engagements", "/engagement-letters", "/documents", "/closebook", "/closebook/files", "/closebook/notes",
  "/admin/settings", "/admin/team", "/admin/team?tab=people", "/admin/team?tab=roles",
  "/admin/settings/business-hours", "/admin/settings/start-page", "/admin/settings/lead-assignment", "/admin/settings/lead-sources", "/admin/settings/booking-link",
  "/admin/screening", "/admin/price-book", "/admin/price-book/packages", "/admin/price-book/cleanup", "/admin/t1-price-check", "/admin/tax-rates",
  "/admin/settings/signers", "/admin/settings/signature", "/admin/templates", "/admin/templates/history", "/admin/templates/publish", "/admin/settings/signing-email",
  "/admin/settings/t1-rules", "/admin/closebook/gifi-lines", "/admin/closebook/tax-codes", "/admin/closebook/lead-sheets", "/admin/closebook/standard-entries",
  "/admin/closebook/vendor-rules", "/admin/closebook/thresholds", "/admin/closebook/gst", "/admin/closebook/policy", "/admin/taxdome-import", "/admin/import",
  "/admin/settings/retention", "/admin/export", "/admin/activity", "/admin/changelog",
  // Round 17 pages and tabs (they do not exist before; the crawl records them as missing there).
  "/admin/firm", "/admin/firm?tab=hours", "/admin/firm?tab=signers", "/admin/firm?tab=signature",
  "/admin/online-sales", "/admin/online-sales?tab=start", "/admin/online-sales?tab=screening", "/admin/online-sales?tab=booking", "/admin/online-sales?tab=assignment",
  "/admin/email-sending", "/admin/closebook-rules", "/admin/closebook-rules?tab=thresholds", "/admin/closebook-rules?tab=policy", "/admin/closebook-rules?tab=due-dates",
  "/admin/connections", "/admin/retention", "/admin/sales-tax", "/admin/sales-tax?tab=rates", "/admin/sales-tax?tab=quick", "/admin/t1-rules", "/admin/lead-sources",
  "/admin/chart", "/admin/chart?tab=gifi", "/admin/chart?tab=tax-codes", "/admin/chart?tab=lead-sheets", "/admin/standard-entries", "/admin/vendor-rules",
  "/admin/templates?tab=letters", "/admin/templates?tab=schedules", "/admin/templates?tab=emails", "/admin/templates?tab=closebook",
];
const DETAIL = [/^\/admin\/price-book\/(packages\/)?[0-9a-f-]{36}$/, /^\/admin\/screening\/[0-9a-f-]{36}$/, /^\/admin\/closebook\/gifi-lines\/[^/?]+$/, /^\/admin\/templates\/(?!history|publish)[A-Za-z0-9]+$/, /^\/admin\/roles\/[0-9a-f-]{36}$/];

async function login(browser, who) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${BASE}/login`);
  await p.fill("#email", USERS[who]); await p.fill("#password", PASS);
  await Promise.all([p.waitForURL((u) => !u.pathname.startsWith("/login")), p.click("button[type=submit]")]);
  return p;
}

async function inventory(p, url) {
  const res = await p.goto(BASE + url, { waitUntil: "networkidle" });
  const landed = new URL(p.url()); 
  const data = await p.evaluate((exportSrc) => {
    const exp = new RegExp(exportSrc);
    const actions = {};
    for (const el of document.querySelectorAll('[name^="$ACTION_ID_"]')) {
      const id = el.getAttribute("name").slice("$ACTION_ID_".length);
      const form = el.closest("form");
      const fields = form ? [...form.querySelectorAll("[name]")].map((x) => x.getAttribute("name")).filter((n) => n && !n.startsWith("$ACTION")) : [];
      actions[id] = [...new Set([...(actions[id] ?? []), ...fields])].sort();
    }
    const links = [...document.querySelectorAll("a[href]")].map((a) => new URL(a.getAttribute("href"), location.href)).filter((u) => u.origin === location.origin);
    return { actions, exports: [...new Set(links.filter((u) => exp.test(u.pathname + u.search)).map((u) => u.pathname.replace(/[0-9a-f-]{36}/g, ":id")))].sort(), links: [...new Set(links.map((u) => u.pathname))] };
  }, EXPORT.source);
  return { status: res?.status() ?? 0, landed: landed.pathname + landed.search, notFound: (await p.locator("text=This page could not be found").count()) > 0, ...data };
}

async function capture(out) {
  const browser = await chromium.launch();
  const result = {};
  for (const who of Object.keys(USERS)) {
    const p = await login(browser, who);
    const seen = new Set();
    const queue = [...PAGES];
    while (queue.length) {
      const u = queue.shift();
      if (seen.has(u)) continue; seen.add(u);
      try {
        const r = await inventory(p, u);
        // One detail page of each kind, found from the list pages' links.
        for (const l of r.links) if (DETAIL.some((d) => d.test(l)) && ![...seen, ...queue].some((s) => DETAIL.find((d) => d.test(l))?.test(s))) queue.push(l);
        delete r.links;
        result[`${who} ${u}`] = r;
      } catch (e) { result[`${who} ${u}`] = { error: String(e).slice(0, 200) }; }
    }
    console.log(who, seen.size, "pages");
  }
  await browser.close();
  writeFileSync(out, JSON.stringify(result, null, 1));
}

// Per person: every action (with its fields) and every export before is still offered somewhere after;
// every old address still opens a page (directly or by redirect).
function compare(a, b, allowed = []) {
  const A = JSON.parse(readFileSync(a, "utf8")), B = JSON.parse(readFileSync(b, "utf8"));
  const union = (X, who) => {
    const acts = {}, exps = new Set();
    for (const [k, v] of Object.entries(X)) {
      if (!k.startsWith(who + " ") || v.error || v.notFound) continue;
      for (const [id, f] of Object.entries(v.actions ?? {})) acts[id] = [...new Set([...(acts[id] ?? []), ...f])];
      (v.exports ?? []).forEach((e) => exps.add(e));
    }
    return { acts, exps };
  };
  let missing = 0;
  for (const who of Object.keys(USERS)) {
    const x = union(A, who), y = union(B, who);
    for (const [id, f] of Object.entries(x.acts)) {
      if (allowed.includes(id)) { console.log(`REMOVED BY DECISION ${who}: ${id} (${f.join(", ")})`); continue; }
      if (!y.acts[id]) { console.log(`MISSING ACTION ${who}: ${id} (${f.join(", ")})`); missing++; continue; }
      const lost = f.filter((n) => !y.acts[id].includes(n));
      if (lost.length) { console.log(`FIELDS LOST ${who}: ${id} (${lost.join(", ")})`); missing++; }
    }
    for (const e of x.exps) if (!y.exps.has(e)) { console.log(`MISSING EXPORT ${who}: ${e}`); missing++; }
    console.log(`${who}: actions before ${Object.keys(x.acts).length}, after ${Object.keys(y.acts).length}; exports before ${x.exps.size}, after ${y.exps.size}`);
  }
  for (const [k, v] of Object.entries(A)) {
    if (v.error || v.notFound || v.status >= 400) continue;
    const w = B[k];
    if (!w || w.error || w.notFound || w.status >= 400) { console.log(`OLD ADDRESS BROKEN ${k}: ${w?.error ?? w?.status ?? "not crawled"}`); missing++; }
    else if (w.landed !== k.split(" ")[1]) console.log(`REDIRECT ${k} -> ${w.landed}`);
  }
  console.log(missing ? `${missing} missing` : "Every function still offered to the same people; every old address opens.");
  process.exit(missing ? 1 : 0);
}

const [cmd, x, y, ...rest] = process.argv.slice(2);
if (cmd === "capture") await capture(x);
else if (cmd === "compare") compare(x, y, rest);
else { console.log("usage: capture <out.json> | compare <before.json> <after.json> [removed action ids]"); process.exit(2); }
