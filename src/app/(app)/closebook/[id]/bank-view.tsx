// Step 2, Get the records, for files built from bank and card CSVs (Hashim, Nov 13, 2026; mockup
// step 2): one tile per account like QuickBooks' bank cards, with "+ Add account". The chosen account
// shows its months for the file's year, its statements and its transactions. A file may hold one month
// or a whole year; every upload must balance to the cent.
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { BankData } from "@/lib/closebook/bank-server";
import { accountCoverage, type MonthState } from "@/lib/closebook/coverage";
import { deleteBankStatement } from "../actions";
import { BankUploadForm } from "./bank-upload-form";

const money = (v: number) => v.toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const MONTH: Record<MonthState, { cls: string; word: string }> = {
  in: { cls: "border-success/40 bg-success-soft text-success", word: "in" },
  part: { cls: "border-warning/50 bg-warning-soft text-warning", word: "part" },
  empty: { cls: "border-warning/50 bg-warning-soft text-warning", word: "no lines" },
  check: { cls: "border-warning/50 bg-warning-soft text-warning", word: "check" },
  missing: { cls: "border-dashed border-sand-300 bg-surface text-ink-3", word: "" },
};

export function BankView({ fileId, bank, editable, locked, yearStart, yearEnd, adding }: {
  fileId: string; bank: BankData; editable: boolean; locked: boolean; yearStart: string; yearEnd: string; adding: boolean;
}) {
  const { accounts, statements, lines, selected } = bank;
  const cov = new Map(accounts.map((a) => [a.id, accountCoverage(yearStart, yearEnd, statements.filter((s) => s.account_id === a.id), bank.txnMonths.get(a.id) ?? new Set())]));
  const acc = adding ? undefined : accounts.find((a) => a.id === selected);
  const words = (kind: string) => (kind === "card" ? { plus: "Charges", minus: "Payments" } : { plus: "Money in", minus: "Money out" });
  const canUpload = editable && !locked;
  const link = (a: string) => `/closebook/${fileId}?step=records&account=${a}`;

  return (
    <div className="grid gap-4">
      {bank.error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{bank.error}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {accounts.map((a) => {
          const c = cov.get(a.id)!;
          const on = acc?.id === a.id;
          return (
            <Link key={a.id} href={link(a.id)} aria-current={on ? "true" : undefined}
              className={`card grid gap-1 p-4 ${on ? "ring-2 ring-navy-700" : "hover:border-navy-300"}`}>
              <span className="flex items-start justify-between gap-2">
                <span className="font-semibold">{a.name}</span>
                {c.complete ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">✓ All in</span>
                  : <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{c.months.length - c.inCount} to do</span>}
              </span>
              <span className="text-xs text-ink-3">{a.kind === "bank" ? "Bank account" : "Card or line of credit"}</span>
              <span className="text-sm">{c.inCount} of {c.months.length} months in</span>
              <span className="text-sm text-ink-2">{c.latestClosing === null ? "" : `Last closing ${money(c.latestClosing)}`}</span>
            </Link>
          );
        })}
        {canUpload && (
          <Link href={link("new")} aria-current={adding || !accounts.length ? "true" : undefined}
            className={`card flex min-h-[112px] items-center justify-center p-4 text-sm font-semibold text-navy-700 ${adding || !accounts.length ? "ring-2 ring-navy-700" : "border-dashed hover:border-navy-300"}`}>
            + Add account
          </Link>
        )}
      </div>

      {(adding || !accounts.length) && canUpload && (
        <section className="card grid gap-3">
          <div>
            <h2 className="font-semibold">Add an account: upload its first statement</h2>
            <p className="text-sm text-ink-2">Concept&rsquo;s bank upload template: Date (YYYY-MM-DD), Description, Amount. Signs as in QuickBooks. <a href="/templates/Concept-bank-upload-template.csv" download className="text-navy-700 underline">Download the template</a></p>
          </div>
          <BankUploadForm fileId={fileId} account={null} nextOpening={null} />
        </section>
      )}

      {acc && (() => {
        const c = cov.get(acc.id)!;
        const sts = statements.filter((s) => s.account_id === acc.id);
        const w = words(acc.kind);
        return (
          <>
            <section className="card grid gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{acc.name} <span className="text-sm font-normal text-ink-2">· {formatDate(yearStart)} to {formatDate(yearEnd)}</span></h2>
                <span className="text-sm text-ink-2">{c.inCount} of {c.months.length} months in</span>
              </div>
              <ol className="grid grid-cols-6 gap-1 sm:grid-cols-12" aria-label="Months of the year">
                {c.months.map((m) => (
                  <li key={m.key} className={`flex h-11 flex-col items-center justify-center rounded-md border text-xs font-medium ${MONTH[m.state].cls}`}>
                    <span>{m.label}</span>{MONTH[m.state].word && <span className="text-[10px]">{MONTH[m.state].word}</span>}
                    <span className="sr-only">{m.state === "missing" ? "not uploaded" : m.state}</span>
                  </li>
                ))}
              </ol>
              {!c.complete && <p className="text-sm text-ink-2">Still to look at: {c.gaps.join(", ")}.</p>}
              {canUpload && (
                <details open={!c.complete} className="rounded-lg border border-sand-200 p-4">
                  <summary className="cursor-pointer font-medium">Upload a statement for {acc.name}</summary>
                  <div className="mt-3"><BankUploadForm fileId={fileId} account={acc} nextOpening={c.latestClosing} /></div>
                </details>
              )}
            </section>

            <section className="card overflow-x-auto p-0">
              <h3 className="px-5 pt-4 font-semibold">Statements</h3>
              <table className="table">
                <thead><tr><th>Period</th><th>File</th><th className="text-right">Lines</th><th className="text-right">Opening</th><th className="text-right">{w.plus}</th><th className="text-right">{w.minus}</th><th className="text-right">Closing</th><th>Uploaded</th><th></th></tr></thead>
                <tbody>{sts.map((s, i) => {
                  const prev = sts[i - 1];
                  const gap = prev && Math.round((s.opening - prev.closing) * 100) !== 0;
                  return (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap">{formatDate(s.period_start)} to {formatDate(s.period_end)}
                        {gap && <div className="text-xs text-warning">Opening differs from the last closing ({money(prev.closing)}) by {money(s.opening - prev.closing)}. A statement may be missing.</div>}</td>
                      <td className="whitespace-nowrap text-sm">{s.file_name}</td><td className="text-right tabular-nums">{s.lines}</td>
                      <td className="text-right tabular-nums">{money(s.opening)}</td><td className="text-right tabular-nums">{money(s.plus_total)}</td>
                      <td className="text-right tabular-nums">{money(-s.minus_total)}</td><td className="text-right tabular-nums">{money(s.closing)}</td>
                      <td className="whitespace-nowrap text-sm text-ink-2">{s.who?.full_name ?? ""} · {formatDateTime(s.uploaded_at)}</td>
                      <td className="text-right">{canUpload && (
                        <form action={deleteBankStatement}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="statement" value={s.id} />
                          <button type="submit" className="text-sm text-danger underline">Remove</button></form>)}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </section>

            <section className="card overflow-x-auto p-0">
              <div className="px-5 pt-4">
                <h3 className="font-semibold">Transactions: {acc.name}</h3>
                <p className="text-sm text-ink-2">{lines.length} line{lines.length === 1 ? "" : "s"}. Coding each line to an account from the standard chart, with its sales tax, is step 3.</p>
              </div>
              <table className="table">
                <thead><tr><th>Date</th><th>Description</th><th className="text-right">{w.plus}</th><th className="text-right">{w.minus}</th></tr></thead>
                <tbody>{lines.map((l) => (
                  <tr key={l.id}><td className="whitespace-nowrap">{formatDate(l.txn_date)}</td><td>{l.description}</td>
                    <td className="text-right tabular-nums">{l.amount > 0 ? money(l.amount) : ""}</td><td className="text-right tabular-nums">{l.amount < 0 ? money(-l.amount) : ""}</td></tr>
                ))}</tbody>
              </table>
            </section>
          </>
        );
      })()}
    </div>
  );
}
