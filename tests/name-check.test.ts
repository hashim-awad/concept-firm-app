// Run with: node --test tests/
// Piece 10b (Hashim, Nov 19, 2026): scripts/checks/name-check.sh. T6: a branch adding a 9-digit number that passes CRA's
// check digit fails, naming the file and line but never the number; the same branch with a number that fails passes.
// The passing number is worked out here when the test runs and is never written to the repository (T7 stays true).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { after } from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

const luhn = (d: string) => [...d].reverse().reduce((t, c, i) => { let n = Number(c); if (i % 2) { n *= 2; if (n > 9) n -= 9; } return t + n; }, 0) % 10 === 0;
// A made-up number that passes: eight digits from the clock, then the check digit that makes it pass.
const passing = (() => { const s = String(Date.now()).slice(-8); for (let c = 0; c < 10; c++) if (luhn(s + c)) return s + c; throw new Error("no check digit"); })();
const failing = passing.slice(0, 8) + String((Number(passing[8]) + 1) % 10);

const made: string[] = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "name-check-"));
  made.push(dir);
  const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.test" } });
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, "scripts/checks"), { recursive: true });
  copyFileSync("scripts/checks/name-check.sh", join(dir, "scripts/checks/name-check.sh"));
  writeFileSync(join(dir, "notes.txt"), "a dummy file\n");
  git("add", "."); git("commit", "-q", "-m", "start");
  git("checkout", "-q", "-b", "test-branch");
  return { dir, git };
}
const run = (dir: string, env: Record<string, string> = {}) => {
  const r = spawnSync("bash", ["scripts/checks/name-check.sh"], { cwd: dir, encoding: "utf8", env: { ...process.env, BASE_REF: "main", CLIENT_NAMES: "", GITHUB_ACTIONS: "", ...env } });
  return { code: r.status, out: r.stdout + r.stderr };
};

test("T6: a number that passes the check digit fails the check, by file and line, never the number", () => {
  assert.equal(luhn(passing), true); assert.equal(luhn(failing), false);
  const { dir, git } = repo();
  writeFileSync(join(dir, "client.csv"), `name,bn\nDummy Co,${passing}RC0001\n`);
  git("add", "."); git("commit", "-q", "-m", "add a dummy file");
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /client\.csv:2: a 9-digit number that passes the business number check digit \(value hidden\)/);
  assert.equal(r.out.includes(passing), false, "the number is never printed");
  assert.match(r.out, /CLIENT_NAMES is not set/);
  // The same branch with the number changed to one that fails the check digit passes.
  writeFileSync(join(dir, "client.csv"), `name,bn\nDummy Co,${failing}RC0001\n`);
  git("commit", "-q", "-am", "made-up number");
  const ok = run(dir);
  assert.equal(ok.code, 0, ok.out);
});

test("written 3-3-3, in a commit message, and client names from CLIENT_NAMES", () => {
  const { dir, git } = repo();
  writeFileSync(join(dir, "a.txt"), "x\n");
  git("add", "."); git("commit", "-q", "-m", `BN ${passing.slice(0, 3)} ${passing.slice(3, 6)} ${passing.slice(6)}`);
  const r = run(dir);
  assert.equal(r.code, 1);
  assert.match(r.out, /commit [0-9a-f]+, message line 1: a 9-digit number/);
  const { dir: d2, git: g2 } = repo();
  writeFileSync(join(d2, "b.md"), "# Notes\nWork for Willow Dummy Holdings this year\nwb" + passing + " is a key, not a number\n");
  g2("add", "."); g2("commit", "-q", "-m", "notes");
  const n = run(d2, { CLIENT_NAMES: "Zed Nobody Ltd.\r\nwillow dummy holdings\n\n" });
  assert.equal(n.code, 1);
  assert.match(n.out, /b\.md:2: a client name \(value hidden\)/);
  assert.equal(n.out.toLowerCase().includes("willow"), false, "the name is never printed");
  assert.equal(/b\.md:3/.test(n.out), false, "a number touching letters is not a business number");
  // "BN" right before the number, and dots between groups, still count.
  const { dir: d3, git: g3 } = repo();
  writeFileSync(join(d3, "c.txt"), `BN${passing}\n${passing.slice(0, 3)}.${passing.slice(3, 6)}.${passing.slice(6)}\n`);
  g3("add", "."); g3("commit", "-q", "-m", "c");
  const c = run(d3);
  assert.match(c.out, /c\.txt:1:/); assert.match(c.out, /c\.txt:2:/);
  assert.equal(c.out.includes(passing), false);
});
