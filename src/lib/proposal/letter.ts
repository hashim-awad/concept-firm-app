// A proposal option becomes the corporate engagement letter (front office batch, section 5, item 2).
// Pure and browser-safe: the builder uses it to show what the letter still needs, the server uses it
// to build the letter the client signs. The option fills the services and fees exactly as the
// Letter Builder's "from proposal" does (Studio pToLetter); the Letter details step fills the rest.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { CorporateLetter } from "../studio/controllers.ts";

// The Letter details step: what the corporate letter needs that a proposal does not hold.
// Stored with the proposal's own fields under "L_" so the proposal engine never sees them.
export const LETTER_FIELDS = [
  ["company", "Company legal name"], ["signer", "Signing officer"], ["signerTitle", "Signing officer's title"], ["salutation", "Salutation (Dear ...)"],
  ["email", "Signing officer's email"], ["addr1", "Street address"], ["addr2", "Unit or suite (optional)"], ["city", "City"], ["postal", "Postal code"],
  ["ye", "Year-end"], ["firstYear", "First year with us"], ["periodStart", "First-year start date"], ["startMonth", "Monthly billing starts"],
  ["catchFrom", "Catch-up from"], ["catchTo", "Catch-up to"], ["t1Owner", "Owner's full name (T1)"],
] as const;
export type LetterKey = (typeof LETTER_FIELDS)[number][0];
export const lk = (k: LetterKey) => `L_${k}`;

export type PackedOption = { n: string; s: string[]; l: [string, string, string][] };
export type ProposalInputs = { f: Record<string, string>; opts: any[]; rec: number };

// The options as Studio packs them for the letter ({n, s, l}).
export function packedOptions(pe: any, s: any): PackedOption[] {
  return (JSON.parse(pe.pPack(s)) as { o: PackedOption[] }).o;
}

// Fill a fresh corporate letter from option i and the Letter details. letterDate: the date on the
// letter (the day the proposal is sent).
// Empty Letter details fall back to the proposal's own fields (name, contact, salutation).
const FALLBACK: Partial<Record<LetterKey, string>> = { company: "name", signer: "contact", salutation: "salutation" };
export const letterValue = (f: Record<string, string>, k: LetterKey) => ((f[lk(k)] ?? "").trim() || (FALLBACK[k] ? (f[FALLBACK[k]!] ?? "").trim() : ""));

export function fillLetter(c: CorporateLetter, o: PackedOption, f: Record<string, string>, letterDate: string) {
  const v = (k: LetterKey) => letterValue(f, k);
  for (const k of ["company", "signer", "signerTitle", "salutation", "addr1", "addr2", "city", "postal", "ye", "periodStart", "startMonth", "catchFrom", "catchTo", "t1Owner"] as const) c.set(k, v(k));
  c.set("firstYear", v("firstYear") === "1");
  c.set("province", f.province || "ON");
  c.set("letterDate", letterDate);
  // The option's fee lines, exactly (the Letter Builder would add its default lines on the next
  // change; a signed letter must show only what the client chose).
  c.fromProposal(o, null, null);
  const kinds = ["month", "quarter", "year", "once"];
  c.load({ ...c.f }, o.l.map((l) => ({ svc: l[0], detail: "", kind: kinds.includes(l[1]) ? l[1] : "once", amt: l[2] })), "final");
  return c;
}

// What still stops the letter for each option (the Letter Builder's own errors). Warnings are left
// for Hashim's judgment, as in the Letter Builder.
export function letterProblems(le: any, inputs: ProposalInputs, pe: any, s: any, letterDate: string): { option: string; errors: string[] }[] {
  const email = (inputs.f[lk("email")] ?? "").trim();
  const out: { option: string; errors: string[] }[] = [];
  const opts = packedOptions(pe, s);
  opts.forEach((o, i) => {
    const c = fillLetter(new CorporateLetter(le, letterDate), o, inputs.f, letterDate);
    const errors = (le.checks(c.state()) as { lvl: string; msg: string }[]).filter((x) => x.lvl === "err").map((x) => x.msg);
    if (i === 0 && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.unshift("Enter the signing officer's email: the signing link goes there.");
    out.push({ option: o.n || `Option ${"ABC"[i]}`, errors });
  });
  return out;
}

// Which Letter details an option set needs (catch-up dates, the T1 owner).
export function needs(opts: PackedOption[]) {
  return { catchup: opts.some((o) => o.s.includes("catchup")), t1: opts.some((o) => o.s.includes("t1")) };
}
