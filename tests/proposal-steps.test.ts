// Run with: npm test
// A proposal "Next steps" line set to blank in Templates is left out (Hashim, Nov 11, 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { Proposal } from "../src/lib/studio/controllers.ts";

const steps = (wording: Record<string, string>) => {
  const e = createStudioEngine({ WORDING: wording } as never) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = new Proposal(e, "2026-11-11");
  return (e.pBuild(p.state()) as { k: string; items?: string[] }[]).find((b) => b.k === "ol")!.items!;
};

test("original wording: four next steps", () => assert.equal(steps({}).length, 4));
test("a blank line is left out, the others keep their order", () => {
  const s = steps({ w5725499754: "" });
  assert.equal(s.length, 3);
  assert.match(s[1], /payment details/);
});
