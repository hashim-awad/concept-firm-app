// Suggestions for coding a bank or card line (Hashim, Nov 13 and 15, 2026): the client's vendor rules
// first, then how this client's file coded the same vendor (this year or last year), then the firm's
// vendor rules. Pure, tested.

// The vendor part of a bank description: no foreign-amount second line, no numbers or card masks.
// "SAMPLE PRINT SHOP GUELPH ON AMT 589.82 USD" -> "SAMPLE PRINT SHOP GUELPH ON".
// Firm vendor rules carry a tax choice, never a provincial code (round 2 item 3).
export const FIRM_TAX_MODE = { taxable: "Taxable at the client's rate", none: "No sales tax", line: "Choose on the line" } as const;

export function vendorKey(description: string): string {
  return description.toUpperCase()
    .replace(/\s+AMT\s+[\d,.]+\s+[A-Z]{3}\b.*$/, "")
    .replace(/[*#]+/g, " ")
    .replace(/\b\d[\d\-/.,]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Coding = { account: string; tax: string | null };
// Where a suggestion comes from (Hashim, Nov 15, 2026, layout item 4): the client's vendor rule, how this
// client's file coded the same vendor this year or last year (with how many times), or a firm vendor rule.
// Never from a guess at what the vendor's name means: no match, no suggestion.
export type Suggestion = Coding & { source: "rule" | "history" | "firm"; count?: number };
export type History = Map<string, { coding: Coding; count: number }>;

// The coding history: for each vendor, the account and tax code used most often (the latest wins a tie).
export function codingHistory(lines: { description: string; chart_account: string | null; tax_code: string | null; coded_at?: string | null }[]): History {
  const tally = new Map<string, Map<string, { coding: Coding; count: number; last: string }>>();
  for (const l of lines) {
    if (!l.chart_account) continue;
    const key = vendorKey(l.description);
    if (!key) continue;
    const k = `${l.chart_account}|${l.tax_code ?? ""}`;
    const m = tally.get(key) ?? new Map();
    const t = m.get(k) ?? { coding: { account: l.chart_account, tax: l.tax_code }, count: 0, last: "" };
    t.count++; if ((l.coded_at ?? "") > t.last) t.last = l.coded_at ?? "";
    m.set(k, t); tally.set(key, m);
  }
  const out: History = new Map();
  for (const [key, m] of tally) {
    const best = [...m.values()].sort((a, b) => b.count - a.count || b.last.localeCompare(a.last))[0];
    out.set(key, { coding: best.coding, count: best.count });
  }
  return out;
}

export function suggest(description: string, rules: Map<string, Coding>, history: History, firm: Map<string, Coding> = new Map()): Suggestion | null {
  const key = vendorKey(description);
  if (!key) return null;
  const r = rules.get(key);
  if (r) return { ...r, source: "rule" };
  const h = history.get(key);
  if (h) return { ...h.coding, source: "history", count: h.count };
  const f = firm.get(key);
  return f ? { ...f, source: "firm" } : null;
}

export const suggestionLabel = (s: Suggestion) => (s.source === "rule" ? "Vendor rule" : s.source === "firm" ? "Firm rule" : `Coded this way ${s.count} time${s.count === 1 ? "" : "s"}`);
