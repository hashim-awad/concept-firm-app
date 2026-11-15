// The test reader (round 20): no API key, no cost. On when STATEMENT_READER is "fixture" and the app is not
// the production deployment (VERCEL_ENV "production"). It finds the uploaded file by the sha256 of its bytes
// (as uploaded) in tests/fixtures/statements/manifest.json:
//   { "<sha256 hex>": { "file": "chequing.pdf", "result": "chequing.json" } }   result: a ReadResult
//   { "<sha256 hex>": { "file": "...", "error": "out_of_credits" | "unreadable" } }
// It records model "fixture", tokens from a fixed estimate, and cost 0.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { OUT_OF_CREDITS, type ReadResult, type StatementAccount, type StatementLine } from "./types.ts";
import { ReaderError, type ReadOutput } from "./reader.ts";

export const FIXTURE_MODEL = "fixture";
export const fixtureMode = (env: Record<string, string | undefined> = process.env) => env.STATEMENT_READER === "fixture" && env.VERCEL_ENV !== "production";
export const defaultFixtureDir = () => path.join(process.cwd(), "tests", "fixtures", "statements");

type Entry = { file?: string; result?: string; error?: "out_of_credits" | "unreadable" };

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

// A fixed estimate, so the screens have figures to show: about 1,600 tokens a page in, 45 a line out.
export function estimateTokens(r: ReadResult): { inputTokens: number; outputTokens: number } {
  const lines = r.accounts.reduce((n, a) => n + a.lines.length, 0);
  return { inputTokens: 600 + 1600 * Math.max(r.pages, 1), outputTokens: 200 + 45 * lines };
}

// Fills what a hand-written fixture may leave out (keys, ids, source, nulls), so the rest of the app can trust it.
export function normalizeResult(r: ReadResult, pages: number): ReadResult {
  let n = 0;
  const accounts: StatementAccount[] = (r.accounts ?? []).map((a, i) => ({
    ...a,
    key: a.key || `a${i + 1}`,
    last4: a.last4 ?? "",
    summary: a.summary ?? null,
    lines: (a.lines ?? []).map((l): StatementLine => ({
      ...l,
      id: l.id || `l${++n}`,
      balanceCents: l.balanceCents ?? null,
      page: l.page || 1,
      unsure: l.unsure === true,
      unsureReason: l.unsureReason ?? "",
      source: l.source ?? "read",
    })),
  }));
  return { bank: r.bank ?? "", pages: r.pages || pages, accounts };
}

export async function readFixture(original: Uint8Array, pages: number, dir: string = defaultFixtureDir()): Promise<ReadOutput> {
  let manifest: Record<string, Entry>;
  try {
    manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as Record<string, Entry>;
  } catch {
    throw new ReaderError("unreadable", "The test reader has no manifest (tests/fixtures/statements/manifest.json).", false);
  }
  const e = manifest[sha256Hex(original)];
  if (!e) throw new ReaderError("unreadable", "This file is not one of the test statements. Upload a test file, or turn the test reader off.", false);
  if (e.error === "out_of_credits") throw new ReaderError("out_of_credits", OUT_OF_CREDITS, false);
  if (e.error || !e.result) throw new ReaderError("unreadable", "The statement could not be read. Try a clearer copy, or upload a CSV instead.", false);
  // The result file sits in the fixture folder or below it (batch/...), never outside it.
  const file = path.resolve(dir, e.result);
  if (!file.startsWith(path.resolve(dir) + path.sep)) throw new ReaderError("unreadable", "The test statement's result is outside the fixture folder.", false);
  const result = normalizeResult(JSON.parse(await readFile(file, "utf8")) as ReadResult, pages);
  return { model: FIXTURE_MODEL, ...estimateTokens(result), costUsd: 0, result };
}
