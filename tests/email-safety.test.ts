// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { emailAllowed } from "../src/lib/email/safety.ts";

test("Live sends to anyone; Test only to the allowed domains", () => {
  assert.equal(emailAllowed("client@example.com", { vercelEnv: "production" }), true);
  assert.equal(emailAllowed("client@gmail.com", { vercelEnv: "preview" }), false, "a real client address is never mailed from Test");
  assert.equal(emailAllowed("hashim@ConceptAccounting.ca", { vercelEnv: "preview" }), true);
  assert.equal(emailAllowed("x@example.com", { vercelEnv: "preview", allow: "example.com, conceptaccounting.ca" }), true);
  assert.equal(emailAllowed("x@example.com", { vercelEnv: undefined }), false, "local runs count as Test");
});
