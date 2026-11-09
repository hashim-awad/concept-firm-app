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

// Every filing and balance-due date that is overdue or due within `ahead` days, oldest first. Looks at
// the latest year end and the next one; items marked done are left out. done keys: clientId|yearEnd|kind.
export function t2Deadlines(clients: T2Client[], today: string, done: Set<string>, ahead = 90): DeadlineItem[] {
  const out: DeadlineItem[] = [];
  for (const c of clients) {
    if (!/^\d{2}-\d{2}$/.test(c.year_end_md)) continue;
    for (const ye of [lastYearEnd(c.year_end_md, today), nextYearEnd(c.year_end_md, today)]) {
      const items: [DeadlineItem["kind"], string][] = [["balance", t2BalanceDue(ye, c.t2_balance_due_months === 3 ? 3 : 2)], ["filing", t2FilingDeadline(ye)]];
      for (const [kind, due] of items) {
        const days = daysBetween(today, due);
        if (days > ahead || done.has(`${c.id}|${ye}|${kind}`)) continue;
        out.push({ clientId: c.id, client: c.legal_name, yearEnd: ye, kind, due, days });
      }
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due) || a.client.localeCompare(b.client));
}
