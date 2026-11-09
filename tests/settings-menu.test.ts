// Run with: node --test tests/
// The Settings menu's locks must match the real permission rules (decision 48). These checks read the
// page code and the database function, so a lock cannot drift from what is enforced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { SETTINGS, lockFor, type SettingsDef } from "../src/app/(app)/admin/settings-menu.ts";

const APP = "src/app/(app)";
const defs: SettingsDef[] = SETTINGS.flatMap(([, d]) => d);
const live = defs.filter((d) => !d.soon);
const pageFile = (href: string) => join(APP, href, "page.tsx");
const allCode = (dir: string): string => readdirSync(dir).map((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? allCode(p) : /\.tsx?$/.test(f) ? readFileSync(p, "utf8") : "";
}).join("\n");

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

test("each page's own access check matches who the menu lets open it", () => {
  for (const d of live) {
    const code = readFileSync(pageFile(d.href), "utf8");
    const o = d.open.join("+");
    if (o === "owner") assert.match(code, /requireOwner\(\)|loadSettings\(true\)/, d.label);
    else if (o === "everyone") assert.match(code, /requireAccess\(\)/, d.label);
    else if (o === "settings") assert.match(code, /loadSettings\(\)/, d.label);
    else if (o === "staff_accounts+owner") assert.ok(code.includes('canView(access, "staff_accounts")') && code.includes("access.is_owner"), d.label);
    else assert.match(code, new RegExp(`requireAccess(WithPricing)?\\("${o}"`), d.label);
  }
  assert.match(readFileSync(join(APP, "admin/settings/data.ts"), "utf8"), /requireAccess\("settings", "view"\)/);
});

test("settings pages: lock for owner-only changes matches update_setting in the database", () => {
  const owner = ownerKeys();
  for (const d of defs.filter((x) => x.settingKeys)) {
    const flags = d.settingKeys!.map((k) => owner.has(k));
    assert.ok(flags.every((f) => f === flags[0]), `${d.label}: keys disagree`);
    assert.equal(!!d.ownerOnly, flags[0], `${d.label}: ownerOnly must be ${flags[0]}`);
  }
});

test("other pages: an owner-only action is really checked in their code", () => {
  for (const d of live.filter((x) => x.ownerOnly && !x.settingKeys)) {
    assert.match(allCode(join(APP, d.href)), /is_owner|requireOwner/, d.label);
  }
});

test("every page under /admin is in the Settings menu", () => {
  const listed = new Set(live.flatMap((d) => [d.href, ...(d.also ?? [])]));
  for (const dir of readdirSync(join(APP, "admin"))) {
    const p = join(APP, "admin", dir);
    if (!statSync(p).isDirectory() || dir === "settings") continue;
    if (existsSync(join(p, "page.tsx"))) assert.ok(listed.has(`/admin/${dir}`), `/admin/${dir} missing from the menu`);
  }
  for (const dir of readdirSync(join(APP, "admin/settings"))) {
    if (existsSync(join(APP, "admin/settings", dir, "page.tsx"))) assert.ok(listed.has(`/admin/settings/${dir}`), dir);
  }
});

test("locks shown", () => {
  const lock = (l: string) => lockFor(defs.find((d) => d.label === l)!);
  assert.equal(lock("Price book"), "Needs the Pricing permission. Only an owner can apply the price book clean-up");
  assert.equal(lock("Activity log"), "Owners only");
  for (const l of ["Lead assignment", "Retention", "Screening questions", "Lead sources", "Business hours", "Change log", "Team and roles"]) assert.equal(lock(l), undefined, l);
  for (const l of ["GST/HST rates", "Templates", "Public start page", "Signer names", "T1 rule values"]) assert.match(lock(l)!, /Only an owner/, l);
});
