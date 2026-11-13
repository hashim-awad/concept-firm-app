// Closebook files: labels, the filing deadline, phase progress and the "Next:" line (Phase 3 batch,
// section 2). Pure, so the lists, the file page and tests share one set of rules.

export type CbDoc = { code: string; phase: "planning" | "fieldwork" | "conclusion"; title: string; detail: string; sort_order: number; status: "open" | "prepared" | "signed";
  prepared_by: string | null; prepared_at: string | null; reviewed_by: string | null; reviewed_at: string | null };
export type CbFileRow = { id: string; client_id: string; year_start: string; year_end: string; year_change_reason: string; file_type: "monthly" | "full"; books: string;
  preparer_id: string; reviewer_id: string; phase: string; created_at: string; setup?: Record<string, unknown>; opening_source?: string | null; opening_re_stated?: number | null; opening_set_at?: string | null };

export const FILE_TYPE: Record<string, string> = { monthly: "Monthly", full: "Full" };
export const BOOKS: Record<string, string> = {
  concept_qbo: "Concept's QuickBooks (monthly client)",
  client_software: "The client's own QuickBooks or Xero",
  bookkeeper: "A bookkeeper's file",
  statements: "Bank and card statements",
  paper: "Paper records, after data entry",
};
export const PHASES = ["planning", "fieldwork", "conclusion"] as const;
export const PHASE_NAME: Record<string, string> = { planning: "Planning", fieldwork: "Fieldwork", conclusion: "Conclusion", locked: "Locked" };

// The T2 is due six months after the year-end (the same rule as the T2 deadlines on My day).
export function fileBy(yearEnd: string): string {
  const [y, m, d] = yearEnd.split("-").map(Number);
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const tm = m + 6, ty = y + (tm > 12 ? 1 : 0), mm = ((tm - 1) % 12) + 1;
  // Year-end on the last day of a month: due on the last day of the sixth month after.
  const day = d === last(y, m) ? last(ty, mm) : Math.min(d, last(ty, mm));
  return `${ty}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// The phase being worked: the first with a document not yet signed (phases open in order).
export function currentPhase(docs: CbDoc[]): (typeof PHASES)[number] | "locked" {
  return PHASES.find((p) => docs.some((d) => d.phase === p && d.status !== "signed")) ?? "locked";
}

export function progress(docs: CbDoc[], phase: string) {
  const inPhase = docs.filter((d) => d.phase === phase);
  return { signed: inPhase.filter((d) => d.status === "signed").length, total: inPhase.length };
}

// One "Next:" line per file, naming the action and the person.
export function nextLine(docs: CbDoc[], people: { preparer: string; reviewer: string }, openNotes = 0): { text: string; code: string | null } {
  if (openNotes > 0) return { text: `Next: reviewer, ${openNotes} review note${openNotes === 1 ? "" : "s"} open`, code: null };
  const phase = currentPhase(docs);
  if (phase === "locked") return { text: "Locked. Every document is signed.", code: null };
  const doc = docs.filter((d) => d.phase === phase && d.status !== "signed").sort((a, b) => a.sort_order - b.sort_order)[0];
  const who = doc.status === "prepared" ? people.reviewer : people.preparer;
  const text = doc.status === "prepared" ? `Next: reviewer signs \u201c${doc.title}\u201d (${who})` : `Next: ${doc.title.charAt(0).toLowerCase() + doc.title.slice(1)} (${who})`;
  return { text, code: doc.code };
}

export const firstName = (full: string) => full.split(" ")[0] ?? full;
