// An answer key written by hand (source/answer_key.json, debit positive everywhere), checked against the engine:
// the trial balance by account (prelim, adjusting, reclass, final), net income (income positive) and the GST/HST return.
// GIFI lines: the engine's GIFI file shows liabilities, equity and revenue (2600 to 3999, 8000 to 8299) credit positive,
// as ProFile reads them, and opening retained earnings on 3660 (3600 is a total ProFile works out); the key's 3600 is
// compared with the engine's 3660. Known differences (known-differences.json, each with its reason) are reported, not failed.
import type { FileResult } from "./compute.ts";

type Key = { trial_balance: Record<string, { prelim: number; adjusting: number; reclass: number; final: number }>;
  net_income?: { before_entries: number; adjusting: number; after: number }; gifi_lines?: Record<string, number>; gst_hst_return?: Record<string, number> };

const credit = (code: string) => (code >= "2600" && code <= "3999") || (code >= "8000" && code <= "8299");

export function checkExternal(got: FileResult, key: Key, known: Record<string, string>) {
  const fails: string[] = [], seen: string[] = [];
  let n = 0;
  const chk = (id: string, want: number, have: number | undefined) => {
    n++;
    if (Math.round(want * 100) === Math.round((have ?? 0) * 100)) return;
    const line = `${id}: key ${want.toFixed(2)}, engine ${(have ?? 0).toFixed(2)}`;
    if (known[id]) seen.push(`${line} (known: ${known[id]})`); else fails.push(line);
  };
  const tb = new Map(got.tb.map((r) => [r.account, r]));
  for (const [a, r] of Object.entries(key.trial_balance)) {
    const g = tb.get(a);
    chk(`TB ${a} prelim`, r.prelim, g?.prelim); chk(`TB ${a} adjusting`, r.adjusting, g?.adj); chk(`TB ${a} reclass`, r.reclass, g?.reclass); chk(`TB ${a} final`, r.final, g?.final);
  }
  for (const a of tb.keys()) if (!(a in key.trial_balance) && tb.get(a)!.final) fails.push(`TB ${a}: in the engine, not in the key`);
  if (key.net_income) {
    const pl = got.tb.filter((x) => /^[4-9]/.test(x.account));
    chk("Net income before entries", key.net_income.before_entries, -pl.reduce((s, x) => s + x.prelim, 0));
    chk("Net income entries", key.net_income.adjusting, -pl.reduce((s, x) => s + x.adj + x.reclass, 0));
    chk("Net income after", key.net_income.after, -pl.reduce((s, x) => s + x.final, 0));
  }
  if (key.gifi_lines) for (const [c, v] of Object.entries(key.gifi_lines)) {
    const code = c === "3600" ? "3660" : c;
    const have = got.gifi[code];
    chk(`GIFI ${c}`, v, have === undefined ? undefined : credit(code) ? -have : have);
  }
  const ret = got.gst?.[0]?.lines ?? {};
  if (key.gst_hst_return) for (const [l, v] of Object.entries(key.gst_hst_return)) chk(`GST/HST ${l}`, v, ret[l]);
  return { checked: n, fails, known: seen };
}
