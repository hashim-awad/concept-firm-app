// Client record form and Studio's client editor checks (shared by the screen and the server).
export type ClientForm = {
  kind: "corporation" | "individual"; legal_name: string; entity_type: string; signing_officer: string; signer_title: string; salutation: string; email: string;
  street_address: string; address_line2: string; city: string; postal_code: string; province: string; year_end_md: string; basis: string;
  custom_basis_wording: string; third_party_user: string; third_party_basis: string; status: string; notes: string; name_verified: boolean;
};

export const ENTITY_TYPES = ["PREC", "Holdco", "Operating co", "Professional corp", "Other"];
export const THIRD_PARTY_BASIS = ["Can request further information", "Agreed basis of accounting"];

export function clientErrors(f: ClientForm, prior: { wasVerified: boolean; oldName: string; retickedAfterChange?: boolean }): string[] {
  const E: string[] = [];
  if (!f.legal_name.trim()) E.push("Legal name is blank.");
  if (f.year_end_md.trim() && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(f.year_end_md.trim())) E.push("Year end must be MM-DD, for example 08-31.");
  if (f.basis === "custom" && f.custom_basis_wording.trim().length < 40) E.push("Custom basis wording is blank or too short.");
  if (!["ON", "AB", "BC", "OTHER"].includes(f.province)) E.push("Choose the province.");
  if (f.legal_name.trim() !== prior.oldName.trim() && prior.wasVerified && f.name_verified && !prior.retickedAfterChange)
    E.push("You changed the legal name. Untick and re-tick the registry check to confirm the new name.");
  return E;
}
