"use client";
// The statement upload: the account (one on the file, or a new one with its type), the file, and the
// statement's opening and closing balances.
import { useState } from "react";
import { fileInputClass } from "@/components/ds/primitives";
import { uploadBankStatement } from "../actions";
import type { BankAccount } from "@/lib/closebook/bank-server";

export function BankUploadForm({ fileId, accounts, selected }: { fileId: string; accounts: BankAccount[]; selected: string }) {
  const [account, setAccount] = useState(selected || (accounts.length ? accounts[0].id : "new"));
  const [kind, setKind] = useState<"" | "bank" | "card">("");
  const known = accounts.find((a) => a.id === account);
  const k = known?.kind ?? kind;
  return (
    <form action={uploadBankStatement} className="grid gap-4">
      <input type="hidden" name="file_id" value={fileId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="account" className="label">Account</label>
          <select id="account" name="account" value={account} onChange={(e) => setAccount(e.target.value)} className="input">
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.kind === "bank" ? "bank account" : "card or line of credit"})</option>)}
            <option value="new">New account</option>
          </select>
        </div>
        {account === "new" && (
          <div>
            <label htmlFor="name" className="label">Account name</label>
            <input id="name" name="name" required maxLength={100} placeholder="For example TD chequing 1234" className="input" />
          </div>
        )}
      </div>
      {account === "new" && (
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
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div><label htmlFor="upload" className="label">Statement file (CSV)</label><input id="upload" name="upload" type="file" accept=".csv" required className={fileInputClass} /></div>
        <div><label htmlFor="opening" className="label">Opening balance</label><input id="opening" name="opening" required inputMode="decimal" placeholder="0.00" className="input" /></div>
        <div><label htmlFor="closing" className="label">Closing balance</label><input id="closing" name="closing" required inputMode="decimal" placeholder="0.00" className="input" /></div>
      </div>
      <p className="text-xs text-muted">
        {k === "card" ? "Card or line of credit: enter the balance owing as shown on the statement. A credit balance is negative." : k === "bank" ? "Bank account: enter the balance as shown on the statement. An overdraft is negative." : "Enter the balances as shown on the statement."}
        {" "}The upload is refused unless opening + transactions = closing, to the cent.
      </p>
      <div><button type="submit" className="btn">Upload statement</button></div>
    </form>
  );
}
