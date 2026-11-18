// Round 37b (Hashim, Nov 18, 2026): every email that goes only to staff shows the C Studio logo (a PNG made from
// c-studio-navy-500.svg, 2x, shown 36 px tall on white). Client emails keep the Concept logo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAuthEmail, type HookPayload } from "../src/lib/email/auth-emails.ts";
import { buildLeadAlert } from "../src/lib/leads/alert-email.ts";
import { renderQuestionsEmail, questionsMessage } from "../src/lib/closebook/questions.ts";
import { CB_QUESTIONS_EMAIL } from "../src/lib/closebook/client-wording.ts";

const LOGO = /<img src="https:\/\/[^"]+\/brand\/c-studio-navy-email\.png" alt="Concept Studio" width="145" height="36"/;
const base = (type: string): HookPayload => ({
  user: { id: "u1", email: "test.person@example.test", user_metadata: { full_name: "Test Person" } },
  email_data: { token: "123456", token_hash: "abc123hash", redirect_to: "", email_action_type: type, site_url: "", token_new: "", token_hash_new: "" },
});

test("staff emails: the C Studio logo, 145 x 36", () => {
  for (const t of ["invite", "recovery", "password_changed_notification"]) {
    const e = buildAuthEmail(base(t), "https://app.example.test");
    assert.match(e.html, LOGO, t); assert.doesNotMatch(e.html, /studio-logo-navy\.png/, t);
  }
  for (const k of ["new", "reminder"] as const) {
    const e = buildLeadAlert(k, { id: "11111111-1111-1111-1111-111111111111", route: "personal", province: "ON", status: "new", answers: {} }, "https://studio.example.test");
    assert.match(e.html, LOGO, k);
  }
});

test("the PNG: 2x (290 x 72)", () => {
  const b = readFileSync("public/brand/c-studio-navy-email.png");
  assert.equal(b.toString("ascii", 1, 4), "PNG");
  assert.deepEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [290, 72]);
});

test("client emails never show the C Studio logo", () => {
  const m = questionsMessage({}, CB_QUESTIONS_EMAIL, { first: "Pat", legalName: "Dummy Inc.", count: 2 });
  const e = renderQuestionsEmail({}, CB_QUESTIONS_EMAIL, m, { name: "Dana Dummy", credentials: "CPA", title: "" }, "https://example.test/cq/x", "2026-12-04", 2);
  assert.doesNotMatch(e.html, /c-studio|Concept Studio/);
});
