"use client";
// Step 3, Code the transactions (Hashim, Nov 13, 2026; mockup step 3): like the QuickBooks bank feed.
// One tile per bank or card account; its lines below, each with an account from the standard chart, a
// sales tax code (only the codes for the company's province; meals only as the group code), Confirm and
// Ask the client. Suggestions come from the client's vendor rules and earlier files. Lines on a "Check"
// account, and meals at the full rate, go to the reviewer.
import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { BankAccount } from "@/lib/closebook/bank-server";
import type { CodingData, CodeLine } from "@/lib/closebook/coding-server";
import { splitLine } from "@/lib/closebook/sales-tax";
import { suggestionLabel } from "@/lib/closebook/vendor";
import { askClientInline, codeLinesInline, undoLinesInline } from "../actions";
import { NoteOnItem } from "./note-on-item";
import { formatDate } from "@/lib/dates";

type Filter = "needs" | "suggested" | "reviewer" | "ask" | "done" | "all";
const FILTERS: [Filter, string][] = [["needs", "Needs you"], ["suggested", "Suggested"], ["reviewer", "For the reviewer"], ["ask", "Ask the client"], ["done", "Done"], ["all", "All"]];
// Lines charged in US dollars are never confirmed in bulk: each one is checked by hand.
const USD = /\bAMT\s+[\d,.]+\s+USD\b/i;
const money = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const inFilter = (l: CodeLine, f: Filter) => f === "all" ? true : f === "needs" ? l.status === "new" && !l.suggestion : f === "suggested" ? l.status === "new" && !!l.suggestion
  : f === "reviewer" ? l.status === "reviewer" : f === "ask" ? l.status === "ask_client" : l.status === "done";

export function CodingView({ fileId, data, accounts, selected, editable, isReviewer, focusLine = null, noteBy }: {
  fileId: string; data: CodingData; accounts: BankAccount[]; selected: string; editable: boolean; isReviewer: boolean; focusLine?: string | null; noteBy?: { back: string };
}) {
  const router = useRouter();
  // Opened from a report's ledger: the list shows the line's own filter, with the line highlighted.
  const focus = focusLine ? data.lines.find((l) => l.id === focusLine) : undefined;
  // Round 15: the list opens on the first filter with lines (a coded account shows its coded lines).
  const firstWith = (ls: CodeLine[]) => (["needs", "suggested", "reviewer", "ask", "done"] as Filter[]).find((k) => ls.some((l) => inFilter(l, k))) ?? "needs";
  const [filter, setFilter] = useState<Filter>(focus ? FILTERS.map(([k]) => k).find((k) => inFilter(focus, k)) ?? "done"
    : isReviewer && data.lines.some((l) => l.status === "reviewer") ? "reviewer" : firstWith(data.lines.filter((l) => l.account_id === (accounts.find((a) => a.id === selected) ?? accounts[0])?.id)));
  const [q, setQ] = useState("");
  const [showItc, setShowItc] = useState(true);
  useEffect(() => { if (focus) document.getElementById(`line-${focus.id}`)?.scrollIntoView({ block: "center" }); }, [focus]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const chart = useMemo(() => new Map(data.chart.map((c) => [c.number, c])), [data.chart]);
  const codes = useMemo(() => new Map(data.codes.map((c) => [c.code, c])), [data.codes]);
  const acc = accounts.find((a) => a.id === selected) ?? accounts[0];
  const mine = data.lines.filter((l) => l.account_id === acc?.id);
  const count = (f: Filter) => mine.filter((l) => inFilter(l, f)).length;
  const effFilter = count(filter) === 0 && filter === "suggested" && count("needs") > 0 ? "needs" : filter;
  const rows = mine.filter((l) => inFilter(l, effFilter) && (!q || `${l.description} ${l.chart_account ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const ctx = { registered: data.setup.gst_registered !== false, quick: data.setup.quick_method === true };
  // No GST/HST answers yet: no tax is assumed, and nothing is confirmed until step 1 is answered (round 3 item 5).
  const gstAnswered = data.setup.gst_registered !== undefined;
  const byType = useMemo(() => {
    const g = new Map<string, CodingData["chart"]>();
    for (const c of data.chart) { if (!g.has(c.account_type)) g.set(c.account_type, []); g.get(c.account_type)!.push(c); }
    return [...g.entries()];
  }, [data.chart]);

  const run = (f: () => Promise<string | null>) => start(async () => { setErr(null); const e = await f(); if (e) setErr(e); else router.refresh(); });
  // Only suggestions that carry a sales tax code can be confirmed in bulk; the rest stay for one by one.
  const bulkable = (l: CodeLine) => !!l.suggestion?.tax && !USD.test(l.description);
  const confirmSuggested = () => run(() => codeLinesInline(fileId, rows.filter(bulkable).map((l) => ({ id: l.id, account: l.suggestion!.account, tax: l.suggestion!.tax, source: l.suggestion!.source })), []));

  if (!acc) return <p className="text-[12.5px] text-ink-3">Upload a statement in step 3 first.</p>;

  return (
    <div className="grid gap-3">
      {data.error && <p role="alert" className="text-[12.5px] text-danger">{data.error}</p>}
      {data.setup.gst_registered === undefined && (
        <p className="text-[12.5px] text-warning">Answer the GST/HST questions first: <Link href={`/closebook/${fileId}?step=setup`} className="font-semibold text-navy-700 underline">step 1</Link>.</p>
      )}
      <section className="rounded-[10px] border border-sand-200 bg-white" aria-label="Lines">
        {/* One card: the accounts as tabs, a toolbar, the lines (round 15, CaseWare Cloud). */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-sand-200 px-3 py-2" role="tablist" aria-label="Accounts">
          {accounts.map((a) => {
            const total = data.lines.filter((l) => l.account_id === a.id).length;
            const coded = data.lines.filter((l) => l.account_id === a.id && l.status === "done").length;
            const left = data.lines.filter((l) => l.account_id === a.id && l.status === "new").length;
            const on = a.id === acc.id;
            return (
              <Link key={a.id} href={`/closebook/${fileId}?step=code&account=${a.id}`} role="tab" aria-selected={on}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] ${on ? "border border-navy-200 font-semibold text-navy-900" : "text-ink-2 hover:bg-sand-50"}`}>
                {a.name}<span className={`rounded px-1.5 text-[11px] font-semibold ${total && coded === total ? "bg-success-soft text-success" : left ? "bg-warning-soft text-warning" : "bg-sand-100 text-ink-2"}`}>{coded}/{total}</span>
              </Link>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-sand-200 px-3 py-2">
          <label className="inline-flex items-center gap-1 rounded-md border border-sand-300 bg-white px-2 py-1 text-xs"><span className="text-ink-3">Show</span>
            <select value={effFilter} onChange={(e) => setFilter(e.target.value as Filter)} className="bg-transparent outline-none" aria-label="Show">
              {FILTERS.map(([k, label]) => <option key={k} value={k}>{label} ({count(k)})</option>)}</select></label>
          <label className="inline-flex items-center gap-1.5 rounded-md border border-sand-300 bg-white px-2 py-1 text-xs"><input type="checkbox" checked={showItc} onChange={(e) => setShowItc(e.target.checked)} />ITC column</label>
          <span className="flex-1" />
          {editable && effFilter === "suggested" && rows.length > 0 && (
            <button type="button" disabled={pending || !gstAnswered || !rows.some(bulkable)} onClick={confirmSuggested} className="btn btn-compact">Confirm {rows.filter(bulkable).length} suggestion{rows.filter(bulkable).length === 1 ? "" : "s"}</button>
          )}
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search lines" aria-label="Search lines" className="w-56 rounded-md border border-sand-300 px-2 py-1 text-xs outline-none focus:border-navy-600" />
        </div>
        {err && <p role="alert" className="border-b border-danger/30 px-3 py-1.5 text-[12.5px] text-danger">{err}</p>}
        {rows.length === 0 ? <p className="px-3 py-3 text-[12.5px] text-ink-3">Nothing here.</p> : (
          <div className={`overflow-x-auto ${showItc ? "" : "[&_.itc]:hidden"}`}>
            {/* Like the QuickBooks Online bank feed (round 2 item 10): one row per line, Spent and Received apart. */}
            <table className="table table-compact min-w-[960px] table-fixed">
              <colgroup><col className="w-[6.8rem]" /><col /><col className="w-[4.4rem]" /><col className="w-[4.4rem]" /><col className="w-[14.6rem]" /><col className="w-[8rem]" /><col className="itc w-[3.6rem]" /><col className="w-[7.8rem]" /></colgroup>
              <thead><tr><th>Date</th><th>Description</th><th className="text-right">Spent</th><th className="text-right">Received</th>
                <th>Account</th><th>Sales tax</th><th className="itc text-right">ITC</th><th className="text-right">Action</th></tr></thead>
              <tbody>{rows.slice(0, 300).map((l) => (
                <Row key={`${l.id}-${l.status}-${l.suggestion?.account ?? ""}-${l.chart_account ?? ""}`} noteBy={noteBy} l={l} kind={acc.kind} fileId={fileId} chart={chart} codes={codes} byType={byType} ctx={ctx}
                  editable={editable} pending={pending} hasRule={data.ruleKeys.includes(l.key)} run={run} focused={l.id === focus?.id} gstAnswered={gstAnswered} />
              ))}</tbody>
            </table>
            {rows.length > 300 && <p className="px-3 py-2 text-[12.5px] text-ink-3">First 300 of {rows.length}.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ l, kind, fileId, chart, codes, byType, ctx, editable, pending, hasRule, run, focused, gstAnswered, noteBy }: {
  l: CodeLine; kind: string; fileId: string; chart: Map<string, CodingData["chart"][number]>; codes: Map<string, CodingData["codes"][number]>;
  byType: [string, CodingData["chart"]][]; ctx: { registered: boolean; quick: boolean }; editable: boolean; pending: boolean; hasRule: boolean;
  run: (f: () => Promise<string | null>) => void; focused: boolean; gstAnswered: boolean;
  // Round 8: the reviewer (an owner) can add a review note on the line.
  noteBy?: { back: string };
}) {
  const start = l.chart_account ?? l.suggestion?.account ?? "";
  const [account, setAccount] = useState(start);
  // Sales tax starts blank, as in QuickBooks, so an uncoded line stands out; a saved rule fills its own.
  const [tax, setTax] = useState<string>(gstAnswered ? l.tax_code ?? l.suggestion?.tax ?? "" : "");
  const [rowErr, setRowErr] = useState("");
  const [rule, setRule] = useState(false);
  const c = chart.get(account);
  // Money out of a bank account, or a charge on a card, is a purchase.
  const cents = Math.round(l.amount * 100);
  const outflow = kind === "card" ? cents > 0 : cents < 0;
  const side = c?.account_type === "Revenue" ? "sale" : "purchase";
  const split = c && tax ? splitLine(Math.abs(cents), codes.get(tax) ?? null, side, ctx, c.account_type === "Asset") : null;
  const usd = USD.test(l.description);
  // Purchases (and refunds of them) show the ITC; a refund (money in) reverses it, in brackets.
  const itc = split && side === "purchase" ? (outflow ? split.itcCents : -split.itcCents) : 0;
  // Why a taxed purchase claims no ITC, said on the line (round 4 item 5).
  const taxed = !!tax && (codes.get(tax)?.parts.some((x) => x.rate > 0) ?? false);
  const noItc = split && side === "purchase" && taxed && !itc
    ? (!ctx.registered ? "Not registered: no ITC" : ctx.quick && c?.account_type !== "Asset" ? "Quick method: no ITC" : "No ITC on this code") : "";
  // One warning, said the moment the account or tax is chosen (round 2 items 6 and 8): a money-in line on
  // an expense, a money-out line on revenue, meals at the full rate, a "Check" account.
  const moneyIn = !outflow;
  const live = l.status !== "new" ? ""
    : c?.account_type === "Expense" && moneyIn ? "An expense on money in: check it is a refund. Confirm sends it to the reviewer."
    : c?.account_type === "Revenue" && !moneyIn ? "Revenue on money out: check it is a refund to a customer. Confirm sends it to the reviewer."
    : account === "60200" && tax && !tax.startsWith("MEALS") ? "Meals at the full rate: only 50% is claimable. Confirm sends it to the reviewer."
    : c?.tax_default === "Check" ? "The reviewer decides the tax on this account." : "";
  const warning = rowErr || live || l.reviewer_reason || (usd ? "Charged in US dollars: check the amount and the tax." : "");
  const locked = !editable || l.status === "done";
  const amount = money(Math.abs(cents)).replace("$", "");
  return (
    <tr id={`line-${l.id}`} className={`h-[42px] align-middle ${focused ? "bg-navy-50 outline-2 -outline-offset-2 outline-navy-700" : ""}`}>
      <td className="whitespace-nowrap tabular-nums text-ink-2">{formatDate(l.txn_date)}</td>
      <td>{l.description}{l.suggestion && <span className="ml-2 rounded bg-sand-100 px-1.5 py-0.5 text-xs text-ink-2">{suggestionLabel(l.suggestion)}</span>}
        {warning && <span role={rowErr ? "alert" : undefined} className={`block text-xs ${rowErr ? "font-semibold text-danger" : "text-warning"}`}>{warning}</span>}</td>
      <td className="text-right tabular-nums">{outflow ? amount : ""}</td>
      <td className="text-right tabular-nums">{outflow ? "" : amount}</td>
      {l.status === "done" ? <>
        {/* Round 15b (QuickBooks Online's Categorized tab): a coded line is plain text. */}
        <td className="truncate" title={c ? `${account} ${c.name}` : undefined}>{c ? `${account} ${c.name}` : account}</td>
        <td className="truncate">{tax ? codes.get(tax)?.name ?? tax : "No tax"}</td>
      </> : <>
      <td style={{ paddingLeft: 6, paddingRight: 6 }}>
        {/* The chosen account in full, never clipped: the box shows the whole name (wrapping when long) and the
            list opens over it (round 2 item 10). */}
        <span className="relative block">
          <span aria-hidden title={c ? `${account} ${c.name}` : undefined} style={{ paddingLeft: 6, paddingRight: 18, fontSize: 12.5 }} className={`input input-compact block min-h-[30px] overflow-hidden leading-snug text-ellipsis whitespace-nowrap ${locked ? "bg-sand-50 text-ink-3" : ""} ${account ? "" : "text-ink-3"}`}>
            {c ? `${account} ${c.name}` : "Choose an account"}<span className="absolute top-1.5 right-1.5 text-ink-3">▾</span></span>
          <select aria-label="Account" value={account} disabled={locked} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" onChange={(e) => { setAccount(e.target.value); setRowErr(""); }}>
            <option value="">Choose an account</option>
            {byType.map(([t, list]) => <optgroup key={t} label={t}>{list.map((a) => <option key={a.number} value={a.number}>{a.number} {a.name}</option>)}</optgroup>)}
          </select>
        </span>
      </td>
      <td style={{ paddingLeft: 6, paddingRight: 6 }}>
        {/* The full code name in a box, the list opening over it, as for the account (round 4b item 3). */}
        <span className="relative block">
          <span aria-hidden style={{ paddingLeft: 6, paddingRight: 18, fontSize: 13 }}
            className={`input input-compact block min-h-[30px] overflow-hidden leading-snug whitespace-nowrap ${locked || !gstAnswered ? "bg-sand-50 text-ink-3" : ""} ${tax ? "" : "text-ink-3"} ${rowErr && !tax ? "border-danger" : ""}`}>
            {tax ? codes.get(tax)?.name ?? tax : "Choose"}<span className="absolute top-1.5 right-1.5 text-ink-3">▾</span></span>
          <select aria-label="Sales tax" value={tax} disabled={locked || !gstAnswered} className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default" onChange={(e) => { setTax(e.target.value); setRowErr(""); }}>
            <option value="">Choose</option>
            {[...codes.values()].map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </span>
        {noItc && <span className="block text-xs text-ink-3">{noItc}</span>}
      </td>
      </>}
      <td className="itc text-right tabular-nums">{itc ? (itc < 0 ? `(${money(-itc).replace("$", "")})` : money(itc).replace("$", "")) : noItc ? "0.00" : ""}</td>
      <td className="text-right">
        {editable && l.status !== "done" && (
          <span className="inline-flex flex-col items-end gap-1">
            {/* Like the QuickBooks Online bank feed: one action button, the others under its arrow (round 4 item 6). */}
            <span className="flex whitespace-nowrap">
              <button type="button" className="btn btn-compact rounded-r-none" disabled={pending}
                onClick={() => !gstAnswered ? setRowErr("Answer the GST/HST questions in step 1 first.") : !account || !tax ? setRowErr(!account ? "Choose an account first. Nothing was saved." : "Choose a sales tax code first. Nothing was saved.") : run(() => codeLinesInline(fileId, [{ id: l.id, account, tax: tax || null, source: l.suggestion && l.suggestion.account === account ? l.suggestion.source : "manual" }],
                  rule ? [{ key: l.key, account, tax: tax || null }] : []))}>Confirm</button>
              <details className="relative">
                <summary aria-label="More actions" className="btn btn-compact cursor-pointer list-none rounded-l-none border-l border-white/30 px-2">▾</summary>
                <span className="card absolute right-0 z-20 mt-1 grid w-max gap-1 p-1.5 text-left">
                  {l.status !== "ask_client" ? <button type="button" className="rounded px-2 py-1 text-sm hover:bg-sand-100" disabled={pending} onClick={() => run(() => askClientInline(fileId, [l.id]))}>Ask client</button>
                    : <button type="button" className="rounded px-2 py-1 text-sm hover:bg-sand-100" disabled={pending} onClick={() => run(() => undoLinesInline(fileId, [l.id]))}>Undo</button>}
                </span>
              </details>
            </span>
            {!hasRule && l.key && <label className="inline-flex items-center gap-1 text-xs text-ink-2"><input type="checkbox" checked={rule} onChange={(e) => setRule(e.target.checked)} className="h-3 w-3" />Save as a rule</label>}
          </span>
        )}
        {l.status === "done" && editable && <button type="button" className="text-[12.5px] font-semibold text-navy-700 hover:underline" disabled={pending} onClick={() => run(() => undoLinesInline(fileId, [l.id]))}>Undo</button>}
        {noteBy && <span className="ml-2 inline-block align-middle"><NoteOnItem fileId={fileId} step="code" targetType="bank_line" targetId={l.id} back={noteBy.back} icon /></span>}
      </td>
    </tr>
  );
}
