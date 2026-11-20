// Small pieces shared by the Banking screens (round 23). No script needed: they work in server and client pages.
import { MoreHorizontal } from "lucide-react";

// A "..." menu (details/summary). An open menu sits above the rows below it.
export function Menu({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group relative z-10 open:z-40">
      <summary aria-label={label} className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-ink-2 hover:bg-sand-100 [&::-webkit-details-marker]:hidden"><MoreHorizontal className="h-4 w-4" /></summary>
      <div className="absolute top-9 right-0 grid min-w-[13rem] rounded-[var(--radius-ds)] border border-sand-300 bg-white p-1 text-[13.5px] shadow-lg">{children}</div>
    </details>
  );
}

// A status word as a pill: Complete, Not uploaded, 1 missing, 1 to fix.
export function Pill({ tone, children }: { tone: "ok" | "bad" | ""; children: React.ReactNode }) {
  const c = tone === "ok" ? "bg-success-soft text-success" : tone === "bad" ? "bg-danger-soft text-danger" : "bg-sand-100 text-ink-2";
  return <span className={`inline-flex rounded-full px-3 py-1 text-[13px] font-semibold whitespace-nowrap ${c}`}>{children}</span>;
}

// Two decimals, negatives in brackets.
export const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const date = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
// "Mar 2 to Apr 2, 2026": the year once when both dates are in it.
export const span = (a: string, b: string) => (a.slice(0, 4) === b.slice(0, 4) ? `${date(a).replace(/, \d{4}$/, "")} to ${date(b)}` : `${date(a)} to ${date(b)}`);
