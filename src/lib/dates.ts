// Today's date in Toronto as YYYY-MM-DD (for date inputs and comparisons).
export function todayToronto(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`));
}
