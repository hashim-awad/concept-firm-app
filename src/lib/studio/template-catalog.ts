// Round 17 (Hashim, Nov 15, 2026): the Templates page in four tabs, each template with a plain-words line
// saying where it is used, and whether it goes to clients. Benchmark: TaxDome keeps templates as their own
// area. No build notes here: the line is for the person approving the wording.
export type TemplateTab = "letters" | "schedules" | "emails" | "closebook";
export const TEMPLATE_TABS: [TemplateTab, string][] = [["letters", "Letters and proposals"], ["schedules", "Schedules and terms"], ["emails", "Emails"], ["closebook", "Closebook"]];

// key: [tab, where it is used]
export const TEMPLATE_INFO: Record<string, [TemplateTab, string]> = {
  master: ["letters", "The engagement letter each corporate client signs. The service schedules attach to it."],
  corpquote: ["letters", "The year-end quote a corporate lead signs online. The corporate letter follows it."],
  prop: ["letters", "The monthly service proposal, with up to three options, signed online."],
  t1quote: ["letters", "The T1 quote and letter a personal tax lead signs online."],
  t1: ["letters", "The T1 engagement letter for owners of our corporate clients, made and signed in Studio."],
  t1td: ["letters", "The master copy of the T1 letter we send from TaxDome."],
  signpage: ["letters", "The sentence above the Sign button on every letter and proposal signed online."],
  sComp: ["schedules", "Compilation engagement. Added to the corporate letter when we compile the financial statements."],
  sT2: ["schedules", "Corporate tax return (T2, and AT1 in Alberta). Added to the corporate letter."],
  sCatch: ["schedules", "Catch-up bookkeeping. Added to the corporate letter."],
  sBooks: ["schedules", "Monthly bookkeeping. Added to the corporate letter."],
  sGst: ["schedules", "GST/HST returns. Added to the corporate letter."],
  sPayroll: ["schedules", "Payroll, full service or support. Added to the corporate letter."],
  sPay: ["schedules", "Payment administration. Added to the corporate letter."],
  sCfo: ["schedules", "CFO reporting. Added to the corporate letter."],
  sBudget: ["schedules", "Annual budget. Added to the corporate letter."],
  sCoord: ["schedules", "Year-end support when another accountant does the year-end. Added to the corporate letter."],
  sExcl: ["schedules", "The sentence in Other matters that lists the work not included."],
  appA: ["schedules", "The sample compilation report attached to the corporate letter, word for word from O. Reg. 324/21."],
  termsC: ["schedules", "The terms and conditions attached to every corporate letter."],
  termsI: ["schedules", "The terms and conditions attached to every letter for individuals."],
  t1email1: ["emails", "The email that sends a T1 quote to one person."],
  t1email2: ["emails", "The email that sends a T1 quote to a couple who both sign."],
  corpemail: ["emails", "The email that sends a corporate year-end quote."],
  letteremail: ["emails", "The email that sends a new engagement letter for signing."],
  propemail: ["emails", "The email that sends a monthly proposal for signing."],
  cbchecklist: ["closebook", "Answered on step 10 of each Closebook file, before the file is locked. Not sent to clients."],
  cbclientlist: ["closebook", "The list of our entries, for clients who keep their own books."],
  memo: ["closebook", "Kept in the client's file for each compilation. Not sent to clients. Its wording is not in Studio yet."],
};

// Templates that never go to a client: approved "for use", not "for clients".
export const INTERNAL_TEMPLATES = new Set(["cbchecklist", "memo"]);
export const tabOf = (key: string): TemplateTab => TEMPLATE_INFO[key]?.[0] ?? "letters";
export const whereUsed = (key: string): string => TEMPLATE_INFO[key]?.[1] ?? "";
export const approvedWord = (key: string) => (INTERNAL_TEMPLATES.has(key) ? "Approved for use" : "Ready for clients");
export const approveButton = (key: string) => (INTERNAL_TEMPLATES.has(key) ? "Approve for use" : "Mark ready for clients");

// A template's status: a draft until an owner approves it. Templates in use before approvals were recorded
// (status "Live" or "In use" in the code) have no approval record, so they show the word without a name.
export type TemplateStatus = { draft: boolean; word: string; by?: string; on?: string };
export function templateStatus(t: { k: string; status: string }, approval?: { by?: string | null; on: string } | null): TemplateStatus {
  if (approval) return { draft: false, word: approvedWord(t.k), by: approval.by ?? undefined, on: approval.on };
  if (t.status === "Trial") return { draft: true, word: "Draft" };
  return { draft: false, word: approvedWord(t.k) };
}
