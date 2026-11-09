// GST/HST rates from the CRA rates page, as checked on the date below. The app loads these
// as pending rates; an owner must approve them before any quote or proposal uses them
// (decision 22). When CRA changes a rate, update this table in a release and load again.
// GST/HST only: Concept does not collect PST or QST.
export const CRA_RATES_PAGE = "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/charge-collect-which-rate/calculator.html";

export const CRA_TABLE = {
  effectiveFrom: "2025-04-01", // the most recent change on the page (Nova Scotia HST 15% to 14%)
  checkedOn: "2026-11-08",
  rates: [
    { province: "AB", name: "Alberta", tax: "GST", rate: 5 },
    { province: "BC", name: "British Columbia", tax: "GST", rate: 5 },
    { province: "MB", name: "Manitoba", tax: "GST", rate: 5 },
    { province: "NB", name: "New Brunswick", tax: "HST", rate: 15 },
    { province: "NL", name: "Newfoundland and Labrador", tax: "HST", rate: 15 },
    { province: "NT", name: "Northwest Territories", tax: "GST", rate: 5 },
    { province: "NS", name: "Nova Scotia", tax: "HST", rate: 14 },
    { province: "NU", name: "Nunavut", tax: "GST", rate: 5 },
    { province: "ON", name: "Ontario", tax: "HST", rate: 13 },
    { province: "PE", name: "Prince Edward Island", tax: "HST", rate: 15 },
    { province: "QC", name: "Quebec", tax: "GST", rate: 5 },
    { province: "SK", name: "Saskatchewan", tax: "GST", rate: 5 },
    { province: "YT", name: "Yukon", tax: "GST", rate: 5 },
  ] as const,
};
