// Price book labels and suggestions. Pure, so they can be tested without the database.

type Offer = { offer: string; segment: string; services: string[]; is_active: boolean };
type CodedItem = { code: string; name: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Packages that list this item in their services, by code or by name (case, spacing and
// punctuation ignored). Only active packages and floors count, not Studio's T1 rows.
export function packagesCovering(item: CodedItem, offers: Offer[]): string[] {
  const code = norm(item.code), name = norm(item.name);
  return offers
    .filter((o) => o.is_active && o.segment !== "T1 personal")
    .filter((o) => (o.services ?? []).some((s) => {
      const n = norm(s);
      return n === code || n === name || (code.length > 0 && n.startsWith(code));
    }))
    .map((o) => o.offer);
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
