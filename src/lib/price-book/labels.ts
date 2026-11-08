// Price book labels and suggestions. Pure, so they can be tested without the database.

type Offer = { offer: string; segment: string; services: string[]; monthly_fee?: number | null; software_per_month?: number | null; is_active: boolean };
type CodedItem = { code: string; name: string };

// The services a package can include: the tick boxes on the package page (Studio's keys).
export const SERVICES: [string, string][] = [["comp", "Year-end financial statements"], ["t2", "Corporate tax return (T2)"], ["catchup", "Catch-up bookkeeping"],
  ["books", "Monthly bookkeeping"], ["pnl", "Monthly profit and loss report"], ["gst", "GST/HST returns"], ["payroll", "Payroll"], ["pay", "Payment administration"],
  ["cfo", "CFO reporting"], ["budget", "Annual budget"], ["coord", "External accountant support"], ["t1", "Owner T1"]];
export const serviceName = (k: string) => SERVICES.find(([key]) => key === k)?.[1] ?? k;

// Which price book items each package service covers (confirmed by Hashim, 2026-11-08).
// "pnl" (monthly P&L report) is part of the monthly service, ACC-101; never billed on its own.
export const SERVICE_ITEMS: Record<string, string[]> = {
  pnl: ["ACC-101"], comp: ["YE-101"], t2: ["CTX-101"], catchup: ["ACC-103"], books: ["ACC-102"], gst: ["GST-101"], payroll: ["PAY-101"],
  pay: ["ACC-105"], cfo: ["ADV-101"], budget: ["ADV-102"], coord: ["ACC-106"], t1: ["PTX-101"],
};

// Codes a package covers: its ticked services, YE-102 when it has both statements and the T2,
// ACC-101 when it has a monthly fee (the line monthly packages are invoiced under), and SFT-101
// when it charges software.
export function packageCodes(o: Offer): Set<string> {
  const s = new Set((o.services ?? []).flatMap((k) => SERVICE_ITEMS[k] ?? []));
  if (o.services?.includes("comp") && o.services?.includes("t2")) s.add("YE-102");
  if (Number(o.monthly_fee ?? 0) > 0) s.add("ACC-101");
  if (Number(o.software_per_month ?? 0) > 0) s.add("SFT-101");
  return s;
}

// Active packages and floors (not Studio's T1 rows) that cover this item.
export function packagesCovering(item: CodedItem, offers: Offer[]): string[] {
  return offers.filter((o) => o.is_active && o.segment !== "T1 personal" && packageCodes(o).has(item.code)).map((o) => o.offer);
}

// Next code for a service line: the prefix most used in that line, and one above the highest
// number with that prefix anywhere in the price book (so CFO's ADV never repeats Advisory's).
export function suggestCode(lineCodes: string[], allCodes: string[]): string {
  const parse = (c: string) => /^([A-Z]+)-(\d+)$/.exec(c);
  const counts = new Map<string, number>();
  for (const c of lineCodes) { const m = parse(c); if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1); }
  if (counts.size === 0) return "";
  const prefix = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
  let max = 0, width = 3;
  for (const c of allCodes) { const m = parse(c); if (m && m[1] === prefix) { max = Math.max(max, Number(m[2])); width = m[2].length; } }
  return `${prefix}-${String(max + 1).padStart(width, "0")}`;
}
