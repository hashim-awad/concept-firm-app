// Piece 1 (Hashim, Nov 18, 2026; benchmark CaseWare Cloud): the CRA rates the firm types in by hand on
// Settings › Closebook rules › CRA rates. Pure, so the page, the activity log and tests share the wording.
// Nothing reads the rates yet: the Vehicle allowance schedule (piece 3) will.

export const KM_COLUMNS = [
  ["first_prov", "First 5,000 km (provinces)"],
  ["after_prov", "After 5,000 km (provinces)"],
  ["first_terr", "First 5,000 km (territories)"],
  ["after_terr", "After 5,000 km (territories)"],
] as const;
export type KmField = (typeof KM_COLUMNS)[number][0];
export type KmRow = { year: number; first_prov: number; after_prov: number; first_terr: number; after_terr: number;
  entered_by: string | null; entered_at: string; updated_by: string | null; updated_at: string | null };
export type ItcRow = { province: string; numerator: number; denominator: number; entered_by: string | null; entered_at: string; updated_by: string | null; updated_at: string | null };

// Provinces first, then the territories, as the CRA lists them.
export const PROVINCES: { code: string; name: string }[] = [
  { code: "AB", name: "Alberta" }, { code: "BC", name: "British Columbia" }, { code: "MB", name: "Manitoba" },
  { code: "NB", name: "New Brunswick" }, { code: "NL", name: "Newfoundland and Labrador" }, { code: "NS", name: "Nova Scotia" },
  { code: "ON", name: "Ontario" }, { code: "PE", name: "Prince Edward Island" }, { code: "QC", name: "Quebec" },
  { code: "SK", name: "Saskatchewan" }, { code: "NT", name: "Northwest Territories" }, { code: "NU", name: "Nunavut" }, { code: "YT", name: "Yukon" },
];
export const provinceName = (code: string) => PROVINCES.find((p) => p.code === code)?.name ?? code;

// A rate as the page shows it: dollars per km, two decimals ("0.73").
export const rate = (v: unknown) => (v === null || v === undefined || v === "" ? "" : Number(v).toFixed(2));
export const factor = (r: { numerator: unknown; denominator: unknown } | null | undefined) => (r ? `${r.numerator}/${r.denominator}` : "");

// One activity log row on either table, in plain words: "2026, first 5,000 km (provinces): 0.73 → 0.74".
export function describeCraChange(table: string, action: string, oldRow: Record<string, unknown>, newRow: Record<string, unknown>): string {
  if (table === "cb_cra_km_rates") {
    const year = String(newRow.year ?? oldRow.year ?? "");
    if (action === "insert") return `${year} added: ${KM_COLUMNS.map(([k, l]) => `${l.toLowerCase()} ${rate(newRow[k])}`).join(", ")}`;
    if (action === "delete") return `${year} removed`;
    const parts = KM_COLUMNS.filter(([k]) => rate(oldRow[k]) !== rate(newRow[k])).map(([k, l]) => `${l.toLowerCase()} ${rate(oldRow[k])} → ${rate(newRow[k])}`);
    return `${year}, ${parts.join(", ") || "no rate changed"}`;
  }
  if (table === "cb_cra_itc_factors") {
    const name = provinceName(String(newRow.province ?? oldRow.province ?? ""));
    if (action === "insert") return `${name} ITC factor set to ${factor(newRow as never)}`;
    if (action === "delete") return `${name} ITC factor removed`;
    return `${name} ITC factor ${factor(oldRow as never)} → ${factor(newRow as never)}`;
  }
  return "";
}

// Round 1b of piece 1 (Hashim, Nov 18, 2026): a refused save keeps what was typed and shows each message in red
// under the field it concerns. These checks match the database's (cb_save_km_rates, cb_save_itc_factor), so most
// refusals are caught before anything is sent; a refusal the database still makes is placed by fieldOfKmError.
export type FieldErrors = Record<string, string>;
const RATE = /^\d{0,2}(\.\d{1,2})?$/;

export function checkKmForm(v: Record<string, string>, isNew: boolean): FieldErrors {
  const e: FieldErrors = {};
  if (isNew && !/^\d{4}$/.test(v.year ?? "")) e.year = "Type the year as four digits, for example 2026.";
  else if (isNew && (Number(v.year) < 2000 || Number(v.year) > 2100)) e.year = "Type a year from 2000 to 2100.";
  for (const [k] of KM_COLUMNS) {
    const t = (v[k] ?? "").replace(/[$\s]/g, "");
    if (!t) e[k] = "Fill in this rate.";
    else if (!/^\d*\.?\d+$/.test(t) || !(Number(t) > 0) || Number(t) >= 10) e[k] = "Dollars per km, for example 0.73.";
    else if (!RATE.test(t)) e[k] = "At most two decimals, for example 0.73.";
  }
  return e;
}

// Where a database refusal belongs: the year field, or the form as a whole.
export const fieldOfKmError = (msg: string) => (/year|already in the table|not in the table/i.test(msg) ? "year" : "form");

// A factor typed as two whole numbers ("13/113"). null when it is fine; spaces around the numbers are fine.
export function checkFactor(text: string): string | null {
  const m = /^\s*(\d{1,6})\s*\/\s*(\d{1,6})\s*$/.exec(text);
  if (!m) return "Type the factor as two whole numbers with a slash, for example 13/113.";
  const [n, d] = [Number(m[1]), Number(m[2])];
  if (!(n > 0 && d > n)) return "The top number must be more than 0 and smaller than the bottom number, for example 13/113.";
  return null;
}
export const sameFactor = (a: string, b: string) => a.replace(/\s/g, "") === b.replace(/\s/g, "");
