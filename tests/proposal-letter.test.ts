// Run with: npm test
// Front office batch, step 1: a proposal option becomes the corporate engagement letter.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { Proposal } from "../src/lib/studio/controllers.ts";
import { letterProblems, lk, packedOptions } from "../src/lib/proposal/letter.ts";
import { letterEngine, partBHtml, partBBlocks, esignWording, type LetterBuild } from "../src/lib/corporate/render.ts";
import { CorporateLetter } from "../src/lib/studio/controllers.ts";
import { fillLetter } from "../src/lib/proposal/letter.ts";

const eng = () => createStudioEngine({ LH: "", ILLUS: "", SIG: "", SIGNER: "Hashim Awad, CPA", SIGNER_TITLE: "Director" } as never) as any; // eslint-disable-line @typescript-eslint/no-explicit-any

function dummyProposal() {
  const p = new Proposal(eng(), "2026-11-11");
  p.set("segment", "Team or brokerage");
  for (const [k, v] of Object.entries({ name: "Dummy Realty Team Inc.", contact: "Pat Example", salutation: "Pat", province: "ON" })) p.set(k, v);
  p.setService(0, "books", true); p.setLine(0, 0, "svc", "Monthly bookkeeping"); p.setLine(0, 0, "kind", "month"); p.setLine(0, 0, "amt", "650");
  p.setService(1, "books", true); p.setService(1, "comp", true); p.setService(1, "t2", true);
  p.setLine(1, 0, "svc", "Monthly bookkeeping"); p.setLine(1, 0, "kind", "month"); p.setLine(1, 0, "amt", "650");
  p.addLine(1); p.setLine(1, 2, "svc", "Year-end financial statements and T2"); p.setLine(1, 2, "kind", "year"); p.setLine(1, 2, "amt", "3400");
  return p;
}
const DETAILS = { company: "Dummy Realty Team Inc.", signer: "Pat Example", signerTitle: "Director", salutation: "Pat", email: "pat@example.test",
  addr1: "1 Sample St.", city: "Kitchener", postal: "N2K 0A1", ye: "2026-12-31", startMonth: "2027-01" };

test("the letter details step lists what each option's letter still needs", () => {
  const p = dummyProposal();
  const first = letterProblems(eng(), { f: p.f, opts: p.opts, rec: p.rec }, p.e, p.state(), "2026-11-11");
  assert.equal(first.length, 2);
  assert.ok(first[0].errors.some((m) => /email/.test(m)), "the signing email is needed");
  assert.ok(first[0].errors.some((m) => /Year end is blank/.test(m)));
  for (const [k, v] of Object.entries(DETAILS)) p.f[lk(k as never)] = v;
  const done = letterProblems(eng(), { f: p.f, opts: p.opts, rec: p.rec }, p.e, p.state(), "2026-11-11");
  assert.deepEqual(done.map((x) => x.errors), [[], []], JSON.stringify(done));
});

test("the chosen option's services and fees are the letter's", () => {
  const p = dummyProposal();
  for (const [k, v] of Object.entries(DETAILS)) p.f[lk(k as never)] = v;
  const o = packedOptions(p.e, p.state());
  const { e, paper } = letterEngine(esignWording({}), { name: "Hashim Awad, CPA", title: "Director" });
  const c = fillLetter(new CorporateLetter(e, "2026-11-11"), o[1], p.f, "2026-11-11");
  const s = c.state();
  assert.equal(s.company, "Dummy Realty Team Inc.");
  assert.ok(s.svc.books && s.svc.comp && s.svc.t2);
  assert.deepEqual(s.fees.map((x: { amt: string }) => x.amt), ["650", "69", "3400"]);
  const L: LetterBuild = { e, s, paper, addr: ["Dummy Realty Team Inc.", "Attention: Pat Example", "pat@example.test"], signer: { name: "Hashim Awad, CPA", title: "Director" }, corp: false };
  const html = partBHtml({}, L, {});
  assert.match(html, /Dummy Realty Team Inc\./);
  assert.match(html, /signing this letter electronically/);
  assert.doesNotMatch(html, /TaxDome client portal\./, "the TaxDome signing sentence is removed");
  assert.match(html, /Please sign this letter below/);
  const blocks = partBBlocks({}, L);
  assert.ok(blocks.some((b: { k: string }) => b.k === "addr"));
});
