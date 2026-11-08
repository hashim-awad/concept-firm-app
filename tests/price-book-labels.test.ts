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

test("priced per client only when a package lists the item", () => {
  const offers = [
    { offer: "Team: Core", segment: "Team or brokerage", services: ["Year-end compilation", "CTX-101"], is_active: true },
    { offer: "Old", segment: "Agent", services: ["ADV-103"], is_active: false },
    { offer: "T1 row", segment: "T1 personal", services: ["INC-101"], is_active: true },
  ];
  assert.deepEqual(packagesCovering({ code: "CTX-101", name: "T2 return" }, offers), ["Team: Core"]);
  assert.deepEqual(packagesCovering({ code: "YE-101", name: "Year-End Compilation" }, offers), ["Team: Core"]);
  assert.deepEqual(packagesCovering({ code: "ADV-103", name: "Advisory" }, offers), [], "inactive package does not count");
  assert.deepEqual(packagesCovering({ code: "INC-101", name: "Incorporation" }, offers), [], "T1 rows are not packages");
});
