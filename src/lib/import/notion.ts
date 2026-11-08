/* eslint-disable @typescript-eslint/no-explicit-any */
// Maps Notion CSV exports of Studio's databases to the app's tables. Pure: no database.
// Each source is recognised by its columns. Every value that cannot be read is reported as a
// problem with its row number; nothing is guessed.
import { csvObjects } from "./csv.ts";

export type Source = "offers" | "catalogue" | "clients" | "engagements" | "proposals";
export type Problem = { row: number; msg: string };
export type Parsed<T> = { source: Source; rows: { row: number; data: T }[]; problems: Problem[] };

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const pad = (n: number) => String(n).padStart(2, "0");

// Notion writes dates as "November 8, 2026" (optionally with a time or "→ end"), or ISO.
export function nDate(v: string): string | null | undefined {
  const s = v.split("→")[0].trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`;
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/);
  if (m) { const mi = MONTHS.indexOf(m[1].toLowerCase()); if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(+m[2])}`; }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m) { const mi = MONTHS.indexOf(m[2].toLowerCase()); if (mi >= 0) return `${m[3]}-${pad(mi + 1)}-${pad(+m[1])}`; }
  return undefined; // not readable
}

// Numbers may be formatted as dollars: "$5,388.00".
export function nNum(v: string): number | null | undefined {
  const s = v.replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

export const nBool = (v: string) => /^(yes|true|__yes__|checked)$/i.test(v.trim());
export const nList = (v: string) => v.split(",").map((x) => x.trim()).filter(Boolean);

// Relation cells. Notion writes them in several ways, depending on the export:
//   "Name (https://www.notion.so/Name-<32 hex>?pvs=21)"         web link
//   "Name (Studio%20Clients/Name%20<32 hex>.md)"                 relative file path (Markdown & CSV)
//   "https://www.notion.so/Name-<32 hex>"                        bare page link (no name)
//   "Name"                                                       plain name
// Several links are separated by commas. Returns what can be matched: the name, or for a bare
// link the name part of its address.
export type RelationRef = { name: string; slug: boolean };
const looksLikeLink = (t: string) => /notion\.(so|site|com)|\.md\b|[0-9a-f]{32}|%20|\//i.test(t);
// Name part of a page address or file path: "Example-Holdings-Inc-<id>" or "Example%20Holdings%20Inc%20<id>.md".
const nameFromAddress = (u: string) => {
  let last = u.split("?")[0].split("#")[0].replace(/\/+$/, "").split("/").pop() ?? "";
  try { last = decodeURIComponent(last); } catch { /* keep as is */ }
  return last.replace(/\.md$/i, "").replace(/[\s-]*[0-9a-f]{32}$/i, "").replace(/-/g, " ").trim();
};
export function nRelations(v: string): RelationRef[] {
  const s = v.trim();
  if (!s) return [];
  const out: RelationRef[] = [];
  let i = 0, nameStart = 0;
  while (i < s.length) {
    if (s[i] !== "(") { i++; continue; }
    let depth = 1, j = i + 1;
    while (j < s.length && depth) { if (s[j] === "(") depth++; else if (s[j] === ")") depth--; j++; }
    if (looksLikeLink(s.slice(i + 1, j - 1))) {
      const name = s.slice(nameStart, i).replace(/^\s*,\s*/, "").trim();
      if (name) out.push({ name, slug: false });
      nameStart = j;
    }
    i = j;
  }
  if (out.length) return out;
  // Bare page links or file paths, one or more.
  const links = s.split(/,\s*(?=https?:|\S+\.md\b)/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x) || /\.md$/i.test(x));
  if (links.length) return links.map((u) => ({ name: nameFromAddress(u), slug: true }));
  // Plain text: one name (commas kept, since legal names can contain them).
  return [{ name: s, slug: false }];
}
// How the link cell is written, for problem messages (never the name itself).
export function linkFormat(v: string): string {
  const s = v.trim();
  if (!s) return "blank";
  if (/\(https?:\/\//.test(s)) return "name with a web link";
  if (/\([^()]*\.md\)/i.test(s)) return "name with a file path";
  if (/^https?:\/\//.test(s)) return "web link only";
  if (/\.md$/i.test(s)) return "file path only";
  return "plain name";
}
export function nRelationNames(v: string): string[] { return nRelations(v).map((r) => r.name); }

// Keys for matching names across files: exact (ignoring case, spacing and quote styles), and
// loose (letters and digits only), for links that only carry the address form of the name.
export const nameKey = (s: string) => s.normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
export const looseKey = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const REQUIRED: Record<Source, string[]> = {
  offers: ["Offer", "Segment", "Annual floor"],
  catalogue: ["Service", "Code", "Income account"],
  clients: ["Legal name", "Signing officer", "Year end (month-day)"],
  engagements: ["Engagement", "Type", "Fiscal year end"],
  proposals: ["Proposal", "Prospect name", "Options data"],
};

export function detectSource(headers: string[]): Source | null {
  return (Object.keys(REQUIRED) as Source[]).find((s) => REQUIRED[s].every((h) => headers.includes(h))) ?? null;
}

type Ctx = { problems: Problem[]; row: number };
const date = (c: Ctx, label: string, v: string) => { const d = nDate(v ?? ""); if (d === undefined) { c.problems.push({ row: c.row, msg: `${label}: date not readable ("${v}").` }); return null; } return d; };
const num = (c: Ctx, label: string, v: string) => { const n = nNum(v ?? ""); if (n === undefined) { c.problems.push({ row: c.row, msg: `${label}: not a number ("${v}").` }); return null; } return n; };
const oneOf = <T extends string>(c: Ctx, label: string, v: string, allowed: readonly T[], fallback?: T): T | null => {
  if (!v) return fallback ?? null;
  if ((allowed as readonly string[]).includes(v)) return v as T;
  c.problems.push({ row: c.row, msg: `${label}: "${v}" is not one of ${allowed.join(", ")}.` }); return null;
};

export type OfferRow = { offer: string; segment: string; is_package: boolean; services: string[]; monthly_fee: number | null; software_per_month: number | null; year_end_fee: number | null;
  annual_floor: number | null; monthly_reference: number | null; allows_payment_admin: boolean; t1_group: string | null; unit: string; unit_price: number | null; notes: string; sort_order: number };
export type CatalogueRow = { code: string; name: string; description: string; unit_label: string; sort_order: number; category: string; line_key: string; income_account: string;
  price_type: string; approval_status: string; decision_needed: string; replaces_qbo: string; replaces_taxdome: string; studio_source: string; price: number | null };
export type ClientRow = { kind: "individual" | "corporation"; legal_name: string; entity_type: string; signing_officer: string; signer_title: string; salutation: string; email: string;
  street_address: string; address_line2: string; city: string; postal_code: string; province: string; year_end_md: string; basis: string; custom_basis_wording: string;
  third_party_user: string; third_party_basis: string; name_verified: boolean; name_verified_on: string | null; status: string; notes: string };
export type EngagementRow = { title: string; client_name: string | null; link_format: string; type: string; fiscal_year_end: string | null; el_version: string; status: string; el_issued: string | null; el_signed: string | null;
  fee: number | null; monthly_fee: number | null; monthly_billing_starts: string | null; period_start: string | null; payment_method: string; registration_confirmed: boolean;
  t1_individual: string; t1_tax_year: number | null; t1_fee: number | null; gst_addon_fee: number | null; cra_authorization: string; cra_request_date: string | null;
  recorded_after_issue: boolean; notes: string; letter_data: unknown; extra: Record<string, unknown> };
export type ProposalRow = { title: string; client_name: string | null; link_format: string; prospect_name: string; contact: string; province: string; segment: string; status: string; date_sent: string | null;
  valid_until: string | null; options_summary: string; recommended: string; chosen_option: string; options_data: unknown; notes: string };

const CATEGORY_LINE: Record<string, string> = { Corporate: "corporate", "T1 personal": "t1", Incorporation: "incorporation", Advisory: "advisory", Adjustments: "adjustments" };

// Studio "Letter data": "S1:" + JSON {v, f, fees}.
export function parseLetterData(v: string): { v: number; f: Record<string, unknown>; fees: string[][] } | null | undefined {
  if (!v.trim()) return null;
  try { const j = JSON.parse(v.replace(/^S1:/, "")); return j && typeof j === "object" && j.f ? j : undefined; } catch { return undefined; }
}

export function parseSource(text: string): Parsed<OfferRow | CatalogueRow | ClientRow | EngagementRow | ProposalRow> | { error: string } {
  const { headers, rows } = csvObjects(text);
  const source = detectSource(headers);
  if (!source) return { error: "This file's columns do not match any Studio database (Price Floors, Service Catalog, Clients, Engagements or Proposals). Export the database from Notion as CSV, without changing it." };
  const problems: Problem[] = [];
  const out: { row: number; data: never }[] = [];
  rows.forEach((r, i) => {
    const c: Ctx = { problems, row: i + 2 }; // row 1 is the header
    const g = (k: string) => r[k] ?? "";
    let data: unknown = null;
    if (source === "offers") {
      if (!g("Offer")) { problems.push({ row: c.row, msg: "Offer is blank." }); return; }
      data = {
        offer: g("Offer"), segment: oneOf(c, "Segment", g("Segment"), ["Team or brokerage", "Agent", "T1 personal"] as const), is_package: nBool(g("Package")),
        services: nList(g("Services")), monthly_fee: num(c, "Monthly fee", g("Monthly fee")), software_per_month: num(c, "Software per month", g("Software per month")),
        year_end_fee: num(c, "Year-end fee", g("Year-end fee")), annual_floor: num(c, "Annual floor", g("Annual floor")), monthly_reference: num(c, "Monthly reference", g("Monthly reference")),
        allows_payment_admin: nBool(g("Allows payment administration")), t1_group: oneOf(c, "T1 group", g("T1 group"), ["Base", "Add-on", "Triage", "Out of scope"] as const),
        unit: g("Unit"), unit_price: num(c, "Unit price", g("Unit price")), notes: g("Notes"), sort_order: num(c, "Order", g("Order")) ?? 0,
      };
      if (!(data as OfferRow).segment) return;
    } else if (source === "catalogue") {
      const code = g("Code").toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) { problems.push({ row: c.row, msg: `Code "${g("Code")}" is blank or not valid.` }); return; }
      const line = CATEGORY_LINE[g("Category")];
      if (!line) { problems.push({ row: c.row, msg: `Category "${g("Category")}" is not known.` }); return; }
      const price = num(c, "Price", g("Price"));
      if (price != null && price < 0) problems.push({ row: c.row, msg: `Price is negative (${price}). Discounts are entered per client, so the price is left blank.` });
      data = {
        code, name: g("Service"), description: g("Description"), unit_label: g("Unit") || "each", sort_order: num(c, "Order", g("Order")) ?? 0, category: g("Category"), line_key: line,
        income_account: g("Income account"), price_type: oneOf(c, "Price type", g("Price type"), ["Fixed", "Per client"] as const, "Fixed"),
        approval_status: g("Status") === "Draft" ? "draft" : "approved", decision_needed: g("Decision needed"), replaces_qbo: g("Replaces in QBO"), replaces_taxdome: g("Replaces in TaxDome"),
        studio_source: g("Source"), price: price != null && price >= 0 ? price : null,
      };
    } else if (source === "clients") {
      if (!g("Legal name")) { problems.push({ row: c.row, msg: "Legal name is blank." }); return; }
      const ye = g("Year end (month-day)");
      if (ye && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(ye)) problems.push({ row: c.row, msg: `Year end "${ye}" is not MM-DD. It is left blank.` });
      const person = g("Entity type") === "Individual";
      data = {
        kind: person ? "individual" : "corporation", legal_name: g("Legal name"),
        entity_type: oneOf(c, "Entity type", g("Entity type"), ["PREC", "Holdco", "Operating co", "Professional corp", "Individual", "Other"] as const, "Other"),
        signing_officer: g("Signing officer"), signer_title: g("Signer title"), salutation: g("Salutation"), email: g("Email"), street_address: g("Street address"),
        address_line2: g("Address line 2"), city: g("City"), postal_code: g("Postal code").toUpperCase(),
        province: ({ ON: "ON", AB: "AB", BC: "BC", Other: "OTHER" } as Record<string, string>)[g("Province")] ?? (g("Province") ? (problems.push({ row: c.row, msg: `Province "${g("Province")}" is not ON, AB, BC or Other.` }), "OTHER") : "OTHER"),
        year_end_md: /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(ye) ? ye : "",
        basis: ({ "Concept standard": "standard", "Cash basis": "cash", Custom: "custom" } as Record<string, string>)[g("Basis of accounting")] ?? "standard",
        custom_basis_wording: g("Custom basis wording"), third_party_user: g("Third-party user"), third_party_basis: g("Third-party basis"),
        name_verified: nBool(g("Name verified")), name_verified_on: date(c, "Name verified on", g("Name verified on")),
        status: g("Status") === "Inactive" ? "inactive" : "active", notes: g("Notes"),
      };
    } else if (source === "engagements") {
      const ld = parseLetterData(g("Letter data"));
      if (ld === undefined) problems.push({ row: c.row, msg: "Letter data could not be read. The engagement comes in without it." });
      const clients = nRelationNames(g("Client")); const link_format = linkFormat(g("Client"));
      if (clients.length > 1) problems.push({ row: c.row, msg: "More than one client linked. The first is used." });
      const type = oneOf(c, "Type", g("Type"), ["Year-end compilation + T2", "Monthly full service", "T2 only", "T1 personal", "Corporate services"] as const);
      if (!type) return;
      data = {
        title: g("Engagement"), client_name: clients[0] ?? null, link_format, type, fiscal_year_end: date(c, "Fiscal year end", g("Fiscal year end")), el_version: g("EL version"),
        status: oneOf(c, "Status", g("Status"), ["EL drafted", "EL sent", "EL signed", "Draft package sent", "MAL signed", "Issued", "Cancelled"] as const, "EL drafted"),
        el_issued: date(c, "EL issued", g("EL issued")), el_signed: date(c, "EL signed", g("EL signed")), fee: num(c, "Fee", g("Fee")), monthly_fee: num(c, "Monthly fee", g("Monthly fee")),
        monthly_billing_starts: date(c, "Monthly billing starts", g("Monthly billing starts")), period_start: date(c, "Period start (first year)", g("Period start (first year)")),
        payment_method: g("Payment method"), registration_confirmed: nBool(g("Registration confirmed (AB/BC)")), t1_individual: g("T1 individual"),
        t1_tax_year: num(c, "T1 tax year", g("T1 tax year")), t1_fee: num(c, "T1 fee", g("T1 fee")), gst_addon_fee: num(c, "GST/HST add-on fee", g("GST/HST add-on fee")),
        cra_authorization: g("CRA authorization"), cra_request_date: date(c, "CRA request date", g("CRA request date")), recorded_after_issue: nBool(g("Recorded after issue")),
        notes: g("Notes"), letter_data: ld ?? null,
        // Kept for Phase 3 (year-end package, inspection file).
        extra: Object.fromEntries(Object.entries({
          draft_package_issued: date(c, "Draft package issued", g("Draft package issued")), mal_signed: date(c, "MAL signed", g("MAL signed")), report_date: date(c, "Report date", g("Report date")),
          package_issued: date(c, "Package issued", g("Package issued")), file_memo_date: date(c, "File memo date", g("File memo date")), file_memo_by: g("File memo by"), taxdome_file_link: g("TaxDome file link"),
          chk_knowledge_of_business: nBool(g("Chk: Knowledge of business")), chk_final_compiled_info: nBool(g("Chk: Final compiled info on file")),
          chk_reconciled: nBool(g("Chk: Reconciled to records and T2")), chk_reviewed_by_hashim: nBool(g("Chk: Reviewed by Hashim")), chk_significant_judgments: nBool(g("Chk: Significant judgments")),
        }).filter(([, v]) => v !== null && v !== "" && v !== false)),
      };
      if (!(data as EngagementRow).fiscal_year_end) problems.push({ row: c.row, msg: "Fiscal year end is blank." });
    } else {
      let od: unknown = null;
      if (g("Options data")) { try { od = JSON.parse(g("Options data")); } catch { problems.push({ row: c.row, msg: "Options data could not be read. The proposal comes in without it." }); } }
      const clients = nRelationNames(g("Client")); const link_format = linkFormat(g("Client"));
      data = {
        title: g("Proposal"), client_name: clients[0] ?? null, link_format, prospect_name: g("Prospect name"), contact: g("Contact"),
        province: ({ ON: "ON", AB: "AB", BC: "BC", Other: "OTHER" } as Record<string, string>)[g("Province")] ?? "OTHER",
        segment: oneOf(c, "Segment", g("Segment"), ["Team or brokerage", "Agent", "Other"] as const, "Other"), status: oneOf(c, "Status", g("Status"), ["Draft", "Sent", "Accepted", "Declined", "Expired"] as const, "Draft"),
        date_sent: date(c, "Date sent", g("Date sent")), valid_until: date(c, "Valid until", g("Valid until")), options_summary: g("Options"), recommended: g("Recommended"),
        chosen_option: g("Chosen option"), options_data: od, notes: g("Notes"),
      };
    }
    out.push({ row: c.row, data: data as never });
  });
  return { source, rows: out, problems };
}

// Studio "Options data" (pPack) back to the proposal inputs. The "What we heard" lines and the
// price-book offer were not saved by Studio, so they are blank on a regenerated proposal.
 
export function proposalFromPack(p: { title: string; segment: string; date_sent: string | null; valid_until: string | null; recommended: string; options_data: any }) {
  const od = p.options_data;
  if (!od?.o?.length) return null;
  const days = p.date_sent && p.valid_until ? Math.round((Date.parse(p.valid_until) - Date.parse(p.date_sent)) / 86400000) : 30;
  const opts = od.o.map((o: any) => ({ name: o.n, offer: "", svc: Object.fromEntries((o.s ?? []).map((k: string) => [k, true])), lines: (o.l ?? []).map((l: any[]) => ({ svc: l[0], kind: l[1], amt: l[2] })) }));
  const rec = Math.max(0, opts.findIndex((o: any) => o.name === p.recommended));
  return {
    f: { name: od.c?.n ?? "", contact: od.c?.ct ?? "", salutation: od.c?.sa ?? "", province: od.c?.pr ?? "OTHER", segment: p.segment, date: p.date_sent ?? "", valid: String(days),
      format: opts.length > 1 ? "options" : "single", h0: "", h1: "", h2: "" },
    opts, rec, mode: "final",
  };
}


