"use client";
// Round 20 (Hashim, Nov 15, 2026; mock 01): the statements uploaded, one row per file with its status.
// Benchmark: QuickBooks Online "Import bank transactions": many files at once, one status per file.
// Each statement is its own background job, so the list only shows where each one is.
import Link from "next/link";
import { Loader2, RotateCcw, X } from "lucide-react";
import type { StatementRow } from "@/lib/statements/server";
import { STATUS_LABEL } from "@/lib/statements/types";
import { accountLabel, money, periodText, plural, shortName, STATUS_CLS } from "./format";

export type PendingUpload = { key: string; name: string; error: string | null };

// What the reader found, in one line (mock 01): "Mar 1 to Mar 31 · Chequing ••• 4821 · 38 lines".
export function foundText(r: StatementRow): string {
  const join = (...p: string[]) => p.filter(Boolean).join(" · ");
  const period = periodText(r.period_start, r.period_end);
  const names = r.found.map((a) => accountLabel(shortName(a.name, a.kind), a.last4));
  const accts = names.length > 1 ? `${names.length} accounts found (${names.join(", ")})` : names[0] ?? (r.accounts > 1 ? `${r.accounts} accounts found` : "");
  switch (r.status) {
    case "queued": return "Waiting its turn";
    case "reading": return r.pages ? `Reading ${plural(r.pages, "page")}` : "Reading";
    case "failed": return r.error || "The statement could not be read.";
    case "imported": return join(period, `${plural(r.lines, "line")} imported`);
    case "needs_look": return join(period, names.length > 1 ? accts : "", r.review ? `${plural(r.review, "line")} for review` : "",
      r.difference_cents ? `difference ${money(r.difference_cents)}` : "", names.length > 1 ? "" : plural(r.lines, "line"));
    default: return join(period, accts, names.length > 1 ? "" : plural(r.lines, "line"));
  }
}

export function summaryText(rows: StatementRow[]): string {
  const n = (s: StatementRow["status"][]) => rows.filter((r) => s.includes(r.status)).length;
  const ready = n(["ready"]), look = n(["needs_look"]), reading = n(["queued", "reading"]), failed = n(["failed"]), imported = n(["imported"]);
  return [ready && `${ready} ready`, look && `${look} need${look === 1 ? "s" : ""} a look`, reading && `${reading} reading`,
    failed && `${failed} failed`, imported && `${imported} imported`].filter(Boolean).join(" · ");
}

export function StatementList({ rows, pending, canEdit, busy, onRetry, onRemove, onDismiss }: {
  rows: StatementRow[]; pending: PendingUpload[]; canEdit: boolean; busy: string | null;
  onRetry: (id: string) => void; onRemove: (id: string) => void; onDismiss: (key: string) => void;
}) {
  const total = rows.length + pending.filter((p) => !p.error).length;
  return (
    <section aria-label="Statements uploaded" className="overflow-hidden rounded-[10px] border border-sand-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-4 py-2.5">
        <h3 className="text-[14px] font-semibold text-ink">{plural(total, "statement")} uploaded</h3>
        <span className="flex-1" />
        <span className="text-[12.5px] text-ink-3">{summaryText(rows)}</span>
      </div>
      {total === 0 && pending.length === 0 ? <p className="px-4 py-6 text-sm text-ink-3">No statements yet. Drop the PDFs or photos on the left.</p> : (
        <div className="overflow-x-auto">
          <table className="table table-compact">
            <thead><tr><th>File</th><th>Status</th><th>What was found</th><th /></tr></thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.key}>
                  <td className="max-w-[15rem] truncate font-medium" title={p.name}>{p.name}</td>
                  <td>{p.error
                    ? <span className="inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap bg-danger-soft text-danger">Failed</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-navy-50 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-navy-700"><Loader2 className="h-3 w-3 animate-spin" aria-hidden />Uploading</span>}</td>
                  <td className={`text-[13px] ${p.error ? "text-danger" : "text-ink-2"}`}>{p.error ?? "Sending the file"}</td>
                  <td className="text-right">{p.error && <button type="button" onClick={() => onDismiss(p.key)} className="btn-secondary h-8 px-3 text-[13px]">Close</button>}</td>
                </tr>
              ))}
              {rows.map((r) => {
                const reading = r.status === "queued" || r.status === "reading";
                return (
                  <tr key={r.id} data-status={r.status}>
                    <td className="max-w-[15rem] truncate font-medium" title={r.file_name}>{r.file_name}</td>
                    <td><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${STATUS_CLS[r.status]}`}>
                      {reading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}{STATUS_LABEL[r.status]}</span></td>
                    <td className={`text-[13px] ${r.status === "failed" ? "text-danger" : "text-ink-2"}`}>{foundText(r)}</td>
                    <td className="text-right whitespace-nowrap">
                      {(r.status === "ready" || r.status === "needs_look") && <Link href={`/statements/${r.id}`} className="btn-secondary h-8 px-3 text-[13px]">Check</Link>}
                      {r.status === "imported" && <Link href={`/statements/${r.id}`} className="btn-secondary h-8 px-3 text-[13px]">Open</Link>}
                      {r.status === "failed" && canEdit && <>
                        <button type="button" disabled={busy === r.id} onClick={() => onRetry(r.id)} className="btn-secondary h-8 px-3 text-[13px]"><RotateCcw className="h-3.5 w-3.5" aria-hidden />Retry</button>
                        <button type="button" disabled={busy === r.id} onClick={() => onRemove(r.id)} title="Remove" aria-label={`Remove ${r.file_name}`} className="ml-1 inline-grid h-8 w-8 place-items-center rounded-lg text-ink-3 hover:bg-sand-100 hover:text-danger"><X className="h-4 w-4" aria-hidden /></button>
                      </>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
