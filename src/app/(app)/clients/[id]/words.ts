// Round 18: the client page's plain words. The basis of accounting, the users of the statements, and the
// Activity tab's readable lines for a client record change (from the activity log's old and new rows).
import { formatDate } from "@/lib/dates";

export type StatementUserRow = { kind: string; name: string; basis_needed?: string };

export const STATUS_WORD: Record<string, string> = { active: "Active", waiting_taxdome: "Waiting for TaxDome", inactive: "Inactive" };
const BASIS_SHORT: Record<string, string> = { standard: "Concept standard", cash: "Cash basis", custom: "Custom" };
const KIND_WORD: Record<string, string> = { lender: "A lender", other: "Other" };

export function basisWords(basis: string, custom: string): string {
  if (basis === "cash") return "Cash basis";
  if (basis === "custom") return `Custom: ${custom.trim() || "no wording yet"}`;
  return "Concept standard (cash basis with selected accruals)";
}

export function statementUsers(v: unknown): StatementUserRow[] {
  return Array.isArray(v) ? v.filter((u) => u && typeof u === "object" && typeof u.name === "string").map((u) => ({ kind: String(u.kind ?? "other"), name: String(u.name), basis_needed: String(u.basis_needed ?? "") })) : [];
}

export const userLabel = (u: StatementUserRow) => `${KIND_WORD[u.kind] ?? "Other"}: ${u.name}`;

// Activity tab. Fields people change on the client page, with their names in plain words.
const FIELDS: Record<string, string> = {
  legal_name: "Legal name", kind: "Client type", entity_type: "Entity type", signing_officer: "Signing officer", signer_title: "Signer title",
  salutation: "Salutation", email: "Email", street_address: "Street address", address_line2: "Address line 2", city: "City", postal_code: "Postal code",
  province: "Province", year_end_md: "Year end", basis: "Basis of accounting", custom_basis_wording: "Custom basis wording", statement_users: "Users of the statements",
  name_verified: "Legal name check", status: "Status", notes: "Notes", business_number: "Business Number", taxdome_tags: "TaxDome tags",
  taxdome_account_id: "TaxDome account", t2_balance_due_months: "Balance due", t2_exclude_deadlines: "Exclude from deadlines",
};
// Long text: say it changed, without quoting it.
const LONG = new Set(["notes", "custom_basis_wording"]);

function value(key: string, v: unknown): string {
  if (v === null || v === undefined || v === "") return "blank";
  if (key === "basis") return BASIS_SHORT[String(v)] ?? String(v);
  if (key === "status") return STATUS_WORD[String(v)] ?? String(v);
  if (key === "kind") return v === "individual" ? "Individual" : "Corporation";
  if (key === "province") return v === "OTHER" ? "Other" : String(v);
  if (key === "name_verified") return v ? "checked" : "not checked";
  if (key === "t2_exclude_deadlines") return v ? "yes" : "no";
  if (key === "t2_balance_due_months") return `${v} months after year-end`;
  if (Array.isArray(v)) return v.length ? v.join(", ") : "none";
  if (typeof v === "boolean") return v ? "yes" : "no";
  return String(v);
}

function usersChange(oldV: unknown, newV: unknown): string {
  const a = statementUsers(oldV), b = statementUsers(newV);
  const key = (u: StatementUserRow) => u.name.trim().toLowerCase();
  const fmt = (u: StatementUserRow) => `${KIND_WORD[u.kind] ?? "Other"}, ${u.name}`;
  const added = b.filter((u) => !a.some((x) => key(x) === key(u)));
  const removed = a.filter((u) => !b.some((x) => key(x) === key(u)));
  const changed = b.filter((u) => a.some((x) => key(x) === key(u) && (x.kind !== u.kind || (x.basis_needed ?? "") !== (u.basis_needed ?? ""))));
  const parts: string[] = [];
  if (added.length) parts.push(`added ${added.map(fmt).join("; ")}`);
  if (removed.length) parts.push(`removed ${removed.map(fmt).join("; ")}`);
  for (const u of changed) parts.push(`${fmt(u)}, basis needed ${u.basis_needed ? u.basis_needed : "not set"}`);
  return parts.length ? parts.join("; ") : "order changed";
}

// One line per field changed, e.g. "Basis of accounting: Concept standard → Cash basis".
export function clientChanges(details: unknown): string[] {
  const d = (details ?? {}) as { old?: Record<string, unknown>; new?: Record<string, unknown> };
  if (!d.old || !d.new) return [];
  const out: string[] = [];
  for (const [k, label] of Object.entries(FIELDS)) {
    if (!(k in d.new) && !(k in d.old)) continue;
    const a = d.old[k], b = d.new[k];
    if (JSON.stringify(a ?? null) === JSON.stringify(b ?? null)) continue;
    if (k === "statement_users") out.push(`${label}: ${usersChange(a, b)}`);
    else if (LONG.has(k)) out.push(`${label} changed`);
    else if (k === "name_verified" && b && d.new.name_verified_on) out.push(`${label}: checked ${formatDate(String(d.new.name_verified_on))}`);
    else out.push(`${label}: ${value(k, a)} → ${value(k, b)}`);
  }
  // Re-checked after a name change: the check stays ticked with a new date.
  if (d.old.name_verified && d.new.name_verified && d.old.name_verified_on !== d.new.name_verified_on && d.new.name_verified_on)
    out.push(`${FIELDS.name_verified}: checked again ${formatDate(String(d.new.name_verified_on))}`);
  return out;
}
