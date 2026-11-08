// One date format everywhere on screen: "Nov 5, 2026" (and "Nov 5, 2026, 3:42 PM" with time),
// always in Toronto time.
const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/Toronto" });
const DATE_ONLY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const DATE_TIME = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" });

// Today's date in Toronto as YYYY-MM-DD (for date inputs and comparisons).
export function todayToronto(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

// A calendar date stored as YYYY-MM-DD, e.g. a price start date.
export function formatDate(value: string | null | undefined) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? DATE_ONLY.format(new Date(`${value}T00:00:00Z`)) : DATE.format(new Date(value));
}

// A moment in time (timestamp), shown with the time.
export function formatDateTime(value: string | null | undefined) {
  if (!value) return "";
  return DATE_TIME.format(new Date(value));
}
