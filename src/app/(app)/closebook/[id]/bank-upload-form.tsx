"use client";
// One statement upload (Hashim, Nov 13, 2026): the file is read in the browser as soon as it is chosen,
// so the statement period fills in from its first and last dates (for the preparer to confirm) and the
// balance check shows before uploading. The server reads the file again and the database checks again.
import { useState } from "react";
import { fileInputClass } from "@/components/ds/primitives";
import { balanceCheck, dollars, flipRows, looksReversed, readBankUpload, REVERSED, typedCents, type BankRow } from "@/lib/closebook/bank-upload";
import { findDuplicatesInline, uploadBankStatement } from "../actions";
import type { BankAccount } from "@/lib/closebook/bank-server";

export function BankUploadForm({ fileId, account, nextOpening }: { fileId: string; account: BankAccount | null; nextOpening: number | null }) {
  const [kind, setKind] = useState<"" | "bank" | "card">("");
  const [rows, setRows] = useState<BankRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [opening, setOpening] = useState(nextOpening === null ? "" : nextOpening.toFixed(2));
  const [closing, setClosing] = useState("");
  // The signs turned over by "Flip signs and re-check"; the flipped lines must still tie to the cent.
  const [flip, setFlip] = useState(false);
  // Lines already in the file on any account (round 2 item 5), and the preparer's "they are real".
  const [dups, setDups] = useState<Awaited<ReturnType<typeof findDuplicatesInline>>>([]);
  const [dupOk, setDupOk] = useState(false);
  const k = account?.kind ?? kind;

  const onFile = async (f: File | undefined) => {
    setRows(null); setErrors([]); setFlip(false); setDups([]); setDupOk(false);
    if (!f) return;
    const r = readBankUpload(await f.text());
    setErrors(r.errors.slice(0, 5));
    if (!r.errors.length) {
      setRows(r.rows);
      setDups(await findDuplicatesInline(fileId, r.rows));
      const d = r.rows.map((x) => x.date).sort();
      setPeriod({ start: d[0], end: d[d.length - 1] });
    }
  };
  const o = typedCents(opening), c = typedCents(closing);
  const used = rows && flip ? flipRows(rows) : rows;
  const chk = used && o !== null && c !== null ? balanceCheck(o, c, used) : null;
  const reversed = !!(used && o !== null && c !== null && looksReversed(o, c, used));

  return (
    <form action={uploadBankStatement} className="grid gap-4">
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="account" value={account?.id ?? "new"} />
      <input type="hidden" name="flip" value={flip ? "1" : ""} />
      <input type="hidden" name="dup_ok" value={dupOk ? "1" : ""} />
      {!account && (
        <>
          <div className="max-w-md">
            <label htmlFor="name" className="label">Account name</label>
            <input id="name" name="name" required maxLength={100} placeholder="For example TD chequing 1234" className="input" />
          </div>
          <fieldset>
            <legend className="label">Account type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {([["bank", "Bank account", "Money in is positive, money out is negative."], ["card", "Credit card or line of credit", "Charges are positive, payments are negative."]] as const).map(([v, l, h]) => (
                <label key={v} className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm ${kind === v ? "border-navy-700 bg-navy-50" : "border-sand-200"}`}>
                  <input type="radio" name="kind" value={v} required checked={kind === v} onChange={() => setKind(v)} className="mt-0.5 h-4 w-4 accent-accent" />
                  <span><span className="font-medium">{l}</span><br /><span className="text-ink-2">{h}</span></span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <div>
        <label htmlFor="upload" className="label">Statement file (CSV): one month or the whole year</label>
        <input id="upload" name="upload" type="file" accept=".csv" required className={fileInputClass} onChange={(e) => onFile(e.target.files?.[0])} />
        {rows && <p className="mt-1 text-sm text-ink-2">{rows.length} transactions read, {period.start} to {period.end}.</p>}
        {/* A card file uploaded as a bank account reads backwards: purchases as money in (Hashim's test). */}
        {!reversed && !flip && rows && k === "bank" && rows.filter((r) => r.cents > 0).length > rows.length * 0.7 && (
          <p className="mt-1 text-sm text-warning">Most lines are positive. On a bank account that means money in. If this is a credit card statement, choose Credit card or line of credit.</p>)}
        {!reversed && !flip && rows && k === "card" && rows.filter((r) => r.cents < 0).length > rows.length * 0.7 && (
          <p className="mt-1 text-sm text-warning">Most lines are negative. On a card that means payments. If this is a bank statement, choose Bank account.</p>)}
        {errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        {dups.length > 0 && (
          <div role="alert" className="mt-2 grid gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm">
            <p className="font-semibold text-danger">{dups.length} of {rows?.length} lines are already in this file. Uploading them again counts them twice.</p>
            <div className="max-h-48 overflow-y-auto"><table className="w-full text-xs">
              <thead><tr className="text-left text-ink-3"><th className="pr-2">Row</th><th className="pr-2">Date</th><th className="pr-2">Description</th><th className="pr-2 text-right">Amount</th><th>Already on</th></tr></thead>
              <tbody>{dups.map((d, i) => <tr key={i}><td className="pr-2 tabular-nums">{d.row_no}</td><td className="pr-2 tabular-nums">{d.txn_date}</td><td className="pr-2">{d.description}</td>
                <td className="pr-2 text-right tabular-nums">{Number(d.amount).toLocaleString("en-CA", { minimumFractionDigits: 2 })}</td><td>{d.account_name}</td></tr>)}</tbody>
            </table></div>
            <p className="text-ink-2">Most often the same file was uploaded twice, or to the wrong account. Remove it by choosing another file, or if these are real (two equal charges on the same day), confirm:</p>
            <label className="flex items-center gap-2"><input type="checkbox" checked={dupOk} onChange={(e) => setDupOk(e.target.checked)} className="h-4 w-4" />These are real transactions: upload them</label>
          </div>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label htmlFor="period_start" className="label">Statement period from</label>
          <input id="period_start" name="period_start" type="date" required value={period.start} onChange={(e) => setPeriod({ ...period, start: e.target.value })} className="input" /></div>
        <div><label htmlFor="period_end" className="label">to</label>
          <input id="period_end" name="period_end" type="date" required value={period.end} onChange={(e) => setPeriod({ ...period, end: e.target.value })} className="input" /></div>
        <div><label htmlFor="opening" className="label">Opening balance</label>
          <input id="opening" name="opening" required inputMode="decimal" placeholder="0.00" value={opening} onChange={(e) => setOpening(e.target.value)} className="input" /></div>
        <div><label htmlFor="closing" className="label">Closing balance</label>
          <input id="closing" name="closing" required inputMode="decimal" placeholder="0.00" value={closing} onChange={(e) => setClosing(e.target.value)} className="input" /></div>
      </div>
      <p className="text-xs text-muted">
        Check the period against the statement: the file only knows its first and last transaction. {k === "card" ? "Card or line of credit: the balance owing; a credit balance is negative." : k === "bank" ? "Bank account: an overdraft is negative." : ""}
        {nextOpening !== null && " The opening is filled from the last statement's closing."}
      </p>
      {chk && (chk.ok
        ? <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">Balances to the cent{flip ? ", with the signs flipped" : ""}: {dollars(o!)} {chk.totalCents < 0 ? "−" : "+"} {dollars(Math.abs(chk.totalCents))} = {dollars(c!)}.</p>
        : reversed
          ? <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-sm">
              <span>{REVERSED}</span>
              <button type="button" className="btn-secondary" onClick={() => setFlip(true)}>Flip signs and re-check</button>
            </div>
          : <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">Does not balance: {dollars(o!)} {chk.totalCents < 0 ? "−" : "+"} {dollars(Math.abs(chk.totalCents))} = {dollars(chk.expectedCents)}, but the closing is {dollars(c!)}. Difference {dollars(chk.differenceCents)}.</p>)}
      <div className="flex items-center gap-3"><button type="submit" className="btn" disabled={(!!chk && !chk.ok) || (dups.length > 0 && !dupOk)}>Upload statement</button>
        {flip && <button type="button" className="text-sm text-navy-700 underline" onClick={() => setFlip(false)}>Undo the flip</button>}</div>
    </form>
  );
}
