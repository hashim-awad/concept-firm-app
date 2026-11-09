// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuthEmail, UnsupportedEmailType, type HookPayload } from "../src/lib/email/auth-emails.ts";

const base = (type: string): HookPayload => ({
  user: { id: "u1", email: "test.person@example.test", user_metadata: { full_name: "Test Person" } },
  email_data: { token: "123456", token_hash: "abc123hash", redirect_to: "", email_action_type: type, site_url: "", token_new: "", token_hash_new: "" },
});

test("invite links to /auth/confirm with type=invite", () => {
  const e = buildAuthEmail(base("invite"), "https://app.example.test");
  assert.equal(e.to, "test.person@example.test");
  assert.match(e.html, /https:\/\/app\.example\.test\/auth\/confirm\?token_hash=abc123hash&amp;type=invite&amp;next=\/set-password/);
  assert.match(e.text, /type=invite&next=\/set-password/);
  assert.match(e.html, /Hi Test,/);
});

test("recovery links with type=recovery", () => {
  const e = buildAuthEmail(base("recovery"), "https://app.example.test");
  assert.match(e.text, /token_hash=abc123hash&type=recovery/);
});

test("password changed notice has no link", () => {
  const e = buildAuthEmail(base("password_changed_notification"), "https://app.example.test");
  assert.doesNotMatch(e.html, /href=/);
});

test("names are escaped", () => {
  const p = base("invite");
  p.user.user_metadata = { full_name: "<script>x</script> Y" };
  const e = buildAuthEmail(p, "https://app.example.test");
  assert.doesNotMatch(e.html, /<script>/);
});

test("no em dashes in any email", () => {
  for (const t of ["invite", "recovery", "password_changed_notification"]) {
    const e = buildAuthEmail(base(t), "https://app.example.test");
    assert.doesNotMatch(e.html + e.text + e.subject, /—/);
  }
});

test("unused types are refused", () => {
  for (const t of ["signup", "magiclink", "email_change"]) {
    assert.throws(() => buildAuthEmail(base(t), "https://x.test"), UnsupportedEmailType);
  }
});
