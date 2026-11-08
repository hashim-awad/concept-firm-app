// Price book clean-up plan: made-up rows in the shape of the imported price book.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planCleanup, unitWithoutNote, type Item } from "../src/lib/price-book/cleanup.ts";

const item = (code: string, line: string, extra: Partial<Item> = {}): Item => ({ code, name: code, unit_label: "each", per_spouse: false, price_type: "Fixed", income_account: "",
  replaces_qbo: "", replaces_taxdome: "", internal_note: "", line, price_cents: 1000, ...extra });

test("unit keeps only the unit", () => {
  assert.equal(unitWithoutNote("per month (new QBO income account 4005, matched to cost 5010 to track the margin)", "New QBO income account 4005, matched to cost 5010 to track the margin."), "per month");
  assert.equal(unitWithoutNote("per property; quantity = number of properties; type in the description", "Quantity = number of properties; type in the description.", "per property"), "per property");
  assert.equal(unitWithoutNote("quantity = number of properties", "Quantity = number of properties; type in the description.", "per property"), "per property");
  assert.equal(unitWithoutNote("per return", "Company-client T1s, often included."), "per return");
});

test("plan: lines, seed replacement with per-spouse carried over, notes, new items, empty line removed", () => {
  const items = [
    item("ACC-102", "corporate"), item("CTX-103", "corporate", { unit_label: "per return (new QBO income account 4015)" }),
    item("PTX-110", "corporate"), item("PTX-125", "t1"), item("PTX-129", "t1"),
    item("T1_BASE_SINGLE", "t1", { price_cents: 29900 }), item("T1_INVESTMENT_SALES", "t1", { per_spouse: true, price_cents: 9900 }),
  ];
  const r = planCleanup(items, ["t1", "corporate", "bookkeeping", "t2"]);
  assert.deepEqual(r.blockers, []);
  const ops = r.plan.map((o) => `${o.op}:${o.code ?? o.from ?? o.line}`);
  assert.ok(ops.includes("replace_item:T1_BASE_SINGLE") && ops.includes("replace_item:T1_INVESTMENT_SALES"));
  assert.ok(r.plan.some((o) => o.op === "set_fields" && o.code === "PTX-125" && o.per_spouse === true), "per-spouse carried over");
  assert.ok(r.plan.some((o) => o.op === "set_line" && o.code === "ACC-102" && o.line === "bookkeeping"));
  assert.ok(r.plan.some((o) => o.op === "set_line" && o.code === "PTX-110" && o.line === "t1"));
  assert.ok(r.plan.some((o) => o.op === "set_fields" && o.code === "CTX-103" && o.unit_label === "per return"));
  assert.equal(r.plan.filter((o) => o.op === "add_item").length, 4);
  assert.equal(r.plan[r.plan.length - 1].op, "remove_empty_line");
});

test("new items: crypto and the US returns are charged for each spouse, partnership once", () => {
  const r = planCleanup([item("PTX-129", "t1")], ["t1"]);
  const spouse = (c: string) => r.plan.find((o) => o.op === "add_item" && o.code === c)?.per_spouse;
  assert.equal(spouse("PTX-133"), true);
  assert.equal(spouse("PTX-134"), false);
  assert.equal(spouse("PTX-135"), true);
  assert.equal(spouse("PTX-136"), true);
});

test("missing PTX-129 blocks the clean-up", () => {
  const r = planCleanup([item("PTX-110", "t1")], ["t1"]);
  assert.ok(r.blockers.some((b) => b.includes("PTX-129")));
});

test("nothing left to change after applying", () => {
  const items = [item("ACC-102", "bookkeeping"), item("PTX-129", "t1"), item("PTX-133", "t1", { per_spouse: true }), item("PTX-134", "t1"),
    item("PTX-135", "t1", { per_spouse: true }), item("PTX-136", "t1", { per_spouse: true }),
    item("PTX-101", "t1", { name: "Owner's personal tax return (T1)", unit_label: "per return", internal_note: "For owners of our corporate clients; included in or priced with their package." }),
    item("PTX-110", "t1", { name: "Personal tax return (T1), single" }), item("PTX-111", "t1", { name: "Personal tax returns (T1), couple" })];
  const r = planCleanup(items, ["t1", "bookkeeping"]);
  assert.deepEqual(r.plan, []);
});

test("applied before the spouse change: PTX-135 and PTX-136 set to each spouse, nothing else", () => {
  const items = [item("ACC-102", "bookkeeping"), item("PTX-129", "t1"), item("PTX-133", "t1", { per_spouse: true }), item("PTX-134", "t1"), item("PTX-135", "t1"), item("PTX-136", "t1"),
    item("PTX-101", "t1", { name: "Owner's personal tax return (T1)", unit_label: "per return", internal_note: "For owners of our corporate clients; included in or priced with their package." }),
    item("PTX-110", "t1", { name: "Personal tax return (T1), single" }), item("PTX-111", "t1", { name: "Personal tax returns (T1), couple" })];
  const r = planCleanup(items, ["t1", "bookkeeping"]);
  assert.deepEqual(r.plan, [{ op: "set_fields", code: "PTX-135", per_spouse: true }, { op: "set_fields", code: "PTX-136", per_spouse: true }]);
});

test("renames PTX-101, PTX-110 and PTX-111, and updates the PTX-101 note", () => {
  const items = [item("PTX-129", "t1"), item("PTX-101", "t1", { name: "Owner T1", unit_label: "per return", internal_note: "Company-client T1s, often included." }),
    item("PTX-110", "t1", { name: "Single" }), item("PTX-111", "t1", { name: "Personal tax return (T1), couple" })];
  const r = planCleanup(items, ["t1"]);
  const names = r.plan.filter((o) => o.name && o.op === "set_fields").map((o) => `${o.code}=${o.name}`);
  assert.deepEqual(names, ["PTX-101=Owner's personal tax return (T1)", "PTX-110=Personal tax return (T1), single", "PTX-111=Personal tax returns (T1), couple"]);
  assert.ok(r.plan.some((o) => o.code === "PTX-101" && o.internal_note === "For owners of our corporate clients; included in or priced with their package."));
});
