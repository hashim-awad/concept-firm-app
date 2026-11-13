"use client";
// One statement upload (Hashim, Nov 13, 2026): the file is read in the browser as soon as it is chosen,
// so the statement period fills in from its first and last dates (for the preparer to confirm) and the
// balance check shows before uploading. The server reads the file again and the database checks again.
import { useState } from "react";
import { fileInputClass } from "@/components/ds/primitives";
import { balanceCheck, dollars, readBankUpload, typedCents, type BankRow } from "@/lib/closebook/bank-upload";
import { uploadBankStatement } from "../actions";
import type { BankAccount } from "@/lib/closebook/bank-server";

export function BankUploadForm({ fileId, account, nextOpening }: { fileId: string; account: BankAccount | null; nextOpening: number | null }) {
  const [kind, setKind] = useState<"" | "bank" | "card">("");
  const [rows, setRows] = useState<BankRow[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [period, setPeriod] = useState({ start: "", end: "" });
  const [opening, setOpening] = useState(nextOpening === null ? "" : nextOpening.toFixed(2));
  const [closing, setClosing] = useState("");
  const k = account?.kind ?? kind;

  const onFile = async (f: File | undefined) => {
    setRows(null); setErrors([]);
    if (!f) return;
    const r = readBankUpload(await f.text());
    setErrors(r.errors.slice(0, 5));
    if (!r.errors.length) {
      setRows(r.rows);
      const d = r.rows.map((x) => x.date).sort();
      setPeriod({ start: d[0], end: d[d.length - 1] });
    }
  };
  const o = typedCents(opening), c = typedCents(closing);
  const chk = rows && o !== null && c !== null ? balanceCheck(o, c, rows) : null;

  return (
    <form action={uploadBankStatement} className="grid gap-4">
      <input type="hidden" name="file_id" value={fileId} />
      <input type="hidden" name="account" value={account?.id ?? "new"} />
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
        {errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm text-danger">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
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
        ? <p className="rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">Balances to the cent: {dollars(o!)} + {dollars(chk.totalCents)} = {dollars(c!)}.</p>
        : <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">Does not balance: {dollars(o!)} + {dollars(chk.totalCents)} = {dollars(chk.expectedCents)}, but the closing is {dollars(c!)}. Difference {dollars(chk.differenceCents)}.</p>)}
      <div><button type="submit" className="btn">Upload statement</button></div>
    </form>
  );
}
