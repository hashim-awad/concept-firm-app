"use client";
// Round 35 (Hashim, Nov 17, 2026): step 7 Review, "Lines for the reviewer", as a working list on step 4's table (same
// pickers, look and 48 px rows), from every account, oldest first. Benchmarks: QuickBooks Online Accountant's
// "Reclassify transactions" (change the account in place, one at a time or in a batch) and TaxDome's "Mark reviewed".
// Under it, "Accounts for the reviewer's decision": a note is required to mark one reviewed.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { notify } from "@/components/save-state";
import { formatDate } from "@/lib/dates";
import type { FeedData } from "@/lib/closebook/feed-server";
import { isOut, type FeedLine } from "@/lib/closebook/bank-feed";
import { AccountPicker } from "./account-picker";
import { FLD, Modal, SplitWindow, TaxSelect, money } from "./windows";
import { AskManyWindow, QIcon, QuestionPop } from "./questions";
import { NotifyWindow } from "./notify-window";
import { getLines, recodeLines, resplitLine, reviewAccount, reviewLines, noteOnLine, setMemo } from "../../feed-actions";
import { addSavedQuestion, askQuestions, deleteQuestion, editQuestion, getThreads, moveQuestionToNote, removeSavedQuestion, savedQuestions } from "../../question-actions";

export type ReviewAccountRow = { id: string; label: string; cents: number; why: string; kind: "reviewer" | "type" | "side"; ledgerHref: string };

// "Why": one short line; the full reason on hover.
export function whyShort(reason: string): string {
  const r = reason.trim();
  if (/^An expense coded to money in/.test(r)) return "Money in coded to an expense";
  if (/^Revenue coded to money out/.test(r)) return "Money out coded to revenue";
  if (/sales tax on this account is the reviewer/i.test(r)) return "Sales tax to check";
  if (/^Meals coded at the full rate/.test(r)) return "Meals at the full rate";
  if (/^Uploaded although already in the file/.test(r)) return "Uploaded twice";
  if (/GST\/HST answers changed/.test(r)) return "Sales tax worked out again";
  return r.split(/[.:]/)[0].slice(0, 60);
}

type Status = "waiting" | "reviewed" | "all";
type Win = null | { k: "edit" } | { k: "split"; id: string } | { k: "ask"; ids: string[] } | { k: "note"; id: string } | { k: "account"; row: ReviewAccountRow };

export function ReviewLines({ data, editable, isReviewer, focusLine, accounts: accountRows, stepFour, onCount }: {
  data: FeedData; editable: boolean; isReviewer: boolean; focusLine: string | null; accounts: ReviewAccountRow[];
  stepFour: string; onCount?: (n: number) => void;   // stepFour: step 4's address; the line's account and id are added
}) {
  const isMine = (l: FeedLine) => l.status === "reviewer" || (!!l.reviewed_at && l.status === "done");
  const [lines, setLines] = useState<FeedLine[]>(() => data.lines.filter(isMine).sort((a, b) => a.acct_date.localeCompare(b.acct_date)));
  const [splits, setSplits] = useState(data.splits);
  const [acctRows, setAcctRows] = useState(accountRows);
  const focus = focusLine ? lines.find((l) => l.id === focusLine) : undefined;
  const [status, setStatus] = useState<Status>(focus && focus.status !== "reviewer" ? "all" : "waiting");
  const [q, setQ] = useState("");
  const [acc, setAcc] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<Win>(null);
  const [busy, setBusy] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; body: string }[] | null>(null);
  const accById = useMemo(() => new Map(data.accounts.map((a) => [a.id, a])), [data.accounts]);
  const chartOf = useMemo(() => new Map(data.chart.map((c) => [c.number, c])), [data.chart]);
  const outOf = (l: FeedLine) => isOut(accById.get(l.account_id)?.kind ?? "bank", l.cents);
  // "RBC Chq ••• 7509": the account's own name, without its number and type.
  const bankName = (id: string) => { const a = accById.get(id); if (a?.short) return a.short;
    const l = (a?.label ?? "").replace(/^\d+\s+/, ""); const parts = l.split(" · "); return parts.length > 1 ? parts.slice(1).join(" · ") : l; };
  const people = data.people;
  const waiting = lines.filter((l) => l.status === "reviewer").length;
  const waitingAccounts = acctRows.length;
  // The "with the reviewer" chip above the list updates at once.
  useEffect(() => { onCount?.(waiting + waitingAccounts); window.dispatchEvent(new CustomEvent("cb-review-count", { detail: waiting + waitingAccounts })); }, [waiting, waitingAccounts, onCount]);

  const inStatus = (l: FeedLine) => (status === "waiting" ? l.status === "reviewer" : status === "reviewed" ? l.status === "done" && !!l.reviewed_at : true);
  const rows = lines.filter((l) => inStatus(l) && (!acc || l.account_id === acc)
    && (!q.trim() || l.description.toLowerCase().includes(q.trim().toLowerCase()) || money(l.cents).includes(q.trim().replace(/^\$/, ""))));
  const tickedLines = rows.filter((l) => ticked.has(l.id));
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allTicked = rows.length > 0 && rows.every((l) => ticked.has(l.id));
  const fail = (e: string) => notify(e, "error", { ms: 9000 });
  useEffect(() => { if (focus) setTimeout(() => document.getElementById(`rl-${focus.id}`)?.scrollIntoView({ block: "center" }), 80); }, [focus]);

  const refresh = async (ids: string[]) => {
    const r = await getLines(data.fileId, ids);
    if (!r.ok) return;
    const fresh = new Map(r.lines.map((l) => [l.id, l]));
    setLines((ls) => ls.map((l) => fresh.get(l.id) ?? l).filter((l) => fresh.has(l.id) ? isMine(fresh.get(l.id)!) : true));
    setSplits((s) => { const n = { ...s }; for (const id of ids) { if (r.splits[id]) n[id] = r.splits[id]; else delete n[id]; } return n; });
  };

  // ---------- Another account in place (QuickBooks Online Accountant's Reclassify): the line keeps its sales tax
  // until the tax is changed too.
  const recode = async (items: { id: string; account: string; tax: string }[], label?: string) => {
    const before = items.map((i) => { const l = lines.find((x) => x.id === i.id)!; return { id: i.id, account: l.chart_account ?? "", tax: l.tax_code ?? "" }; });
    setLines((ls) => ls.map((l) => { const i = items.find((x) => x.id === l.id); return i ? { ...l, chart_account: i.account, tax_code: i.tax } : l; }));
    const r = await recodeLines(data.fileId, items);
    if (!r.ok) { fail(r.error); await refresh(items.map((i) => i.id)); return false; }
    notify(label ?? "Changed", "ok", { ms: 8000, action: { label: "Undo", run: async () => {
      setLines((ls) => ls.map((l) => { const b = before.find((x) => x.id === l.id); return b ? { ...l, chart_account: b.account, tax_code: b.tax } : l; }));
      const u = await recodeLines(data.fileId, before.filter((b) => b.account && b.tax));
      if (!u.ok) fail(u.error); else notify("Change undone");
    } } });
    return true;
  };

  // ---------- Mark reviewed (TaxDome) and Undo
  const markReviewed = async (ids: string[]) => {
    const now = new Date().toISOString();
    setLines((ls) => ls.map((l) => (ids.includes(l.id) && l.status === "reviewer" ? { ...l, status: "done", reviewed_reason: l.reviewer_reason, reviewer_reason: "", reviewed_by: data.me, reviewed_at: now } : l)));
    setTicked(new Set());
    const r = await reviewLines(data.fileId, ids);
    if (!r.ok) { fail(r.error); await refresh(ids); return; }
    notify(ids.length === 1 ? "Marked reviewed" : `${ids.length} marked reviewed`, "ok", { ms: 8000, action: { label: "Undo", run: () => { void unmark(ids); } } });
  };
  const unmark = async (ids: string[]) => {
    setLines((ls) => ls.map((l) => (ids.includes(l.id) && l.reviewed_at ? { ...l, status: "reviewer", reviewer_reason: l.reviewed_reason ?? "", reviewed_reason: "", reviewed_by: null, reviewed_at: null } : l)));
    const r = await reviewLines(data.fileId, ids, true);
    if (!r.ok) { fail(r.error); await refresh(ids); return; }
    notify(ids.length === 1 ? "Back with the reviewer" : `${ids.length} back with the reviewer`);
  };

  // ---------- Ask client (round 35b): the line stays posted, with its account, tax and flag; the question stays open
  // until the client answers. A reviewer's question never changes the books.
  const ask = async (ids: string[], text: string) => {
    const r = await askQuestions(data.fileId, ids, text);
    if (!r.ok) { fail(r.error); return false; }
    setLines((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, q_status: "not_sent" } : l)));
    const t = await getThreads(data.fileId, ids);
    if (t.ok) setThreads((x) => ({ ...x, ...t.threads }));
    setTicked(new Set());
    notify(ids.length === 1 ? "Question added" : `Question added to ${ids.length} lines`, "ok", { ms: 8000, action: { label: "Notify now", run: () => setNotifyIds(ids) } });
    return true;
  };
  // The 💬: the line's questions and the client's answers, as in step 4.
  const [threads, setThreads] = useState(data.threads);
  const [qPop, setQPop] = useState<{ el: HTMLElement; id: string } | null>(null);
  // Notify client (the same window as step 4): the questions on these lines that are not sent or still waiting.
  const [notifyIds, setNotifyIds] = useState<string[] | false>(false);
  const toSend = lines.filter((l) => l.q_status === "not_sent" || l.q_status === "waiting").map((l) => l.id);
  const sentNow = (ids: string[]) => { const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
    setLines((ls) => ls.map((l) => (ids.includes(l.id) && (l.q_status === "not_sent" || l.q_status === "waiting") ? { ...l, q_status: "waiting", q_sent_on: today } : l)));
    void getThreads(data.fileId, ids).then((t) => { if (t.ok) setThreads((x) => ({ ...x, ...t.threads })); }); };
  const loadSaved = async () => { if (saved) return; const r = await savedQuestions(); setSaved(r.ok ? r.list : []); };

  // ---------- Words for a row
  const accountLabel = (l: FeedLine) => (l.chart_account ? `${l.chart_account} ${chartOf.get(l.chart_account)?.name ?? ""}`.trim() : "");
  const transferish = (l: FeedLine) => !!l.transfer || !!l.transfer_account || l.source === "transfer" || l.source === "outstanding";
  const th = "px-2 py-2 text-left text-[12px] font-semibold tracking-[.04em] text-ink-3 uppercase";
  const thR = `${th} text-right`;
  const reviewedView = status === "reviewed";
  const spent = tickedLines.filter(outOf).reduce((n, l) => n + Math.abs(l.cents), 0), got = tickedLines.filter((l) => !outOf(l)).reduce((n, l) => n + Math.abs(l.cents), 0);
  const barOn = tickedLines.length > 0 && status !== "reviewed";
  const listRef = useRef<HTMLElement>(null);
  const [barBox, setBarBox] = useState<{ left: number; width: number } | null>(null);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !barOn) return;
    const place = () => { const r = el.getBoundingClientRect(); setBarBox({ left: r.left, width: r.width }); };
    place(); const o = new ResizeObserver(place); o.observe(el); window.addEventListener("resize", place);
    return () => { o.disconnect(); window.removeEventListener("resize", place); };
  }, [barOn]);
  const reviewerOnly = isReviewer ? undefined : "Reviewer only";

  return (
    <div className="grid gap-4">
      <section ref={listRef} className="rounded-[var(--radius-ds)] border border-sand-200 bg-white" aria-label="Lines for the reviewer" data-review-lines>
        <h2 className="border-b border-sand-200 px-3 py-2.5 text-[15px] font-semibold">Lines for the reviewer</h2>
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3 py-2">
          <label className="flex h-8 w-60 items-center gap-1.5 rounded-[6px] border border-sand-300 px-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description or amount" aria-label="Search" className="min-w-0 flex-1 text-[13.5px] outline-none" /></label>
          <select aria-label="Account" value={acc} onChange={(e) => { setAcc(e.target.value); setTicked(new Set()); }} className="h-8 rounded-[6px] border border-sand-300 bg-white px-2 text-[13.5px]">
            <option value="">All accounts</option>{data.accounts.map((a) => <option key={a.id} value={a.id}>{bankName(a.id)}</option>)}</select>
          <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value as Status); setTicked(new Set()); }} className="h-8 rounded-[6px] border border-sand-300 bg-white px-2 text-[13.5px]">
            <option value="waiting">Waiting for the reviewer</option><option value="reviewed">Reviewed</option><option value="all">All</option></select>
          <span className="flex-1" />
          {editable && toSend.length > 0 && <button type="button" onClick={() => setNotifyIds(toSend)} className="mr-2 text-[14px] font-semibold text-navy-700 hover:underline" data-step7-notify>Notify client</button>}
          <span className="text-[13px] text-ink-2 tabular-nums" data-review-count>{rows.length ? `1-${rows.length} of ${rows.length}` : "0 of 0"}</span>
        </div>
        <div className="overflow-x-auto">
          {/* Round 36: ten columns do not fit a 1280 px window with a 220 px description, so the bank account and the Why
              sit on a grey second line under the description (QuickBooks Online shows the bank detail there). */}
          <table className="w-full table-fixed text-[13.5px]" style={{ minWidth: 708 + 220 }} data-feed-table>
            <colgroup><col className="w-8" /><col className="w-24" /><col /><col className="w-20" /><col className="w-20" /><col className="w-8" />
              <col className="w-[6.75rem]" /><col className="w-36" /><col className="w-[8.5rem]" /></colgroup>
            <thead><tr className="border-b border-sand-200">
              <th className="px-2 py-2"><input type="checkbox" aria-label="Tick all" checked={allTicked} disabled={!editable || !rows.length || reviewedView}
                onChange={() => setTicked(allTicked ? new Set() : new Set(rows.map((l) => l.id)))} /></th>
              <th className={th}>Date</th><th className={th}>Bank description</th><th className={thR}>Spent</th><th className={thR}>Received</th>
              <th className={th} aria-label="Questions to the client" title="Questions to the client">💬</th><th className={th}>Sales tax</th><th className={th}>Account</th><th className={thR}>Action</th></tr></thead>
            <tbody>{rows.map((l) => row(l))}</tbody>
          </table>
          {!rows.length && <p className="px-3 py-4 text-[13.5px] text-ink-3">{status === "waiting" ? "Nothing waits for the reviewer." : "Nothing here."}</p>}
        </div>
      </section>
      {barOn && <div aria-hidden className="h-16" />}

      {/* Piece R1 (D5): on a bank-statement file accounts are decided in step 8, so the card shows only if rows are passed. */}
      {acctRows.length > 0 && (
      <section className="rounded-[var(--radius-ds)] border border-sand-200 bg-white" aria-label="Accounts for the reviewer's decision" data-review-accounts>
        <h2 className="border-b border-sand-200 px-3 py-2.5 text-[15px] font-semibold">Accounts for the reviewer&rsquo;s decision</h2>
        {acctRows.length === 0 ? <p className="px-3 py-3 text-[13.5px] text-ink-3">Nothing waits for the reviewer.</p> : (
          <table className="w-full table-fixed text-[13.5px]">
            <colgroup><col className="w-[18rem]" /><col className="w-[8rem]" /><col /><col className="w-[9rem]" /></colgroup>
            <thead><tr className="border-b border-sand-200"><th className={th}>Account</th><th className={thR}>Balance</th><th className={th}>Why</th><th className={thR}>Action</th></tr></thead>
            <tbody>{acctRows.map((a) => (
              <tr key={a.id} className="h-12 border-b border-sand-100" data-review-account={a.label}>
                <td className="truncate px-2"><Link href={a.ledgerHref} className="font-semibold text-navy-700 hover:underline">{a.label}</Link></td>
                <td className={`px-2 text-right tabular-nums ${a.cents < 0 ? "text-danger" : ""}`}>{a.cents < 0 ? `(${money(a.cents)})` : money(a.cents)}</td>
                <td className="truncate px-2 text-ink-2" title={a.why}>{a.why}</td>
                <td className="px-2 text-right"><span title={reviewerOnly} className="inline-flex"><button type="button" disabled={!editable || !isReviewer} onClick={() => setWin({ k: "account", row: a })}
                  className="font-semibold text-navy-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline">Mark reviewed</button></span></td>
              </tr>))}</tbody>
          </table>)}
      </section>
      )}

      {barOn && (
        <div role="toolbar" aria-label="Ticked lines" style={barBox ? { left: barBox.left, width: barBox.width } : { left: 0, right: 0 }}
          className="fixed bottom-0 z-[60] flex min-h-14 flex-wrap items-center gap-2 rounded-t-[var(--radius-ds)] bg-[#1d2330] px-5 py-2.5 text-[14px] text-white shadow-[0_-8px_24px_rgba(0,0,0,.25)]">
          <span className="mr-auto font-semibold tabular-nums" data-bar-text>{`${tickedLines.length} line${tickedLines.length === 1 ? "" : "s"}`}{spent ? ` · Spent ${money(spent)}` : ""}{got ? ` · Received ${money(got)}` : ""}</span>
          {([["Mark reviewed", () => markReviewed(tickedLines.filter((l) => l.status === "reviewer").map((l) => l.id)), !isReviewer, reviewerOnly],
            ["Edit", () => setWin({ k: "edit" }), tickedLines.some((l) => transferish(l) || l.is_split), tickedLines.some((l) => transferish(l) || l.is_split) ? "A transfer or a split line is ticked." : undefined],
            ["Ask client", () => { void loadSaved(); setWin({ k: "ask", ids: tickedLines.map((l) => l.id) }); }, false, undefined]] as const).map(([label, run, off, why]) => (
            <span key={label} title={why} className="inline-flex"><button type="button" disabled={off || busy || !editable} onClick={run}
              className="h-9 rounded-[6px] border border-white/80 px-4 font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:border-white/30 disabled:text-white/40">{label}</button></span>))}
          <button type="button" aria-label="Clear the ticks" onClick={() => setTicked(new Set())} className="ml-3 grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"><X className="h-5 w-5" /></button>
        </div>)}

      {win?.k === "edit" && <RecodeWindow n={tickedLines.length} out={tickedLines.every(outOf)} data={data} onClose={() => setWin(null)} onApply={async (account, tax) => {
        setBusy(true); const ok = await recode(tickedLines.map((l) => ({ id: l.id, account, tax })), `${tickedLines.length} changed`); setBusy(false);
        if (ok) setWin(null);
      }} />}
      {win?.k === "split" && (() => {
        const l = lines.find((x) => x.id === win.id)!;
        return <SplitWindow line={{ date: l.acct_date, description: l.description, cents: l.cents }} out={outOf(l)} chart={data.chart} codes={data.codes} defaultTax={data.defaultTax}
          initial={splits[l.id] ?? (l.chart_account ? [{ account: l.chart_account, tax: l.tax_code ?? "", cents: Math.abs(l.cents), memo: "" }] : [])} onClose={() => setWin(null)}
          onSave={async (rs) => { const r = await resplitLine(data.fileId, l.id, rs); if (!r.ok) { fail(r.error); return false; } await refresh([l.id]); notify(`Split in ${rs.length}`); return true; }} />;
      })()}
      {win?.k === "ask" && <AskManyWindow n={win.ids.length} saved={saved} onClose={() => setWin(null)} onSend={(t) => ask(win.ids, t)}
        onSave={async (t) => { const r = await addSavedQuestion(t); if (r.ok) setSaved((x) => [...(x ?? []), { id: r.id, body: t }]); else fail(r.error); }}
        onRemove={async (id) => { setSaved((x) => (x ?? []).filter((s) => s.id !== id)); await removeSavedQuestion(id); }} />}
      {notifyIds !== false && <NotifyWindow fileId={data.fileId} lineIds={notifyIds} onClose={() => setNotifyIds(false)}
        onSent={(who) => { const ids = notifyIds; setNotifyIds(false); notify(`Sent to ${who}`); sentNow(ids); }} onCopied={() => sentNow(notifyIds)} />}
      {qPop && lines.find((x) => x.id === qPop.id) && (() => {
        const l = lines.find((x) => x.id === qPop.id)!;
        const reload = async () => { const t = await getThreads(data.fileId, [l.id]); if (t.ok) setThreads((x) => ({ ...x, [l.id]: t.threads[l.id] ?? [] })); await refresh([l.id]); };
        return <QuestionPop anchor={qPop.el} line={{ date: l.acct_date, description: l.description, amount: money(l.cents) }} thread={threads[l.id] ?? []} status={l.q_status ?? ""}
          canAsk={editable} saved={saved} memo={l.memo ?? ""} onClose={() => setQPop(null)}
          onSave={async (t) => { const r = await addSavedQuestion(t); if (r.ok) setSaved((x) => [...(x ?? []), { id: r.id, body: t }]); else fail(r.error); }}
          onRemove={async (id) => { setSaved((x) => (x ?? []).filter((s) => s.id !== id)); await removeSavedQuestion(id); }}
          onSend={(t) => ask([l.id], t)}
          onSaveMemo={async (m) => { const r = await setMemo(l.id, m); if (!r.ok) { fail(r.error); return false; } setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, memo: m } : x))); notify("Internal note saved"); return true; }}
          actions={{
            onEdit: async (id, text) => { const r = await editQuestion(id, text); if (!r.ok) { fail(r.error); return false; } await reload(); notify("Question changed"); return true; },
            onDelete: async (id) => { const r = await deleteQuestion(id); if (!r.ok) { fail(r.error); return; } await reload(); notify("Question deleted"); },
            onMove: async (id) => { const r = await moveQuestionToNote(id); if (!r.ok) { fail(r.error); return; } await reload(); notify("Moved to the internal note"); },
          }} />;
      })()}
      {win?.k === "note" && <TextWindow title="Add review note" label="Review note" button="Add review note" min={1} onClose={() => setWin(null)} onSave={async (t) => {
        const r = await noteOnLine(data.fileId, win.id, t); if (!r.ok) { fail(r.error); return false; } notify("Review note added"); return true; }} />}
      {win?.k === "account" && <TextWindow title={`Mark reviewed: ${win.row.label}`} label="Decision" button="Mark reviewed" min={3} hint="Required. Say what you decided and why. It is kept with the account."
        onClose={() => setWin(null)} onSave={async (t) => {
          const r = await reviewAccount(data.fileId, win.row.id, win.row.kind, t);
          if (!r.ok) { fail(r.error); return false; }
          setAcctRows((rs) => rs.filter((x) => x.id !== win.row.id)); notify("Account marked reviewed"); return true;
        }} />}
    </div>
  );

  // A row (a plain function, not a component, so the pickers keep their state while the list re-renders).
  function row(l: FeedLine) {
    const out = outOf(l);
    const menu = menuFor === l.id;
    const setMenu = (on: boolean) => setMenuFor(on ? l.id : null);
    const waitingRow = l.status === "reviewer";
    const reason = waitingRow ? l.reviewer_reason : l.reviewed_reason ?? "";
    const canPick = editable && waitingRow && !transferish(l) && !l.is_split;
    return (
      <tr key={l.id} id={`rl-${l.id}`} data-review-line={l.description} className={`h-12 border-b border-sand-100 ${ticked.has(l.id) ? "bg-navy-50/60" : ""} ${focus?.id === l.id ? "bg-navy-50 outline outline-2 -outline-offset-2 outline-navy-400" : ""}`}>
        <td className="px-2"><input type="checkbox" aria-label={`Tick ${l.description}`} checked={ticked.has(l.id)} disabled={!editable || reviewedView || !waitingRow} onChange={() => toggle(l.id)} /></td>
        <td className="px-2 whitespace-nowrap tabular-nums">{formatDate(l.acct_date)}</td>
        {/* The description, one line; under it in grey: the bank and the last digits in full (round 35b: the digits never
            shorten), then why the line is with the reviewer, or who reviewed it and when. */}
        <td className="px-2 py-1">
          <span className="block truncate leading-5" title={l.description}>{l.description}</span>
          <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-[12px] leading-4 text-ink-3">
            <span className="shrink-0" title={bankName(l.account_id)} data-bank-account>{bankName(l.account_id)}</span>
            {waitingRow ? <span className="truncate font-semibold text-warning" title={reason} data-why>· {whyShort(reason)}</span>
              : <span className="truncate" title={reason ? `Was with the reviewer: ${reason}` : undefined}>· Reviewed <span data-reviewed-by>{people[l.reviewed_by ?? ""]?.initials ?? ""} · {l.reviewed_at ? formatDate(l.reviewed_at.slice(0, 10)) : ""}</span></span>}
          </span></td>
        <td className="px-2 text-right tabular-nums">{out ? money(l.cents) : ""}</td>
        <td className="px-2 text-right tabular-nums">{out ? "" : money(l.cents)}</td>
        <td className="px-1 text-center"><QIcon id={l.id} status={l.q_status ?? ""} thread={threads[l.id] ?? []} disabled={!editable} onOpen={(el) => { void loadSaved(); setQPop({ el, id: l.id }); }} /></td>
        <td className="px-1.5" title={transferish(l) || l.is_split ? undefined : data.codes.find((x) => x.code === l.tax_code)?.name}>{transferish(l) || l.is_split ? <span className="block truncate px-1 text-ink-3">{l.is_split ? "Split" : "No tax"}</span>
          : <TaxSelect codes={data.codes} value={l.tax_code ?? ""} disabled={!canPick} label={`Sales tax for ${l.description}`}
            onChange={(t) => { if (t && l.chart_account) void recode([{ id: l.id, account: l.chart_account, tax: t }]); }} />}</td>
        <td className="px-1.5">{l.is_split
          ? <button type="button" disabled={!editable || !waitingRow} onClick={() => setWin({ k: "split", id: l.id })} className="flex h-8 w-full items-center rounded-[6px] border border-sand-300 px-2 text-left text-navy-700 disabled:text-ink-3">Split ({splits[l.id]?.length ?? 0})</button>
          : transferish(l) ? <span className="block truncate px-1 text-ink-2" title={accountLabel(l) || "Transfer"}>{accountLabel(l) || "Transfer"}</span>
          : <AccountPicker chart={data.chart} banks={[]} out={out} ownAccount={l.account_id} label={accountLabel(l)} disabled={!canPick}
            onPick={(pk) => { if ("account" in pk) void recode([{ id: l.id, account: pk.account, tax: l.tax_code ?? data.defaultTax[pk.account] ?? "" }]); }} />}</td>
        <td className="relative px-2 text-right whitespace-nowrap">{!waitingRow ? (
          editable && isReviewer && <button type="button" onClick={() => unmark([l.id])} className="font-semibold text-navy-700 hover:underline">Undo</button>
        ) : editable && <>
          <span title={reviewerOnly} className="inline-flex"><button type="button" disabled={!isReviewer} onClick={() => markReviewed([l.id])}
            className="font-semibold text-navy-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline">Mark reviewed</button></span>
          <span className="mx-1.5 text-sand-300">|</span>
          <button type="button" aria-label={`More actions for ${l.description}`} onClick={() => setMenu(!menu)} className="text-navy-700">▾</button>
          {menu && <span className="card absolute right-1 z-30 mt-1 grid w-max gap-0.5 p-1.5 text-left" onMouseLeave={() => setMenu(false)}>
            {([["Split", () => setWin({ k: "split", id: l.id }), transferish(l)], ["Ask client", () => { void loadSaved(); setWin({ k: "ask", ids: [l.id] }); }, false],
              ["Add review note", () => setWin({ k: "note", id: l.id }), !isReviewer], ["Open in step 4", () => { window.location.href = `${stepFour}&account=${l.account_id}&line=${l.id}`; }, false]] as [string, () => void, boolean][]).map(([t, run, off]) => (
              <button key={t} type="button" disabled={off} title={off && t === "Add review note" ? "Reviewer only" : undefined} className="rounded px-3 py-1 text-left hover:bg-sand-100 disabled:text-ink-3" onClick={() => { setMenu(false); run(); }}>{t}</button>))}
          </span>}</>}</td>
      </tr>
    );
  }
}

// Edit selected transactions: Account and Sales tax; Apply re-posts every ticked line.
function RecodeWindow({ n, out, data, onClose, onApply }: { n: number; out: boolean; data: FeedData; onClose: () => void; onApply: (account: string, tax: string) => Promise<void> }) {
  const [account, setAccount] = useState("");
  const [tax, setTax] = useState("");
  const [busy, setBusy] = useState(false);
  const label = account ? `${account} ${data.chart.find((c) => c.number === account)?.name ?? ""}` : "";
  return (
    <Modal title="Edit selected transactions" onClose={onClose} width={520} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={!account || !tax || busy} onClick={async () => { setBusy(true); await onApply(account, tax); setBusy(false); }}>Apply</button></>}>
      <p className="text-ink-2">{n} transaction{n === 1 ? "" : "s"} selected. Apply changes the account and sales tax on each, and re-posts it.</p>
      <div className="grid gap-1"><span className="font-semibold">Account</span>
        <AccountPicker chart={data.chart} banks={[]} out={out} ownAccount={null} label={label} onPick={(p) => { if ("account" in p) { setAccount(p.account); setTax(data.defaultTax[p.account] ?? tax); } }} /></div>
      <label className="grid gap-1 font-semibold">Sales tax<TaxSelect codes={data.codes} value={tax} onChange={setTax} /></label>
    </Modal>
  );
}

// A short text window: a review note on a line, or the decision on an account (required).
function TextWindow({ title, label, button, min, hint, onClose, onSave }: { title: string; label: string; button: string; min: number; hint?: string; onClose: () => void; onSave: (t: string) => Promise<boolean> }) {
  const [t, setT] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose} width={520} foot={<>
      <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="btn" disabled={busy || t.trim().length < min} onClick={async () => { setBusy(true); const ok = await onSave(t.trim()); setBusy(false); if (ok) onClose(); }}>{button}</button></>}>
      <label className="grid gap-1 font-semibold">{label}
        <textarea aria-label={label} value={t} onChange={(e) => setT(e.target.value)} rows={4} maxLength={500} className={`${FLD} h-auto py-1.5 font-normal`} autoFocus /></label>
      {hint && <p className="text-[12.5px] text-ink-3">{hint}</p>}
    </Modal>
  );
}
