// Screen parity test: the app's real letter and proposal screens against Studio's own forms.
// One list of steps (type into a field, tick a box, pick an option, click a button) is played
// on both pages, by element id. Then everything is compared: the letter inputs, the checks
// shown on screen, the letter blocks, the PDF definition and the preview HTML.
//
// Run: npm run test:screens   (builds nothing; needs the app running with STUDIO_HARNESS=1,
// see scripts/run-screen-parity.sh, which CI uses). All data is made up.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FLOORS, SCREEN_CASES } from "./cases.mjs";

const APP = process.env.STUDIO_APP_URL ?? "http://localhost:3100";
const REF = "file://" + fileURLToPath(new URL("../../reference/studio/studio-el-v3.31-redacted.html", import.meta.url));
const CAT = [
  { Code: "PTX-110", Service: "T1 single return", Price: 299 }, { Code: "PTX-111", Service: "T1 couple filing together", Price: 349 },
];
// Studio's package list uses each row's page link as its value; the app uses the offer name.
const floors = FLOORS.map((r) => ({ ...r, url: r.Offer }));
// The only wording difference allowed: the app's button is "Save client", not "Save client to Concept Studio".
const appWording = (t) => t.replace(" to Concept Studio", "");

let browser, studio, app;
before(async () => {
  browser = await chromium.launch();
  studio = await browser.newPage();
  app = await browser.newPage();
  await studio.goto(REF, { waitUntil: "load" });
  await studio.evaluate(({ floors, cat }) => { DB.floors = floors; DB.floorsOk = true; DB.loaded = true; DB.cat = cat; LH = "LH"; SIG = "SIG"; ILLUS = "ILLUS"; }, { floors, cat: CAT });
});
after(async () => { await browser?.close(); });

// Plays steps in the page. Works the same on Studio's plain page and the app's React page:
// values are set with the browser's own setter and announced with input and change events.
async function drive(page, steps) {
  await page.evaluate(async (steps) => {
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const find = async (sel) => { for (let t = 0; t < 60; t++) { const el = document.querySelector(sel); if (el) return el; await frame(); } throw new Error("Not on the page: " + sel); };
    for (const st of steps) {
      if (st.click) (await find(st.click)).click();
      else {
        const el = await find(st.set);
        if (el.type === "checkbox" || el.type === "radio") { if (el.checked !== !!st.value) el.click(); }
        else {
          const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(el, st.value);
          el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
          if (el.value !== st.value) throw new Error(`Could not set ${st.set} to "${st.value}" (no such choice)`);
        }
      }
      await frame();
    }
  }, steps);
}

const shown = (page, ul) => page.evaluate((ul) => [...document.querySelectorAll(`#${ul} li`)].map((li) => li.textContent), ul);
const html = (page, id) => page.evaluate((id) => document.getElementById(id).innerHTML, id);

async function openApp(screen) {
  await app.goto(`${APP}/studio-harness/${screen}`, { waitUntil: "networkidle" });
  await app.waitForSelector("#harness-waiting");
  await app.evaluate(({ floors, cat }) => window.__harnessInit({
    env: { floors, floorsOk: true, cat, loaded: true, signer: { name: "", title: "" }, images: { LH: "LH", SIG: "SIG", ILLUS: "ILLUS" } }, isOwner: true,
  }), { floors, cat: CAT });
  await app.waitForSelector("#harness-ready");
}

const RESET = {
  corporate: () => { FEES = []; feeType = null; feesTouched = false; acks = { ab: false, bc: false }; selClientUrl = ""; lastFinal = null; go("el"); buildEL(); fillPkgSelect(); refresh(); },
  t1: () => { t1Acks = { ab: false, bc: false }; t1ClientUrl = ""; go("t1"); buildT1View(); },
  proposal: () => { go("prop"); buildPropView(); },
};
const STUDIO_READ = {
  corporate: () => { const s = state(); return { s, blocks: build(s), pdf: pdfDoc(s, build(s), "LH"), fileName: fileName(s) }; },
  t1: () => { const s = t1State(); const sa = s.card === "standalone"; return { s, blocks: sa ? [] : buildT1(s), pdf: sa ? null : pdfDoc(s, buildT1(s), "LH"), fileName: sa ? "" : t1FileName(s) }; },
  proposal: () => { const s = pState(); return { s, blocks: pBuild(s), pdf: pPdf(s) }; },
};
const IDS = { corporate: ["checks", "paper"], t1: ["t1_checks", "t1_paper"], proposal: ["p_checks", "p_paper"] };
const plain = (x) => JSON.parse(JSON.stringify(x));

for (const c of SCREEN_CASES) {
  test(`screen: ${c.screen}: ${c.name}`, async () => {
    await studio.evaluate(`(${RESET[c.screen].toString()})()`);
    await openApp(c.screen);
    await drive(studio, c.steps);
    await drive(app, c.steps);

    const [checksId, paperId] = IDS[c.screen];
    const want = plain(await studio.evaluate(`(${STUDIO_READ[c.screen].toString()})()`));
    const got = plain(await app.evaluate(() => window.__studioScreen()));

    assert.deepEqual(got.s, want.s, "letter inputs differ");
    assert.deepEqual(got.blocks, want.blocks, "document text (blocks) differs");
    assert.deepEqual(got.pdf, want.pdf, "PDF definition differs");
    if (want.fileName !== undefined) assert.equal(got.fileName, want.fileName, "file name differs");
    assert.deepEqual(await shown(app, checksId), (await shown(studio, checksId)).map(appWording), "checks shown on screen differ");
    assert.equal(await html(app, paperId), await html(studio, paperId), "preview differs");
  });
}

test("server PDF builds in the production app (fonts, letterhead, regenerated label)", async () => {
  const r = await fetch(`${APP}/studio-harness/pdf`);
  assert.equal(r.status, 200);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buf.length > 50000, "PDF includes the letterhead image");
  assert.match(r.headers.get("x-sha256") ?? "", /^[0-9a-f]{64}$/);
});
