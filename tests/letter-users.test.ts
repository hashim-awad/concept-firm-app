// Round 18 fix (Hashim): the corporate letter names every user of the statements on the client record,
// each with the sentence for the basis it needs. A client with no users gives Studio's letter unchanged.
// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { CorporateLetter, joinNames, tpUsers } from "../src/lib/studio/controllers.ts";
import { corporateScreen } from "../src/lib/studio/screen.ts";

const TODAY = "2026-11-15";
const text = (x: unknown): string => JSON.stringify(x).replace(/\\uE00[0-3]/g, "");
const users = [{ kind: "lender", name: "Dummy Credit Union", basis_needed: "Can request further information" }, { kind: "other", name: "Dummy Landlord Ltd.", basis_needed: "" }];
const client = (u: unknown[]) => ({ url: "c1", "Legal name": "Poplar Dummy Realty Inc.", "Year end (month-day)": "12-31", "Name verified": "__YES__", "Users of the statements": JSON.stringify(u) });
const letter = (u: unknown[]) => {
  const c = new CorporateLetter(createStudioEngine({}), TODAY);
  c.applyClient(client(u)); c.set("svc_comp", true);
  const s = c.state();
  return { c, s, body: text(c.e.build(s)) };
};

test("names joined for the letter", () => {
  assert.equal(joinNames(["A"]), "A");
  assert.equal(joinNames(["A", "B"]), "A and B");
  assert.equal(joinNames(["A", "B", "C"]), "A, B and C");
  assert.deepEqual(tpUsers(""), []);
  assert.deepEqual(tpUsers("not json"), []);
  assert.deepEqual(tpUsers(JSON.stringify([{ name: "X", basis_needed: "Agreed basis of accounting" }])), [{ name: "X", basis: "agreed", set: true }]);
});

test("a letter names both users from the client, each with its own sentence", () => {
  const { body } = letter(users);
  assert.ok(body.includes("It will also be provided to Dummy Credit Union and Dummy Landlord Ltd. You confirm that Dummy Credit Union is in a position to request and obtain further information from the Company. You confirm that Dummy Landlord Ltd. is in a position to request and obtain further information from the Company."), body);
  assert.ok(body.includes("we may tell Dummy Credit Union and Dummy Landlord Ltd. that we no longer act for the Company."));
  assert.ok(!body.includes("Ltd.."));
});

test("a user who agreed the basis gets the agreed sentence", () => {
  const { body } = letter([{ kind: "lender", name: "Dummy Bank", basis_needed: "Agreed basis of accounting" }]);
  assert.ok(body.includes("It will also be provided to Dummy Bank. You confirm that Dummy Bank has agreed with you the basis of accounting to be applied."));
});

test("a user with no basis chosen is flagged; Final waits for it", () => {
  const { c, s } = letter(users);
  const draft = corporateScreen(c.e, s, { client: client(users), loaded: true, isOwner: true, acks: {} });
  assert.ok(draft.checks.some((x) => x.lvl === "warn" && x.msg.startsWith("Choose the basis Dummy Landlord Ltd. needs")));
  assert.ok(!draft.checks.some((x) => x.msg.includes("Dummy Credit Union needs")));
  c.setMode("final");
  const fin = corporateScreen(c.e, c.state(), { client: client(users), loaded: true, isOwner: true, acks: {} });
  assert.ok(fin.checks.some((x) => x.lvl === "err" && x.msg.startsWith("Choose the basis Dummy Landlord Ltd. needs")));
});

test("no users on the client: no third party, as Studio", () => {
  const { s, body } = letter([]);
  assert.equal(s.thirdParty, false);
  assert.ok(!body.includes("It will also be provided to"));
});
