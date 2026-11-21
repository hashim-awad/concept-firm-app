"use client";
// CB2-1 PR B part i: Rules (QBO). A rule has a name, the money and accounts it applies to, and conditions; then it sets the
// account, tax code and memo, or splits by percentage. "Automatically confirm" is off by default: a rule only suggests until
// it is turned on. Each rule's ⋯ menu: Edit, Copy, Delete, History.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Clock, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { formatDateTime } from "@/lib/dates";
import type { BooksRule, Cond } from "@/lib/books/bank";
import { Picker, type PickOpt } from "../../picker";
import { ruleAction, saveRule, type RuleIn } from "../../bank-actions";
import { SidePanel } from "../chart/view";

type Hist = { id: string; action: string; detail: string; old_value: string | null; new_value: string | null; created_at: string; who: string };
const DIR: Record<string, string> = { any: "Money in or out", in: "Money in", out: "Money out" };
const OPS: Record<Cond["field"], { value: Cond["op"]; label: string }[]> = {
  description: [{ value: "contains", label: "contains" }],
  amount: [{ value: "eq", label: "is" }, { value: "between", label: "is between" }],
};
const condText = (c: Cond) => c.field === "description" ? `Description contains "${c.value}"` : c.op === "between" ? `Amount between ${c.value} and ${c.value2 ?? ""}` : `Amount is ${c.value}`;

function RuleMenu({ name, canEdit, onEdit, onCopy, onDelete, onHistory }: { name: string; canEdit: boolean; onEdit: () => void; onCopy: () => void; onDelete: () => void; onHistory: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const item = "block w-full px-3 py-2 text-left text-[13px] hover:bg-sand-100";
  const pick = (f: () => void) => () => { setOpen(false); f(); };
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-label={`More for ${name}`} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded p-1 hover:bg-sand-100" data-rule-menu><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-40 rounded-md border border-sand-200 bg-white py-1 shadow-xl">
          {canEdit && <button type="button" className={item} onClick={pick(onEdit)} data-menu-edit>Edit</button>}
          {canEdit && <button type="button" className={item} onClick={pick(onCopy)} data-menu-copy>Copy</button>}
          {canEdit && <button type="button" className={item} onClick={pick(onDelete)} data-menu-delete>Delete</button>}
          <button type="button" className={item} onClick={pick(onHistory)} data-menu-history>History</button>
        </div>
      )}
    </div>
  );
}

function RulePanel({ clientId, rule, accounts, taxes, defaultTax, banks, onClose }: { clientId: string; rule: BooksRule | null; accounts: PickOpt[]; taxes: PickOpt[];
  defaultTax: Record<string, string>; banks: PickOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [r, setR] = useState<RuleIn>(() => rule ? { name: rule.name, direction: rule.direction, accounts: rule.accounts, match_all: rule.match_all, conditions: rule.conditions,
    chart_account: rule.chart_account, splits: rule.splits, tax_code: rule.tax_code, memo: rule.memo, auto_confirm: rule.auto_confirm, active: rule.active }
    : { name: "", direction: "out", accounts: [], match_all: true, conditions: [{ field: "description", op: "contains", value: "" }], chart_account: null, splits: null, tax_code: null, memo: "", auto_confirm: false, active: true });
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const set = (p: Partial<RuleIn>) => setR({ ...r, ...p });
  const setCond = (i: number, p: Partial<Cond>) => set({ conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...p } : c)) });
  const split = !!r.splits;
  const pct = (r.splits ?? []).reduce((n, s) => n + (Number(s.percent) || 0), 0);
  const save = () => start(async () => {
    setErr("");
    const res = await saveRule(clientId, rule?.id ?? null, { ...r, splits: split ? r.splits!.map((s) => ({ ...s, percent: Number(s.percent) })) : null, chart_account: split ? null : r.chart_account });
    if (!res.ok) { setErr(res.error); return; }
    onClose(); router.refresh();
  });
  const lbl = "grid gap-1 text-[12px] font-semibold text-ink-3";
  return (
    <SidePanel title={rule ? "Edit rule" : "New rule"} onClose={onClose}>
      <div className="grid gap-4" data-rule-panel>
        <label className={lbl}>Rule name<input value={r.name} onChange={(e) => set({ name: e.target.value })} className="input input-compact" maxLength={100} data-rule-name /></label>
        <fieldset className="grid gap-2"><legend className="mb-1 text-[13px] font-bold">Apply this to</legend>
          <select value={r.direction} onChange={(e) => set({ direction: e.target.value as RuleIn["direction"] })} className="input input-compact" aria-label="Money in or out" data-rule-direction>
            {Object.entries(DIR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          <p className="text-[12px] text-ink-3">In these accounts (none ticked: all accounts)</p>
          {banks.map((b) => <label key={b.value} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={r.accounts.includes(b.value)}
            onChange={(e) => set({ accounts: e.target.checked ? [...r.accounts, b.value] : r.accounts.filter((x) => x !== b.value) })} />{b.label}</label>)}
        </fieldset>
        <fieldset className="grid gap-2" data-rule-conditions><legend className="mb-1 text-[13px] font-bold">And include</legend>
          <select value={r.match_all ? "all" : "any"} onChange={(e) => set({ match_all: e.target.value === "all" })} className="input input-compact" aria-label="All or any">
            <option value="all">All of these conditions</option><option value="any">Any of these conditions</option></select>
          {r.conditions.map((c, i) => (
            <div key={i} className="grid grid-cols-[7rem_6.5rem_minmax(0,1fr)_auto] items-center gap-2">
              <select value={c.field} onChange={(e) => setCond(i, { field: e.target.value as Cond["field"], op: OPS[e.target.value as Cond["field"]][0].value })} className="input input-compact" aria-label={`Condition ${i + 1} field`}>
                <option value="description">Description</option><option value="amount">Amount</option></select>
              <select value={c.op} onChange={(e) => setCond(i, { op: e.target.value as Cond["op"] })} className="input input-compact" aria-label={`Condition ${i + 1} test`}>
                {OPS[c.field].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              <div className="flex gap-1"><input value={c.value} onChange={(e) => setCond(i, { value: e.target.value })} className="input input-compact w-full" aria-label={`Condition ${i + 1} value`} data-cond-value />
                {c.op === "between" && <input value={c.value2 ?? ""} onChange={(e) => setCond(i, { value2: e.target.value })} className="input input-compact w-full" aria-label={`Condition ${i + 1} second value`} />}</div>
              <button type="button" aria-label={`Delete condition ${i + 1}`} disabled={r.conditions.length <= 1} onClick={() => set({ conditions: r.conditions.filter((_, j) => j !== i) })} className="rounded p-1 hover:bg-sand-100 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          {r.conditions.length < 10 && <button type="button" className="btn btn-ghost btn-compact justify-self-start" onClick={() => set({ conditions: [...r.conditions, { field: "description", op: "contains", value: "" }] })}><Plus className="h-4 w-4" />Add a condition</button>}
        </fieldset>
        <fieldset className="grid gap-2"><legend className="mb-1 text-[13px] font-bold">Then</legend>
          <div className="flex gap-4 text-[13px]" role="radiogroup" aria-label="Set or split">
            <label className="flex items-center gap-1.5"><input type="radio" checked={!split} onChange={() => set({ splits: null })} />Set the account</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={split} onChange={() => set({ splits: [{ account: "", tax: "", percent: 50 }, { account: "", tax: "", percent: 50 }] })} data-rule-split />Split by percentage</label>
          </div>
          {!split ? <>
            <label className={lbl}>Account<Picker value={r.chart_account ?? ""} options={accounts} onChange={(v) => set({ chart_account: v, tax_code: defaultTax[v] ?? r.tax_code })} ariaLabel="Rule account" compact /></label>
            <label className={lbl}>Sales tax<Picker value={r.tax_code ?? ""} options={taxes} onChange={(v) => set({ tax_code: v || null })} ariaLabel="Rule sales tax" compact allowEmpty emptyLabel="No tax" /></label>
          </> : <div className="grid gap-2">
            {r.splits!.map((s, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_4.5rem_auto] items-center gap-2">
                <Picker value={s.account} options={accounts} onChange={(v) => set({ splits: r.splits!.map((x, j) => (j === i ? { ...x, account: v, tax: defaultTax[v] ?? x.tax } : x)) })} ariaLabel={`Split ${i + 1} account`} compact />
                <Picker value={s.tax} options={taxes} onChange={(v) => set({ splits: r.splits!.map((x, j) => (j === i ? { ...x, tax: v } : x)) })} ariaLabel={`Split ${i + 1} sales tax`} compact allowEmpty emptyLabel="No tax" />
                <input value={String(s.percent)} onChange={(e) => set({ splits: r.splits!.map((x, j) => (j === i ? { ...x, percent: e.target.value as unknown as number } : x)) })} inputMode="decimal" className="input input-compact text-right" aria-label={`Split ${i + 1} percent`} />
                <button type="button" aria-label={`Delete split ${i + 1}`} disabled={r.splits!.length <= 2} onClick={() => set({ splits: r.splits!.filter((_, j) => j !== i) })} className="rounded p-1 hover:bg-sand-100 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
              </div>
            ))}
            <div className="flex items-center gap-3 text-[13px]"><button type="button" className="btn btn-ghost btn-compact" onClick={() => set({ splits: [...r.splits!, { account: "", tax: "", percent: 0 }] })}><Plus className="h-4 w-4" />Add a split line</button>
              <span className={pct === 100 ? "text-ink-3" : "font-semibold text-danger"}>Total {pct}%</span></div>
          </div>}
          <label className={lbl}>Memo<input value={r.memo} onChange={(e) => set({ memo: e.target.value })} className="input input-compact" maxLength={200} /></label>
        </fieldset>
        <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" checked={r.auto_confirm} onChange={(e) => set({ auto_confirm: e.target.checked })} className="mt-0.5" data-rule-auto />
          <span><b>Automatically confirm</b><br /><span className="text-ink-3">Lines this rule applies to are confirmed when a bank file is uploaded. Off: the rule only suggests.</span></span></label>
        {rule && <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={r.active} onChange={(e) => set({ active: e.target.checked })} />Active</label>}
        {err && <p role="alert" className="text-[13px] font-semibold text-danger" data-rule-err>{err}</p>}
        <div className="flex justify-end gap-2"><button type="button" className="btn btn-ghost btn-compact" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-compact" disabled={busy} onClick={save} data-rule-save>Save</button></div>
      </div>
    </SidePanel>
  );
}

export function RulesView({ clientId, rules, accounts, taxes, defaultTax, banks, canEdit, panel, historyFor, history }: { clientId: string; rules: BooksRule[]; accounts: PickOpt[];
  taxes: PickOpt[]; defaultTax: Record<string, string>; banks: PickOpt[]; canEdit: boolean; panel: string | null; historyFor: string | null; history: Hist[] }) {
  const router = useRouter();
  const base = `/cb/${clientId}/rules`;
  const [edit, setEdit] = useState<BooksRule | "new" | null>(panel === "new" && canEdit ? "new" : null);
  const [err, setErr] = useState("");
  const [, start] = useTransition();
  const acct = new Map(accounts.map((a) => [a.value, a.label]));
  const bank = new Map(banks.map((a) => [a.value, a.label]));
  const act = (id: string, a: "copy" | "delete") => start(async () => { setErr(""); const r = await ruleAction(clientId, id, a); if (!r.ok) setErr(r.error); router.refresh(); });
  const hist = historyFor ? rules.find((r) => r.id === historyFor) : null;
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex items-center gap-2"><h1 className="text-[22px] font-bold">Rules</h1><span className="flex-1" />
        {canEdit && <button type="button" className="btn btn-compact" onClick={() => setEdit("new")} data-rule-new><Plus className="h-4 w-4" />New rule</button>}</div>
      <p className="text-[13px] text-ink-3">Rules suggest the account for new bank lines, first rule first. A rule set to Automatically confirm also confirms them when a file is uploaded.</p>
      {err && <p role="alert" className="text-[13px] font-semibold text-danger">{err}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-[13px]" data-rules-table>
          <thead className="border-b border-sand-200 bg-sand-50 text-left text-[12px] text-ink-3"><tr>
            <th className="px-3 py-2">Priority</th><th className="px-2 py-2">Rule name</th><th className="hidden px-2 py-2 md:table-cell">Applies to</th>
            <th className="hidden px-2 py-2 md:table-cell">Conditions</th><th className="px-2 py-2">Then</th><th className="px-2 py-2">Auto confirm</th><th className="px-2 py-2">Status</th><th className="w-10 px-2 py-2" /></tr></thead>
          <tbody>
            {!rules.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-3">No rules yet.</td></tr>}
            {rules.map((r, i) => (
              <tr key={r.id} className="border-b border-sand-100 align-top" data-rule={r.name}>
                <td className="px-3 py-2">{i + 1}</td>
                <td className="px-2 py-2 font-semibold">{r.name}</td>
                <td className="hidden px-2 py-2 md:table-cell">{DIR[r.direction]}<div className="text-[12px] text-ink-3">{r.accounts.length ? r.accounts.map((a) => bank.get(a) ?? a).join(", ") : "All accounts"}</div></td>
                <td className="hidden px-2 py-2 md:table-cell">{r.conditions.map(condText).join(r.match_all ? " and " : " or ")}</td>
                <td className="px-2 py-2">{r.splits?.length ? `Split: ${r.splits.map((s) => `${s.percent}% ${acct.get(s.account) ?? s.account}`).join(", ")}` : acct.get(r.chart_account ?? "") ?? r.chart_account}
                  {r.memo && <div className="text-[12px] text-ink-3">Memo: {r.memo}</div>}</td>
                <td className="px-2 py-2">{r.auto_confirm ? "Yes" : "No"}</td>
                <td className="px-2 py-2">{r.active ? "Active" : "Inactive"}</td>
                <td className="px-2 py-2 text-right"><RuleMenu name={r.name} canEdit={canEdit} onEdit={() => setEdit(r)} onCopy={() => act(r.id, "copy")}
                  onDelete={() => { if (window.confirm(`Delete the rule ${r.name}? Lines it already confirmed stay as they are.`)) act(r.id, "delete"); }} onHistory={() => router.push(`${base}?history=${r.id}`)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <RulePanel clientId={clientId} rule={edit === "new" ? null : edit} accounts={accounts} taxes={taxes} defaultTax={defaultTax} banks={banks}
        onClose={() => { setEdit(null); if (panel) router.replace(base); }} />}
      {hist && (
        <SidePanel title={`History: ${hist.name}`} onClose={() => router.push(base)}>
          <ol className="grid gap-3" data-rule-history>
            {history.map((h) => (
              <li key={h.id} className="rounded-md border border-sand-200 p-3 text-[13px]">
                <p className="flex items-center gap-1.5 text-[12px] text-ink-3"><Clock className="h-3.5 w-3.5" />{formatDateTime(h.created_at)}{h.who ? ` · ${h.who}` : ""}</p>
                <p className="mt-1 font-semibold">{h.detail}</p>
                {(h.old_value || h.new_value) && <div className="mt-1.5 grid gap-2 text-[12px] sm:grid-cols-2">
                  {h.old_value && <pre className="whitespace-pre-wrap rounded bg-sand-50 p-2 font-sans">{h.old_value}</pre>}
                  {h.new_value && <pre className="whitespace-pre-wrap rounded bg-navy-50 p-2 font-sans">{h.new_value}</pre>}</div>}
              </li>
            ))}
            {!history.length && <li className="text-[13px] text-ink-3">No change recorded yet.</li>}
          </ol>
        </SidePanel>
      )}
    </div>
  );
}
