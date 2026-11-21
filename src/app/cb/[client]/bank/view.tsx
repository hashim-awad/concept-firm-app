"use client";
// CB2-1 PR B part g: QBO's Bank transactions. Cards on top (balance in Closebook, lines for review), then the tabs For
// review, Categorized and Excluded. A row expands to Categorize, Split, Transfer or Match; Confirm. When the suggestion is
// right, the row's own Confirm posts it (open the account, Confirm: 2 clicks). Tick lines for Confirm selected or Exclude
// selected; each line keeps its own History row.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useMemo, useState, useTransition } from "react";
import { ListChecks, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { bracketAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { formatDate } from "@/lib/dates";
import { isOut } from "@/lib/books/bank";
import { Picker } from "../../picker";
import { changeLine, confirmLines, excludeLines, restoreLines, undoLines, type ConfirmItem } from "../../bank-actions";
import type { BankPage, BLine } from "./load";

type Tab = "review" | "categorized" | "excluded";
const TABS: { key: Tab; label: string }[] = [{ key: "review", label: "For review" }, { key: "categorized", label: "Categorized" }, { key: "excluded", label: "Excluded" }];
const REASONS: Record<string, string> = { duplicate: "Duplicate", recorded: "Already recorded", other: "Other" };
const money = (c: number) => `$${bracketAmount(c)}`;

// What a line is coded to, in words.
function codedTo(l: BLine, label: (n: string) => string): string {
  if (l.entry) return `Matched: ${l.entry.label}`;
  if (l.transfer) return `Transfer: ${l.transfer}`;
  if (l.split) return `Split (${l.split.length} lines)`;
  return l.account ? label(l.account) : "";
}

// The item Confirm sends for a line's suggestion as it stands.
function fromSuggestion(l: BLine, defaultTax: Record<string, string>): ConfirmItem | null {
  const s = l.suggestion;
  if (!s) return null;
  const src = s.source === "rule" ? "rule" : "manual";
  if (s.splits?.length) return { id: l.id, kind: "split", rows: s.splits.map((r) => ({ account: r.account, tax: r.tax, amount: r.cents / 100 })), memo: s.memo, source: src, rule_id: s.ruleId ?? null };
  if (!s.account) return null;
  return { id: l.id, kind: "code", account: s.account, tax: s.tax ?? defaultTax[s.account] ?? null, memo: s.memo, source: src, rule_id: s.ruleId ?? null };
}

type Mode = "categorize" | "split" | "transfer" | "match";
type SplitRow = { account: string; tax: string; amount: string };

function Editor({ clientId, l, data, onDone }: { clientId: string; l: BLine; data: BankPage; onDone: (msg: string) => void }) {
  const s = l.suggestion;
  const review = l.state === "review";
  const [mode, setMode] = useState<Mode>(l.split || s?.splits ? "split" : l.transfer && !review ? "transfer" : !s && l.matches.length ? "match" : "categorize");
  const [account, setAccount] = useState(l.account ?? s?.account ?? "");
  const [tax, setTax] = useState(l.tax ?? s?.tax ?? (s?.account ? data.defaultTax[s.account] ?? "" : ""));
  const [memo, setMemo] = useState(l.memo || s?.memo || "");
  const [rows, setRows] = useState<SplitRow[]>(() => {
    const from = l.split ?? s?.splits;
    return from?.length ? from.map((r) => ({ account: r.account, tax: r.tax, amount: bracketAmount(r.cents) })) : [{ account: "", tax: "", amount: "" }, { account: "", tax: "", amount: "" }];
  });
  const [transfer, setTransfer] = useState("");
  const [match, setMatch] = useState(l.matches.length === 1 ? `${l.matches[0].kind}:${l.matches[0].id}` : "");
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const router = useRouter();
  const total = Math.abs(l.cents);
  const given = rows.reduce((n, r) => n + Math.abs(parseAmount(r.amount) ?? 0), 0);
  const banks = data.banks.filter((b) => b.value !== data.card?.ident);
  const modes: Mode[] = review ? ["categorize", "split", "transfer", "match"] : ["categorize", "split"];
  const name: Record<Mode, string> = { categorize: "Categorize", split: "Split", transfer: "Transfer", match: "Match" };

  const save = () => start(async () => {
    setErr("");
    const splitRows = rows.filter((r) => r.account || r.amount).map((r) => ({ account: r.account, tax: r.tax || data.defaultTax[r.account] || "", amount: Math.abs(parseAmount(r.amount) ?? 0) / 100 }));
    let res;
    if (!review) {
      res = mode === "split" ? await changeLine(clientId, l.id, { splits: splitRows, memo }) : await changeLine(clientId, l.id, { account, tax: tax || null, memo });
    } else {
      let item: ConfirmItem;
      if (mode === "categorize") {
        if (!account) { setErr("Choose an account."); return; }
        const fromRule = s?.source === "rule" && s.account === account;
        item = { id: l.id, kind: "code", account, tax: tax || data.defaultTax[account] || null, memo, source: fromRule ? "rule" : "manual", rule_id: fromRule ? s?.ruleId ?? null : null };
      } else if (mode === "split") {
        if (given !== total) { setErr(`Left to split: ${money(total - given)}.`); return; }
        item = { id: l.id, kind: "split", rows: splitRows, memo, source: "manual" };
      } else if (mode === "transfer") {
        if (!transfer) { setErr("Choose the account the money went to or came from."); return; }
        item = { id: l.id, kind: "transfer", transfer, memo };
      } else {
        const [k, id] = match.split(":");
        if (!id) { setErr("Choose a record to match."); return; }
        item = k === "entry" ? { id: l.id, kind: "entry", entry: id, memo } : { id: l.id, kind: "pair", other: id, memo };
      }
      res = await confirmLines(clientId, [item]);
    }
    if (!res.ok) { setErr(res.error); return; }
    onDone(review ? "1 line confirmed." : "Line changed.");
    router.refresh();
  });

  return (
    <div className="grid gap-3 bg-sand-50 px-4 py-3" data-bank-editor>
      <div role="radiogroup" aria-label="What to do with this line" className="flex flex-wrap gap-4 text-[13px]">
        {modes.map((m) => <label key={m} className="flex items-center gap-1.5"><input type="radio" name={`mode-${l.id}`} checked={mode === m} onChange={() => setMode(m)} data-mode={m} />{name[m]}</label>)}
      </div>
      {mode === "categorize" && (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Account
            <Picker value={account} options={data.accounts} onChange={(v) => { setAccount(v); setTax(data.defaultTax[v] ?? ""); }} ariaLabel="Account" compact /></label>
          <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Sales tax
            <Picker value={tax} options={data.taxes} onChange={setTax} ariaLabel="Sales tax" compact allowEmpty emptyLabel="No tax" /></label>
        </div>
      )}
      {mode === "split" && (
        <div className="grid gap-2" data-split>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_7rem_auto] items-center gap-2">
              <Picker value={r.account} options={data.accounts} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, account: v, tax: data.defaultTax[v] ?? "" } : x)))} ariaLabel={`Split line ${i + 1} account`} compact />
              <Picker value={r.tax} options={data.taxes} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, tax: v } : x)))} ariaLabel={`Split line ${i + 1} sales tax`} compact allowEmpty emptyLabel="No tax" />
              <input value={r.amount} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} onBlur={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: tidyAmount(e.target.value) } : x)))}
                aria-label={`Split line ${i + 1} amount`} inputMode="decimal" className="input input-compact text-right tabular-nums" />
              <button type="button" aria-label={`Delete split line ${i + 1}`} disabled={rows.length <= 2} onClick={() => setRows(rows.filter((_, j) => j !== i))} className="rounded p-1 hover:bg-sand-100 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            <button type="button" className="btn btn-compact btn-secondary" onClick={() => setRows([...rows, { account: "", tax: "", amount: "" }])}><Plus className="h-4 w-4" />Add line</button>
            <span className={given === total ? "text-ink-3" : "font-semibold text-danger"} data-left>Left to split: {money(total - given)}</span>
          </div>
        </div>
      )}
      {mode === "transfer" && (
        <label className="grid max-w-md gap-1 text-[12px] font-semibold text-ink-3">{isOut(data.card?.kind ?? "bank", l.cents) ? "Transfer to" : "Transfer from"}
          <Picker value={transfer} options={banks} onChange={setTransfer} ariaLabel="Transfer account" compact /></label>
      )}
      {mode === "match" && (
        l.matches.length ? (
          <fieldset className="grid gap-1.5 text-[13px]" data-matches><legend className="mb-1 text-[12px] font-semibold text-ink-3">Records with the same amount</legend>
            {l.matches.map((m) => <label key={m.kind + m.id} className="flex items-center gap-2"><input type="radio" name={`match-${l.id}`} checked={match === `${m.kind}:${m.id}`} onChange={() => setMatch(`${m.kind}:${m.id}`)} />{m.label}</label>)}
          </fieldset>
        ) : <p className="text-[13px] text-ink-3">No journal entry or line in another account has this amount near this date.</p>
      )}
      <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Memo<input value={memo} onChange={(e) => setMemo(e.target.value)} className="input input-compact" maxLength={2000} /></label>
      {err && <p role="alert" className="text-[13px] font-semibold text-danger">{err}</p>}
      <div className="flex gap-2"><button type="button" className="btn btn-compact" disabled={busy} onClick={save} data-editor-save>{review ? "Confirm" : "Save"}</button></div>
    </div>
  );
}

export function BankView({ clientId, data, tab, canEdit }: { clientId: string; data: BankPage; tab: Tab; canEdit: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [excl, setExcl] = useState<{ reason: string; note: string } | null>(null);
  const [busy, start] = useTransition();
  const card = data.card;
  const base = `/cb/${clientId}/bank`;
  const acctName = useMemo(() => new Map(data.accounts.map((a) => [a.value, a.label])), [data.accounts]);
  const label = (n: string) => acctName.get(n) ?? n;
  const counts = { review: 0, categorized: 0, excluded: 0 };
  for (const l of data.lines) counts[l.state]++;
  const shown = data.lines.filter((l) => l.state === tab && (!q.trim() || `${l.description} ${bracketAmount(l.cents)} ${l.date} ${l.memo}`.toLowerCase().includes(q.trim().toLowerCase())));
  const tickedShown = shown.filter((l) => ticked.has(l.id) && !l.locked);

  const run = (f: () => Promise<{ ok: boolean; error?: string; n?: number }>, words: (n: number) => string) => start(async () => {
    setErr(""); setMsg("");
    const r = await f();
    if (!r.ok) { setErr(r.error ?? "Something went wrong."); return; }
    setMsg(words(r.n ?? 0)); setTicked(new Set()); setOpen(null); router.refresh();
  });
  const plural = (n: number) => `${n} line${n === 1 ? "" : "s"}`;
  const confirmSelected = () => {
    const items = tickedShown.map((l) => fromSuggestion(l, data.defaultTax)).filter((x): x is ConfirmItem => !!x);
    const missing = tickedShown.length - items.length;
    if (!items.length) { setErr("The lines ticked have no suggestion. Open a line to choose its account."); return; }
    run(() => confirmLines(clientId, items), (n) => `${plural(n)} confirmed.${missing ? ` ${plural(missing)} with no suggestion left For review.` : ""}`);
  };

  if (!card) return (
    <div className="mx-auto grid max-w-6xl gap-4"><h1 className="text-[22px] font-bold">Bank transactions</h1>
      <div className="card p-5 text-[14px]">This client has no bank or card account yet. {canEdit && <Link href={`${base}/upload`} className="font-semibold text-navy-700 underline">Upload a bank file</Link>}</div></div>
  );
  const outOf = (l: BLine) => isOut(card.kind, l.cents);
  const all = shown.filter((l) => !l.locked);
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-[22px] font-bold">Bank transactions</h1><span className="flex-1" />
        <Link href={`/cb/${clientId}/rules`} className="btn btn-secondary btn-compact" data-bank-rules><ListChecks className="h-4 w-4" />Rules</Link>
        {canEdit && <Link href={`${base}/upload?account=${encodeURIComponent(card.ident)}`} className="btn btn-compact" data-bank-upload><Upload className="h-4 w-4" />Upload bank file</Link>}
      </div>

      <div className="flex gap-3 overflow-x-auto pb-1" data-bank-cards>
        {data.cards.map((c) => (
          <Link key={c.ident} href={`${base}?account=${encodeURIComponent(c.ident)}`} aria-current={c.ident === card.ident ? "true" : undefined}
            className={`min-w-[13rem] flex-none rounded-lg border p-3 ${c.ident === card.ident ? "border-navy-700 bg-white shadow" : "border-sand-200 bg-sand-50 hover:bg-white"}`} data-bank-card={c.ident}>
            <div className="text-[13px] font-bold">{c.ident} {c.name}</div>
            <div className="mt-2 text-[12px] text-ink-3">Balance in Closebook</div>
            <div className="text-[16px] font-bold tabular-nums">{money(c.balance)}</div>
            <div className="mt-1 text-[12px]"><span className="font-semibold">{c.review}</span> for review</div>
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 border-b border-sand-200" role="tablist">
        {TABS.map((t) => <Link key={t.key} role="tab" aria-selected={tab === t.key} href={`${base}?${new URLSearchParams({ account: card.ident, ...(t.key !== "review" ? { tab: t.key } : {}) })}`}
          className={`-mb-px border-b-2 px-2 pb-2 text-[14px] font-semibold ${tab === t.key ? "border-navy-700 text-navy-800" : "border-transparent text-ink-3 hover:text-ink-1"}`} data-tab={t.key}>{t.label} ({counts[t.key]})</Link>)}
        <span className="flex-1" />
        <label className="relative mb-2 w-full max-w-[16rem]"><Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Description, amount or memo" aria-label="Search lines" className="input input-compact w-full !pl-8" /></label>
      </div>

      {msg && <p role="status" className="text-[13px] font-semibold text-success" data-bank-msg>{msg}</p>}
      {err && <p role="alert" className="text-[13px] font-semibold text-danger" data-bank-err>{err}</p>}

      {canEdit && tickedShown.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-navy-900 px-3 py-2 text-[13px] text-white" data-bank-bar>
          <span className="font-semibold">{plural(tickedShown.length)} ticked</span><span className="flex-1" />
          {tab === "review" && <>
            <button type="button" className="btn btn-compact" disabled={busy} onClick={confirmSelected} data-confirm-selected>Confirm selected</button>
            <button type="button" className="btn btn-compact btn-secondary" disabled={busy} onClick={() => setExcl({ reason: "duplicate", note: "" })} data-exclude-selected>Exclude selected</button>
          </>}
          {tab === "categorized" && <button type="button" className="btn btn-compact" disabled={busy} onClick={() => run(() => undoLines(clientId, tickedShown.map((l) => l.id)), (n) => `${plural(n)} back For review.`)} data-undo-selected>Undo selected</button>}
          {tab === "excluded" && <button type="button" className="btn btn-compact" disabled={busy} onClick={() => run(() => restoreLines(clientId, tickedShown.map((l) => l.id)), (n) => `${plural(n)} back For review.`)} data-undo-selected>Undo selected</button>}
          <button type="button" aria-label="Clear the ticks" className="rounded p-1 hover:bg-white/10" onClick={() => setTicked(new Set())}><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-[13px]" data-bank-table>
          <thead className="border-b border-sand-200 bg-sand-50 text-left text-[12px] text-ink-3">
            <tr>
              <th className="w-8 px-3 py-2">{canEdit && <input type="checkbox" aria-label="Tick every line" checked={all.length > 0 && all.every((l) => ticked.has(l.id))}
                onChange={(e) => setTicked(e.target.checked ? new Set(all.map((l) => l.id)) : new Set())} />}</th>
              <th className="px-2 py-2">Date</th><th className="px-2 py-2">Description</th>
              <th className="hidden px-2 py-2 text-right md:table-cell">Spent</th><th className="hidden px-2 py-2 text-right md:table-cell">Received</th>
              <th className="hidden px-2 py-2 md:table-cell">{tab === "review" ? "Suggested" : tab === "categorized" ? "Categorized as" : "Reason"}</th>
              <th className="px-2 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-3">{tab === "review" ? "Nothing to review." : "No lines here."}</td></tr>}
            {shown.map((l) => {
              const editable = canEdit && !l.locked;
              const sug = l.suggestion;
              const what = tab === "review"
                ? (sug ? <span>{sug.splits ? `Split (${sug.splits.length} lines)` : label(sug.account ?? "")} <span className="ml-1 rounded bg-sand-100 px-1.5 py-0.5 text-[11px] text-ink-3">{sug.source === "rule" ? `Rule: ${sug.ruleName}` : "Like before"}</span></span>
                  : l.matches.length ? <span className="text-ink-3">{l.matches.length} match{l.matches.length === 1 ? "" : "es"} found</span> : <span className="text-ink-3">Choose an account</span>)
                : tab === "categorized" ? codedTo(l, label)
                : `${REASONS[l.excluded?.reason ?? ""] ?? ""}${l.excluded?.note ? `: ${l.excluded.note}` : ""}`;
              return (
                <Fragment key={l.id}>
                  <tr className={`border-b border-sand-100 ${open === l.id ? "bg-sand-50" : "hover:bg-sand-50"} cursor-pointer`} onClick={() => tab !== "excluded" && editable && setOpen(open === l.id ? null : l.id)} data-line={l.id}>
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>{editable && <input type="checkbox" aria-label={`Tick ${l.description}`} checked={ticked.has(l.id)}
                      onChange={(e) => { const n = new Set(ticked); if (e.target.checked) n.add(l.id); else n.delete(l.id); setTicked(n); }} />}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-[12px] md:text-[13px]">{formatDate(l.date)}</td>
                    <td className="px-2 py-2">{l.description}{l.memo && <div className="text-[12px] text-ink-3">{l.memo}</div>}<div className="font-semibold tabular-nums md:hidden">{outOf(l) ? "Spent" : "Received"} {money(Math.abs(l.cents))}</div><div className="text-[12px] text-ink-3 md:hidden">{what}</div>
                      {l.locked && <div className="text-[12px] text-ink-3">Year locked</div>}</td>
                    <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums md:table-cell">{outOf(l) ? money(Math.abs(l.cents)) : ""}</td>
                    <td className="hidden whitespace-nowrap px-2 py-2 text-right tabular-nums md:table-cell">{outOf(l) ? "" : money(Math.abs(l.cents))}</td>
                    <td className="hidden px-2 py-2 md:table-cell">{what}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                      {editable && tab === "review" && (sug && fromSuggestion(l, data.defaultTax)
                        ? <button type="button" className="btn btn-compact" disabled={busy} onClick={() => run(() => confirmLines(clientId, [fromSuggestion(l, data.defaultTax)!]), () => "1 line confirmed.")} data-row-confirm>Confirm</button>
                        : <button type="button" className="btn btn-compact btn-secondary" onClick={() => setOpen(open === l.id ? null : l.id)} data-row-open>{l.matches.length ? "Match" : "Categorize"}</button>)}
                      {editable && tab === "categorized" && <button type="button" className="btn btn-compact btn-secondary" disabled={busy} onClick={() => run(() => undoLines(clientId, [l.id]), () => "1 line back For review.")} data-row-undo>Undo</button>}
                      {editable && tab === "excluded" && <button type="button" className="btn btn-compact btn-secondary" disabled={busy} onClick={() => run(() => restoreLines(clientId, [l.id]), () => "1 line back For review.")} data-row-undo>Undo</button>}
                    </td>
                  </tr>
                  {open === l.id && <tr><td colSpan={7} className="border-b border-sand-200 p-0"><Editor clientId={clientId} l={l} data={data} onDone={(m) => { setMsg(m); setOpen(null); }} /></td></tr>}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {excl && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-navy-950/30" onClick={() => setExcl(null)} />
          <div role="dialog" aria-modal="true" aria-label="Exclude lines" className="relative grid w-full max-w-sm gap-3 rounded-lg bg-white p-5 shadow-2xl" data-exclude-dialog>
            <h2 className="text-[16px] font-bold">Exclude {plural(tickedShown.length)}</h2>
            <p className="text-[13px] text-ink-3">Excluded lines post nothing. Undo puts them back For review.</p>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Reason
              <select value={excl.reason} onChange={(e) => setExcl({ ...excl, reason: e.target.value })} className="input input-compact" data-exclude-reason>
                {Object.entries(REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Note{excl.reason === "other" ? "" : " (optional)"}
              <input value={excl.note} onChange={(e) => setExcl({ ...excl, note: e.target.value })} className="input input-compact" maxLength={300} data-exclude-note /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setExcl(null)}>Cancel</button>
              <button type="button" className="btn btn-compact" disabled={busy} onClick={() => { const e = excl; setExcl(null); run(() => excludeLines(clientId, tickedShown.map((l) => l.id), e.reason, e.note), (n) => `${plural(n)} excluded.`); }} data-exclude-go>Exclude</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
