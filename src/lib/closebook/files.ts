// Closebook files: labels, the filing deadline, phase progress and the "Next:" line (Phase 3 batch,
// section 2). Pure, so the lists, the file page and tests share one set of rules.

export type CbDoc = { code: string; phase: "planning" | "fieldwork" | "conclusion"; title: string; detail: string; sort_order: number; status: "open" | "prepared" | "signed";
  prepared_by: string | null; prepared_at: string | null; reviewed_by: string | null; reviewed_at: string | null };
export type CbFileRow = { id: string; client_id: string; year_start: string; year_end: string; year_change_reason: string; file_type: "monthly" | "full"; books: string;
  preparer_id: string; reviewer_id: string; phase: string; created_at: string; setup?: Record<string, unknown>; opening_source?: string | null; opening_re_stated?: number | null; opening_set_at?: string | null;
  opening_note?: string; opening_pdf?: string | null; opening_ni_typed?: number | null; opening_signed_by?: string | null; opening_signed_at?: string | null; first_year?: boolean };

// Data source (CaseWare Cloud's term; Hashim, Nov 15, 2026): one question on the New year-end file
// screen, shown with the same words wherever it appears (file header, step 1, My files). It maps to the
// stored file_type and books, which drive how the file works; those values never show on screen.
// "Paper records" and "A bookkeeper's file" are no longer offered: older files with them read as their
// nearest choice (paper as statements; a bookkeeper's file as the client's books).
export type DataSource = "ours" | "client" | "statements";
export const DATA_SOURCE: Record<DataSource, { label: string; line: string; file_type: "monthly" | "full"; books: string }> = {
  ours: { label: "Our QuickBooks file (monthly client)", line: "We import the QuickBooks trial balance. Year-end entries go back through the client entry list.", file_type: "monthly", books: "concept_qbo" },
  client: { label: "The client's books", line: "Kept by the client or their bookkeeper. We import their trial balance, and Closebook lists our entries for them to book.", file_type: "full", books: "client_software" },
  statements: { label: "Bank and card statements", line: "The client has no books. We upload the statements and code each line.", file_type: "full", books: "statements" },
};
// The monthly route (our QuickBooks file) is not built end to end yet: no "bank and cards reconciled in
// QuickBooks" confirmation, and step 8's T2 tie-out refuses monthly files. Hidden until it is.
export const MONTHLY_READY = false;
export function dataSourceOf(f: { file_type: string; books: string }): DataSource {
  if (f.file_type === "monthly") return "ours";
  return f.books === "statements" || f.books === "paper" ? "statements" : "client";
}
export const dataSourceLabel = (f: { file_type: string; books: string }) => DATA_SOURCE[dataSourceOf(f)].label;

// The year: the start is the day after the previous year end. Dates as YYYY-MM-DD, in UTC.
const iso = (d: Date) => d.toISOString().slice(0, 10);
const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// The same day a number of months on, kept inside the month (Jan 31 + 1 month is Feb 28 or 29).
export function addMonths(date: string, n: number): string {
  const d = utc(date), y = d.getUTCFullYear(), m = d.getUTCMonth() + n;
  const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12;
  return iso(new Date(Date.UTC(ty, tm, Math.min(d.getUTCDate(), daysIn(ty, tm)))));
}
export const nextDay = (date: string) => iso(new Date(utc(date).getTime() + 86_400_000));
// A full year's start for a year end: the day after the same date a year before (month ends stay month ends).
export function fullYearStart(yearEnd: string): string {
  const d = utc(yearEnd), y = d.getUTCFullYear() - 1, m = d.getUTCMonth();
  const lastDay = d.getUTCDate() === daysIn(d.getUTCFullYear(), m);
  return nextDay(iso(new Date(Date.UTC(y, m, lastDay ? daysIn(y, m) : Math.min(d.getUTCDate(), daysIn(y, m))))));
}
// Whole months and days from start to end (both included), and whether it is a full 12-month year.
export function yearPeriod(start: string, end: string): { months: number; days: number; full: boolean; text: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) return { months: 0, days: 0, full: false, text: "check the dates" };
  const after = nextDay(end);
  let months = 0;
  while (addMonths(start, months + 1) <= after) months++;
  const days = Math.round((utc(after).getTime() - utc(addMonths(start, months)).getTime()) / 86_400_000);
  const full = start === fullYearStart(end);
  const part = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const text = full ? "12 months" : [months ? part(months, "month") : "", days ? part(days, "day") : ""].filter(Boolean).join(" ");
  return { months, days, full, text };
}
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
