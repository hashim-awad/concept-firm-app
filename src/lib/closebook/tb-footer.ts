// Piece UI1 (closebook specialist item 10; approved wording): the trial balance footer names each column that does not
// net to nil, and what to do. Prelim points at the import; every other column at an entry.
export type OutColumn = { key: string; label: string; by: number };   // by: cents, the column's sum
const amt = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export function outLines(outs: OutColumn[]): string[] {
  return outs.filter((x) => x.by !== 0).map((x) => `${x.label} out by ${amt(x.by)}: ${x.key === "prelim" ? "check the import" : "find the entry"}`);
}
