// Round 36: in an Excel header or footer "&" starts a code (&P page, &N pages, &L left...). Text placed there writes
// every "&" as "&&", or "Concept Accounting & Advisory" prints as "Concept Accounting Advisory". Used by every
// Studio Excel file that has a header or footer (the reports and work papers, and the Client questions file).
export const hfText = (s: string) => s.replace(/&/g, "&&");
