"use client";
// Closebook step 3 windows (round 22, Hashim, Nov 16, 2026; mock screen 2). Every task opens a window over
// the main page and closes back to it. Benchmark: QuickBooks Online "Add an account" (the type first, then the
// name and the opening balance); placement by GIFI line as in CaseWare Cloud.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Maximize2, Minimize2, X } from "lucide-react";
import { AmountInput } from "@/components/amount";
import { accountName, nextNumber, placement, type AccountType } from "@/lib/closebook/step3";
import { useRouter } from "next/navigation";
import { saveAccount } from "../../step3-actions";
import { notify } from "@/components/save-state";
import { guarded, isLockRefusal, type Lock } from "./guard";

// Round 27 (Hashim, Nov 17, 2026): a large window can fill the page. The expand icon sits in the title bar (beside
// "..." where there is one); it switches to the full page and back. Esc returns to the normal size (not while a
// question is open over the window).
export function useExpand(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("dialog[open]")) { e.preventDefault(); setOn(false); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [on]);
  return [on, () => setOn((x) => !x)];
}
export function ExpandButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button type="button" onClick={toggle} aria-label={on ? "Back to normal size" : "Expand to the full page"} title={on ? "Back to normal size (Esc)" : "Expand"} aria-pressed={on}
      className="grid h-8 w-8 place-items-center rounded text-ink-2 hover:bg-sand-100">{on ? <Minimize2 className="h-[18px] w-[18px]" /> : <Maximize2 className="h-[18px] w-[18px]" />}</button>
  );
}

export function Win({ title, sub, closeHref, width = 620, children, footer, expandable }: { title: string; sub?: string; closeHref: string; width?: number; children: React.ReactNode; footer?: React.ReactNode; expandable?: boolean }) {
  const [big, toggle] = useExpand();
  const canExpand = expandable ?? width >= 700;
  return (
    <div className={`fixed inset-0 z-[60] grid overflow-y-auto bg-navy-950/40 ${big ? "" : "place-items-start justify-center px-4 py-10"}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className={`flex w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)] ${big ? "min-h-full" : "rounded-[var(--radius-ds)]"}`} style={big ? undefined : { maxWidth: width }}>
        <div className="flex items-center gap-3 border-b border-sand-200 px-5 py-3.5">
          <h2 className="text-[17px] font-semibold">{title}</h2>{sub && <span className="text-[13px] text-ink-3">{sub}</span>}
          <span className="flex-1" />
          {canExpand && <ExpandButton on={big} toggle={toggle} />}
          <Link href={closeHref} scroll={false} aria-label="Close" className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></Link>
        </div>
        <div className={`grid gap-4 px-5 py-4 ${big ? "flex-1 content-start" : ""}`}>{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-sand-200 bg-[#fcfbf8] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// Round 23 (Hashim): five types in one row.
const TYPES: [AccountType, string][] = [["chequing", "Chequing"], ["savings", "Savings"], ["card", "Credit card"], ["loc", "Line of credit"], ["loan", "Loan"]];
const fmt = (c: number) => (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type AddCtx = {
  fileId: string; closeHref: string; then: string; dayBefore: string; chartNumbers: string[]; taken: string[];
  t2: Record<string, number>; t2Entered: boolean;          // last year's T2 by GIFI line (cents)
  others: { gifi: string; books: number | null; id: string }[]; // the file's accounts
  edit: { id: string; number: string; type: AccountType; bank: string; last4: string; books: number | null; longTerm: boolean; hasStatements: boolean; t2Line?: string | null } | null;
  prefill: { type?: string; last4?: string; bank?: string };
  // Round 25: the balance sheet lines in step 2 that hold an amount, and GIFI names (for "Last year's T2 line").
  t2Lines?: { code: string; name: string; cents: number }[]; gifiNames?: Record<string, string>;
};

// Round 25 (rule G17 for every account edit): a change that removes a 3.1, 3.2 or 3.3 sign-off asks first; one the
// reviewer signed only the reviewer continues, and the window then shows only the refusal.
export function AddAccountWindow({ c }: { c: AddCtx; lock?: Lock }) {
  const e = c.edit;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const pre = (c.prefill.type === "card" || c.prefill.type === "loc" || c.prefill.type === "loan") ? c.prefill.type : c.prefill.type === "savings" ? "savings" : "chequing";
  const [type, setType] = useState<AccountType>(e?.type ?? (pre as AccountType));
  const [bank, setBank] = useState(e?.bank ?? c.prefill.bank ?? "");
  const [last4, setLast4] = useState(e?.last4 ?? c.prefill.last4 ?? "");
  const [long, setLong] = useState(e?.longTerm ?? false);
  const isBank = (t: AccountType) => t === "chequing" || t === "savings";
  const p = placement(type, long);
  // Round 23: the balance is typed to the cent from last year's statement (no pre-fill from the T2's whole dollars).
  const [balance, setBalance] = useState(e?.books !== null && e?.books !== undefined ? fmt(Math.abs(e.books)) : "");
  const [negative, setNegative] = useState(!!e && (e.books ?? 0) < 0);
  // Round 25 (Hashim, Nov 17, 2026): last year's T2 line. Empty follows the type's usual line (overdrawn: 2600).
  const [t2Line, setT2Line] = useState(e?.t2Line ?? "");
  const number = useMemo(() => {
    const own = e && placement(e.type, e.longTerm).base === p.base ? e.number : null;
    if (own) return own;
    return nextNumber(p.base, new Set(c.chartNumbers), new Set(c.taken.filter((t) => t !== e?.number)));
  }, [p.base, c.chartNumbers, c.taken, e]);
  const digits = last4.replace(/\D/g, "");
  const ready = bank.trim() && digits.length >= 2;
  const neg = p.kind === "bank" ? `Overdrawn on ${c.dayBefore}` : `In credit on ${c.dayBefore} (the bank owed the company)`;
  const fixed = !!e?.hasStatements;
  // Refused by a sign-off lock: the window shows only the refusal (Hashim, Nov 16, 2026).
  if (refused) return (
    <Win title="Edit account" closeHref={c.closeHref} width={520} footer={<><span className="flex-1" /><Link href={c.closeHref} scroll={false} className="btn h-9">Close</Link></>}>
      <p className="rounded-[var(--radius-ds)] border border-[#efd9a6] bg-warning-soft/60 px-4 py-3 text-[14.5px]" role="alert">{refused}</p>
    </Win>
  );
  return (
    <Win title={e ? "Edit account" : "Add account"} closeHref={c.closeHref} footer={<>
      <span className="flex-1" />
      <Link href={c.closeHref} scroll={false} className="btn-secondary">Cancel</Link>
      <button type="submit" form="add-account" disabled={!ready || busy} className="btn h-9">{e ? "Save" : "Add account"}</button>
    </>}>
      <form id="add-account" className="grid gap-4" onSubmit={async (ev) => {
        ev.preventDefault();
        const fd = new FormData(ev.currentTarget);
        setBusy(true);
        try {
          const r = await guarded((confirm) => saveAccount(fd, confirm));
          if (!r) return;
          if (!r.ok) { if (isLockRefusal(r.error)) setRefused(r.error); else notify(r.error, "error"); return; }
          router.push(r.then, { scroll: false }); router.refresh();
        } finally { setBusy(false); }
      }}>
        <input type="hidden" name="file_id" value={c.fileId} />
        {e && <input type="hidden" name="account" value={e.id} />}
        <input type="hidden" name="back" value={`${c.closeHref}${c.closeHref.includes("?") ? "&" : "?"}add=1${e ? `&edit=${e.id}` : ""}`} />
        <input type="hidden" name="then" value={c.then} />
        <input type="hidden" name="type" value={type} />
        <div className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Type</span>
          <span className="inline-flex w-fit overflow-hidden rounded-lg border border-sand-300" role="radiogroup" aria-label="Type">
            {TYPES.map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={type === k} disabled={fixed && isBank(k) !== isBank(type)} onClick={() => setType(k)}
                className={`px-3.5 py-2 text-[13.5px] font-semibold [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-200 ${type === k ? "bg-navy-800 text-white" : "text-ink-2 hover:bg-sand-50"} disabled:opacity-40`}>{l}</button>
            ))}
          </span>
          {(type === "loc" || type === "loan") && (
            <label className="mt-1 inline-flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="long_term" checked={long} onChange={(x) => setLong(x.target.checked)} className="h-4 w-4" />
              Long-term (not due within a year)</label>
          )}
        </div>
        <div className="grid gap-3.5 sm:grid-cols-[1fr_10rem]">
          <label className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Bank</span>
            <input name="bank" value={bank} onChange={(x) => setBank(x.target.value)} maxLength={40} required placeholder="For example: RBC" className="input h-9" /></label>
          <label className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Last 4 digits</span>
            <input name="last4" value={last4} onChange={(x) => setLast4(x.target.value)} maxLength={12} required inputMode="numeric" placeholder="1234" className="input h-9" /></label>
        </div>
        <div className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Balance at last year end ({c.dayBefore}), to the cent</span>
          <AmountInput name="balance" value={balance} onValue={setBalance} className="input h-9 w-[14rem] text-right" placeholder="0.00" aria-label="Balance at last year end" />
          <label className="inline-flex items-center gap-2 text-[13.5px]"><input type="checkbox" name="negative" checked={negative} onChange={(x) => setNegative(x.target.checked)} className="h-4 w-4" />{neg}</label>
        </div>
        {(() => {
          const usual = p.kind === "bank" && negative ? "2600" : p.gifi;
          const nameOf = (code: string) => c.gifiNames?.[code] ?? c.t2Lines?.find((x) => x.code === code)?.name ?? (code === p.gifi ? p.gifiName : "");
          const others = (c.t2Lines ?? []).filter((x) => x.code !== usual);
          return (
            <label className="grid gap-1.5"><span className="text-[12px] font-semibold text-ink-2">Last year&rsquo;s T2 line</span>
              <select name="t2_line" aria-label="Last year's T2 line" value={t2Line === usual ? "" : t2Line} onChange={(x) => setT2Line(x.target.value)} className="input h-9 w-full max-w-[30rem]">
                <option value="">{usual} {nameOf(usual)} (usual for this type)</option>
                {others.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name} · {fmt(x.cents)}</option>)}
              </select>
              <span className="text-[12px] text-ink-3">The line this account was on in last year&rsquo;s T2. This year&rsquo;s line does not change here: match it in step 8.</span></label>
          );
        })()}
        <p className="rounded-[var(--radius-ds)] border border-success/30 bg-success-soft px-3.5 py-2.5 text-[13.5px] text-[#14532d]">
          {e ? "Saves as" : "Creates"} <b>{number} {accountName(type, long, bank || "Bank", digits || "0000")}</b></p>
        {fixed && <p className="text-[12.5px] text-ink-3">This account has statements: it can change between chequing and savings, or among card, line of credit and loan, but not between a bank account and the others.</p>}
      </form>
    </Win>
  );
}
