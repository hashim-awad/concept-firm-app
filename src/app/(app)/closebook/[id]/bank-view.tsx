// Transactions view, first piece (part 2b; Hashim, Nov 13, 2026): bank and card statements uploaded in
// Concept's bank upload template, each checked opening + transactions = closing, and their lines.
// Coding each line to a GIFI line, with vendor rules, comes next.
import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { BankData } from "@/lib/closebook/bank-server";
import { deleteBankStatement } from "../actions";
import { BankUploadForm } from "./bank-upload-form";

const money = (v: number) => v.toLocaleString("en-CA", { style: "currency", currency: "CAD" });

export function BankView({ fileId, bank, editable, locked }: { fileId: string; bank: BankData; editable: boolean; locked: boolean }) {
  const { accounts, statements, lines, selected } = bank;
  const acc = accounts.find((a) => a.id === selected);
  const words = (kind: string) => (kind === "card" ? { plus: "Charges", minus: "Payments" } : { plus: "Money in", minus: "Money out" });
  return (
    <div className="grid gap-4">
      {bank.error && <p className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{bank.error}</p>}
      {editable && !locked && (
        <section className="card grid gap-3">
          <div>
            <h2 className="font-semibold">Upload a bank or card statement</h2>
            <p className="text-sm text-ink-2">One statement per upload, in Concept&rsquo;s bank upload template: Date (YYYY-MM-DD), Description, Amount. Signs as in QuickBooks. <a href="/templates/Concept-bank-upload-template.csv" download className="text-navy-700 underline">Download the template</a></p>
          </div>
          <BankUploadForm fileId={fileId} accounts={accounts} selected={selected} />
        </section>
      )}
      {accounts.length === 0 ? <p className="card text-sm text-ink-2">No statements yet.</p> : accounts.map((a) => {
        const sts = statements.filter((s) => s.account_id === a.id);
        const w = words(a.kind);
        return (
          <section key={a.id} className="card overflow-x-auto p-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
              <h3 className="font-semibold">{a.name} <span className="text-sm font-normal text-ink-2">· {a.kind === "bank" ? "Bank account" : "Credit card or line of credit"}</span></h3>
              {a.id !== selected && <Link href={`/closebook/${fileId}?tab=tb&view=transactions&account=${a.id}`} className="text-sm text-navy-700 underline">Show transactions</Link>}
            </div>
            <table className="table">
              <thead><tr><th>Dates</th><th>File</th><th className="text-right">Lines</th><th className="text-right">Opening</th><th className="text-right">{w.plus}</th><th className="text-right">{w.minus}</th><th className="text-right">Closing</th><th>Uploaded</th><th></th></tr></thead>
              <tbody>{sts.map((s, i) => {
                const prev = sts[i - 1];
                const gap = prev && Math.round((s.opening - prev.closing) * 100) !== 0;
                return (
                  <tr key={s.id}>
                    <td className="whitespace-nowrap">{formatDate(s.first_date)} to {formatDate(s.last_date)}
                      {gap && <div className="text-xs text-warning">Opening differs from the last closing ({money(prev.closing)}) by {money(s.opening - prev.closing)}. A statement may be missing.</div>}</td>
                    <td className="whitespace-nowrap text-sm">{s.file_name}</td><td className="text-right tabular-nums">{s.lines}</td>
                    <td className="text-right tabular-nums">{money(s.opening)}</td><td className="text-right tabular-nums">{money(s.plus_total)}</td>
                    <td className="text-right tabular-nums">{money(-s.minus_total)}</td><td className="text-right tabular-nums">{money(s.closing)}</td>
                    <td className="whitespace-nowrap text-sm text-ink-2">{s.who?.full_name ?? ""} · {formatDateTime(s.uploaded_at)}</td>
                    <td className="text-right">{editable && !locked && (
                      <form action={deleteBankStatement}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="statement" value={s.id} />
                        <button type="submit" className="text-sm text-danger underline">Remove</button></form>)}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </section>
        );
      })}
      {acc && (
        <section className="card overflow-x-auto p-0">
          <div className="px-5 pt-4">
            <h3 className="font-semibold">Transactions: {acc.name}</h3>
            <p className="text-sm text-ink-2">{lines.length} line{lines.length === 1 ? "" : "s"}. Coding each line to a GIFI line, with vendor rules, comes next.</p>
          </div>
          <table className="table">
            <thead><tr><th>Date</th><th>Description</th><th className="text-right">{words(acc.kind).plus}</th><th className="text-right">{words(acc.kind).minus}</th></tr></thead>
            <tbody>{lines.map((l) => (
              <tr key={l.id}><td className="whitespace-nowrap">{formatDate(l.txn_date)}</td><td>{l.description}</td>
                <td className="text-right tabular-nums">{l.amount > 0 ? money(l.amount) : ""}</td><td className="text-right tabular-nums">{l.amount < 0 ? money(-l.amount) : ""}</td></tr>
            ))}</tbody>
          </table>
        </section>
      )}
    </div>
  );
}
