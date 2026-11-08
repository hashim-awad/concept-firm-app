// Notion CSV import mapping. Made-up rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv } from "../src/lib/import/csv.ts";
import { nDate, nNum, nRelationNames, parseSource, parseLetterData } from "../src/lib/import/notion.ts";

test("CSV: quotes, commas, line breaks, BOM", () => {
  const rows = parseCsv('﻿a,b\r\n"x, y","line 1\nline ""2"""\r\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'line 1\nline "2"']]);
});

test("Notion values", () => {
  assert.equal(nDate("November 8, 2026"), "2026-11-08");
  assert.equal(nDate("2026/03/01"), "2026-03-01");
  assert.equal(nDate("March 31, 2027 → April 2, 2027"), "2027-03-31");
  assert.equal(nDate(""), null);
  assert.equal(nDate("soon"), undefined);
  assert.equal(nNum("$5,388.00"), 5388);
  assert.equal(nNum(""), null);
  assert.equal(nNum("abc"), undefined);
  assert.deepEqual(nRelationNames("Example Holdings Inc. (https://www.notion.so/Example-Holdings-Inc-0123456789abcdef0123456789abcdef?pvs=21)"), ["Example Holdings Inc."]);
  assert.deepEqual(parseLetterData('S1:{"v":1,"f":{"company":"X"},"fees":[["main","Monthly","","month","1150"]]}')?.fees[0][4], "1150");
});

test("clients file is recognised and mapped; problems name the row", () => {
  const csv = "Legal name,Signing officer,Signer title,Year end (month-day),Province,Entity type,Basis of accounting,Name verified,Name verified on,Status\n" +
    "Sample Realty Ltd.,Morgan Example,President,03-31,AB,PREC,Cash basis,Yes,\"October 1, 2026\",Active\n" +
    "Example Person,Example Person,Individual,31-12,ON,Individual,,No,,Active\n";
  const r = parseSource(csv);
  assert.ok(!("error" in r));
  if ("error" in r) return;
  assert.equal(r.source, "clients");
  assert.equal(r.rows.length, 2);
  const a = r.rows[0].data as Record<string, unknown>;
  assert.equal(a.kind, "corporation"); assert.equal(a.basis, "cash"); assert.equal(a.name_verified, true); assert.equal(a.name_verified_on, "2026-10-01"); assert.equal(a.province, "AB");
  const b = r.rows[1].data as Record<string, unknown>;
  assert.equal(b.kind, "individual"); assert.equal(b.year_end_md, "");
  assert.deepEqual(r.problems, [{ row: 3, msg: 'Year end "31-12" is not MM-DD. It is left blank.' }]);
});

test("engagements keep letter data, link client by name, keep Phase 3 fields", () => {
  const csv = 'Engagement,Client,Type,Fiscal year end,Status,EL issued,Fee,Letter data,Chk: Reviewed by Hashim,MAL signed\n' +
    'Sample FYE 2026-03-31,Sample Realty Ltd. (https://www.notion.so/x-0123456789abcdef0123456789abcdef),Monthly full service,"March 31, 2026",EL signed,"April 2, 2026","$3,200.00","S1:{""v"":1,""f"":{""company"":""Sample Realty Ltd.""},""fees"":[]}",Yes,\n';
  const r = parseSource(csv);
  if ("error" in r) throw new Error(r.error);
  assert.equal(r.source, "engagements");
  const d = r.rows[0].data as Record<string, any>;
  assert.equal(d.client_name, "Sample Realty Ltd.");
  assert.equal(d.fiscal_year_end, "2026-03-31"); assert.equal(d.el_issued, "2026-04-02"); assert.equal(d.fee, 3200);
  assert.equal(d.letter_data.f.company, "Sample Realty Ltd.");
  assert.deepEqual(d.extra, { chk_reviewed_by_hashim: true });
  assert.equal(r.problems.length, 0);
});

test("unknown file is refused", () => {
  const r = parseSource("Name,Tags\nx,y\n");
  assert.ok("error" in r);
});

import { createStudioEngine } from "../src/lib/studio/engine.generated.js";
import { proposalFromPack } from "../src/lib/import/notion.ts";
import { rebuild, engineFor, BLANK_PNG } from "../src/lib/studio/build.ts";
import { PROPOSALS, FLOORS } from "./studio/cases.mjs";

test("a past proposal regenerates from Studio's saved options data", () => {
  const c = PROPOSALS[1];
  const e = createStudioEngine({ DB: { floors: FLOORS, floorsOk: true, loaded: true, cat: [] } });
  const s = { single: false, mode: "final", name: c.fields.name, contact: c.fields.contact, salutation: c.fields.salutation, province: c.fields.province, segment: c.fields.segment, date: c.fields.date, valid: c.fields.valid, heard: [], opts: c.opts, rec: c.rec };
  const packed = JSON.parse(e.pPack(s));
  const snap = proposalFromPack({ title: "x", segment: c.fields.segment, date_sent: c.fields.date, valid_until: e.pValidUntil(s), recommended: c.opts[c.rec].name, options_data: packed });
  assert.ok(snap);
  const data = { floors: FLOORS, floorsOk: true, cat: [], signers: { letter: { name: "A", title: "B" }, proposal: { name: "A", title: "B" } } };
  const b = rebuild("proposal", engineFor("proposal", data, BLANK_PNG), snap, null, true, "2026-11-08");
  const want = c.opts.map((o: any) => ({ ...o, offer: "", svc: Object.fromEntries(Object.entries(o.svc).filter(([, v]) => v)) }));
  assert.deepEqual(JSON.parse(JSON.stringify(b.s.opts)), want);
  assert.equal(b.s.rec, c.rec); assert.equal(b.s.valid, "30"); assert.equal(b.s.name, c.fields.name);
  assert.deepEqual(e.pBuild({ ...s, opts: want }), b.e.pBuild(b.s), "same document text as the original, apart from the price-book offer Studio did not save");
});

import { nRelations, nameKey, looseKey, linkFormat } from "../src/lib/import/notion.ts";

test("client links: every format Notion exports", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const cases: [string, string, string][] = [
    [`Example Holdings Inc. (https://www.notion.so/Example-Holdings-Inc-${id}?pvs=21)`, "Example Holdings Inc.", "name with a web link"],
    [`Example Holdings Inc. (Studio%20Clients/Example%20Holdings%20Inc%20${id}.md)`, "Example Holdings Inc.", "name with a file path"],
    [`Example Holdings Inc. (../Studio%20Clients%20${id}/Example%20Holdings%20Inc%20${id}.md)`, "Example Holdings Inc.", "name with a file path"],
    [`Sample, Test & Co. (Ontario) Ltd. (https://www.notion.so/${id})`, "Sample, Test & Co. (Ontario) Ltd.", "name with a web link"],
    [`https://www.notion.so/Example-Holdings-Inc-${id}`, "Example Holdings Inc", "web link only"],
    [`Studio%20Clients/Example%20Holdings%20Inc%20${id}.md`, "Example Holdings Inc", "file path only"],
    ["Example Holdings Inc.", "Example Holdings Inc.", "plain name"],
  ];
  for (const [cell, name, fmt] of cases) {
    assert.equal(nRelations(cell)[0]?.name, name, cell);
    assert.equal(linkFormat(cell), fmt, cell);
  }
  assert.deepEqual(nRelations(`A Ltd. (https://www.notion.so/A-${id}), B Inc. (https://www.notion.so/B-${id})`).map((r) => r.name), ["A Ltd.", "B Inc."]);
});

test("name matching ignores case, spaces, quote styles; loose key for address-only links", () => {
  assert.equal(nameKey("  Sample Realty   LTD. "), nameKey("Sample Realty Ltd."));
  assert.equal(nameKey("Taylor’s Holdings Inc."), nameKey("Taylor's Holdings Inc."));
  assert.equal(looseKey("Example Holdings Inc"), looseKey("Example Holdings Inc."));
  assert.notEqual(looseKey("Example Holdings Inc"), looseKey("Example Holding Inc"));
});
