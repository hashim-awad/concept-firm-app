import { Download } from "lucide-react";

type Gifi = { codes: [string, number][]; totals: Record<string, number>; problems: string[]; names: Map<string, string>; fileName: string };
const money = (n: number) => n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TOTALS: [string, string][] = [["2599", "Total assets"], ["3499", "Total liabilities"], ["3620", "Total shareholder equity"], ["3640", "Total liabilities and shareholder equity"],
  ["8299", "Total revenue"], ["9368", "Total expenses"], ["9999", "Net income/loss after taxes"], ["3660", "Retained earnings/deficit – Start"], ["3849", "Retained earnings/deficit – End"]];

// GIFI for ProFile (Hashim, Nov 13, 2026): the codes and amounts the file holds, the required totals
// Closebook checks first (not written into the file, as QuickBooks does), and the download.
export function GifiView({ fileId, g }: { fileId: string; g: Gifi }) {
  const ties = Math.abs(g.totals["2599"] - g.totals["3640"]) < 0.01;
  return (
    <div className="grid gap-4">
      <div className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${g.problems.length ? "border-danger/30 bg-danger/5" : "border-success/30 bg-success-soft"}`}>
        {g.problems.length ? (
          <div><p className="font-semibold text-danger">Not ready to export</p><ul className="ml-4 list-disc">{g.problems.map((p) => <li key={p}>{p}</li>)}</ul></div>
        ) : <p className="font-semibold text-success">The required totals tie. Ready for ProFile.</p>}
        {g.problems.length === 0 && <a href={`/closebook/${fileId}/gifi`} className="btn"><Download className="h-4 w-4" aria-hidden />Download GIFI file</a>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">Required totals (checked, not in the file)</h2>
          <table className="table"><tbody>{TOTALS.map(([c, n]) => (
            <tr key={c}><td className="tabular-nums text-ink-3">{c}</td><td>{n}</td><td className="text-right tabular-nums">{money(g.totals[c] ?? 0)}</td></tr>
          ))}<tr><td colSpan={2} className="font-semibold">2599 equals 3640</td><td className={`text-right font-semibold ${ties ? "text-success" : "text-danger"}`}>{ties ? "Ties" : `Off by ${money(g.totals["2599"] - g.totals["3640"])}`}</td></tr></tbody></table>
        </section>
        <section className="card overflow-x-auto p-0">
          <h2 className="px-5 pt-4 pb-2 font-semibold">In the file ({g.codes.length} codes)</h2>
          <table className="table"><thead><tr><th>GIFI</th><th>Line</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{g.codes.map(([c, v]) => <tr key={c}><td className="tabular-nums">{c}</td><td>{g.names.get(c) ?? ""}</td><td className="text-right tabular-nums">{money(v)}</td></tr>)}</tbody></table>
        </section>
      </div>
      <p className="text-xs text-muted">Same layout as QuickBooks&rsquo; GIFI export: a header line, then one line per GIFI code. Assets and expenses as debits, liabilities, equity and revenue as credits, so contra and deficit balances are negative. Retained earnings from the trial balance go in as 3660 (start of the year). File name: {g.fileName}.</p>
    </div>
  );
}
