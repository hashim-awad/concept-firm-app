// The wording version a letter is built with: its label (e.g. "EL v3.32"), the date it was
// approved, and the pieces that differ from the original EL v3.31.
export type Wording = { id: string; label: string; date: string; texts: Record<string, string> };

// Engine settings for a wording version. No version (or the original) gives EL v3.31 exactly.
export function wordingEnv(w: Wording | null | undefined): { WORDING?: Record<string, string>; EL_VERSION?: string; EL_VERSION_DATE?: string } {
  if (!w) return {};
  return { WORDING: w.texts, EL_VERSION: w.label, EL_VERSION_DATE: w.date };
}
