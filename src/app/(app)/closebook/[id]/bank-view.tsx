// Step 2, Get the records, for files built from bank and card CSVs (Hashim, Nov 13, 2026; mockup
// step 2): one tile per account like QuickBooks' bank cards, with "+ Add account". The chosen account
// shows its months for the file's year, its statements and its transactions. A file may hold one month
// or a whole year; every upload must balance to the cent.
import { Fragment } from "react";
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { BankData, BankStatement } from "@/lib/closebook/bank-server";
import { accountCoverage, type MonthState } from "@/lib/closebook/coverage";
import { deleteBankStatement } from "../actions";
import { BankUploadForm } from "./bank-upload-form";
import { SidePanel } from "./side-panel";
import { bracketAmount, negativeTone } from "@/lib/closebook/amount";

// Dollars: a negative in brackets, ($1,234.00); in a table cell in red too (Hashim, Nov 15, 2026, item C).
const money = (v: number) => { const t = Math.abs(v).toLocaleString("en-CA", { style: "currency", currency: "CAD" }); return v < 0 ? `(${t})` : t; };
const Money = ({ v }: { v: number }) => <span className={negativeTone(v)}>{money(v)}</span>;
// Round 20: the conversion record of a statement read from a PDF or photo (benchmark: QuickBooks Online keeps
// the PDF with the imported statement; we also keep who, when, model, pages, cost and the checks at import).
const MODEL_NAME: Record<string, string> = { "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-sonnet-5": "Claude Sonnet 5", fixture: "the test reader" };
const cents = (c: number) => bracketAmount(c);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
function ConversionRecord({ s }: { s: BankStatement }) {
  if (s.source !== "pdf") return null;
  const k = s.check_result, e = s.edits;
  const model = s.model ? MODEL_NAME[s.model] ?? s.model : "the statement reader";
  const changes: string[] = [];
  if (e?.edited) changes.push(`${e.edited} edited`);
  if (e?.added) changes.push(`${e.added} added`);
  if (e?.deleted) changes.push(`${e.deleted} removed`);
  const summary = (ok: boolean | null) => (ok === null ? "no printed total" : ok ? "matches the statement" : "does not match the statement");
  return (
    <details className="text-xs text-ink-2">
      <summary className="cursor-pointer text-navy-700">Conversion record</summary>
      <ul className="mt-1 max-w-4xl list-disc space-y-0.5 whitespace-normal pl-5">
        <li>Read by {model}{s.converted_at ? ` on ${formatDateTime(s.converted_at)}` : ""}{s.conv ? `, uploaded by ${s.conv.full_name}` : ""}.</li>
        <li>{plural(s.pages ?? 0, "page", "pages")} · cost {s.cost_usd == null ? "not recorded" : `US$${s.cost_usd.toFixed(4)}`} (US-only processing){s.input_tokens != null ? ` · ${s.input_tokens.toLocaleString("en-CA")} tokens in, ${(s.output_tokens ?? 0).toLocaleString("en-CA")} out` : ""}</li>
        {k && <li>Checks at import: difference {cents(k.differenceCents)}; money in {summary(k.summaryOk.in)}; money out {summary(k.summaryOk.out)}; running balance {k.runningBreak ? "stopped matching on one line, kept after review" : "matched on every line"}{k.review ? `; ${plural(k.review, "line", "lines")} looked at in For review` : ""}.</li>}
        {k?.warnings?.length ? <li>Warnings shown: {k.warnings.join(" ")}</li> : null}
        <li>Changed before import: {changes.length ? changes.join(", ") : "nothing"}.</li>
        {s.statement_import_id && <li><Link href={`/statements/${s.statement_import_id}`} className="text-navy-700 underline">Open the PDF and the lines as imported</Link></li>}
      </ul>
    </details>
  );
}

const MONTH: Record<MonthState, { cls: string; word: string }> = {
  in: { cls: "border-success/40 bg-success-soft text-success", word: "in" },
  part: { cls: "border-warning/50 bg-warning-soft text-warning", word: "part" },
  empty: { cls: "border-warning/50 bg-warning-soft text-warning", word: "no lines" },
  check: { cls: "border-warning/50 bg-warning-soft text-warning", word: "check" },
  missing: { cls: "border-dashed border-sand-300 bg-surface text-ink-3", word: "" },
};

export function BankView({ fileId, bank, editable, locked, yearStart, yearEnd, upload, error, dups = [] }: {
  fileId: string; bank: BankData; editable: boolean; locked: boolean; yearStart: string; yearEnd: string;
  dups?: { txn_date: string; description: string; amount: number; times: number; accounts: string }[];
  upload: string | null; error: string | null;   // the side panel: "new", an account id, or closed
}) {
  const { accounts, statements, selected } = bank;
  const cov = new Map(accounts.map((a) => [a.id, accountCoverage(yearStart, yearEnd, statements.filter((s) => s.account_id === a.id), bank.txnMonths.get(a.id) ?? new Set())]));
  const acc = accounts.find((a) => a.id === selected);
  const words = (kind: string) => (kind === "card" ? { plus: "Charges", minus: "Payments" } : { plus: "Money in", minus: "Money out" });
  const canUpload = editable && !locked;
  const link = (a: string) => `/closebook/${fileId}?step=records&account=${a}`;
  const panelAcc = upload && upload !== "new" ? accounts.find((a) => a.id === upload) ?? null : null;
  const panelOpen = canUpload && (upload === "new" || !!panelAcc);
  const closeHref = acc ? link(acc.id) : `/closebook/${fileId}?step=records`;

  return (
    <div className="grid gap-4">
      {bank.error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{bank.error}</p>}
      {/* Lines already in the file more than once (round 3 item 3): the same check as at upload. */}
      {dups.length > 0 && (
        <section role="alert" className="card grid gap-2 border-danger/30 p-0">
          <p className="px-4 pt-3 text-sm"><b className="text-danger">{dups.reduce((n, d) => n + d.times - 1, 0)} lines are in this file twice</b> (same date, description and amount). Each one counts twice until a copy is removed.
            If a statement went to the wrong account, remove it in that account&rsquo;s statement list below.</p>
          <div className="max-h-64 overflow-y-auto">
            <table className="table table-compact">
              <thead><tr><th>Date</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">Times</th><th>On</th></tr></thead>
              <tbody>{dups.map((d, i) => <tr key={i}><td className="tabular-nums">{d.txn_date}</td><td>{d.description}</td>
                <td className="text-right tabular-nums">{Number(d.amount).toLocaleString("en-CA", { minimumFractionDigits: 2 })}</td><td className="text-right">{d.times}</td><td>{d.accounts}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
              <span className="mt-1 grid grid-cols-12 gap-0.5" aria-label={`${c.inCount} of ${c.months.length} months in`}>
                {c.months.map((m) => (
                  <span key={m.key} title={`${m.label}: ${m.state === "missing" ? "not uploaded" : m.state}`}
                    className={`flex h-5 items-center justify-center rounded border text-[9px] font-medium ${MONTH[m.state].cls}`}>{m.label[0]}</span>
                ))}
              </span>
              <span className="flex justify-between gap-2 text-xs text-ink-2"><span>{c.inCount} of {c.months.length} months in</span>
                <span>{c.latestClosing === null ? "" : <>Closing <Money v={c.latestClosing} /></>}</span></span>
            </Link>
          );
        })}
        {canUpload && (
          <Link href={`${closeHref}&upload=new`} scroll={false}
            className="card flex min-h-[112px] items-center justify-center border-dashed p-4 text-sm font-semibold text-navy-700 hover:border-navy-300">
            + Add account
          </Link>
        )}
      </div>


      {acc && (() => {
        const c = cov.get(acc.id)!;
        const sts = statements.filter((s) => s.account_id === acc.id);
        const w = words(acc.kind);
        return (
          <>
            <section className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">{acc.name}</h2>
                <p className="text-sm text-ink-2">{c.complete ? "Every month is in." : `Still to look at: ${c.gaps.join(", ")}.`}</p>
              </div>
              {canUpload && <Link href={`${link(acc.id)}&upload=${acc.id}`} scroll={false} className="btn">Upload a statement</Link>}
            </section>

            <section className="card overflow-x-auto p-0">
              <h3 className="px-5 pt-4 font-semibold">Statements</h3>
              <table className="table">
                <thead><tr><th>Period</th><th>File</th><th className="text-right">Lines</th><th className="text-right">Opening</th><th className="text-right">{w.plus}</th><th className="text-right">{w.minus}</th><th className="text-right">Closing</th><th>Uploaded</th><th></th></tr></thead>
                <tbody>{sts.map((s, i) => {
                  const prev = sts[i - 1];
                  const gap = prev && Math.round((s.opening - prev.closing) * 100) !== 0;
                  return (
                    <Fragment key={s.id}>
                    <tr className={s.source === "pdf" ? "[&>td]:border-b-0" : undefined}>
                      <td className="whitespace-nowrap">{formatDate(s.period_start)} to {formatDate(s.period_end)}
                        {gap && <div className="text-xs text-warning">Opening differs from the last closing ({money(prev.closing)}) by {money(s.opening - prev.closing)}. A statement may be missing.</div>}</td>
                      <td className="whitespace-nowrap text-sm">{s.file_name}{s.source === "pdf" && <div className="text-xs text-ink-3">PDF</div>}</td><td className="text-right tabular-nums">{s.lines}</td>
                      <td className="text-right tabular-nums"><Money v={s.opening} /></td><td className="text-right tabular-nums"><Money v={s.plus_total} /></td>
                      <td className="text-right tabular-nums"><Money v={-s.minus_total} /></td><td className="text-right tabular-nums"><Money v={s.closing} /></td>
                      <td className="whitespace-nowrap text-sm text-ink-2">{s.who?.full_name ?? ""} · {formatDateTime(s.uploaded_at)}</td>
                      <td className="text-right">{canUpload && (
                        <form action={deleteBankStatement}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="statement" value={s.id} />
                          <button type="submit" className="text-sm text-danger underline">Remove</button></form>)}</td>
                    </tr>
                    {s.source === "pdf" && <tr><td colSpan={9} className="pt-0"><ConversionRecord s={s} /></td></tr>}
                    </Fragment>
                  );
                })}</tbody>
              </table>
            </section>

          </>
        );
      })()}

      {panelOpen && (
        <SidePanel title={panelAcc ? `Upload a statement: ${panelAcc.name}` : "Add an account"} closeHref={closeHref}>
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <p className="text-sm text-ink-2">Template: Date, Description, Amount. <a href="/templates/Concept-bank-upload-template.csv" download className="text-navy-700 underline">Download the template</a></p>
          <BankUploadForm fileId={fileId} account={panelAcc} nextOpening={panelAcc ? cov.get(panelAcc.id)!.latestClosing : null} />
        </SidePanel>
      )}
    </div>
  );
}
