// Parity test: the app's copy of the Studio engine must produce exactly what the original
// Studio page produces, for the same dummy inputs. Run: npm run test:parity
// It opens reference/studio/studio-el-v3.31-redacted.html in a headless browser, fills in
// Studio's own forms, and compares checks, letter blocks and PDF definitions with the app.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createStudioEngine } from "../../src/lib/studio/engine.generated.js";
import { CORPORATE, T1, PROPOSALS, FLOORS } from "./cases.mjs";

const REF = new URL("../../reference/studio/studio-el-v3.31-redacted.html", import.meta.url);
const CAT = [
  { Code: "PTX-110", Service: "T1 single return", Price: 299 }, { Code: "PTX-111", Service: "T1 couple filing together", Price: 349 },
  { Code: "PTX-120", Service: "Rental property (T776)", Price: 249 }, { Code: "PTX-121", Service: "Self-employment (T2125)", Price: 499 },
  { Code: "PTX-122", Service: "Vehicle claim", Price: 150 }, { Code: "PTX-123", Service: "Home office claim", Price: 150 },
  { Code: "PTX-125", Service: "Investment sales", Price: 99 },
];
let browser, page;

before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(fileURLToPath(REF).startsWith("/") ? "file://" + fileURLToPath(REF) : REF.href, { waitUntil: "load" });
  await page.evaluate(({ floors, cat }) => {
    DB.floors = floors; DB.floorsOk = true; DB.loaded = true; DB.cat = cat;
    LH = "LH"; SIG = "SIG"; ILLUS = "ILLUS";
  }, { floors: FLOORS, cat: CAT });
});
after(async () => { await browser?.close(); });

const engine = () => createStudioEngine({ DB: { floors: FLOORS, floorsOk: true, loaded: true, cat: CAT }, LH: "LH", SIG: "SIG", ILLUS: "ILLUS" });
const plain = (x) => JSON.parse(JSON.stringify(x));

for (const c of CORPORATE) {
  test(`corporate letter: ${c.name}`, async () => {
    const studio = await page.evaluate(({ fields, feeAmounts }) => {
      go("el");
      for (const [id, v] of Object.entries(fields)) {
        const el = document.getElementById(id); if (!el) throw new Error("missing field " + id);
        if (el.type === "checkbox") el.checked = v; else el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      feeAmounts.forEach((a, i) => { if (FEES[i]) FEES[i].amt = a; });
      const s = state();
      return JSON.parse(JSON.stringify({ s, checks: checks(s), blocks: build(s), pdf: pdfDoc(s, build(s), "LH") }));
    }, c);
    const e = engine();
    assert.deepEqual(plain(e.checks(studio.s)), studio.checks, "checks differ");
    assert.deepEqual(plain(e.build(studio.s)), studio.blocks, "letter blocks differ");
    assert.deepEqual(plain(e.pdfDoc(studio.s, e.build(studio.s), "LH")), studio.pdf, "PDF definition differs");
  });
}

for (const c of T1) {
  test(`T1 letter: ${c.name}`, async () => {
    const studio = await page.evaluate(({ fields }) => {
      go("t1");
      // Two passes: some fields (e.g. the fee) appear only after the letter type is chosen.
      let pending = Object.entries(fields);
      for (let pass = 0; pass < 2 && pending.length; pass++) {
        pending = pending.filter(([k, v]) => {
          const el = document.getElementById("t1_" + k); if (!el) return true;
          el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
          return false;
        });
      }
      if (pending.length) throw new Error("missing fields " + pending.map(([k]) => "t1_" + k).join(", "));
      const s = t1State();
      return JSON.parse(JSON.stringify({ s, checks: t1Checks(s), blocks: buildT1(s) }));
    }, c);
    const e = engine();
    assert.deepEqual(plain(e.t1Checks(studio.s)), studio.checks, "checks differ");
    assert.deepEqual(plain(e.buildT1(studio.s)), studio.blocks, "letter blocks differ");
  });
}

for (const c of PROPOSALS) {
  test(`proposal: ${c.name}`, async () => {
    const studio = await page.evaluate(({ fields, opts, rec }) => {
      go("prop");
      for (const [k, v] of Object.entries(fields)) {
        const el = document.getElementById("p_" + k); if (!el) throw new Error("missing field p_" + k);
        el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      POPTS = opts; pRec = rec;
      const s = pState();
      return JSON.parse(JSON.stringify({ s, checks: pChecks(s), blocks: pBuild(s), pdf: pPdf(s) }));
    }, c);
    const e = engine();
    assert.deepEqual(plain(e.pChecks(studio.s)), studio.checks, "checks differ (including floor checks)");
    assert.deepEqual(plain(e.pBuild(studio.s)), studio.blocks, "proposal blocks differ");
    assert.deepEqual(plain(e.pPdf(studio.s)), studio.pdf, "PDF definition differs");
  });
}

test("T1 pricing calculator", async () => {
  const input = { filing: "couple", name: "Riley and Sam Example", q: { "PTX-120": 2, "PTX-121": 1, "PTX-122": 1, "PTX-123": 2, "PTX-125": 2 }, tri: {}, out: {} };
  const studio = await page.evaluate((inp) => { Object.assign(T1C, JSON.parse(JSON.stringify(inp))); const R = t1cCalc(); return JSON.parse(JSON.stringify({ R, sum: t1cSummary(R) })); }, input);
  const e = engine();
  Object.assign(e.T1C, plain(input));
  const R = e.t1cCalc();
  assert.deepEqual(plain(R), studio.R);
  assert.equal(e.t1cSummary(R), studio.sum);
});

test("signer name comes from the owner setting", async () => {
  const s = (await page.evaluate(() => { go("el"); return JSON.parse(JSON.stringify(state())); }));
  const e = createStudioEngine({ SIGNER: "Test Signer, CPA", LH: "LH", SIG: "SIG" });
  assert.match(JSON.stringify(e.pdfDoc(s, e.build(s), "LH")), /Test Signer, CPA/);
});
