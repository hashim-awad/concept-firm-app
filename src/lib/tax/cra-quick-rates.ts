// Quick method remittance rates from CRA's guide RC4058 (Quick Method of Accounting for GST/HST), by the
// province of the permanent establishment where the supplies are made: one rate for businesses that
// provide services, one for businesses that buy goods for resale. Rates as percentages. The app loads
// these as pending rates; an owner approves them before any GST/HST return uses them (round 20, Hashim,
// Nov 15, 2026), as the GST/HST rates table (cra-rates.ts) works. When CRA changes a rate, update this
// table in a release and load again.
//
// Not filled yet: canada.ca could not be reached from the build session on Nov 15, 2026, so no rate was
// read and none is written here. Rates are never typed from memory. Until this table is filled from the
// page below, an owner adds the rates by hand on Settings, Sales tax rates, Quick method rates (they still
// wait for approval). When filling it: effectiveFrom is CRA's "reporting periods beginning on or after"
// date for the rates, checkedOn the date the page was read.
export const CRA_QUICK_PAGE = "https://www.canada.ca/en/revenue-agency/services/forms-publications/publications/rc4058/quick-method-accounting-gst-hst.html";

export type CraQuickRow = { province: string; name: string; services: number; goods: number };
export const CRA_QUICK_TABLE: { effectiveFrom: string; checkedOn: string; rates: readonly CraQuickRow[] } = {
  effectiveFrom: "",
  checkedOn: "",
  rates: [],
};
