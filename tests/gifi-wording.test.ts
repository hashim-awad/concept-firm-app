// Run with: node --test tests/
// Piece R1 (Hashim, Nov 19, 2026), test T8 as narrowed by D10: the word "GIFI" shows on screen in Closebook only in
// step 2, step 3.1 ("Last year's T2 line"), step 4 on trial balance files, step 8, step 9 and the GIFI export. Comments,
// Settings, the changelog and internal code names are not on screen and are not checked. Each allowed file says why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/app/(app)/closebook";
const ALLOWED: Record<string, string> = {
  "[id]/t2-step.tsx": "step 8", "[id]/match-step.tsx": "step 8", "[id]/gst-section.tsx": "step 8", "[id]/export-button.tsx": "the GIFI export",
  "[id]/gifi/route.ts": "the GIFI export", "[id]/tax-workpaper/route.ts": "step 8", "[id]/opening-schedule.tsx": "step 2",
  "statements-actions.ts": "step 9", "[id]/accounts-table.tsx": "step 4 on trial balance files and step 8's window",
  "[id]/tb-tab.tsx": "step 4 on trial balance files (By GIFI line)", "[id]/shell/help.tsx": "the help of steps 2, 4 (trial balance files), 7 (trial balance files) and 8",
  "[id]/page.tsx": "step 8's empty-file lines",
};
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? files(p) : /\.(tsx?|ts)$/.test(f) ? [p] : []; });
// Code, not comments: line comments and JSX comments are left out.
const onScreen = (src: string) => src.split("\n").map((l) => l.replace(/\{\/\*.*?\*\/\}/g, "").replace(/(^|\s)\/\/.*$/, "")).filter((l) => !/^\s*(\*|\/\*)/.test(l));

test("T8: GIFI on screen only where allowed", () => {
  const hits: string[] = [];
  for (const f of files(ROOT)) {
    const rel = f.slice(ROOT.length + 1);
    if (ALLOWED[rel]) continue;
    onScreen(readFileSync(f, "utf8")).forEach((l, i) => { if (/GIFI/.test(l) && !/\bgifi[A-Z_]|[a-z]GIFI|"GIFI\.gfi"/.test(l)) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepEqual(hits, []);
});

test("T8: the Trial balance tab has no GIFI view, tag or link", () => {
  for (const f of ["[id]/areas/tb-area.tsx", "[id]/areas/tb-table.tsx", "[id]/areas/account-panel.tsx", "[id]/report-view.tsx", "[id]/areas/statements-area.tsx", "[id]/areas/sh-report.tsx", "[id]/shell/ui.tsx"]) {
    const code = onScreen(readFileSync(join(ROOT, f), "utf8")).join("\n");
    assert.doesNotMatch(code, /GIFI|tbv=match/, f);
  }
});
