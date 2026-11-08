import { test } from "node:test";
import assert from "node:assert/strict";
import { packagesCovering, suggestCode } from "../src/lib/price-book/labels.ts";

test("code follows the service line", () => {
  const all = ["PTX-101", "PTX-136", "PTX-190", "CTX-101", "CTX-103", "ADV-101", "ADV-102", "ADV-103", "ACC-106", "SFT-101"];
  assert.equal(suggestCode(["PTX-101", "PTX-136", "PTX-190"], all), "PTX-191");
  assert.equal(suggestCode(["CTX-101", "CTX-103"], all), "CTX-104");
  assert.equal(suggestCode(["ADV-101", "ADV-102"], all), "ADV-104", "CFO never repeats Advisory's ADV-103");
  assert.equal(suggestCode(["ACC-106", "SFT-101"], all), "ACC-107", "most used prefix wins");
  assert.equal(suggestCode([], all), "", "empty line: no guess");
});

test("priced per client only for items a package's ticked services cover", () => {
  const offers = [
    { offer: "Team: Essential", segment: "Team or brokerage", services: ["books", "cfo", "comp", "gst", "payroll", "t2"], monthly_fee: 1150, software_per_month: 69, is_active: true },
    { offer: "Agent: year-end T2 only", segment: "Agent", services: ["comp", "gst", "t2"], software_per_month: null, is_active: true },
    { offer: "Old", segment: "Agent", services: ["coord"], is_active: false },
    { offer: "T1 row", segment: "T1 personal", services: ["t1"], is_active: true },
  ];
  const cov = (code: string) => packagesCovering({ code, name: code }, offers);
  assert.deepEqual(cov("CTX-101"), ["Team: Essential", "Agent: year-end T2 only"]);
  assert.deepEqual(cov("YE-102"), ["Team: Essential", "Agent: year-end T2 only"], "statements plus T2");
  assert.deepEqual(cov("SFT-101"), ["Team: Essential"], "software only where charged");
  assert.deepEqual(cov("ACC-102"), ["Team: Essential"]);
  assert.deepEqual(cov("ACC-106"), [], "inactive package does not count");
  assert.deepEqual(cov("PTX-101"), [], "T1 rows are not packages");
  assert.deepEqual(cov("ADJ-101"), []);
  assert.deepEqual(cov("ACC-101"), ["Team: Essential"], "monthly fee means ACC-101; year-end only does not");
  assert.deepEqual(packagesCovering({ code: "ACC-101", name: "x" }, [{ offer: "P", segment: "Agent", services: ["pnl"], is_active: true }]), ["P"], "pnl is part of ACC-101");
});
