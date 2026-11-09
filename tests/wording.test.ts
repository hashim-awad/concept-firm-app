// Editable wording: with no edits the engine is unchanged (parity tests); with an approved edit,
// the change appears in the letter text, the PDF and the preview, and fill-ins still work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { CorporateLetter } from "../src/lib/studio/controllers.ts";

const require = createRequire(import.meta.url);
const W: { key: string; text: string }[] = require("../src/lib/studio/wording.generated.json");
const key = (t: string) => W.find((p) => p.text === t)!.key;

function letter(wording?: Record<string, string>) {
  const paper = { innerHTML: "", classList: { toggle() {} } };
  const e = createStudioEngine({ WORDING: wording, $: (id: string) => (id === "paper" ? paper : null) } as never);
  const c = new CorporateLetter(e, "2026-11-08");
  for (const [k, v] of Object.entries({ company: "Example Holdings Inc.", signer: "Taylor Sample", salutation: "Taylor", addr1: "1 Test St", city: "Kitchener", postal: "N2A 1A1", ye: "2026-12-31" })) c.set(k, v);
  const s = c.state();
  e.render(s);
  return { blocks: JSON.stringify(e.build(s)), pdf: JSON.stringify(e.pdfDoc(s, e.build(s), "LH")), html: paper.innerHTML };
}

test("no edits: same output as the original wording", () => {
  assert.deepEqual(letter({}), letter(undefined));
});

test("an edit shows in the letter, the PDF and the preview", () => {
  const out = letter({ [key("Yours truly,")]: "Sincerely," });
  for (const part of [out.blocks, out.pdf, out.html]) { assert.match(part, /Sincerely,/); assert.doesNotMatch(part, /Yours truly,/); }
});

test("fill-ins stay in place and the preview escapes edited text", () => {
  const out = letter({ [key("Dear {1},")]: "Hello {1} & team," });
  assert.match(out.blocks, /Hello Taylor & team,/);
  assert.match(out.html, /Hello Taylor &amp; team,/);
});

test("compared wording stays consistent (terms for individuals still adjusted)", () => {
  const out = letter({ [key("Personal information")]: "Privacy" });
  assert.match(out.pdf, /Privacy/);
});

test("every piece has a unique key and a non-empty text", () => {
  assert.equal(new Set(W.map((p) => p.key)).size, W.length);
  assert.ok(W.every((p) => p.text.trim().length > 0));
});

import { toFriendly, fromFriendly, checkEdit } from "../src/lib/studio/wording-pieces.ts";

test("fill-ins show by name and convert back", () => {
  const k = key("Dear {1},");
  assert.equal(toFriendly(k, "Dear {1},"), "Dear [Salutation],");
  assert.equal(fromFriendly(k, "Hello [Salutation], welcome"), "Hello {1}, welcome");
  assert.equal(checkEdit(k, fromFriendly(k, "Hello [Salutation],")), null);
  assert.match(checkEdit(k, fromFriendly(k, "Hello,")) ?? "", /\[Salutation\]/);
  assert.match(checkEdit(k, fromFriendly(k, "Hello [Salutation] [Salutation],")) ?? "", /once/);
});

test("every fill-in has a name", () => {
  for (const p of W as { text: string; fills?: string[] }[]) {
    const n = (p.text.match(/\{\d+\}/g) ?? []).length;
    assert.equal((p.fills ?? []).length, n, p.text);
    assert.ok((p.fills ?? []).every((f) => f && !/^Detail( \d+)?$/.test(f)), p.text);
  }
});
