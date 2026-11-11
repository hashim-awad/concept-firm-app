// Provinces and territories, for client forms (province decides the GST/HST line later).
export const PROVINCES: [string, string][] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"], ["NL", "Newfoundland and Labrador"],
  ["NT", "Northwest Territories"], ["NS", "Nova Scotia"], ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"],
  ["QC", "Quebec"], ["SK", "Saskatchewan"], ["YT", "Yukon"],
];
export const provinceName = (code: string) => PROVINCES.find(([c]) => c === code)?.[1] ?? code;
export const LEAD_STATUS: Record<string, string> = {
  // The list shows five words (front office batch, section 2); the lead page keeps the reason after a colon.
  new: "New", quoted: "New: quote ready", sent: "Quote sent", call_needed: "With Hashim: call needed", out_of_scope: "With Hashim: out of scope", signed: "Signed", lost: "Lost",
};
