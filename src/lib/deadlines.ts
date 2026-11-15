// Deadlines worked out from a fiscal year end (YYYY-MM-DD). Pure, so it can be tested.

const lastOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate(); // mm is 1-12
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// A date a number of months after a year end. A year end on the last day of a month gives the last
// day of the target month (Feb 28 + 6 months -> Aug 31); otherwise the same day, or the month's last day.
export function monthsAfterYearEnd(fye: string, months: number): string {
  const [y, m, d] = fye.split("-").map(Number);
  const ty = y + Math.floor((m - 1 + months) / 12), tm = ((m - 1 + months) % 12) + 1;
  const day = d === lastOfMonth(y, m) ? lastOfMonth(ty, tm) : Math.min(d, lastOfMonth(ty, tm));
  return iso(ty, tm, day);
}

// T2 filing deadline: six months after the tax year end (CRA, checked Nov 8, 2026). Weekends and holidays are not moved.
export const t2FilingDeadline = (fye: string) => monthsAfterYearEnd(fye, 6);

// Balance-due day: two months after the year end, or three for a CCPC that meets CRA's conditions
// (claimed the small business deduction; income within the business limit). Set per client.
export const t2BalanceDue = (fye: string, months: 2 | 3) => monthsAfterYearEnd(fye, months);

// Whole days from one YYYY-MM-DD date to another (negative when past).
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

// The most recent year end on or before today, from a month-day ("12-31"). Feb 29 is not a valid year-end day.
export function lastYearEnd(md: string, today: string): string {
  const [ty] = today.split("-").map(Number);
  const [m, d] = md.split("-").map(Number);
  const thisYear = iso(ty, m, Math.min(d, lastOfMonth(ty, m)));
  return thisYear <= today ? thisYear : iso(ty - 1, m, Math.min(d, lastOfMonth(ty - 1, m)));
}
export function nextYearEnd(md: string, today: string): string {
  const last = lastYearEnd(md, today);
  const [y, m, d] = last.split("-").map(Number);
  return iso(y + 1, m, Math.min(d, lastOfMonth(y + 1, m)));
}

export type T2Client = { id: string; legal_name: string; year_end_md: string; t2_balance_due_months: number };
export type DeadlineItem = { clientId: string; client: string; yearEnd: string; kind: "filing" | "balance"; due: string; days: number };

export const deadlineKey = (x: { clientId: string; yearEnd: string; kind: string }) => `${x.clientId}|${x.yearEnd}|${x.kind}`;

// Every filing and balance-due date for the latest year end and the next one, done or not, oldest first.
// Clients with no month-day year end are left out.
export function t2DeadlinesAll(clients: T2Client[], today: string): DeadlineItem[] {
  const out: DeadlineItem[] = [];
  for (const c of clients) {
    if (!/^\d{2}-\d{2}$/.test(c.year_end_md)) continue;
    for (const ye of [lastYearEnd(c.year_end_md, today), nextYearEnd(c.year_end_md, today)]) {
      const items: [DeadlineItem["kind"], string][] = [["balance", t2BalanceDue(ye, c.t2_balance_due_months === 3 ? 3 : 2)], ["filing", t2FilingDeadline(ye)]];
      for (const [kind, due] of items) out.push({ clientId: c.id, client: c.legal_name, yearEnd: ye, kind, due, days: daysBetween(today, due) });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.client.localeCompare(b.client));
}

// Every filing and balance-due date that is overdue or due within `ahead` days, oldest first. Looks at
// the latest year end and the next one; items marked done are left out. done keys: clientId|yearEnd|kind.
export function t2Deadlines(clients: T2Client[], today: string, done: Set<string>, ahead = 90): DeadlineItem[] {
  return t2DeadlinesAll(clients, today).filter((x) => x.days <= ahead && !done.has(deadlineKey(x)));
}

// The same window, but only the items marked done (My day, "Show done").
export function t2DeadlinesDone(clients: T2Client[], today: string, done: Set<string>, ahead = 90): DeadlineItem[] {
  return t2DeadlinesAll(clients, today).filter((x) => x.days <= ahead && done.has(deadlineKey(x)));
}

// Deadlines due strictly before a date (YYYY-MM-DD). No 90-day limit.
export function dueBefore<T extends { due: string }>(items: T[], before: string): T[] {
  return /^\d{4}-\d{2}-\d{2}$/.test(before) ? items.filter((x) => x.due < before) : [];
}

// "Mark done before a date": every open deadline for the latest and next year end, due before the date.
export function t2DeadlinesDueBefore(clients: T2Client[], today: string, done: Set<string>, before: string): DeadlineItem[] {
  return dueBefore(t2DeadlinesAll(clients, today).filter((x) => !done.has(deadlineKey(x))), before);
}

// The reason kept with each deadline marked done in one step: 2 to 200 characters. Null when not valid.
export function cleanReason(value: string): string | null {
  const r = value.trim().replace(/\s+/g, " ");
  return r.length >= 2 && r.length <= 200 ? r : null;
}

// A deadline label inside a sentence: "Balance due" -> "balance due"; "T2 filing" stays as it is.
export const labelInSentence = (label: string) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// "3 deadlines due before Jan 1, 2026 will be marked done: 2 T2 filing, 1 balance due, for 2 clients."
// Kinds are listed most first; a kind with none is left out. labels: kind key -> label.
export function doneBeforeSummary(items: { clientId: string; kind: string }[], labels: Record<string, string>, beforeText: string): string {
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x.kind, (counts.get(x.kind) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1] || (labels[a[0]] ?? a[0]).localeCompare(labels[b[0]] ?? b[0]))
    .map(([k, n]) => `${n} ${labelInSentence(labels[k] ?? k)}`);
  const clients = new Set(items.map((x) => x.clientId)).size;
  return `${plural(items.length, "deadline", "deadlines")} due before ${beforeText} will be marked done: ${parts.join(", ")}, for ${plural(clients, "client", "clients")}.`;
}
