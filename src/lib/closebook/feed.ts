// Round 24 (Hashim, Nov 16, 2026): the reasons a statement is excluded (rule 9), for the server and the client.
export const REASONS: { key: string; label: string }[] = [
  { key: "wrong_account", label: "Wrong account" }, { key: "wrong_client", label: "Wrong client" }, { key: "wrong_period", label: "Wrong period" },
  { key: "twice", label: "Imported twice" }, { key: "other", label: "Other" },
];
export const reasonLabel = (k: string, note: string) => (k === "other" ? `Other: ${note}` : REASONS.find((r) => r.key === k)?.label ?? k);
