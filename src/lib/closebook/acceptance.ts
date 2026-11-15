// Round 16: the acceptance and continuance record (step 1), shared by the page (server) and its form.
// Round 18: the basis of accounting and the users of the statements live on the client. The record keeps
// what the preparer confirmed for this year (read-only): basis, users with the basis each needs, who and when.
export type YN = "yes" | "no" | "";
export type StatementUser = { kind: "lender" | "other"; name: string; basis_needed?: string };
export type AccUser = StatementUser & { agreed: YN };
export type Statements = { basis: string; custom_basis_wording: string; users: StatementUser[] };
export type Confirmed = Statements & { by: string; at: string };
export type AccRow = { q1: YN; q2: YN; q3: YN; q4: YN; q5: YN; q5_note: string; users: AccUser[]; q8: "confirmed" | "different" | ""; q8_note: string; q9: YN;
  answered: Record<string, { by: string; at: string; same?: boolean }>; confirmed: Confirmed | null };
export const emptyAcc = (): AccRow => ({ q1: "", q2: "", q3: "", q4: "", q5: "", q5_note: "", users: [], q8: "", q8_note: "", q9: "", answered: {}, confirmed: null });

export const basisWords = (s: Pick<Statements, "basis" | "custom_basis_wording">) =>
  s.basis === "cash" ? "Cash basis" : s.basis === "custom" ? `Custom: ${s.custom_basis_wording || "wording not set"}` : "Concept standard (cash basis with selected accruals)";
export const userWords = (u: StatementUser) => `${u.kind === "lender" ? "A lender" : "Other"}: ${u.name}${u.basis_needed ? ` (${u.basis_needed.toLowerCase()})` : ""}`;
export const usersWords = (users: StatementUser[]) => ["Management", ...users.map(userWords)].join("; ");
// One line for the face of question 6 (Hashim, round 18 fix): "Management; Dummy Credit Union (lender); Dummy Landlord Ltd."
export const usersLine = (users: StatementUser[]) => ["Management", ...users.map((u) => (u.kind === "lender" ? `${u.name} (lender)` : u.name))].join("; ");
// The same record? Compares what matters, ignoring who and when.
const userKey = (x: Statements) => JSON.stringify(x.users.map((u) => [u.kind, u.name.trim().toLowerCase(), u.basis_needed ?? ""]));
export const sameBasis = (a: Statements | null, b: Statements | null) => !!a && !!b && a.basis === b.basis && (a.custom_basis_wording ?? "") === (b.custom_basis_wording ?? "");
export const sameUsers = (a: Statements | null, b: Statements | null) => !!a && !!b && userKey(a) === userKey(b);
export const sameStatements = (a: Statements | null, b: Statements | null) => sameBasis(a, b) && sameUsers(a, b);
