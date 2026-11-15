// What a statement read cost (round 20, Hashim, Nov 15, 2026). Pure.
//
// Source: Claude API list prices in USD per million tokens, as given in Anthropic's claude-api reference
// (models table and "Migrating to Claude Sonnet 5.5"; pricing page cached Nov 3, 2026). Check the Pricing
// page (https://platform.claude.com/docs/en/about-claude/pricing) when the rates change and update this table only.
// - Claude Sonnet 5.5: $2 input, $10 output, cache writes $2.50 (5 minutes) / $4 (1 hour), cache reads $0.10.
// - Claude Sonnet 5 (the server-side refusal fallback for Sonnet 5.5): the same, except cache reads $0.20.
// - inference_geo "us" (US-only processing) is billed at 1.1x every rate above.
// The reader sends no cache_control, so cache tokens are normally 0; they are priced in case that changes.

export type Rates = { input: number; output: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number };

export const RATES: Record<string, Rates> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
};
export const DEFAULT_MODEL = "claude-sonnet-5-5";
export const US_ONLY_MULTIPLIER = 1.1;

export type TokenUsage = { input: number; output: number; cacheWrite?: number; cacheRead?: number };

// The rates for the model that answered. A dated or unknown name falls back to its family, then to Sonnet 5.5.
export function ratesFor(model: string | null | undefined): Rates {
  const m = (model ?? "").toLowerCase();
  if (RATES[m]) return RATES[m];
  const family = Object.keys(RATES).sort((a, b) => b.length - a.length).find((k) => m.startsWith(k));
  return RATES[family ?? DEFAULT_MODEL];
}

// Cost in USD, to 4 decimals (the column is numeric(10,4)). geo "us" multiplies by 1.1.
export function costUsd(model: string | null | undefined, u: TokenUsage, geo: "us" | "global" = "us"): number {
  const r = ratesFor(model);
  const base = (u.input * r.input + u.output * r.output + (u.cacheWrite ?? 0) * r.cacheWrite5m + (u.cacheRead ?? 0) * r.cacheRead) / 1_000_000;
  const total = geo === "us" ? base * US_ONLY_MULTIPLIER : base;
  return Math.round(total * 10_000) / 10_000;
}
