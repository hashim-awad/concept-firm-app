// The server rebuilds each letter and proposal from the inputs the screen sends, then renders
// the PDF. This checks that the rebuild gives exactly what the screen showed, that the rules
// for Final hold on the server too, and that every dummy case renders to a real PDF.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { CorporateLetter, Proposal, T1Letter } from "../src/lib/studio/controllers.ts";
import { rebuild, engineFor, BLANK_PNG } from "../src/lib/studio/build.ts";
import { LETTERHEAD } from "../src/lib/studio/assets.generated.ts";
import { CORPORATE, T1, PROPOSALS, FLOORS } from "./studio/cases.mjs";

const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake/src/printer");
const vfs = require("pdfmake/build/vfs_fonts.js").pdfMake.vfs;
const font = (n: string) => Buffer.from(vfs[n], "base64");
const printer = new PdfPrinter({ Roboto: { normal: font("Roboto-Regular.ttf"), bold: font("Roboto-Medium.ttf"), italics: font("Roboto-Italic.ttf"), bolditalics: font("Roboto-MediumItalic.ttf") } });
const render = (def: unknown): Promise<Buffer> => new Promise((res, rej) => { const d = printer.createPdfKitDocument(def); const c: Buffer[] = []; d.on("data", (x: Buffer) => c.push(x)); d.on("end", () => res(Buffer.concat(c))); d.on("error", rej); d.end(); });

const TODAY = "2026-11-08";
const data = { floors: FLOORS, floorsOk: true, cat: [], signers: { letter: { name: "Hashim Abouelfetouh, CPA", title: "Director" }, proposal: { name: "Hashim Awad", title: "Director" } } };
const screenEngine = () => createStudioEngine({ DB: { floors: FLOORS, floorsOk: true, loaded: true, cat: [] }, LH: LETTERHEAD, SIG: BLANK_PNG, SIGNER: "Hashim Abouelfetouh, CPA", SIGNER_TITLE: "Director" });
const plain = (x: unknown) => JSON.parse(JSON.stringify(x));
const verified = { url: "c1", "Legal name": "x", "Name verified": "__YES__" };

for (const c of CORPORATE) {
  test(`server rebuild = screen: corporate: ${c.name}`, async () => {
    const ctl = new CorporateLetter(screenEngine(), TODAY);
    for (const [k, v] of Object.entries(c.fields)) ctl.set(k, v as string | boolean);
    c.feeAmounts.forEach((a, i) => { if (ctl.fees[i]) ctl.setFee(i, "amt", a); });
    const snap = plain({ f: ctl.f, fees: ctl.fees, mode: "draft", acks: ctl.acks });
    const b = rebuild("corporate_letter", engineFor("corporate_letter", data, BLANK_PNG), snap, null, false, TODAY);
    const want = ctl.output();
    assert.deepEqual(plain(b.s), plain(want.s));
    assert.deepEqual(plain(b.e.build(b.s)), plain(want.blocks));
    assert.equal(b.fileName, want.fileName);
    const pdf = await render(b.def);
    assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
    assert.ok(pdf.length > 20000, "PDF has content");
  });
}

test("server refuses Final for a non-owner, and without a verified client record", () => {
  const ctl = new CorporateLetter(screenEngine(), TODAY);
  for (const [k, v] of Object.entries(CORPORATE[0].fields)) ctl.set(k, v as string | boolean);
  CORPORATE[0].feeAmounts.forEach((a, i) => ctl.setFee(i, "amt", a));
  const snap = plain({ f: { ...ctl.f, reviewed: true }, fees: ctl.fees, mode: "final", acks: {} });
  const e = () => engineFor("corporate_letter", data, BLANK_PNG);
  assert.equal(rebuild("corporate_letter", e(), snap, verified, false, TODAY).scr.message, "Only Hashim can issue a Final letter.");
  assert.equal(rebuild("corporate_letter", e(), snap, null, true, TODAY).scr.message, "Final needs a client record with a verified legal name.");
  assert.equal(rebuild("corporate_letter", e(), snap, { ...verified, "Legal name": "Example Holdings Inc.", "Signing officer": "Taylor Sample", "Signer title": "Director", Salutation: "Taylor", "Street address": "1 Test Street", City: "Kitchener", "Postal code": "N2A 1A1" }, true, TODAY).scr.ok, true);
  const noReview = plain({ ...snap, f: { ...snap.f, reviewed: false } });
  assert.equal(rebuild("corporate_letter", e(), noReview, verified, true, TODAY).scr.ok, false);
});

for (const c of T1.filter((x) => x.fields.card !== "standalone")) {
  test(`server rebuild = screen: T1: ${c.name}`, async () => {
    const ctl = new T1Letter(screenEngine(), TODAY);
    for (const [k, v] of Object.entries(c.fields)) ctl.set(k, v);
    const b = rebuild("t1_letter", engineFor("t1_letter", data, BLANK_PNG), plain({ f: ctl.f, mode: "draft", acks: {} }), null, false, TODAY);
    const want = ctl.output();
    assert.deepEqual(plain(b.s), plain(want.s));
    assert.equal(b.fileName, want.fileName);
    assert.equal((await render(b.def)).subarray(0, 5).toString(), "%PDF-");
  });
}

test("server refuses a standalone T1 (sent from TaxDome)", () => {
  const snap = { f: { ...T1[0].fields }, mode: "draft" };
  assert.throws(() => rebuild("t1_letter", engineFor("t1_letter", data, BLANK_PNG), snap, null, true, TODAY), /TaxDome/);
});

for (const c of PROPOSALS) {
  test(`server rebuild = screen: proposal: ${c.name}`, async () => {
    const ctl = new Proposal(createStudioEngine({ DB: { floors: FLOORS, floorsOk: true, loaded: true, cat: [] }, SIGNER: "Hashim Awad", SIGNER_TITLE: "Director" }), TODAY);
    for (const [k, v] of Object.entries(c.fields)) ctl.set(k, v);
    ctl.e.__set("POPTS", plain(c.opts)); ctl.e.__set("pRec", c.rec);
    const b = rebuild("proposal", engineFor("proposal", data, BLANK_PNG), plain({ f: ctl.f, opts: ctl.opts, rec: ctl.rec, mode: "draft" }), null, false, TODAY);
    const want = ctl.output();
    assert.deepEqual(plain(b.s), plain(want.s));
    assert.deepEqual(plain(b.scr.checks.filter((x) => x.lvl !== "ok")), plain(want.checks), "floor checks the same on the server");
    assert.equal(b.fileName, want.fileName);
    assert.equal((await render(b.def)).subarray(0, 5).toString(), "%PDF-");
  });
}
