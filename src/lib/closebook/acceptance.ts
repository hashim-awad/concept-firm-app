// Round 16: the acceptance and continuance record (step 1), shared by the page (server) and its form.
export type YN = "yes" | "no" | "";
export type AccUser = { kind: "lender" | "other"; name: string; agreed: YN };
export type AccRow = { q1: YN; q2: YN; q3: YN; q4: YN; q5: YN; q5_note: string; users: AccUser[]; q8: "confirmed" | "different" | ""; q8_note: string; q9: YN;
  answered: Record<string, { by: string; at: string; same?: boolean }> };
export const emptyAcc = (): AccRow => ({ q1: "", q2: "", q3: "", q4: "", q5: "", q5_note: "", users: [], q8: "", q8_note: "", q9: "", answered: {} });
