// Step 9, the year-end package (round 11): every sentence the client reads, in one place, so the PDF and
// the Word copy say exactly the same. Appendix C's wording (render_fs.js, render_mal.js,
// render_lawyer.js), word for word. Never edit the CSRS 4200 report wording without Hashim.
import type { FsModel } from "./fs-model.ts";

export const FIRM = "Concept Accounting & Advisory Professional Corporation";
export const FIRM_FOOTER = "Prepared by Concept Accounting & Advisory Professional Corporation | Registered with CPA Ontario";
export const CONFIDENTIAL = "PRIVATE & CONFIDENTIAL | Intended solely for the named addressee.";
export const UNAUDITED = "(Unaudited - See Compilation Engagement Report)";
export const DRAFT = "DRAFT FOR REVIEW";
export const DATE_PLACEHOLDER = "[Date of signing]";

// Appendix C title-cases the address (it came from the T2 in capitals), keeping quadrant suffixes.
export const tc = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Sw|Se|Nw|Ne)\b/g, (x) => x.toUpperCase());
export const addressLines = (m: FsModel) => [tc(m.address.street), `${tc(m.address.city)} ${m.address.prov}  ${m.address.postal}`];

export type Run = { text: string; bold?: boolean; italics?: boolean };
// The compilation engagement report (CSRS 4200 illustrative report), as Appendix C.
export function reportParagraphs(m: FsModel): Run[][] {
  const end = m.isYear ? "year" : "period";
  return [
    [{ text: "On the basis of information provided by management, we have compiled the balance sheet of " }, { text: m.name, bold: true }, { text: " as at " },
      { text: m.asat.slice(6), bold: true }, { text: `, the statement of earnings and retained earnings for the ${end} then ended, and Note 1, which describes the basis of accounting applied in the preparation of the compiled financial information ("financial information").` }],
    [{ text: "Management is responsible for the accompanying financial information, including the accuracy and completeness of the underlying information used to compile it and the selection of the basis of accounting." }],
    [{ text: "We performed this engagement in accordance with Canadian Standard on Related Services (CSRS) 4200, Compilation Engagements, which requires us to comply with relevant ethical requirements. Our responsibility is to assist management in the preparation of the financial information." }],
    [{ text: "We did not perform an audit engagement or a review engagement, nor were we required to perform procedures to verify the accuracy or completeness of the information provided by management. Accordingly, we do not express an audit opinion or a review conclusion or provide any form of assurance on the financial information." }],
    [{ text: "Readers are cautioned that the financial information may not be appropriate for their purposes." }],
  ];
}

// The notes: Appendix C's wording, and round 11's related parties note (the capital assets note comes in round 12),
// generated from the file. Each block: heading, paragraphs, bullets, an optional table.
export type NoteBlock = { heading: string; paras: string[]; bullets?: string[]; table?: "shareholder" | "related" };
export function noteBlocks(m: FsModel): NoteBlock[] {
  const per = m.period.charAt(0).toLowerCase() + m.period.slice(1);
  const N = m.notes;
  const bullets: string[] = [];
  if (N.has_ar) bullets.push("Accounts receivable, less an allowance for doubtful accounts");
  // Appendix C said "amortized over their useful lives"; Closebook's Note 1 policy is amortization equal
  // to capital cost allowance, so the bullet says so and agrees with the capital assets note (for Hashim's approval).
  if (N.has_ppe) bullets.push(N.note1Policy === "amortization_equals_cca" ? "Property, plant and equipment, amortized at the rates allowed for income tax purposes" : "Property, plant and equipment, amortized over their useful lives");
  if (N.has_ap) bullets.push("Accounts payable and accrued liabilities");
  if (N.has_sd) bullets.push("Source deductions payable on salaries");
  if (N.has_tax) bullets.push("Current income taxes payable as at the reporting date");
  if (N.has_hst) bullets.push("GST/HST payable as at the reporting date");
  const out: NoteBlock[] = [{ heading: "1. Basis of accounting", paras: [`The basis of accounting applied in the preparation of the balance sheet of ${m.name} as at ${m.asat.slice(6)}, and the statement of earnings and retained earnings ${per}, is the historical cost basis and reflects cash transactions with the addition of:`], bullets }];
  if (N.has_hst) out.push({ heading: "GST/HST", paras: ["Revenue and expenses are recorded net of GST/HST. Receivables and payables include GST/HST."] });
  if (N.ppa) out.push({ heading: `${N.ppa.n}. Prior period adjustment`, paras: [`Opening retained earnings has been ${N.ppa.amount < 0 ? "reduced" : "increased"} by $${Math.abs(N.ppa.amount).toLocaleString("en-US")} to correct an error in a prior period. Comparative figures have not been restated.`] });
  if (N.shareholder) out.push({ heading: `${N.shareholder.n}. ${N.shareholder.heading}`, paras: [N.shareholder.terms], table: "shareholder" });
  // Round 11: written by Closebook, not in Appendix C (approved by Hashim, Nov 14, 2026).
  if (N.related) out.push({ heading: `${N.related.n}. Related parties`, paras: ["The balances below are with related parties. They are recorded at the amounts agreed between the parties."], table: "related" });
  return out;
}

// The Management Responsibility Acknowledgement: management's letter, on plain paper, as Appendix C.
export function malParagraphs(m: FsModel): string[] {
  const per = m.period.charAt(0).toLowerCase() + m.period.slice(1);
  return [
    `As management of ${m.name}, I am writing to acknowledge and confirm my responsibility for the final version of the financial statements and related disclosures compiled by your firm on behalf of ${m.name} ${per}.`,
    `In addition, I approve all adjusting entries and reclassifications made by ${FIRM} to the company's financial information during the course of your compilation of the above financial statements.`,
  ];
}
export const FIRM_ADDRESS = ["675 Riverbend Dr.", "Kitchener, ON  N2K 3S3"];

// The minute book letter (Appendix C, render_lawyer.js), signed Hashim Awad, CPA.
export type Dividend = { cls: string; amount: number; eligible: boolean; declared: string; paid: string };
export type Lawyer = { auditWaiver: boolean; dividends: Dividend[]; released?: string };
export function lawyerRows(m: FsModel, reportDate: string, l: Lawyer): [string, string][] {
  return [["Fiscal year end", m.asat.slice(6)], ["Financial information dated", reportDate], ["Financial information released", l.released || reportDate],
    ["Audit waiver", l.auditWaiver ? "Yes" : "No"], ["Our appointment", "Accountants (not auditor)"], ["Our engagement", "Compilation"]];
}
export const lawyerGroups = (l: Lawyer): [string, Dividend[]][] => [
  ["Declaration and payment of eligible dividends", l.dividends.filter((d) => d.eligible)],
  ["Declaration and payment of dividends other than eligible dividends", l.dividends.filter((d) => !d.eligible)],
];
export const money = (v: number) => `$${Number(v).toLocaleString("en-US")}`;

// The MAL as the signing officer reads it on the signing page (the same words as the PDF). The date is
// left as {{DATE}}: the signing page fills in the day it is signed.
const h = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export function malHtml(m: FsModel, officer: { name: string; position: string }, date: string, esign = ""): string {
  const [street, city] = addressLines(m);
  const [p1, p2] = malParagraphs(m);
  return `<div style="font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">`
    + `<p style="margin:0 0 24px"><b>${h(m.name)}</b><br>${h(street)}<br>${h(city)}</p>`
    + `<h2 style="text-align:center;font-size:18px;font-weight:700;margin:0 0 24px">Management Responsibility Acknowledgement</h2>`
    + `<p style="margin:0 0 16px">${h(date)}</p><p style="margin:0 0 16px">${h(FIRM)}<br>${h(FIRM_ADDRESS[0])}<br>${h(FIRM_ADDRESS[1])}</p><p style="margin:0 0 16px">To: ${h(FIRM)}</p>`
    + `<p style="text-align:justify;margin:0 0 12px">${h(p1)}</p><p style="text-align:justify;margin:0 0 24px">${h(p2)}</p><p style="margin:0 0 ${esign ? 24 : 48}px">Yours truly,</p>`
    + (esign ? `<p style="margin:0 0 4px;font-style:italic">${h(esign)}</p>` : "")
    + `<p style="margin:0 0 16px;border-top:1px solid #1a1a1a;padding-top:6px;max-width:420px">${h(officer.name)}<br>${h(m.name)}<br>${h(officer.position)}</p><p>Date: ${h(date)}</p></div>`;
}
