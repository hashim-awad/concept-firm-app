"use client";
// Closebook step 3 windows (round 22, Hashim, Nov 16, 2026; mock screen 2). Every task opens a window over
// the main page and closes back to it. Benchmark: QuickBooks Online "Add an account" (the type first, then the
// name and the opening balance); placement by GIFI line as in CaseWare Cloud.
import { useMemo, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { AmountInput } from "@/components/amount";
import { accountName, nextNumber, placement, type AccountType } from "@/lib/closebook/step3";
import { saveBankAccount } from "../../step3-actions";

export function Win({ title, sub, closeHref, width = 620, children, footer }: { title: string; sub?: string; closeHref: string; width?: number; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-y-auto bg-navy-950/40 px-4 py-10" role="dialog" aria-modal="true" aria-label={title}>
      <div className="flex w-full flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]" style={{ maxWidth: width }}>
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3.5">
          <h2 className="text-[17px] font-semibold">{title}</h2>{sub && <span className="text-[13px] text-ink-3">{sub}</span>}
          <span className="flex-1" />
          <Link href={closeHref} scroll={false} aria-label="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></Link>
        </div>
        <div className="grid gap-4 px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-sand-200 bg-[#fcfbf8] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

const TYPES: [string, string][] = [["bank", "Bank account"], ["card", "Credit card"], ["loc", "Line of credit"], ["loan", "Loan"]];
const fmt = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type AddCtx = {
  fileId: string; closeHref: string; then: string; dayBefore: string; chartNumbers: string[]; taken: string[];
  t2: Record<string, number>; t2Entered: boolean;          // last year's T2 by GIFI line (cents)
  others: { gifi: string; books: number | null; id: string }[]; // the file's accounts
  edit: { id: string; number: string; type: AccountType; bank: string; last4: string; books: number | null; longTerm: boolean; hasStatements: boolean } | null;
  prefill: { type?: string; last4?: string; bank?: string };
};

export function AddAccountWindow({ c }: { c: AddCtx }) {
  const e = c.edit;
  const pre = (c.prefill.type === "card" || c.prefill.type === "loc" || c.prefill.type === "loan") ? c.prefill.type : c.prefill.type === "savings" ? "savings" : "chequing";
  const [type, setType] = useState<AccountType>(e?.type ?? (pre as AccountType));
  const [bank, setBank] = useState(e?.bank ?? c.prefill.bank ?? "");
  const [last4, setLast4] = useState(e?.last4 ?? c.prefill.last4 ?? "");
  const [long, setLong] = useState(e?.longTerm ?? false);
  const group = type === "chequing" || type === "savings" ? "bank" : type;
  const p = placement(type, long);
  // What is left on the GIFI line once the other accounts on it are counted: the balance to start from.
  const onLine = c.others.filter((o) => o.gifi === p.gifi && o.id !== e?.id).reduce((n, o) => n + (o.books ?? 0), 0);
  const t2 = c.t2[p.gifi] ?? 0;
  const left = t2 - onLine;
  const [balance, setBalance] = useState(e?.books !== null && e?.books !== undefined ? fmt(Math.abs(e.books)) : c.t2Entered && left > 0 ? fmt(left) : "");
  const [negative, setNegative] = useState(!!e && (e.books ?? 0) < 0);
  const number = useMemo(() => {
    const own = e && placement(e.type, e.longTerm).base === p.base ? e.number : null;
    if (own) return own;
    return nextNumber(p.base, new Set(c.chartNumbers), new Set(c.taken.filter((t) => t !== e?.number)));
  }, [p.base, c.chartNumbers, c.taken, e]);
  const digits = last4.replace(/\D/g, "");
  const ready = bank.trim() && digits.length >= 2;
  const neg = p.kind === "bank" ? `Overdrawn on ${c.dayBefore}` : `In credit on ${c.dayBefore} (the bank owed the company)`;
  const fixed = !!e?.hasStatements;
  return (
    <Win title={e ? "Edit account" : "Add account"} closeHref={c.closeHref} footer={<>
      <span className="flex-1" />
      <Link href={c.closeHref} scroll={false} className="btn-secondary">Cancel</Link>
      <button type="submit" form="add-account" disabled={!ready} className="btn h-9">{e ? "Save" : "Add account"}</button>
    </>}>
      <form id="add-account" action={saveBankAccount} className="grid gap-4">
        <input type="hidden" name="file_id" value={c.fileId} />
        {e && <input type="hidden" name="account" value={e.id} />}
        <input type="hidden" name="back" value={`${c.closeHref}${c.closeHref.includes("?") ? "&" : "?"}add=1${e ? `&edit=${e.id}` : ""}`} />
        <input type="hidden" name="then" value={c.then} />
        <input type="hidden" name="type" value={type} />
        <div className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Type</span>
          <span className="inline-flex w-fit overflow-hidden rounded-lg border border-sand-300" role="radiogroup" aria-label="Type">
            {TYPES.map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={group === k} disabled={fixed && (k === "bank") !== (group === "bank")}
                onClick={() => setType(k === "bank" ? (type === "savings" ? "savings" : "chequing") : (k as AccountType))}
                className={`px-3.5 py-2 text-[13.5px] font-semibold [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-200 ${group === k ? "bg-navy-800 text-white" : "text-ink-2 hover:bg-sand-50"} disabled:opacity-40`}>{l}</button>
            ))}
          </span>
          {group === "bank" && (
            <span className="mt-1 inline-flex gap-4 text-[13.5px]" role="radiogroup" aria-label="Chequing or savings">
              {(["chequing", "savings"] as const).map((k) => <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={type === k} onChange={() => setType(k)} className="h-4 w-4" />{k === "chequing" ? "Chequing" : "Savings"}</label>)}
            </span>
          )}
          {(type === "loc" || type === "loan") && (
            <label className="mt-1 inline-flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="long_term" checked={long} onChange={(x) => setLong(x.target.checked)} className="h-4 w-4" />
              Long-term (not due within a year)</label>
          )}
        </div>
        <div className="grid gap-3.5 sm:grid-cols-[1fr_10rem]">
          <label className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Bank</span>
            <input name="bank" value={bank} onChange={(x) => setBank(x.target.value)} maxLength={40} required placeholder="For example: RBC" className="input h-9" /></label>
          <label className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Last digits</span>
            <input name="last4" value={last4} onChange={(x) => setLast4(x.target.value)} maxLength={12} required inputMode="numeric" placeholder="1234" className="input h-9" /></label>
        </div>
        <div className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Balance in the books on {c.dayBefore}</span>
          <AmountInput name="balance" value={balance} onValue={setBalance} className="input h-9 w-[14rem] text-right" placeholder="0.00" aria-label={`Balance in the books on ${c.dayBefore}`} />
          <span className="text-[12px] text-ink-3">Enter it as a positive number. {p.kind === "bank" ? "If the account was overdrawn, tick below." : "Enter what was owed."}</span>
          <label className="inline-flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="negative" checked={negative} onChange={(x) => setNegative(x.target.checked)} className="h-4 w-4" />{neg}</label>
        </div>
        {c.t2Entered && (
          <p className="rounded-[10px] border border-navy-100 bg-navy-50 px-3.5 py-2.5 text-[13px] leading-relaxed">
            Step 2 has <b>{fmt(t2)}</b> on T2 line {p.gifi}. {onLine ? <>The other accounts on it hold <b>{fmt(onLine)}</b>. Left for this one: <b>{fmt(Math.max(left, 0))}</b>.</> : <>No other account is on it yet.</>}
            {" "}If the accounts do not add up to {fmt(t2)}, the {p.gifi} tie line on the page shows the difference.</p>
        )}
        <p className="rounded-[10px] border border-success/30 bg-success-soft px-3.5 py-2.5 text-[13px] text-[#14532d]">
          {e ? "Saves as" : "Creates"} <b>{number} {accountName(type, long, bank || "Bank", digits || "0000")}</b> under GIFI {p.gifi} {p.gifiName}.{p.kind === "bank" ? " If its balance is negative at year end, it moves to 2600 Bank overdraft." : ""}</p>
        <p className="text-[12.5px] text-ink-3">This adds the account to this file only. The standard chart does not change.</p>
        {fixed && <p className="text-[12.5px] text-ink-3">This account has statements: it can change between chequing and savings, or among card, line of credit and loan, but not between a bank account and the others.</p>}
      </form>
    </Win>
  );
}
