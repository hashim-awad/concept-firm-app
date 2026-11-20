"use client";
// Round 31, step 4 (Hashim, Nov 17, 2026): bank rules as QuickBooks Online has them. The client's Rules page (priority
// order, drag to reorder, Edit, Copy, Disable, Delete, New rule) and the "Create rule" pane on the right.
// A rule runs on Pending lines only, in priority order, one rule per line; it never changes a posted line, never
// touches a paired line and never excludes. With Auto-post on, the lines it finds post at once ("AUTO" in Posted).
import { useState } from "react";
import { X } from "lucide-react";
import { AccountPicker, type Pick } from "./account-picker";
import { TaxSelect } from "./windows";
import type { FeedChart } from "@/lib/closebook/feed-server";
import type { BankRule, FeedAccount, RuleCondition } from "@/lib/closebook/bank-feed";
import type { TaxCode } from "@/lib/closebook/sales-tax";

// Fields sized here (the app's .input is full width).
const FI = "h-9 rounded-[6px] border border-sand-300 bg-white px-2.5 text-[14px] outline-none focus:border-navy-600";
export type RuleDraft = Omit<BankRule, "id" | "priority" | "active">;
export const blankRule = (direction: "out" | "in" = "out"): RuleDraft => ({ name: "", direction, accounts: [], match_all: true, conditions: [{ field: "description", op: "contains", value: "" }],
  txn_type: direction === "out" ? "expense" : "deposit", chart_account: null, bank_number: null, tax_code: null, memo: "", auto_post: false });

const OPS: Record<RuleCondition["field"], [RuleCondition["op"], string][]> = {
  description: [["contains", "Contains"], ["not_contains", "Doesn't contain"], ["is", "Is exactly"]],
  amount: [["eq", "Equals"], ["gt", "Greater than"], ["lt", "Less than"]],
};
export const conditionText = (c: RuleCondition) => `${c.field === "description" ? "Description" : "Amount"} ${(OPS[c.field].find(([k]) => k === c.op)?.[1] ?? c.op).toLowerCase()} ${c.field === "description" ? `"${c.value}"` : c.value}`;

export function RulePane({ initial, id, accounts, chart, codes, defaultTax, test, onClose, onSave }: {
  initial: RuleDraft; id: string | null; accounts: FeedAccount[]; chart: FeedChart[]; codes: TaxCode[]; defaultTax: Record<string, string | null>;
  test: (r: RuleDraft) => number; onClose: () => void; onSave: (r: RuleDraft, id: string | null) => Promise<boolean>;
}) {
  const [r, setR] = useState<RuleDraft>(initial);
  const [tested, setTested] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<RuleDraft>) => { setR((x) => ({ ...x, ...p })); setTested(null); };
  const setCond = (i: number, p: Partial<RuleCondition>) => set({ conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const out = r.direction !== "in";
  const transfer = r.txn_type === "transfer";
  const bank = r.bank_number ? accounts.find((a) => a.number === r.bank_number) : undefined;
  const label = bank ? bank.label : r.chart_account ? `${r.chart_account} ${chart.find((c) => c.number === r.chart_account)?.name ?? ""}` : "";
  const ok = r.name.trim() && r.conditions.length && r.conditions.every((c) => c.value.trim() && (c.field === "description" || /^-?\d+(\.\d{1,2})?$/.test(c.value.trim())))
    && (r.bank_number || (r.chart_account && r.tax_code));
  const pick = (p: Pick) => {
    if ("transfer" in p) set({ bank_number: accounts.find((a) => a.id === p.transfer)?.number ?? null, chart_account: null, tax_code: null, txn_type: "transfer" });
    else set({ chart_account: p.account, bank_number: null, tax_code: defaultTax[p.account] ?? r.tax_code, txn_type: r.txn_type === "transfer" ? (out ? "expense" : "deposit") : r.txn_type });
  };
  return (
    <div className="fixed inset-0 z-[70] flex justify-end bg-navy-950/30" role="dialog" aria-modal="true" aria-label={id ? "Edit rule" : "Create rule"}>
      <div className="flex h-full w-full max-w-[520px] flex-col bg-white shadow-[-12px_0_40px_rgba(11,26,58,.25)]">
        <div className="flex items-center gap-3 border-b border-sand-200 px-6 py-4"><h2 className="text-[18px] font-semibold">{id ? "Edit rule" : "Create rule"}</h2><span className="flex-1" />
          <button type="button" aria-label="Close" onClick={onClose} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
        <div className="grid flex-1 content-start gap-5 overflow-y-auto px-6 py-5 text-[14px]">
          <label className="grid gap-1.5 font-semibold">What do you want to call this rule?
            <input aria-label="Rule name" value={r.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} className="input font-normal" /></label>
          <div className="grid gap-1.5"><span className="font-semibold">Apply this to transactions that are</span>
            <div className="flex flex-wrap items-center gap-2">
              <select aria-label="Money out or money in" value={r.direction} onChange={(e) => { const d = e.target.value as RuleDraft["direction"]; set({ direction: d, txn_type: r.txn_type === "transfer" ? "transfer" : d === "in" ? "deposit" : "expense" }); }} className={`${FI} w-auto`}>
                <option value="out">Money out</option><option value="in">Money in</option>{r.direction === "any" && <option value="any">Money in or out</option>}</select>
              <span>in</span>
              <select aria-label="Accounts" value={r.accounts[0] ?? ""} onChange={(e) => set({ accounts: e.target.value ? [e.target.value] : [] })} className={`${FI} min-w-0 flex-1`}>
                <option value="">All bank and card accounts</option>{accounts.map((a) => <option key={a.id} value={a.number}>{a.label}</option>)}</select>
            </div></div>
          <div className="grid gap-2"><div className="flex items-center gap-2"><span className="font-semibold">and include the following:</span>
            <select aria-label="All or any" value={r.match_all ? "all" : "any"} onChange={(e) => set({ match_all: e.target.value === "all" })} className="h-8 rounded-[6px] border border-sand-300 bg-white px-2 text-[13.5px]"><option value="all">All</option><option value="any">Any</option></select></div>
            {r.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select aria-label={`Condition ${i + 1} field`} value={c.field} onChange={(e) => { const f = e.target.value as RuleCondition["field"]; setCond(i, { field: f, op: OPS[f][0][0] }); }} className={`${FI} w-[7.5rem] flex-none`}>
                  <option value="description">Description</option><option value="amount">Amount</option></select>
                <select aria-label={`Condition ${i + 1} test`} value={c.op} onChange={(e) => setCond(i, { op: e.target.value as RuleCondition["op"] })} className={`${FI} w-[9.5rem] flex-none`}>
                  {OPS[c.field].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                <input aria-label={`Condition ${i + 1} value`} value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} inputMode={c.field === "amount" ? "decimal" : undefined} className={`${FI} min-w-0 flex-1`} />
                {r.conditions.length > 1 && <button type="button" aria-label={`Remove condition ${i + 1}`} onClick={() => set({ conditions: r.conditions.filter((_, j) => j !== i) })} className="text-ink-3 hover:text-danger">✕</button>}
              </div>))}
            {r.conditions.length < 5 && <button type="button" className="justify-self-start text-navy-700 underline" onClick={() => set({ conditions: [...r.conditions, { field: "description", op: "contains", value: "" }] })}>Add a condition</button>}
            <div className="flex items-center gap-3"><button type="button" className="btn-secondary btn-compact" onClick={() => setTested(test(r))}>Test rule</button>
              {tested !== null && <span role="status">{tested} Pending line{tested === 1 ? "" : "s"} match{tested === 1 ? "es" : ""}</span>}</div>
          </div>
          <div className="grid gap-3 rounded-[var(--radius-ds)] border border-sand-200 p-4"><span className="font-semibold">Then assign</span>
            <label className="grid gap-1">Transaction type
              <select aria-label="Transaction type" value={r.txn_type} onChange={(e) => set({ txn_type: e.target.value, ...(e.target.value === "transfer" ? { chart_account: null, tax_code: null } : { bank_number: null }) })} className={`${FI} w-full`}>
                {(out ? [["expense", "Expense"], ["transfer", "Transfer"]] : [["deposit", "Deposit"], ["transfer", "Transfer"]]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <div className="grid gap-1">Account<AccountPicker chart={chart} banks={accounts} out={out} ownAccount={null} label={label} transferOnly={transfer} onPick={pick} /></div>
            {!transfer && <label className="grid gap-1">Sales tax<TaxSelect codes={codes} value={r.tax_code ?? ""} onChange={(v) => set({ tax_code: v || null })} /></label>}
            <label className="grid gap-1">Memo<input aria-label="Memo" value={r.memo} onChange={(e) => set({ memo: e.target.value })} maxLength={300} className="input" /></label>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-[var(--radius-ds)] border border-sand-200 p-4">
            <span><span className="block font-semibold">Automatically post transactions this rule applies to</span><span className="text-[13px] text-ink-3">Auto-post. Off by default.</span></span>
            <button type="button" role="switch" aria-checked={r.auto_post} aria-label="Auto-post" onClick={() => set({ auto_post: !r.auto_post })}
              className={`relative h-6 w-11 flex-none rounded-full transition-colors ${r.auto_post ? "bg-success" : "bg-sand-300"}`}>
              <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${r.auto_post ? "left-[22px]" : "left-0.5"}`} /></button>
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-sand-200 px-6 py-3.5">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn" disabled={!ok || busy} onClick={async () => { setBusy(true); const d = await onSave({ ...r, name: r.name.trim() }, id); setBusy(false); if (d) onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}

export function RulesPage({ rules, accounts, chart, codes, editable, onBack, onNew, onEdit, onAction, onReorder }: {
  rules: BankRule[]; accounts: FeedAccount[]; chart: FeedChart[]; codes: TaxCode[]; editable: boolean; onBack: () => void; onNew: () => void; onEdit: (r: BankRule) => void;
  onAction: (r: BankRule, a: "disable" | "enable" | "delete" | "copy") => void; onReorder: (ids: string[]) => void;
}) {
  const [drag, setDrag] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const applies = (r: BankRule) => `${r.direction === "out" ? "Money out" : r.direction === "in" ? "Money in" : "Money in or out"} · ${r.accounts.length ? r.accounts.map((n) => accounts.find((a) => a.number === n)?.label.split(" · ")[0] ?? n).join(", ") : "All bank and card accounts"}`;
  const settings = (r: BankRule) => r.bank_number ? `Transfer · ${accounts.find((a) => a.number === r.bank_number)?.label.split(" · ")[0] ?? r.bank_number}`
    : `${r.chart_account} ${chart.find((c) => c.number === r.chart_account)?.name ?? ""} · ${codes.find((c) => c.code === r.tax_code)?.name ?? r.tax_code ?? ""}`;
  return (
    <section aria-label="Rules" className="grid gap-3">
      <div className="flex items-center gap-3"><button type="button" onClick={onBack} className="text-[14px] text-navy-700 underline">‹ Bank transactions</button>
        <h2 className="text-[20px] font-semibold">Rules</h2><span className="flex-1" />{editable && <button type="button" className="btn" onClick={onNew}>New rule</button>}</div>
      <p className="text-[13.5px] text-ink-2">The client&rsquo;s rules, in priority order: the first rule that fits a Pending line fills it. Drag a row to change the order. Rules roll forward to next year&rsquo;s file.</p>
      <div className="overflow-x-auto rounded-[var(--radius-ds)] border border-sand-200 bg-white">
        <table className="w-full min-w-[980px] text-[13.5px]">
          <thead><tr className="border-b border-sand-200 text-left text-[12px] text-ink-3 uppercase"><th className="px-3 py-2 font-semibold">Priority</th><th className="px-3 py-2 font-semibold">Rule name</th>
            <th className="px-3 py-2 font-semibold">Applied to</th><th className="px-3 py-2 font-semibold">Conditions</th><th className="px-3 py-2 font-semibold">Settings</th>
            <th className="px-3 py-2 font-semibold">Auto-post</th><th className="px-3 py-2 font-semibold">Status</th><th className="px-3 py-2 text-right font-semibold">Action</th></tr></thead>
          <tbody>{ordered.map((r, i) => (
            <tr key={r.id} draggable={editable} onDragStart={() => setDrag(r.id)} onDragOver={(e) => e.preventDefault()}
              onDrop={() => { if (!drag || drag === r.id) return; const ids = ordered.map((x) => x.id).filter((x) => x !== drag); ids.splice(ids.indexOf(r.id), 0, drag); onReorder(ids); setDrag(null); }}
              className={`border-b border-sand-100 last:border-b-0 ${drag === r.id ? "opacity-50" : ""} ${r.active ? "" : "text-ink-3"}`}>
              <td className="px-3 py-2.5 tabular-nums"><span aria-hidden className="mr-2 cursor-grab text-ink-3">⋮⋮</span>{i + 1}</td>
              <td className="px-3 py-2.5 font-semibold">{r.name}</td><td className="px-3 py-2.5">{applies(r)}</td>
              <td className="px-3 py-2.5">{r.conditions.map(conditionText).join(r.match_all ? " and " : " or ")}</td><td className="px-3 py-2.5">{settings(r)}</td>
              <td className="px-3 py-2.5">{r.auto_post ? "On" : "Off"}</td><td className="px-3 py-2.5">{r.active ? "Active" : "Disabled"}</td>
              <td className="relative px-3 py-2.5 text-right">{editable && <>
                <button type="button" className="font-semibold text-navy-700" onClick={() => onEdit(r)}>Edit</button><span className="mx-1.5 text-sand-300">|</span>
                <button type="button" aria-label={`More actions for ${r.name}`} onClick={() => setMenu(menu === r.id ? null : r.id)} className="text-navy-700">▾</button>
                {menu === r.id && <span className="card absolute right-2 z-20 mt-1 grid w-max gap-0.5 p-1.5 text-left" onMouseLeave={() => setMenu(null)}>
                  {([["copy", "Copy"], [r.active ? "disable" : "enable", r.active ? "Disable" : "Enable"], ["delete", "Delete"]] as const).map(([k, l]) => (
                    <button key={k} type="button" className="rounded px-3 py-1 hover:bg-sand-100" onClick={() => { setMenu(null); onAction(r, k); }}>{l}</button>))}
                </span>}</>}</td>
            </tr>))}
            {!ordered.length && <tr><td colSpan={8} className="px-3 py-4 text-ink-3">No rules yet. Use New rule, or Save as rule on a line.</td></tr>}</tbody>
        </table>
      </div>
    </section>
  );
}
