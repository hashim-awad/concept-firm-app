// CB2-0 v7 item 11: before against after. Prints one line per file: its ID and pass, fail or "expected change". Never a
// figure. Expected change: only GST/HST lines 110, 112 and 113 moved, on a file where a payment was coded to 21500
// (line 110 now reads only the GST/HST instalments account; 112 is 110 plus 111; 113 follows). Anything else is a fail.
// Run: node scripts/live-check/compare.ts before.json after.json
import { readFileSync } from "node:fs";

type Run = Record<string, { paid21500: boolean; figures: Record<string, string> }>;
const [a, b] = process.argv.slice(2).map((p) => JSON.parse(readFileSync(p, "utf8")) as Run);
const EXPECTED = /^gst\.\d+\.(110|112|113)$/;
let fails = 0, expected = 0, pass = 0;
for (const id of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) {
  const x = a[id], y = b[id];
  if (!x || !y) { fails++; console.log(`${id} fail (${x ? "missing after" : "new since before"})`); continue; }
  const keys = new Set([...Object.keys(x.figures), ...Object.keys(y.figures)]);
  const moved = [...keys].filter((k) => x.figures[k] !== y.figures[k]);
  if (!moved.length) { pass++; console.log(`${id} pass`); }
  else if (x.paid21500 && moved.every((k) => EXPECTED.test(k))) { expected++; console.log(`${id} expected change`); }
  else { fails++; console.log(`${id} fail`); }
}
console.log(`${pass} pass, ${expected} expected change, ${fails} fail.`);
process.exit(fails ? 1 : 0);
