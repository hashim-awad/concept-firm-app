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

type Filter = "needs" | "suggested" | "reviewer" | "ask" | "done";
const FILTERS: [Filter, string][] = [["needs", "Needs you"], ["suggested", "Suggested"], ["reviewer", "For the reviewer"], ["ask", "Ask the client"], ["done", "Done"]];
// Lines charged in US dollars are never confirmed in bulk: each one is checked by hand.
const USD = /\bAMT\s+[\d,.]+\s+USD\b/i;
const money = (c: number) => (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD" });
const inFilter = (l: CodeLine, f: Filter) => f === "needs" ? l.status === "new" && !l.suggestion : f === "suggested" ? l.status === "new" && !!l.suggestion
  : f === "reviewer" ? l.status === "reviewer" : f === "ask" ? l.status === "ask_client" : l.status === "done";

export function CodingView({ fileId, data, accounts, selected, editable, isReviewer, focusLine = null }: {
  fileId: string; data: CodingData; accounts: BankAccount[]; selected: string; editable: boolean; isReviewer: boolean; focusLine?: string | null;
}) {
  const router = useRouter();
  // Opened from a report's ledger: the list shows the line's own filter, with the line highlighted.
  const focus = focusLine ? data.lines.find((l) => l.id === focusLine) : undefined;
  const [filter, setFilter] = useState<Filter>(focus ? FILTERS.map(([k]) => k).find((k) => inFilter(focus, k)) ?? "done"
    : isReviewer && data.lines.some((l) => l.status === "reviewer") ? "reviewer" : "suggested");
  useEffect(() => { if (focus) document.getElementById(`line-${focus.id}`)?.scrollIntoView({ block: "center" }); }, [focus]);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const chart = useMemo(() => new Map(data.chart.map((c) => [c.number, c])), [data.chart]);
  const codes = useMemo(() => new Map(data.codes.map((c) => [c.code, c])), [data.codes]);
  const acc = accounts.find((a) => a.id === selected) ?? accounts[0];
  const mine = data.lines.filter((l) => l.account_id === acc?.id);
  const count = (f: Filter) => mine.filter((l) => inFilter(l, f)).length;
  const effFilter = count(filter) === 0 && filter === "suggested" && count("needs") > 0 ? "needs" : filter;
  const rows = mine.filter((l) => inFilter(l, effFilter));
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

  if (!acc) return <p className="card text-sm text-ink-2">Upload a statement in step 2 first: the lines to code come from the statements.</p>;

  return (
    <div className="grid gap-4">
      {data.error && <p role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">{data.error}</p>}
      {data.setup.gst_registered === undefined && (
        <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">The GST/HST questions are not answered yet, so no sales tax is worked out and no line can be confirmed. <Link href={`/closebook/${fileId}?step=setup`} className="font-semibold text-navy-700 underline">Answer them in step 1</Link>.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {accounts.map((a) => {
          const left = data.lines.filter((l) => l.account_id === a.id && l.status === "new").length;
          const total = data.lines.filter((l) => l.account_id === a.id).length;
          // Coded means done: a line waiting for the reviewer or the client is not coded yet (round 2 item 16).
          const coded = data.lines.filter((l) => l.account_id === a.id && l.status === "done").length;
          const withClient = data.lines.filter((l) => l.account_id === a.id && l.status === "ask_client").length;
          const withReviewer = data.lines.filter((l) => l.account_id === a.id && l.status === "reviewer").length;
          return (
            <Link key={a.id} href={`/closebook/${fileId}?step=code&account=${a.id}`} aria-current={a.id === acc.id ? "true" : undefined}
              className={`card grid gap-1 p-4 ${a.id === acc.id ? "ring-2 ring-navy-700" : "hover:border-navy-300"}`}>
              <span className="flex justify-between gap-2"><span className="font-semibold">{a.name}</span>
                {total === 0 ? <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-3">No lines yet</span>
                  : coded === total ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">✓ Coded</span>
                  : <span className="flex flex-wrap justify-end gap-1">
                    {left > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{left} to code</span>}
                    {withReviewer > 0 && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">{withReviewer} with the reviewer</span>}
                    {withClient > 0 && <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-2">{withClient} with the client</span>}</span>}</span>
              <span className="text-xs text-ink-2">{coded} of {total} lines coded</span>
            </Link>
          );
        })}
      </div>

      <section className="card overflow-hidden p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 px-4 py-3">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Lines">
            {FILTERS.map(([k, label]) => (
              <button key={k} type="button" role="tab" aria-selected={effFilter === k} onClick={() => setFilter(k)}
                className={`rounded-full px-3 py-1.5 text-sm ${effFilter === k ? "bg-navy-700 font-semibold text-white" : "border border-sand-200 text-ink-2 hover:border-navy-300"}`}>{label} · {count(k)}</button>
            ))}
          </div>
          {editable && effFilter === "suggested" && rows.length > 0 && (
            <button type="button" disabled={pending || !gstAnswered || !rows.some(bulkable)} onClick={confirmSuggested} className="btn">Confirm {rows.filter(bulkable).length} suggestion{rows.filter(bulkable).length === 1 ? "" : "s"}</button>
          )}
        </div>
        {err && <p role="alert" className="border-b border-danger/30 bg-danger/10 px-4 py-2 text-sm text-danger">{err}</p>}
        {rows.length === 0 ? <p className="p-5 text-sm text-ink-2">Nothing here.</p> : (
          <div className="overflow-x-auto">
            {/* Like the QuickBooks Online bank feed (round 2 item 10): one row per line, Spent and Received apart. */}
            <table className="table table-compact min-w-[960px] table-fixed">
              <colgroup><col className="w-[5.4rem]" /><col /><col className="w-[4.4rem]" /><col className="w-[4.4rem]" /><col className="w-[14.6rem]" /><col className="w-[8rem]" /><col className="w-[3.6rem]" /><col className="w-[7.8rem]" /></colgroup>
              <thead><tr><th>Date</th><th>Description</th><th className="text-right">Spent</th><th className="text-right">Received</th>
                <th>Account</th><th>Sales tax</th><th className="text-right">ITC</th><th className="text-right">Action</th></tr></thead>
              <tbody>{rows.slice(0, 300).map((l) => (
                <Row key={`${l.id}-${l.status}-${l.suggestion?.account ?? ""}-${l.chart_account ?? ""}`} l={l} kind={acc.kind} fileId={fileId} chart={chart} codes={codes} byType={byType} ctx={ctx}
                  editable={editable} pending={pending} hasRule={data.ruleKeys.includes(l.key)} run={run} focused={l.id === focus?.id} gstAnswered={gstAnswered} />
              ))}</tbody>
            </table>
            {rows.length > 300 && <p className="px-4 py-3 text-sm text-ink-2">Showing the first 300 of {rows.length}. Confirm these to see the rest.</p>}
          </div>
        )}
      </section>
    </div>
  );
}

function Row({ l, kind, fileId, chart, codes, byType, ctx, editable, pending, hasRule, run, focused, gstAnswered }: {
  l: CodeLine; kind: string; fileId: string; chart: Map<string, CodingData["chart"][number]>; codes: Map<string, CodingData["codes"][number]>;
  byType: [string, CodingData["chart"]][]; ctx: { registered: boolean; quick: boolean }; editable: boolean; pending: boolean; hasRule: boolean;
  run: (f: () => Promise<string | null>) => void; focused: boolean; gstAnswered: boolean;
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
    <tr id={`line-${l.id}`} className={`align-top ${focused ? "bg-navy-50 outline-2 -outline-offset-2 outline-navy-700" : ""}`}>
      <td className="whitespace-nowrap tabular-nums text-ink-2">{l.txn_date}</td>
      <td>{l.description}{l.suggestion && <span className="ml-2 rounded bg-sand-100 px-1.5 py-0.5 text-xs text-ink-2">{suggestionLabel(l.suggestion)}</span>}
        {warning && <span role={rowErr ? "alert" : undefined} className={`block text-xs ${rowErr ? "font-semibold text-danger" : "text-warning"}`}>{warning}</span>}</td>
      <td className="text-right tabular-nums">{outflow ? amount : ""}</td>
      <td className="text-right tabular-nums">{outflow ? "" : amount}</td>
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
      <td className="text-right tabular-nums">{itc ? (itc < 0 ? `(${money(-itc).replace("$", "")})` : money(itc).replace("$", "")) : noItc ? "0.00" : ""}</td>
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
        {l.status === "done" && (
          <span className="inline-flex items-center gap-2">
            <span className="text-xs text-success">Coded</span>
            {editable && <button type="button" className="btn-secondary btn-compact" disabled={pending} onClick={() => run(() => undoLinesInline(fileId, [l.id]))}>Undo</button>}
          </span>
        )}
      </td>
    </tr>
  );
}
