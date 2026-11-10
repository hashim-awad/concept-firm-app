// The wording version a letter is built with: its label (e.g. "EL v3.32"), the date it was
// approved, and the pieces that differ from the original EL v3.31.
export type Wording = { id: string; label: string; date: string; texts: Record<string, string> };

// Engine settings for a wording version. No version (or the original) gives EL v3.31 exactly.
export function wordingEnv(w: Wording | null | undefined): { WORDING?: Record<string, string>; EL_VERSION?: string; EL_VERSION_DATE?: string } {
  if (!w) return {};
  return { WORDING: w.texts, EL_VERSION: w.label, EL_VERSION_DATE: readableDate(w.date) };
}

// The letters' footer shows the approval date the readable way, "Nov 8, 2026" (batch section 13).
export function readableDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
}
