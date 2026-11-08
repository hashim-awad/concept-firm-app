// Deadlines worked out from a fiscal year end (YYYY-MM-DD). Pure, so it can be tested.

// T2 filing deadline: six months after the tax year end (brief, Phase 3 A). A year end on the
// last day of a month files by the last day of the sixth month after it (Feb 28 -> Aug 31).
// Weekends and holidays are not moved.
export function t2FilingDeadline(fye: string): string {
  const [y, m, d] = fye.split("-").map(Number);
  const lastOfMonth = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate(); // mm is 1-12
  const ty = y + Math.floor((m - 1 + 6) / 12), tm = ((m - 1 + 6) % 12) + 1;
  const day = d === lastOfMonth(y, m) ? lastOfMonth(ty, tm) : Math.min(d, lastOfMonth(ty, tm));
  return `${ty}-${String(tm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Whole days from one YYYY-MM-DD date to another (negative when past).
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
