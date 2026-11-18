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
