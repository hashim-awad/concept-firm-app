// TaxDome Accounts CSV: read only the columns Studio needs, then match to Studio clients.
// Pure (no database), so it can be tested. The file holds personal data Studio must never keep
// (SIN, notes, contacts, addresses): only the columns in COLUMNS are ever read.
import { csvObjects } from "../import/csv.ts";

export const COLUMNS = {
  id: "id",
  name: "Account Name",
  type: "Account Type",
  tags: "Tags",
  bn: 'CRA BN "9 digits" (RC)',
  fye: "Fiscal Year-End",
  province: "Company State / Province",
} as const;

export type Account = {
  row: number; taxdomeId: string; legalName: string; type: string; tags: string[];
  bnRaw: string; bn: string; fyeRaw: string; fye: string; province: string;
};
export type Flag = { row: number; name: string; reason: string };

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const LAST_DAY = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// "Dec 31", "December 31", "31 Dec", "Dec. 31st", "2025-12-31" -> "12-31". Anything else -> "" (flagged, never guessed).
export function parseYearEnd(raw: string): string {
  const t = raw.trim().toLowerCase().replace(/[.,]/g, " ").replace(/(\d)(st|nd|rd|th)\b/g, "$1").replace(/\s+/g, " ");
  if (!t) return "";
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  let month = 0, day = 0;
  if (m) { month = Number(m[2]); day = Number(m[3]); }
  else {
    const word = (w: string) => { const i = MONTHS.indexOf(w.slice(0, 3)); return i >= 0 && (w.length === 3 || "january february march april may june july august september october november december".split(" ").some((f) => f.startsWith(w))) ? i + 1 : 0; };
    m = /^([a-z]+) (\d{1,2})$/.exec(t);
    if (m && word(m[1])) { month = word(m[1]); day = Number(m[2]); }
    else { m = /^(\d{1,2}) ([a-z]+)$/.exec(t); if (m && word(m[2])) { month = word(m[2]); day = Number(m[1]); } }
  }
  if (!month || month > 12 || day < 1 || day > LAST_DAY[month - 1]) return "";
  if (month === 2 && day === 29) return ""; // a year-end cannot fall on Feb 29 every year: flag it
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "725603690 RC0001", "736174566 RC 0001", "725 603 690" -> "725603690". Fewer than 9 digits -> "".
export function bn9(raw: string): string {
  const d = raw.replace(/\D/g, "");
  return d.length >= 9 ? d.slice(0, 9) : "";
}

const PROV: Record<string, string> = { on: "ON", ontario: "ON", ab: "AB", alberta: "AB", bc: "BC", "british columbia": "BC" };
export function province(raw: string): string {
  const k = raw.trim().toLowerCase();
  return k ? PROV[k] ?? "OTHER" : "";
}

export const nameKey = (s: string) => s.normalize("NFKD").toLowerCase().replace(/[‘’`´]/g, "'").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
// Invisible characters removed, spaces tidied: U+FEFF (byte-order mark), zero-width spaces and joiners.
export const clean = (s: string) => s.replace(/[\uFEFF\u200B-\u200D\u2060\u00AD]/g, "").replace(/\s+/g, " ").trim();
const hasT2 = (tags: string[]) => tags.some((t) => t.trim().toUpperCase() === "T2");

// Reads the export. Returns only the needed fields of T2-tagged Company accounts, plus flags.
export function readAccounts(text: string): { accounts: Account[]; flags: Flag[]; missingColumns: string[] } {
  const { headers, rows } = csvObjects(text);
  const missingColumns = Object.values(COLUMNS).filter((c) => !headers.includes(c));
  if (missingColumns.length) return { accounts: [], flags: [], missingColumns };
  const accounts: Account[] = [], flags: Flag[] = [];
  rows.forEach((r, i) => {
    const row = i + 2;
    const tags = (r[COLUMNS.tags] ?? "").split(/[,;]/).map((t) => t.trim()).filter(Boolean);
    if (!hasT2(tags)) return;
    // Names sometimes carry invisible characters (a byte-order mark, zero-width spaces): removed.
    const name = clean(r[COLUMNS.name] ?? "");
    const type = (r[COLUMNS.type] ?? "").trim();
    if (type.toLowerCase() !== "company") { flags.push({ row, name, reason: `Tagged T2 but the account type is "${type || "blank"}", not Company. Not imported.` }); return; }
    if (!name) { flags.push({ row, name: "(no name)", reason: "No account name. Not imported." }); return; }
    const taxdomeId = (r[COLUMNS.id] ?? "").trim();
    if (!taxdomeId) { flags.push({ row, name, reason: "No TaxDome id. Not imported." }); return; }
    const bnRaw = (r[COLUMNS.bn] ?? "").trim(), fyeRaw = (r[COLUMNS.fye] ?? "").trim();
    accounts.push({ row, taxdomeId, legalName: name, type, tags, bnRaw, bn: bn9(bnRaw), fyeRaw, fye: parseYearEnd(fyeRaw), province: province(r[COLUMNS.province] ?? "") });
  });
  return { accounts, flags, missingColumns };
}

export type Existing = { id: string; kind: string; legal_name: string; business_number: string; taxdome_account_id: string | null; year_end_md: string; taxdome_tags: string[] };
export type Planned = {
  account: Account;
  action: "update" | "insert";
  clientId?: string;
  matchedBy?: "taxdome id" | "business number" | "legal name" | "chosen by you";
  changes: { field: string; from: string; to: string }[];
  notes: string[];
};

// Matching: TaxDome id (a re-import), then Business Number, then legal name. Name matches and accounts
// without a Business Number are marked for Hashim to check. Two possible matches -> flagged, never guessed.
// links: accounts the owner tied to an existing Studio client in the preview (taxdome id -> client id).
export function planImport(accounts: Account[], existing: Existing[], links: Record<string, string> = {}): { planned: Planned[]; flags: Flag[]; candidates: { id: string; legal_name: string }[] } {
  const flags: Flag[] = [], planned: Planned[] = [];
  const count = <T,>(xs: T[], k: (x: T) => string) => xs.reduce((m, x) => { const key = k(x); if (key) m.set(key, (m.get(key) ?? 0) + 1); return m; }, new Map<string, number>());
  const bnInFile = count(accounts, (a) => a.bn), idInFile = count(accounts, (a) => a.taxdomeId);
  const byId = new Map(existing.filter((c) => c.taxdome_account_id).map((c) => [c.taxdome_account_id!, c]));
  const byBn = new Map<string, Existing[]>(), byName = new Map<string, Existing[]>();
  for (const c of existing) {
    if (c.business_number) byBn.set(c.business_number, [...(byBn.get(c.business_number) ?? []), c]);
    if (c.kind === "corporation") byName.set(nameKey(c.legal_name), [...(byName.get(nameKey(c.legal_name)) ?? []), c]);
  }
  const used = new Set<string>();
  for (const a of accounts) {
    if ((idInFile.get(a.taxdomeId) ?? 0) > 1) { flags.push({ row: a.row, name: a.legalName, reason: "The same TaxDome id appears more than once in the file. Not imported." }); continue; }
    if (a.bn && (bnInFile.get(a.bn) ?? 0) > 1) { flags.push({ row: a.row, name: a.legalName, reason: `Business Number ${a.bn} appears on more than one account in the file. Not imported.` }); continue; }
    let match: Existing | undefined, matchedBy: Planned["matchedBy"];
    const chosen = links[a.taxdomeId] ? existing.find((c) => c.id === links[a.taxdomeId]) : undefined;
    if (links[a.taxdomeId] && !chosen) { flags.push({ row: a.row, name: a.legalName, reason: "The Studio client chosen for this account no longer exists. Not imported." }); continue; }
    if (chosen && !byId.has(a.taxdomeId)) { match = chosen; matchedBy = "chosen by you"; }
    else if (byId.has(a.taxdomeId)) { match = byId.get(a.taxdomeId); matchedBy = "taxdome id"; }
    else if (a.bn && byBn.has(a.bn)) {
      const hits = byBn.get(a.bn)!;
      if (hits.length > 1) { flags.push({ row: a.row, name: a.legalName, reason: `More than one Studio client has Business Number ${a.bn}. Not imported.` }); continue; }
      match = hits[0]; matchedBy = "business number";
    } else {
      const hits = (byName.get(nameKey(a.legalName)) ?? []).filter((c) => !c.taxdome_account_id && (!c.business_number || !a.bn || c.business_number === a.bn));
      if (hits.length > 1) { flags.push({ row: a.row, name: a.legalName, reason: "More than one Studio client has this name. Not imported." }); continue; }
      if (hits.length === 1) { match = hits[0]; matchedBy = "legal name"; }
    }
    if (match && match.taxdome_account_id && match.taxdome_account_id !== a.taxdomeId) { flags.push({ row: a.row, name: a.legalName, reason: "The matching Studio client is already linked to a different TaxDome account. Not imported." }); continue; }
    if (match && used.has(match.id)) { flags.push({ row: a.row, name: a.legalName, reason: "Two accounts in the file match the same Studio client. Not imported." }); continue; }
    const notes: string[] = [];
    if (!a.bn) notes.push(a.bnRaw ? `Business Number "${a.bnRaw}" could not be read.` : "No Business Number in TaxDome.");
    if (!a.fye) notes.push(a.fyeRaw ? `Year-end "${a.fyeRaw}" could not be read; left blank.` : "No fiscal year-end in TaxDome.");
    if (matchedBy === "legal name") notes.push("Matched by name only. Check it is the same company.");
    const tagsText = a.tags.join(", ");
    if (match) {
      used.add(match.id);
      const changes: Planned["changes"] = [];
      if (match.legal_name !== a.legalName) changes.push({ field: "Legal name", from: match.legal_name, to: a.legalName });
      if (a.bn && match.business_number !== a.bn) changes.push({ field: "Business Number", from: match.business_number, to: a.bn });
      if (a.fye && match.year_end_md !== a.fye) changes.push({ field: "Year-end", from: match.year_end_md, to: a.fye });
      if ((match.taxdome_tags ?? []).join(", ") !== tagsText) changes.push({ field: "TaxDome tags", from: (match.taxdome_tags ?? []).join(", "), to: tagsText });
      if (match.taxdome_account_id !== a.taxdomeId) changes.push({ field: "TaxDome account", from: match.taxdome_account_id ?? "", to: a.taxdomeId });
      planned.push({ account: a, action: "update", clientId: match.id, matchedBy, changes, notes });
    } else {
      planned.push({ account: a, action: "insert", changes: [], notes });
    }
  }
  // Studio companies not linked to TaxDome and not matched in this file: offered in the preview.
  const candidates = existing.filter((c) => c.kind === "corporation" && !c.taxdome_account_id && !used.has(c.id))
    .map((c) => ({ id: c.id, legal_name: c.legal_name })).sort((x, y) => x.legal_name.localeCompare(y.legal_name));
  return { planned, flags, candidates };
}
