// Suggestions for coding a bank or card line (Hashim, Nov 13, 2026): the client's vendor rules first,
// then how the same vendor was coded in the client's earlier files. Pure, tested.

// The vendor part of a bank description: no foreign-amount second line, no numbers or card masks.
// "SAMPLE PRINT SHOP GUELPH ON AMT 589.82 USD" -> "SAMPLE PRINT SHOP GUELPH ON".
export function vendorKey(description: string): string {
  return description.toUpperCase()
    .replace(/\s+AMT\s+[\d,.]+\s+[A-Z]{3}\b.*$/, "")
    .replace(/[*#]+/g, " ")
    .replace(/\b\d[\d\-/.,]*\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type Coding = { account: string; tax: string | null };
export type Suggestion = Coding & { source: "rule" | "last_year" };

export function suggest(description: string, rules: Map<string, Coding>, history: Map<string, Coding>): Suggestion | null {
  const key = vendorKey(description);
  if (!key) return null;
  const r = rules.get(key);
  if (r) return { ...r, source: "rule" };
  const h = history.get(key);
  return h ? { ...h, source: "last_year" } : null;
}
