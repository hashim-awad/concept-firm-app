// Run with: npm test
// Bank statement PDF to CSV (round 20, Hashim, Nov 15, 2026): the reader's request, its answer, the cost,
// the out-of-credits message, the test (fixture) reader and getting a PDF ready. No API calls: the SDK
// client is a stand-in.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildRequest, fromWire, INSTRUCTION, MAX_TOKENS, MODEL, moneyCents, READ_SCHEMA, ReaderError, readStatement, type StreamClient } from "../src/lib/statements/reader.ts";
import { costUsd, US_ONLY_MULTIPLIER } from "../src/lib/statements/pricing.ts";
import { fixtureMode, readFixture, sha256Hex } from "../src/lib/statements/fixture-reader.ts";
import { prepare, PrepareError } from "../src/lib/statements/prepare.ts";
import { OUT_OF_CREDITS } from "../src/lib/statements/types.ts";

const pdf = new TextEncoder().encode("%PDF-1.4 dummy");

// One answer as the API sends it: the JSON in a text block.
const wire = {
  bank: "Northern Dummy Bank",
  pages: 2,
  accounts: [{
    last_digits: "****4321", name: "Business chequing", kind: "bank", period_start: "2026-01-01", period_end: "2026-01-31",
    opening_balance: "1,000.00", closing_balance: "1249.75",
    summary: { money_in_total: "500.00", money_in_count: 1, money_out_total: "250.25", money_out_count: null },
    lines: [
      { date: "2026-01-03", description: "SAMPLE  DEPOSIT\nREF 12", amount: "500.00", direction: "in", balance: "1,500.00", page: 1, unsure: false, unsure_reason: "" },
      { date: "2026-01-10", description: "SAMPLE RENT", amount: "200.00", direction: "out", balance: null, page: 2, unsure: false, unsure_reason: "" },
      { date: "2026-01-2?", description: "SAMPLE FEE", amount: "50.2?", direction: "out", balance: "1249.75", page: 9, unsure: true, unsure_reason: "smudged" },
    ],
  }],
};
const message = (over: Partial<Anthropic.Beta.BetaMessage> = {}) => ({
  id: "msg_dummy", type: "message", role: "assistant", model: "claude-sonnet-5-5", stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: JSON.stringify(wire) }],
  usage: { input_tokens: 10000, output_tokens: 2000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, inference_geo: "us" },
  ...over,
}) as unknown as Anthropic.Beta.BetaMessage;

function stub(answer: () => Promise<Anthropic.Beta.BetaMessage>) {
  const calls: { body: ReturnType<typeof buildRequest>; opts?: { timeout?: number } }[] = [];
  const client: StreamClient = { beta: { messages: { stream: (body, opts) => { calls.push({ body, opts }); return { finalMessage: answer }; } } } };
  return { client, calls };
}

test("the request: Sonnet 5.5, US-only, the refusal fallback, the document, the schema, a large max_tokens, and nothing else", async () => {
  const { client, calls } = stub(async () => message());
  await readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 2 }, client, { timeoutMs: 200_000 });
  assert.equal(calls.length, 1);
  const b = calls[0].body;
  assert.equal(b.model, "claude-sonnet-5-5");
  assert.equal(MODEL, "claude-sonnet-5-5");
  assert.equal(b.inference_geo, "us");
  assert.equal(b.max_tokens, 64000);
  assert.equal(MAX_TOKENS, 64000);
  assert.deepEqual(b.betas, ["server-side-fallback-2026-07-01"]);
  assert.equal(b.fallbacks, "default");
  assert.equal(b.output_config.format.type, "json_schema");
  assert.equal(b.output_config.format.schema, READ_SCHEMA);
  assert.equal(b.system, INSTRUCTION);
  assert.equal(calls[0].opts?.timeout, 200_000);
  // Only the file and a fixed line: no client name, no file data from Closebook.
  assert.equal(b.messages.length, 1);
  const [doc, text] = b.messages[0].content as unknown as [{ type: string; source: { type: string; media_type: string; data: string } }, { type: string; text: string }];
  assert.deepEqual(doc, { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } });
  assert.deepEqual(text, { type: "text", text: "Read this statement." });
  assert.equal(Object.keys(b).sort().join(","), "betas,fallbacks,inference_geo,max_tokens,messages,model,output_config,system");
});

test("a photo goes as an image block", () => {
  const b = buildRequest({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 1]), mediaType: "image/jpeg", pages: 1 });
  const block = (b.messages[0].content as unknown as { type: string; source: { media_type: string } }[])[0];
  assert.equal(block.type, "image");
  assert.equal(block.source.media_type, "image/jpeg");
});

test("the schema: every object closed, every field required (structured outputs)", () => {
  const walk = (s: Record<string, unknown>): void => {
    if (s.type === "object") {
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...(s.required as string[])].sort(), Object.keys(s.properties as object).sort());
      for (const p of Object.values(s.properties as Record<string, Record<string, unknown>>)) walk(p);
    }
    if (s.type === "array") walk(s.items as Record<string, unknown>);
    if (Array.isArray(s.anyOf)) for (const p of s.anyOf as Record<string, unknown>[]) walk(p);
  };
  walk(READ_SCHEMA as unknown as Record<string, unknown>);
  // The instruction covers what Hashim asked for.
  for (const words of ["every account", "last digits", "\"card\"", "period_start", "opening_balance", "summary", "every page", "in the order printed", "positive number", "raises the balance", "running balance", "page:", "unsure", "Never guess a missing digit"]) {
    assert.ok(INSTRUCTION.includes(words), words);
  }
});

test("the answer becomes a ReadResult: keys, ids, cents, digits only, unsure kept with its reason", async () => {
  const { client } = stub(async () => message());
  const out = await readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 2 }, client);
  const a = out.result.accounts[0];
  assert.equal(out.result.bank, "Northern Dummy Bank");
  assert.equal(out.result.pages, 2);
  assert.deepEqual({ key: a.key, last4: a.last4, kind: a.kind, opening: a.opening, closing: a.closing }, { key: "a1", last4: "4321", kind: "bank", opening: 100000, closing: 124975 });
  assert.deepEqual(a.summary, { inTotal: 50000, inCount: 1, outTotal: 25025, outCount: null });
  assert.deepEqual(a.lines.map((l) => l.id), ["l1", "l2", "l3"]);
  assert.deepEqual(a.lines[0], { id: "l1", date: "2026-01-03", description: "SAMPLE DEPOSIT REF 12", amountCents: 50000, dir: "in", balanceCents: 150000, page: 1, unsure: false, unsureReason: "", source: "read" });
  // A smudged line: the date and amount could not be read; it stays, unsure, on a page that exists.
  assert.equal(a.lines[2].unsure, true);
  assert.equal(a.lines[2].unsureReason, "smudged; the amount could not be read; the date could not be read");
  assert.equal(a.lines[2].page, 2);
  assert.equal(out.model, "claude-sonnet-5-5");
  assert.equal(out.inputTokens, 10000);
  assert.equal(out.outputTokens, 2000);
});

test("money as printed: commas, $, brackets, CR and a trailing minus", () => {
  assert.equal(moneyCents("1,234.50"), 123450);
  assert.equal(moneyCents("$57.9"), 5790);
  assert.equal(moneyCents("(15.20)"), -1520);
  assert.equal(moneyCents("15.20 CR"), -1520);
  assert.equal(moneyCents("15.20-"), -1520);
  assert.equal(moneyCents("-0.00"), 0);
  assert.equal(moneyCents("1.234"), null);
  assert.equal(moneyCents("abc"), null);
  assert.equal(fromWire({}, 1).accounts.length, 0);
});

test("the cost: Sonnet 5.5 list rates, x1.1 for US-only processing (worked example)", async () => {
  // 10,000 input tokens x $2 per million  = $0.0200
  //  2,000 output tokens x $10 per million = $0.0200
  //                                 total  = $0.0400
  // US-only (inference_geo "us"): $0.0400 x 1.1 = $0.0440
  assert.equal(US_ONLY_MULTIPLIER, 1.1);
  assert.equal(costUsd("claude-sonnet-5-5", { input: 10_000, output: 2_000 }, "global"), 0.04);
  assert.equal(costUsd("claude-sonnet-5-5", { input: 10_000, output: 2_000 }, "us"), 0.044);
  const { client } = stub(async () => message());
  const out = await readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 2 }, client);
  assert.equal(out.costUsd, 0.044);
  // A long statement: 60,000 in, 25,000 out = $0.12 + $0.25 = $0.37, x1.1 = $0.407.
  assert.equal(costUsd("claude-sonnet-5-5", { input: 60_000, output: 25_000 }), 0.407);
  // The fallback model that answered is priced at its own rates (Sonnet 5: the same in and out).
  assert.equal(costUsd("claude-sonnet-5", { input: 10_000, output: 2_000, cacheRead: 10_000 }), 0.0462);
});

test("out of credits (billing error, 402): the plain message, no retry", async () => {
  const billing = new Anthropic.APIError(402, { type: "error", error: { type: "billing_error", message: "Your credit balance is too low." } }, undefined, new Headers());
  const { client } = stub(async () => { throw billing; });
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, client), (e: unknown) => {
    assert.ok(e instanceof ReaderError);
    assert.equal(e.code, "out_of_credits");
    assert.equal(e.message, OUT_OF_CREDITS);
    assert.equal(e.message, "The statement reader is out of credits for this month. Upload a CSV instead, or ask Hashim to add credits.");
    assert.equal(e.retry, false);
    return true;
  });
  // The monthly spend limit reads the same.
  const limit = new Anthropic.RateLimitError(429, { type: "error", error: { type: "rate_limit_error", message: "limit", details: { error_code: "enforced_spend_limit_reached" } } }, undefined, new Headers());
  const s2 = stub(async () => { throw limit; });
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, s2.client), (e: unknown) => e instanceof ReaderError && e.code === "out_of_credits");
});

test("passing problems are tried again; a bad key means not set up; a refusal and a cut-off answer are not retried", async () => {
  const busy = stub(async () => { throw new Anthropic.InternalServerError(529, { type: "error", error: { type: "overloaded_error", message: "x" } }, undefined, new Headers()); });
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, busy.client), (e: unknown) => e instanceof ReaderError && e.code === "busy" && e.retry);
  const key = stub(async () => { throw new Anthropic.AuthenticationError(401, { type: "error", error: { type: "authentication_error", message: "x" } }, undefined, new Headers()); });
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, key.client), (e: unknown) => e instanceof ReaderError && e.message === "The statement reader is not set up yet." && !e.retry);
  const refused = stub(async () => message({ stop_reason: "refusal", content: [] }));
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, refused.client), (e: unknown) => e instanceof ReaderError && e.code === "refused" && !e.retry && e.usage?.costUsd === 0.044);
  const long = stub(async () => message({ stop_reason: "max_tokens" }));
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, long.client), (e: unknown) => e instanceof ReaderError && e.code === "too_long");
  const junk = stub(async () => message({ content: [{ type: "text", text: "not json" } as Anthropic.Beta.BetaTextBlock] }));
  await assert.rejects(readStatement({ bytes: pdf, mediaType: "application/pdf", pages: 1 }, junk.client), (e: unknown) => e instanceof ReaderError && e.code === "unreadable" && e.retry);
});

test("the fixture reader: on only outside production; finds a file by its sha256; fills ids; model fixture, cost 0", async () => {
  assert.equal(fixtureMode({ STATEMENT_READER: "fixture" }), true);
  assert.equal(fixtureMode({ STATEMENT_READER: "fixture", VERCEL_ENV: "preview" }), true);
  assert.equal(fixtureMode({ STATEMENT_READER: "fixture", VERCEL_ENV: "production" }), false);
  assert.equal(fixtureMode({}), false);
  const dir = mkdtempSync(path.join(tmpdir(), "statements-fixture-"));
  mkdirSync(path.join(dir, "batch"));
  const good = new TextEncoder().encode("%PDF-1.4 good"), broke = new TextEncoder().encode("%PDF-1.4 broke"), unknown = new TextEncoder().encode("%PDF-1.4 other");
  writeFileSync(path.join(dir, "batch", "good.json"), JSON.stringify({ bank: "Northern Dummy Bank", pages: 1, accounts: [{ last4: "1111", name: "Chequing", kind: "bank", periodStart: "2026-01-01", periodEnd: "2026-01-31", opening: 0, closing: 100,
    lines: [{ date: "2026-01-02", description: "SAMPLE", amountCents: 100, dir: "in", page: 1 }] }] }));
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
    [sha256Hex(good)]: { file: "good.pdf", result: "batch/good.json" },
    [sha256Hex(broke)]: { file: "credits.pdf", error: "out_of_credits" },
  }));
  const out = await readFixture(good, 1, dir);
  assert.equal(out.model, "fixture");
  assert.equal(out.costUsd, 0);
  assert.deepEqual([out.inputTokens, out.outputTokens], [2200, 245]);
  assert.equal(out.result.accounts[0].key, "a1");
  assert.deepEqual(out.result.accounts[0].lines[0], { date: "2026-01-02", description: "SAMPLE", amountCents: 100, dir: "in", page: 1, id: "l1", balanceCents: null, unsure: false, unsureReason: "", source: "read" });
  await assert.rejects(readFixture(broke, 1, dir), (e: unknown) => e instanceof ReaderError && e.message === OUT_OF_CREDITS);
  await assert.rejects(readFixture(unknown, 1, dir), (e: unknown) => e instanceof ReaderError && /not one of the test statements/.test(e.message));
});

const FIX = new URL("./fixtures/statements/", import.meta.url);
test("the dummy statements from tests/fixtures/statements: each PDF is found in the manifest", { skip: !existsSync(new URL("manifest.json", FIX)) }, async () => {
  const dir = path.dirname(new URL("manifest.json", FIX).pathname);
  const card = await readFixture(new Uint8Array(readFileSync(new URL("card.pdf", FIX))), 1, dir);
  assert.equal(card.result.accounts[0].kind, "card");
  const two = await readFixture(new Uint8Array(readFileSync(new URL("chequing-savings.pdf", FIX))), 1, dir);
  assert.equal(two.result.accounts.length, 2);
  if (existsSync(new URL("out-of-credits.pdf", FIX))) {
    await assert.rejects(readFixture(new Uint8Array(readFileSync(new URL("out-of-credits.pdf", FIX))), 1, dir), (e: unknown) => e instanceof ReaderError && e.code === "out_of_credits");
  }
});

test("getting a PDF ready: pages counted; a PDF locked with an empty password is unlocked", { skip: !existsSync(new URL("locked.pdf", FIX)) }, async () => {
  const locked = new Uint8Array(readFileSync(new URL("locked.pdf", FIX)));
  const p = await prepare(locked, "application/pdf");
  assert.equal(p.kind, "pdf");
  assert.equal(p.unlocked, true);
  assert.ok(p.pages >= 1);
  assert.ok(!Buffer.from(p.bytes).includes("/Encrypt"));
  const plain = await prepare(new Uint8Array(readFileSync(new URL("card.pdf", FIX))), "application/pdf");
  assert.equal(plain.unlocked, false);
  assert.equal(plain.pages, JSON.parse(readFileSync(new URL("card.json", FIX), "utf8")).pages);
  await assert.rejects(prepare(new TextEncoder().encode("not a pdf"), "application/pdf"), PrepareError);
  await assert.rejects(prepare(new Uint8Array(readFileSync(new URL("card.pdf", FIX))), "application/zip"), PrepareError);
  assert.equal(process.exitCode, undefined);
});
