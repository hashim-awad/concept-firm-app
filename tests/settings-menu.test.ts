// Run with: node --test tests/
// Round 17: the gear menu (settings-menu.ts) must match the real permission rules, so the menu never shows
// an entry or tab a person cannot open, and never hides one they can. These checks read the page code
// and the database function.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { GEAR, entryOpen, gearMenu, type GearDef, type Open } from "../src/app/(app)/admin/settings-menu.ts";

const APP = "src/app/(app)";
const ADMIN = join(APP, "admin");
const defs: GearDef[] = GEAR.flatMap(([, d]) => d);
// The code that does a menu entry's or tab's work: its view (round 17) or its page.
const codeOf = (dir: string) => readFileSync(join(ADMIN, dir, existsSync(join(ADMIN, dir, "view.tsx")) ? "view.tsx" : "page.tsx"), "utf8");
const allCode = (dir: string): string => readdirSync(dir).map((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? allCode(p) : /\.tsx?$/.test(f) ? readFileSync(p, "utf8") : "";
}).join("\n");
const units = defs.flatMap((d) => (d.tabs ?? [{ key: "", label: d.label, open: d.open!, ownerOnly: d.ownerOnly, settingKeys: d.settingKeys, dir: d.dir! }]).map((t) => ({ ...t, label: d.tabs ? `${d.label} › ${t.label}` : d.label, href: d.href })));

// Owner-only keys in the latest update_setting: a branch that calls private.is_owner().
function ownerKeys(): Set<string> {
  const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
  let body = "";
  for (const f of files) {
    const s = readFileSync(join("supabase/migrations", f), "utf8");
    const i = s.lastIndexOf("function public.update_setting(");
    if (i >= 0) body = s.slice(i, s.indexOf("$$;", i));
  }
  const re = /(?:if|elsif) p_key (?:=|in) (\([^)]*\)|'[^']+') then/g;
  const marks = [...body.matchAll(re)];
  const owner = new Set<string>();
  marks.forEach((m, n) => {
    const branch = body.slice(m.index!, n + 1 < marks.length ? marks[n + 1].index : undefined);
    if (branch.includes("private.is_owner()")) for (const k of m[1].matchAll(/'([^']+)'/g)) owner.add(k[1]);
  });
  assert.ok(owner.size > 0, "found update_setting");
  return owner;
}

function checkAccess(code: string, open: Open[], label: string) {
  const o = open.join("+");
  if (o === "owner") assert.match(code, /requireOwner\(\)|loadSettings\(true\)/, label);
  else if (o === "everyone") assert.match(code, /requireAccess\(\)/, label);
  else if (o === "settings") assert.match(code, /loadSettings\(\)/, label);
  else if (o === "staff_accounts+owner") assert.ok(code.includes('canView(access, "staff_accounts")') && code.includes("access.is_owner"), label);
  else assert.match(code, new RegExp(`requireAccess(WithPricing)?\\("${o}"`), label);
}

test("each menu entry and tab does its own access check, matching who the menu lets open it", () => {
  for (const u of units) checkAccess(codeOf(u.dir), u.open, u.label);
  assert.match(readFileSync(join(ADMIN, "settings/data.ts"), "utf8"), /requireAccess\("settings", "view"\)/);
});

test("each menu entry opens a page; a page of tabs shows only the tabs the person can open", () => {
  for (const d of defs) {
    const path = d.href.split("?")[0];
    assert.ok(existsSync(join(APP, path, "page.tsx")), `${d.label}: ${path} has no page`);
    if (d.tabs) assert.match(readFileSync(join(APP, path, "page.tsx"), "utf8"), new RegExp(`openTabs\\(access, "${path}"\\)`), d.label);
  }
});

test("settings pages: owner-only changes match update_setting in the database", () => {
  const owner = ownerKeys();
  for (const u of units.filter((x) => x.settingKeys)) {
    const flags = u.settingKeys!.map((k) => owner.has(k));
    assert.ok(flags.every((f) => f === flags[0]), `${u.label}: keys disagree`);
    assert.equal(!!u.ownerOnly, flags[0], `${u.label}: ownerOnly must be ${flags[0]}`);
  }
});

test("an owner-only action is really checked in the code", () => {
  for (const u of units.filter((x) => x.ownerOnly && !x.settingKeys)) assert.match(allCode(join(ADMIN, u.dir)), /is_owner|requireOwner/, u.label);
});

test("every page under /admin is a menu entry, a tab's old address that redirects, or a detail page", () => {
  const listed = new Set(defs.flatMap((d) => [d.href.split("?")[0], ...(d.also ?? [])]));
  const walk = (dir: string, route: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (!statSync(p).isDirectory()) continue;
      const r = `${route}/${f}`;
      if (existsSync(join(p, "page.tsx")) && !f.startsWith("[")) {
        const code = readFileSync(join(p, "page.tsx"), "utf8");
        const redirects = /redirectKeep\(/.test(code) || (/redirect\("/.test(code) && !/return\s*\(?\s*</.test(code));
        const parentListed = [...listed].some((l) => r.startsWith(l + "/"));
        assert.ok(listed.has(r) || redirects || parentListed, `${r} is not in the gear menu and does not redirect`);
      }
      walk(p, r);
    }
  };
  walk(ADMIN, "/admin");
});

test("no lock icons on the settings pages", () => {
  assert.doesNotMatch(allCode(ADMIN), /LockIcon|<Lock\b/);
});

test("the gear shows staff only what they can open; owners see the template count", () => {
  const staff = { is_owner: false, permissions: { settings: "view", engagement_terms: "view" } } as never;
  const owner = { is_owner: true, permissions: {} } as never;
  const s = gearMenu(staff, { closebook: 2 }).flatMap((c) => c.items.map((i) => i.label));
  assert.deepEqual(s.sort(), ["Change log", "Closebook", "Data retention", "Emails", "Firm details", "Lead sources", "Letters and proposals", "Online sales", "Schedules and terms", "T1 rule values"].sort());
  assert.equal(gearMenu(staff, { closebook: 2 }).flatMap((c) => c.items).find((i) => i.label === "Closebook")?.count, undefined);
  const o = gearMenu(owner, { closebook: 2 });
  assert.deepEqual(o.map((c) => c.label), ["Your firm", "Lists", "Templates", "Tools"]);
  assert.equal(o.flatMap((c) => c.items).find((i) => i.label === "Closebook")?.count, 2);
  for (const d of defs) assert.ok(entryOpen(d).length, d.label);
});
