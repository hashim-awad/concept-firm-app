"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Clock, MoreHorizontal, Plus, Search, X } from "lucide-react";
import { bracketAmount } from "@/lib/closebook/amount";
import { formatDateTime } from "@/lib/dates";
import { Picker, type PickOpt } from "../../picker";
import { saveAccount, setAccountActive } from "../../actions";

export type ChartRow = { id: string; ident: string; number: string; name: string; type: string; line_no: string | null; lineName: string; tax: string | null; active: boolean; balance: number;
  salesTax: boolean };
type Hist = { id: string; action: string; detail: string; old_value: string | null; new_value: string | null; created_at: string; who: string };
type Col = "number" | "name" | "type" | "gifi" | "tax" | "balance";
const TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-navy-950/30" />
      <aside role="dialog" aria-modal="true" aria-label={title} className="absolute inset-y-0 right-0 flex w-[min(32rem,100vw)] min-w-0 flex-col bg-white shadow-2xl" data-side-panel>
        <div className="flex items-center justify-between border-b border-sand-200 px-5 py-3.5"><h2 className="text-[16px] font-bold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 py-4">{children}</div>
      </aside>
    </div>
  );
}

function AccountPanel({ clientId, row, lines, taxes, onClose }: { clientId: string; row: ChartRow | null; lines: PickOpt[]; taxes: PickOpt[]; onClose: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ number: row?.number ?? "", name: row?.name ?? "", type: row?.type ?? "Expense", line: row?.line_no ?? "", tax: row?.tax ?? "" });
  // The "Sales tax account" tick: sent only when changed (left alone, the account keeps following the chart template).
  const [salesTax, setSalesTax] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merge, setMerge] = useState<{ id: string; label: string } | null>(null);
  const [pending, start] = useTransition();
  const save = (m = false) => start(async () => {
    setError(null);
    const r = await saveAccount(clientId, { id: row?.id, ...f, salesTax }, m);
    if (r.ok) { onClose(); router.refresh(); return; }
    if ("merge" in r) { setMerge(r.merge); return; }
    setError(r.error);
  });
  return (
    <SidePanel title={row ? "Edit account" : "New account"} onClose={onClose}>
      <form className="grid gap-3.5" onSubmit={(e) => { e.preventDefault(); save(); }} data-account-panel>
        <label className="grid gap-1"><span className="label">Account number</span><input className="input" value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} inputMode="numeric" data-acct-number /></label>
        <label className="grid gap-1"><span className="label">Account name</span><input className="input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-acct-name /></label>
        <div className="grid gap-1"><span className="label">Account type</span><Picker ariaLabel="Account type" value={f.type} onChange={(v) => setF({ ...f, type: v })} options={TYPES.map((t, i) => ({ value: t, label: t, sort: String(i) }))} /></div>
        <div className="grid gap-1"><span className="label">GIFI line <span className="font-normal text-ink-3">(optional)</span></span>
          <Picker ariaLabel="GIFI line" value={f.line} onChange={(v) => setF({ ...f, line: v })} options={lines} allowEmpty emptyLabel="Unmatched" placeholder="Unmatched" /></div>
        <div className="grid gap-1"><span className="label">Default tax code</span><Picker ariaLabel="Default tax code" value={f.tax} onChange={(v) => setF({ ...f, tax: v })} options={taxes} allowEmpty emptyLabel="None" placeholder="None" /></div>
        <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={salesTax ?? row?.salesTax ?? false} onChange={(e) => setSalesTax(e.target.checked)} data-acct-sales-tax />
          <span><b>Sales tax account</b><br /><span className="text-ink-3">GST/HST or PST payable, or instalments. The Overview&apos;s sales tax payable tile adds these accounts.</span></span></label>
        {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
        {merge && (
          <div role="alertdialog" className="rounded-md border border-warning/40 bg-warning/10 p-3 text-[13px]" data-merge-ask>
            <p className="font-semibold">Merge into {merge.label}?</p>
            <p className="mt-1 text-ink-2">Everything posted to this account will show on {merge.label}. This account becomes inactive.</p>
            <div className="mt-2.5 flex gap-2"><button type="button" className="btn btn-compact" disabled={pending} onClick={() => save(true)} data-merge-yes>Merge</button>
              <button type="button" className="btn-secondary btn-compact" onClick={() => setMerge(null)}>Cancel</button></div>
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn" disabled={pending} data-acct-save>Save</button></div>
      </form>
    </SidePanel>
  );
}

function RowMenu({ clientId, row, runHref, onEdit, onHistory, canEdit }: { clientId: string; row: ChartRow; runHref: string; onEdit: () => void; onHistory: () => void; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", out);
    return () => document.removeEventListener("mousedown", out);
  }, [open]);
  const item = "block w-full px-3 py-2 text-left text-[13px] hover:bg-sand-100";
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-label={`More for ${row.name}`} aria-expanded={open} onClick={() => setOpen(!open)} className="rounded p-1 hover:bg-sand-100" data-row-menu><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-md border border-sand-200 bg-white py-1 shadow-xl">
          {canEdit && <button type="button" className={item} onClick={() => { setOpen(false); onEdit(); }} data-menu-edit>Edit</button>}
          <Link href={runHref} className={item} data-menu-run>Run report</Link>
          {canEdit && <button type="button" className={item} onClick={() => start(async () => { setOpen(false); await setAccountActive(clientId, row.id, !row.active); router.refresh(); })}>{row.active ? "Make inactive" : "Make active"}</button>}
          <button type="button" className={item} onClick={() => { setOpen(false); onHistory(); }} data-menu-history>History</button>
        </div>
      )}
    </div>
  );
}

export function ChartView({ clientId, rows, lines, taxes, canEdit, asOf, from, panel, historyFor, history }: {
  clientId: string; rows: ChartRow[]; lines: PickOpt[]; taxes: PickOpt[]; canEdit: boolean; asOf: string; from: string; panel: string | null; historyFor: string | null; history: Hist[];
}) {
  const router = useRouter();
  const base = `/cb/${clientId}/chart`;
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: "number", dir: 1 });
  const [inactive, setInactive] = useState(false);
  const [edit, setEdit] = useState<ChartRow | "new" | null>(panel === "new" && canEdit ? "new" : null);
  // + New opens the panel on this page too (the address changes; the page stays).
  const [seenPanel, setSeenPanel] = useState(panel);
  if (panel !== seenPanel) { setSeenPanel(panel); if (panel === "new" && canEdit) setEdit("new"); }
  const taxName = useMemo(() => new Map(taxes.map((t) => [t.value, t.label])), [taxes]);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    const key = (r: ChartRow): string | number => sort.col === "number" ? r.number || `~${r.name}` : sort.col === "name" ? r.name.toLowerCase() : sort.col === "type" ? TYPES.indexOf(r.type)
      : sort.col === "gifi" ? r.line_no ?? "~" : sort.col === "tax" ? taxName.get(r.tax ?? "") ?? "~" : r.balance;
    return rows.filter((r) => (inactive || r.active) && (!t || `${r.number} ${r.name} ${r.type} ${r.line_no ?? ""} ${r.lineName}`.toLowerCase().includes(t)))
      .sort((a, b) => { const x = key(a), y = key(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * sort.dir; });
  }, [rows, q, sort, inactive, taxName]);
  const head = (col: Col, label: string, right = false, wide = false) => (
    <th className={`${right ? "text-right" : ""} ${wide ? "max-md:hidden" : ""}`} aria-sort={sort.col === col ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => setSort({ col, dir: sort.col === col ? (sort.dir === 1 ? -1 : 1) : 1 })} className="inline-flex items-center gap-1 font-semibold">
        {label}{sort.col === col && (sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}</button></th>
  );
  const hist = historyFor ? rows.find((r) => r.id === historyFor) : null;
  const run = (r: ChartRow) => `/cb/${clientId}/reports/gl?from=${from}&to=${asOf}&account=${encodeURIComponent(r.ident)}`;
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-bold">Chart of accounts</h1><span className="flex-1" />
        {canEdit && <button type="button" className="btn" onClick={() => setEdit("new")} data-chart-new><Plus className="h-4 w-4" />New</button>}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label className="relative w-full max-w-xs"><span className="sr-only">Search accounts</span>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by number or name" className="input input-compact w-full pl-8" data-chart-search /></label>
        <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={inactive} onChange={(e) => setInactive(e.target.checked)} className="h-4 w-4" />Include inactive</label>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="table" data-chart-table>
          <thead><tr>{head("number", "Number")}{head("name", "Name")}{head("type", "Type", false, true)}{head("gifi", "GIFI line", false, true)}{head("tax", "Default tax code", false, true)}{head("balance", "Balance", true)}<th className="w-10"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id} className={r.active ? "" : "text-ink-3"} data-chart-row={r.ident}>
              <td className="tabular-nums">{r.number}</td>
              <td className="md:min-w-[12rem]"><Link href={run(r)} className="hover:underline">{r.name}</Link>{!r.active && <span className="ml-1.5 text-[11.5px]">(inactive)</span>}</td>
              <td className="max-md:hidden">{r.type}</td>
              <td className="min-w-[10rem] max-md:hidden">{r.line_no ? <span title={r.lineName}>{r.line_no.replace(/\.00$/, "")} {r.lineName}</span> : <span className="text-warning">Unmatched</span>}</td>
              <td className="max-md:hidden">{r.tax ? taxName.get(r.tax) ?? r.tax : ""}</td>
              <td className="text-right tabular-nums"><Link href={run(r)} className="hover:underline">{bracketAmount(r.balance)}</Link></td>
              <td className="text-right"><RowMenu clientId={clientId} row={r} runHref={run(r)} canEdit={canEdit} onEdit={() => setEdit(r)} onHistory={() => router.push(`${base}?history=${r.id}`)} /></td>
            </tr>
          ))}
            {!shown.length && <tr><td colSpan={7} className="text-ink-3">No account matches.</td></tr>}</tbody>
        </table>
      </div>
      <p className="text-[12px] text-ink-3">Balances at {asOf}. A credit balance shows in brackets.</p>
      {edit && <AccountPanel clientId={clientId} row={edit === "new" ? null : edit} lines={lines} taxes={taxes} onClose={() => { setEdit(null); if (panel) router.replace(base); }} />}
      {hist && (
        <SidePanel title={`History: ${r_label(hist)}`} onClose={() => router.push(base)}>
          <ol className="grid gap-3" data-account-history>
            {history.map((h) => (
              <li key={h.id} className="rounded-md border border-sand-200 p-3 text-[13px]">
                <p className="flex items-center gap-1.5 text-[12px] text-ink-3"><Clock className="h-3.5 w-3.5" />{formatDateTime(h.created_at)}{h.who ? ` · ${h.who}` : ""}</p>
                <p className="mt-1 font-semibold">{h.detail}</p>
                {(h.old_value || h.new_value) && <div className="mt-1.5 grid gap-2 text-[12px] sm:grid-cols-2">
                  {h.old_value && <pre className="whitespace-pre-wrap rounded bg-sand-50 p-2 font-sans">{h.old_value}</pre>}
                  {h.new_value && <pre className="whitespace-pre-wrap rounded bg-navy-50 p-2 font-sans">{h.new_value}</pre>}</div>}
              </li>
            ))}
            {!history.length && <li className="text-[13px] text-ink-3">No change recorded yet. Accounts that come from the year files show History once changed here.</li>}
          </ol>
        </SidePanel>
      )}
    </div>
  );
}
const r_label = (r: ChartRow) => `${r.number ? `${r.number} ` : ""}${r.name}`;
