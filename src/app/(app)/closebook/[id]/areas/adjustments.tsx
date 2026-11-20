// Piece 5 (Hashim, Nov 18, 2026, version 2; benchmark CaseWare Cloud: the Adjustments page lists the engagement's adjusting
// entries with their working papers). Step 5's page when no paper is chosen: last year's schedule entries (one grey line,
// information only), the Schedules table (the step's two working papers as before, then one row per schedule made this
// year), and the Entries tab's list, whole, as "Entries this year".
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbEntry } from "@/lib/closebook/server";
import { entryNo } from "@/lib/closebook/reports";
import { formatAmount } from "@/lib/closebook/amount";
import type { Progress } from "@/lib/closebook/step-progress";

export const SCHED_LABEL: Record<string, string> = { vehicle: "Vehicle (owner's car)", home_office: "Home office", expenses: "Expenses paid personally" };
const SHORT: Record<string, string> = { vehicle: "Vehicle", home_office: "Home office", expenses: "Expenses paid personally" };
const STATUS: Record<Progress, string> = { not_started: "Not started", started: "Started", signed: "Signed" };
// An entry's amount as the entries list shows it: the total of its debits.
const amountOf = (lines: { amount: number }[]) => Math.round(lines.filter((l) => Number(l.amount) > 0).reduce((n, l) => n + Number(l.amount), 0) * 100);

// "Last year: Vehicle 7,900.00 · Home office 1,250.00": the schedule entries on the client's previous-year file, in the
// order they were made. Empty on a first-year file or when last year had none.
export async function lastYearLine(supabase: SupabaseClient, file: CbFileRow): Promise<string> {
  const { data: prev } = await supabase.from("cb_files").select("id").eq("client_id", file.client_id).lt("year_end", file.year_end)
    .order("year_end", { ascending: false }).limit(1).maybeSingle();
  if (!prev) return "";
  const { data: sch } = await supabase.from("cb_schedules").select("kind, entry_id, entry:entry_id(created_at, lines:cb_entry_lines(amount))").eq("file_id", (prev as { id: string }).id);
  type Row = { kind: string; entry_id: string; entry: { created_at: string; lines: { amount: number }[] } | null };
  const rows = ((sch ?? []) as unknown as Row[]).filter((r) => r.entry).sort((a, b) => a.entry!.created_at.localeCompare(b.entry!.created_at) || a.entry_id.localeCompare(b.entry_id));
  return rows.length ? `Last year: ${rows.map((r) => `${SHORT[r.kind] ?? r.kind} ${formatAmount(amountOf(r.entry!.lines))}`).join(" · ")}` : "";
}

export async function adjustmentsTop({ supabase, file, entries, papers, base, editable, addRevenue }: {
  supabase: SupabaseClient; file: CbFileRow; entries: CbEntry[]; base: string; editable: boolean;
  addRevenue?: React.ReactNode;   // Piece 7: "+ Add revenue check", at the right of the heading, until it is added
  papers: { name: string; href: string; status: Progress }[];   // Revenue check, Shareholder loans: as the step list offers them
}) {
  const [last, { data: sch }] = await Promise.all([lastYearLine(supabase, file), supabase.from("cb_schedules").select("kind, entry_id").eq("file_id", file.id)]);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const made = ((sch ?? []) as { kind: string; entry_id: string }[]).map((s) => ({ s, e: byId.get(s.entry_id) })).filter((x) => x.e)
    .sort((a, b) => (a.e!.created_at ?? "").localeCompare(b.e!.created_at ?? "") || a.e!.id.localeCompare(b.e!.id));
  const open = editable && file.phase !== "locked";
  const cell = "px-3 py-2";
  return (
    <>
      {last && <p className="mb-4 rounded-[var(--radius-ds)] border border-sand-200 bg-white px-4 py-2.5 text-[13px] text-ink-3" data-last-year>{last}</p>}
      <div className="mb-2 flex items-center justify-between gap-3"><h2 className="text-[14px] font-semibold">Schedules</h2>{addRevenue}</div>
      <section className="mb-5 overflow-hidden rounded-[var(--radius-ds)] border border-sand-200 bg-white" aria-label="Schedules">
        <table className="w-full border-collapse text-[12.5px]" data-schedules>
          <thead><tr className="border-b border-sand-200 bg-sand-50 text-left text-[11px] font-semibold tracking-[.06em] text-ink-3 uppercase">
            <th className={cell}>Schedule</th><th className={`${cell} w-32`}>Status</th><th className={`${cell} w-32 text-right`}>Amount</th><th className={`${cell} w-36`}>Entry</th><th className={`${cell} w-20`} /></tr></thead>
          <tbody>
            {papers.map((p) => (
              <tr key={p.name} className="border-b border-sand-100 last:border-0" data-schedule-row>
                <td className={cell}>{p.name}</td><td className={cell}>{STATUS[p.status]}</td><td className={`${cell} text-right text-ink-3`}>–</td><td className={`${cell} text-ink-3`}>–</td>
                <td className={cell}><Link href={p.href} className="font-medium text-navy-700 underline">Open</Link></td>
              </tr>
            ))}
            {made.map(({ s, e }) => {
              // Piece S1 and E1: the schedule's name opens its window with the saved inputs while the file is open and not booked;
              // Open shows the entry.
              const href = `${base}&open=${e!.id}`;
              const schedHref = `${base}&open=${e!.id}&edit=1&sched=1`;
              const label = SCHED_LABEL[s.kind] ?? s.kind;
              return (
                <tr key={e!.id} className="border-b border-sand-100 last:border-0" data-schedule-row>
                  <td className={cell}>{open && !e!.booked_at ? <Link href={schedHref} scroll={false} className="font-medium text-navy-700 underline" aria-label={`Change the ${label} schedule`} data-schedule-name>{label}</Link> : label}</td><td className={cell}>Done</td>
                  <td className={`${cell} text-right tabular-nums`}>{formatAmount(amountOf(e!.lines))}</td>
                  <td className={`${cell} tabular-nums`}>{e!.kind} {entryNo(file.year_end, e!).split(" ")[0]}</td>
                  <td className={cell}><Link href={href} scroll={false} className="font-medium text-navy-700 underline">Open</Link></td>
                </tr>
              );
            })}
            {!papers.length && !made.length && <tr><td colSpan={5} className={`${cell} text-ink-3`}>No schedules yet.</td></tr>}
          </tbody>
        </table>
      </section>
    </>
  );
}
