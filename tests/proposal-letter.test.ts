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

test("Quotes (live): one option, team ticks, package fills services and prices, software on its own line", () => {
  const e = createStudioEngine({ P_LINES: true } as never) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = new Proposal(e, "2026-11-11", { live: true });
  assert.equal(p.opts.length, 1, "a team opens as one option");
  assert.equal(p.f.format, "single");
  assert.ok(p.opts[0].svc.pnl && p.opts[0].svc.cfo, "P&L and quarterly review ticked for a team");
  assert.equal(p.opts[0].lines[0].amt, "", "the main fee starts empty");
  assert.ok(!(e.pChecks(p.state()) as { msg: string }[]).some((c) => /second option/.test(c.msg)), "no second-option warning");
  assert.ok((e.pChecks(p.state()) as { lvl: string; msg: string }[]).some((c) => c.lvl === "err" && /needs a dollar amount/.test(c.msg)), "cannot send with the main fee empty");
  p.applyOffer(0, { Offer: "Team: Core", Services: '["books","gst","comp","t2","cfo"]', "Monthly fee": "950", "Software per month": "69", "Year-end fee": "" });
  assert.deepEqual(p.opts[0].lines.map((l: { amt: string }) => l.amt), ["950", "69"]);
  assert.ok(p.opts[0].svc.books && p.opts[0].svc.cfo && p.opts[0].svc.pnl && !p.opts[0].svc.payroll);
  const box = (e.pBuild(p.state()) as { k: string; opts?: { lines: string[][] }[] }[]).find((b) => b.k === "popts")!;
  assert.equal(box.opts![0].lines.length, 2, "software is its own line in the option box");
  p.applyOffer(0, { Offer: "Team: Plus", Services: '["books"]', "Monthly fee": "2400", "Software per month": "", "Year-end fee": "" });
  assert.deepEqual(p.opts[0].lines.map((l: { amt: string }) => l.amt), ["2400", "Included"], "no software price: software included");
  p.setLine(0, 0, "amt", "");
  const box2 = (e.pBuild(p.state()) as { k: string; opts?: { lines: string[][] }[] }[]).find((b) => b.k === "popts")!;
  assert.equal(box2.opts![0].lines[0][1], "Amount needed", "a blank amount never reads Included");
  p.set("format", "options");
  assert.equal(p.opts.length, 2);
  p.removeOption(1);
  assert.ok((e.pChecks(p.state()) as { msg: string }[]).some((c) => /second option/.test(c.msg)), "the warning shows only for Options with one option");
});
test("Studio's screen (not live) is unchanged: a team opens on the Options format", () => {
  const p = new Proposal(createStudioEngine({} as never) as any, "2026-11-11"); // eslint-disable-line @typescript-eslint/no-explicit-any
  assert.equal(p.f.format, "options");
  assert.ok(!p.opts[0].svc.pnl, "no extra ticks");
});
