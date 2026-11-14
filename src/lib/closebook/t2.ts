// Step 8, T2 tie-out (round 10, Hashim, Nov 27, 2026). Pure and tested.
// Benchmarks: QuickBooks Online's GIFI export for the file (gifi.ts), ProFile for the import, CaseWare for
// the tie-out working paper: each check shows its figures and its result, and a failed check refuses the
// export by name.
import type { GifiResult } from "./gifi.ts";

const cents = (n: number) => Math.round(n * 100) / 100;
export const fmt = (n: number) => { const t = Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${t})` : t; };

export type CheckRow = { label: string; amount?: number; text?: string; total?: boolean };
export type GifiCheck = { key: string; title: string; ok: boolean; rows: CheckRow[]; result: string };

// The five checks before every export. lastYearRe: last year's closing retained earnings from step 2
// (null when step 2 has none).
export function gifiChecks(r: GifiResult, lastYearRe: number | null): GifiCheck[] {
  const t = r.totals;
  const out: GifiCheck[] = [];
  const diff = (a: number, b: number) => cents(a - b);
  const res = (d: number) => (d === 0 ? "Ties" : `Off by ${fmt(d)}`);

  const tbOk = r.tbOutBy === 0 && r.issues.length === 0;
  out.push({ key: "tb", title: "The trial balance balances and every account is matched (step 7)", ok: tbOk,
    rows: [{ label: "Trial balance difference (debits less credits)", amount: r.tbOutBy }, { label: "Accounts not ready", text: String(r.issues.length) },
      ...r.issues.slice(0, 8).map((i) => ({ label: i, text: "" }))],
    result: tbOk ? "Balances; every account is matched" : r.tbOutBy !== 0 ? `Out by ${fmt(r.tbOutBy)}` : `${r.issues.length} account${r.issues.length === 1 ? "" : "s"} not ready` });

  const le = cents(t["3499"] + t["3620"]), d1 = diff(t["2599"], le);
  out.push({ key: "bs", title: "Total assets (2599) = total liabilities (3499) + total equity (3620)", ok: d1 === 0,
    rows: [{ label: "2599 Total assets", amount: t["2599"] }, { label: "3499 Total liabilities", amount: t["3499"] }, { label: "3620 Total shareholder equity", amount: t["3620"] },
      { label: "3499 + 3620", amount: le, total: true }, { label: "Difference", amount: d1, total: true }], result: res(d1) });

  // Net income in the retained earnings schedule (3680) is the year's net income carried to it.
  const ni3680 = t["9999"], d2 = diff(t["9999"], ni3680);
  out.push({ key: "ni", title: "Net income on the income statement (9999) = net income in the retained earnings schedule (3680)", ok: d2 === 0,
    rows: [{ label: "9999 Net income/loss after taxes", amount: t["9999"] }, { label: "3680 Net income/loss", amount: ni3680 }, { label: "Difference", amount: d2, total: true }], result: res(d2) });

  // Retained earnings: start + net income − dividends + prior period adjustments + other = end, and the
  // end equals retained earnings on the balance sheet (3600: total equity less share capital and the rest).
  const end = cents(t["3660"] + ni3680 - r.re.dividends + r.re.ppa + r.re.other);
  const onBs = cents(t["3620"] - r.re.shareEquity);
  const d3 = diff(end, t["3849"]), d4 = diff(t["3849"], onBs);
  out.push({ key: "re", title: "Retained earnings end (3849) = start + net income − dividends + prior period adjustments + other, = 3600 on the balance sheet", ok: d3 === 0 && d4 === 0,
    rows: [{ label: "3660 Retained earnings – start", amount: t["3660"] }, { label: "3680 Net income", amount: ni3680 }, { label: "Less 3700 Dividends", amount: -r.re.dividends },
      { label: "3720 Prior period adjustments", amount: r.re.ppa }, { label: "3740 Other items", amount: r.re.other }, { label: "Worked out", amount: end, total: true },
      { label: "3849 Retained earnings – end", amount: t["3849"] }, { label: "3600 Retained earnings on the balance sheet", amount: onBs }, { label: "Difference", amount: cents(d3 + d4), total: true }],
    result: res(cents(d3 + d4)) });

  const d5 = lastYearRe === null ? null : diff(t["3660"], lastYearRe);
  out.push({ key: "opening", title: "Retained earnings start (3660) = last year's closing retained earnings (step 2)", ok: d5 === 0,
    rows: [{ label: "3660 Retained earnings – start", amount: t["3660"] }, lastYearRe === null ? { label: "Last year's closing retained earnings (step 2)", text: "Not in step 2" }
      : { label: "Last year's closing retained earnings (step 2)", amount: lastYearRe }, ...(d5 === null ? [] : [{ label: "Difference", amount: d5, total: true }])],
    result: d5 === null ? "Last year's closing retained earnings are not in step 2" : res(d5) });
  return out;
}

export type ExportKind = "before_tax" | "final";
export const KIND_LABEL: Record<ExportKind, string> = { before_tax: "before tax entries", final: "final" };
// "<legal name> GIFI <year end> before tax entries.gfi" or "... final.gfi". Characters a file name
// cannot hold are left out.
export function gifiFileName(legalName: string, yearEnd: string, kind: ExportKind): string {
  const name = legalName.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "Client";
  return `${name} GIFI ${yearEnd} ${KIND_LABEL[kind]}.gfi`;
}

// The tax workpaper (Appendix B, Tax codes): for each tax code in use, its accounts, their amounts and
// the Schedule 1 effect. Amounts: the account's final balance as GIFI shows it (expenses and revenue
// positive). Effect: + adds to net income for tax, − deducts from it.
export type WpAccount = { label: string; line_no: string; gifi: string; lineType: string; code: string; amount: number };
export type Treatment = "add100" | "add50" | "deduct100" | "none";
export const TREATMENT: Record<Treatment, string> = { add100: "Add back 100%", add50: "Add back 50%", deduct100: "Deduct 100%", none: "No Schedule 1 effect" };
export type WpSection = { code: string; name: string; rule: string; accounts: (WpAccount & { effect: number | null; note: string })[]; total: number; effect: number; open: number };

export function taxWorkpaper(accounts: WpAccount[], codes: Map<string, { name: string; rule: string }>, treatments: Map<string, Treatment>): WpSection[] {
  const out = new Map<string, WpSection>();
  for (const a of accounts) {
    if (a.amount === 0 || a.code === "FULL" || a.code === "BS") continue;
    let effect: number | null, note = "";
    const revenue = a.lineType === "Revenue";
    switch (a.code) {
      case "M50": effect = cents(a.amount * 0.5); note = "Add back 50%"; break;
      case "NONDED": case "INCTAX": effect = a.amount; note = "Add back 100%"; break;
      case "DON": effect = a.amount; note = "Add back 100%; claim on Schedule 2"; break;
      case "AMORT": effect = a.amount; note = "Add back 100%; CCA is claimed on Schedule 8"; break;
      // A book gain (revenue) comes out; a book loss goes back in.
      case "CAPGAIN": case "UNREAL": effect = revenue ? -a.amount : a.amount; note = revenue ? "Remove the book gain" : "Add back the book loss"; break;
      case "DIV112": effect = -a.amount; note = "Deduct under s.112 on Schedule 3"; break;
      case "REVIEW": {
        const t = treatments.get(a.line_no);
        if (!t) { effect = null; note = "The reviewer sets the treatment"; break; }
        effect = t === "add100" ? a.amount : t === "add50" ? cents(a.amount * 0.5) : t === "deduct100" ? -a.amount : 0;
        note = `Reviewer: ${TREATMENT[t]}`; break;
      }
      default: effect = 0; note = "";
    }
    const c = codes.get(a.code);
    const s = out.get(a.code) ?? { code: a.code, name: c?.name ?? a.code, rule: c?.rule ?? "", accounts: [], total: 0, effect: 0, open: 0 };
    s.accounts.push({ ...a, effect, note });
    s.total = cents(s.total + a.amount);
    if (effect === null) s.open++; else s.effect = cents(s.effect + effect);
    out.set(a.code, s);
  }
  const order = ["M50", "NONDED", "DON", "AMORT", "INCTAX", "CAPGAIN", "DIV112", "UNREAL", "REVIEW"];
  return [...out.values()].sort((a, b) => order.indexOf(a.code) - order.indexOf(b.code));
}

// The tie-out to ProFile. Closebook's figures come from the final export; the preparer types ProFile's.
// A difference shows to the cent, Closebook less ProFile (round 10 fix 6). ProFile rounds each GIFI line
// to whole dollars, so a difference within the rounding allowed (Settings, $5) shows as rounding and does
// not block (fix 1). CCA is compared only when the client's book amortization is CCA.
export type TieItem = { key: "ni" | "assets" | "cca" | "tax"; label: string; closebook: number; profile: number | null; diff: number | null; compared: boolean;
  accepted: { diff: number; by: string; at: string; reason: string } | null; open: boolean; rounding: boolean };
export function tieOut(closebook: { ni: number; assets: number; amort: number; tax: number }, typed: { ni: number | null; assets: number | null; cca: number | null; tax: number | null },
  accepted: Record<string, { diff: number; by: string; at: string; reason: string }>, bookAmortization: boolean, roundingAllowed = 5): TieItem[] {
  const item = (key: TieItem["key"], label: string, cb: number, pf: number | null, compared = true): TieItem => {
    const diff = pf === null ? null : cents(cb - pf);
    const acc = accepted[key] ?? null;
    // Only net income and total assets come from the rounded GIFI lines; CCA and income tax tie to the cent.
    const allowed = key === "ni" || key === "assets" ? roundingAllowed : 0;
    const rounding = compared && allowed > 0 && diff !== null && diff !== 0 && Math.abs(diff) <= allowed;
    return { key, label, closebook: cb, profile: pf, diff, compared, accepted: acc, rounding, open: compared && diff !== null && Math.abs(diff) > allowed && (!acc || acc.diff !== diff) };
  };
  return [
    item("ni", "Net income (9999)", closebook.ni, typed.ni),
    item("assets", "Total assets (2599)", closebook.assets, typed.assets),
    item("cca", "Total CCA claimed (Schedule 8) and amortization booked (AMORT lines)", closebook.amort, typed.cca, !bookAmortization),
    item("tax", "Total income tax, federal plus provincial, and income tax booked (INCTAX lines)", closebook.tax, typed.tax),
  ];
}
