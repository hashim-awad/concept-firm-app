// Price book clean-up after the Studio import (Hashim, 2026-11-08). Pure: works out, from the
// price book as it is now, the exact list of changes, shown before and after, and the plan the
// database applies. Running it again after applying finds nothing to change.

export type Item = {
  code: string; name: string; unit_label: string; per_spouse: boolean; price_type: string; income_account: string;
  replaces_qbo: string; replaces_taxdome: string; internal_note: string; line: string; price_cents: number | null;
};
export type Change = { code: string; name: string; what: string; before: string; after: string };
export type Op = Record<string, unknown> & { op: string };

const LINE_NAMES: Record<string, string> = { t1: "Personal tax (T1)", t2: "Corporate tax (T2)", bookkeeping: "Bookkeeping", payroll: "Payroll", gst_hst: "GST/HST",
  cfo: "CFO reporting", corporate: "Corporate", incorporation: "Incorporation", advisory: "Advisory", adjustments: "Adjustments" };
export const lineName = (k: string) => LINE_NAMES[k] ?? k;

// 3. Service line by code.
const LINE_BY_CODE: Record<string, string> = {
  "ACC-101": "bookkeeping", "ACC-102": "bookkeeping", "ACC-103": "bookkeeping", "ACC-104": "bookkeeping", "ACC-105": "bookkeeping", "ACC-106": "bookkeeping", "SFT-101": "bookkeeping",
  "YE-101": "t2", "YE-102": "t2", "CTX-101": "t2", "CTX-102": "t2", "CTX-103": "t2",
  "GST-101": "gst_hst", "GST-102": "gst_hst", "PAY-101": "payroll", "PAY-102": "payroll",
  "ADV-101": "cfo", "ADV-102": "cfo", "ADV-103": "advisory",
};
const lineFor = (code: string) => LINE_BY_CODE[code] ?? (code.startsWith("PTX-") ? "t1" : code.startsWith("INC-") ? "incorporation" : code.startsWith("ADJ-") ? "adjustments" : null);

// 4. The brief's seed T1 items, replaced by Studio's PTX items (rules repointed).
export const REPLACE: [string, string][] = [
  ["T1_BASE_SINGLE", "PTX-110"], ["T1_BASE_COUPLE", "PTX-111"], ["T1_RENTAL", "PTX-120"], ["T1_STR", "PTX-120"],
  ["T1_SELF_EMPLOYED", "PTX-121"], ["T1_VEHICLE", "PTX-122"], ["T1_HOME_OFFICE", "PTX-123"], ["T1_GST_RETURN", "PTX-124"],
  ["T1_INVESTMENT_SALES", "PTX-125"], ["T1_PR_SALE", "PTX-126"], ["T1_PROPERTY_SALE", "PTX-127"], ["T1_T1135_SIMPLE", "PTX-128"],
  ["T1_T1135_DETAILED", "PTX-129"], ["T1_FOREIGN_INCOME", "PTX-130"], ["T1_EMPLOYMENT_EXP", "PTX-131"], ["T1_MOVING", "PTX-132"],
];

// 5. New T1 items from the brief. PTX-133, 135 and 136 are charged for each spouse who needs
// them, like the other per-return add-ons (decision 7; 135 and 136 set by Hashim, 2026-11-08).
const T1_ACCOUNT = "4020 Tax Preparation - Personal (T1)";
export const NEW_ITEMS = [
  { code: "PTX-133", name: "Crypto or active trading, including options", unit_label: "per return", per_spouse: true, price_cents: 24900, sort_order: 133 },
  { code: "PTX-134", name: "Partnership interest with a T5013 slip", unit_label: "per partnership", per_spouse: false, price_cents: 14900, sort_order: 134 },
  { code: "PTX-135", name: "US non-resident return (1040-NR), federal", unit_label: "per return", per_spouse: true, price_cents: 79900, sort_order: 135 },
  { code: "PTX-136", name: "US state return", unit_label: "per state return", per_spouse: true, price_cents: 24900, sort_order: 136 },
];

// 6. Notes moved out of the "Charged" column.
export const NOTES: Record<string, string> = {
  "SFT-101": "New QBO income account 4005, matched to cost 5010 to track the margin.",
  "CTX-103": "New QBO income account 4015.",
  "PTX-101": "Company-client T1s, often included.",
  "ADV-103": "Topic in the invoice description.",
  "INC-101": "Corporation type in the invoice description.",
  "PTX-127": "Quantity = number of properties; type in the description.",
};

// The unit without the note: the text before the note (or before a bracket, semicolon or dash).
export function unitWithoutNote(unit: string, note: string, fallback = "each"): string {
  const u = unit.trim();
  const probe = note.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
  const flat = u.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ");
  let cut = -1;
  if (probe && flat.includes(probe)) {
    // Find where the note starts in the original text.
    const first = note.trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "");
    cut = u.toLowerCase().indexOf(first.toLowerCase());
  }
  if (cut < 0) cut = u.search(/\(|;|:|\s[-–—]\s/);
  if (cut === 0) return fallback; // the whole column was the note
  const out = (cut > 0 ? u.slice(0, cut) : u).replace(/[\s(,;:–—-]+$/, "").trim();
  return out || fallback;
}

const money = (c: number | null) => (c == null ? "no price" : "$" + (c / 100).toFixed(c % 100 ? 2 : 0));

export function planCleanup(items: Item[], lineKeys: string[]): { changes: Change[]; plan: Op[]; blockers: string[]; notes: string[] } {
  const by = new Map(items.map((i) => [i.code, i]));
  const changes: Change[] = [], plan: Op[] = [], blockers: string[] = [], notes: string[] = [];

  // 1. PTX-129
  if (!by.has("PTX-129")) blockers.push("PTX-129 (T1135, detailed) is not in the price book: it was the row that failed. Re-import the Service Catalog file first (it adds only that row), then come back.");

  // 4. Replace seed items (before line changes, so nothing is moved twice).
  for (const [from, to] of REPLACE) {
    const f = by.get(from);
    if (!f) continue;
    const t = by.get(to);
    if (!t) { blockers.push(`${to} is missing, so ${from} cannot be replaced yet.`); continue; }
    changes.push({ code: from, name: f.name, what: "Removed, replaced by " + to, before: `${f.name}, ${money(f.price_cents)} ${f.unit_label}`, after: `Screening rules use ${to} ${t.name}, ${money(t.price_cents)}` });
    if (f.price_cents != null && t.price_cents != null && f.price_cents !== t.price_cents) notes.push(`${to} keeps its Studio price ${money(t.price_cents)}; the brief's ${from} was ${money(f.price_cents)}.`);
    plan.push({ op: "replace_item", from, to });
    if (f.per_spouse && !t.per_spouse && !plan.some((p) => p.op === "set_fields" && p.code === to && p.per_spouse)) {
      changes.push({ code: to, name: t.name, what: "Charged for each spouse (as the brief's item was, decision 7)", before: "Once per couple", after: "Each spouse who needs it" });
      plan.push({ op: "set_fields", code: to, per_spouse: true });
    }
  }

  // 3. Service lines.
  for (const i of items) {
    if (REPLACE.some(([f]) => f === i.code)) continue;
    const line = lineFor(i.code);
    if (!line) { if (i.line === "corporate") notes.push(`${i.code} ${i.name} has no line assigned in your list; it stays in Corporate.`); continue; }
    if (line !== i.line) { changes.push({ code: i.code, name: i.name, what: "Service line", before: lineName(i.line), after: lineName(line) }); plan.push({ op: "set_line", code: i.code, line }); }
  }

  // 6. Notes out of "Charged".
  for (const [code, note] of Object.entries(NOTES)) {
    const i = by.get(code);
    if (!i) { notes.push(`${code} is not in the price book, so its note was not moved.`); continue; }
    const unit = unitWithoutNote(i.unit_label, note, code === "PTX-127" ? "per property" : "each");
    if (unit === i.unit_label && i.internal_note === note) continue;
    changes.push({ code, name: i.name, what: "Charged column and internal note", before: `Charged: ${i.unit_label}${i.internal_note ? ` · Note: ${i.internal_note}` : ""}`, after: `Charged: ${unit} · Note: ${note}` });
    plan.push({ op: "set_fields", code, unit_label: unit, internal_note: note });
  }

  // 5. New T1 items.
  for (const n of NEW_ITEMS) {
    if (by.has(n.code)) continue;
    changes.push({ code: n.code, name: n.name, what: "New item", before: "", after: `${money(n.price_cents)} ${n.unit_label}${n.per_spouse ? ", each spouse" : ""} · ${T1_ACCOUNT} · Fixed` });
    plan.push({ op: "add_item", ...n, line: "t1", income_account: T1_ACCOUNT, price_type: "Fixed", description: "" });
  }

  // Remove the Corporate line once nothing is left in it.
  const leftInCorporate = items.filter((i) => i.line === "corporate" && !REPLACE.some(([f]) => f === i.code) && !lineFor(i.code));
  if (lineKeys.includes("corporate") && leftInCorporate.length === 0) {
    changes.push({ code: "", name: "Corporate", what: "Empty service line removed", before: "Corporate", after: "" });
    plan.push({ op: "remove_empty_line", line: "corporate" });
  }
  return { changes, plan, blockers, notes };
}
