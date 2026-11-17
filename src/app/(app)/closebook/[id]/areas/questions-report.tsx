"use client";
// Round 32 (Hashim, Nov 18, 2026): the Client questions report. Benchmarks: QuickBooks Online's report page (header,
// filters, Export, Print), TaxDome's answered list (screens 08 and 09), CaseWare Cloud Queries (statuses).
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Paperclip, Printer } from "lucide-react";
import { notify } from "@/components/save-state";
import type { QReport } from "@/lib/closebook/questions-server";
import { longDate, money, Q_LABEL, Q_TONE, shortDate, type QStatus } from "@/lib/closebook/questions";
import { MarkSentWindow, NotifyWindow, downloadFile } from "../feed/notify-window";
import { FLD } from "../feed/windows";

const STATUSES: [string, string][] = [["open", "All open"], ["not_sent", "Not sent"], ["waiting", "Waiting"], ["answered", "Answered"], ["closed", "Closed"], ["all", "All"]];

export function QuestionsReport({ data, editable, initialAccount, initialStatus }: { data: QReport; editable: boolean; initialAccount: string; initialStatus: string }) {
  const router = useRouter();
  const [acct, setAcct] = useState(initialAccount);
  const [status, setStatus] = useState(STATUSES.some(([k]) => k === initialStatus) ? initialStatus : "open");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState(false);
  const [win, setWin] = useState<"notify" | "mark" | null>(null);
  const rows = useMemo(() => data.rows.filter((r) => (!acct || r.accountId === acct) && (status === "all" || (status === "open" ? r.status !== "closed" : r.status === status))), [data.rows, acct, status]);
  // None ticked: the rows in the filter.
  const chosen = ticked.size ? rows.filter((r) => ticked.has(r.id)) : rows;
  const ids = chosen.map((r) => r.id);
  const toNotify = chosen.filter((r) => r.status === "not_sent" || r.status === "waiting");
  const toMark = chosen.filter((r) => r.status === "not_sent");
  const allOn = rows.length > 0 && rows.every((r) => ticked.has(r.id));
  const open = (id: string) => router.push(`/closebook/${data.fileId}?step=code&line=${id}&ask=1`);
  const sum = (out: boolean) => rows.filter((r) => r.out === out).reduce((n, r) => n + Math.abs(r.cents), 0);

  return (
    <div data-questions-report>
      <div className="mb-4 text-center">
        <p className="text-[15px] font-bold text-ink">{data.legalName}</p>
        <h1 className="text-xl font-bold text-ink">Client questions</h1>
        <p className="text-[13px] text-ink-2">Year ended {longDate(data.yearEnd)}</p>
        <p className="text-[12px] text-ink-3">Generated {data.generated}</p>
      </div>
      <div className="mb-3 flex flex-wrap items-end gap-3 print:hidden">
        <label className="grid gap-1 text-[12.5px] font-semibold">Account
          <select aria-label="Account" value={acct} onChange={(e) => { setAcct(e.target.value); setTicked(new Set()); }} className={`${FLD} w-56 font-normal`}>
            <option value="">All accounts</option>
            {data.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select></label>
        <label className="grid gap-1 text-[12.5px] font-semibold">Status
          <select aria-label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setTicked(new Set()); }} className={`${FLD} w-40 font-normal`}>
            {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select></label>
        <span className="flex-1" />
        <div className="relative">
          <button type="button" className="btn-secondary inline-flex items-center gap-1" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)} disabled={!rows.length}>Export<ChevronDown className="h-4 w-4" /></button>
          {menu && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-36 overflow-hidden rounded-[8px] border border-sand-200 bg-white py-1 shadow-lg" onMouseLeave={() => setMenu(false)}>
              <button role="menuitem" type="button" className="block w-full px-3 py-1.5 text-left text-[13.5px] hover:bg-sand-50" onClick={() => { setMenu(false); void downloadFile(data.fileId, "xlsx", ids); }}>Excel</button>
              <button role="menuitem" type="button" className="block w-full px-3 py-1.5 text-left text-[13.5px] hover:bg-sand-50" onClick={() => { setMenu(false); void downloadFile(data.fileId, "pdf", ids); }}>PDF</button>
            </div>
          )}
        </div>
        <button type="button" className="btn-secondary inline-flex items-center gap-1.5" onClick={() => window.print()}><Printer className="h-4 w-4" />Print</button>
        {editable && <button type="button" className="btn-secondary" disabled={!toMark.length} onClick={() => setWin("mark")}>Mark as sent</button>}
        {editable && <button type="button" className="btn" disabled={!toNotify.length} onClick={() => setWin("notify")}>Notify client</button>}
      </div>
      {ticked.size > 0 && <p className="mb-2 text-[12.5px] text-ink-2 print:hidden">{ticked.size} ticked. The buttons use the ticked rows. <button type="button" className="font-semibold text-navy-700 hover:underline" onClick={() => setTicked(new Set())}>Clear</button></p>}
      {data.rows.length === 0 || rows.length === 0 ? (
        <p className="rounded-[10px] border border-sand-200 bg-surface px-6 py-10 text-center text-ink-2" data-questions-empty>
          {data.rows.length === 0 ? "No questions for the client. Ask from step 4, in the 💬 column." : "No questions match these filters."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-sand-200 bg-surface">
          <table className="w-full min-w-[1100px] text-[13px]">
            <thead className="bg-sand-50 text-left text-[11.5px] font-semibold tracking-[.04em] text-ink-2 uppercase">
              <tr className="border-b border-sand-200">
                <th className="w-8 px-2 py-2 print:hidden"><input type="checkbox" aria-label="Tick all" checked={allOn} onChange={() => setTicked(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /></th>
                <th className="w-8 px-2 py-2">#</th><th className="px-2 py-2">Date</th><th className="px-2 py-2">Account</th><th className="px-2 py-2">Bank description</th>
                <th className="px-2 py-2 text-right">Spent</th><th className="px-2 py-2 text-right">Received</th><th className="px-2 py-2">Question (latest)</th>
                <th className="px-2 py-2">Status</th><th className="px-2 py-2">Sent on</th><th className="px-2 py-2">Answer (latest)</th><th className="w-10 px-2 py-2 text-center" aria-label="Files">📎</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} data-q-row={r.id} data-q-status={r.status} onClick={() => open(r.id)} className={`cursor-pointer border-b border-sand-100 align-top hover:bg-navy-50/50 ${ticked.has(r.id) ? "bg-navy-50/60" : ""}`}>
                  <td className="px-2 py-2 print:hidden" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" aria-label={`Tick ${r.description}`} checked={ticked.has(r.id)} onChange={() => { const s = new Set(ticked); if (s.has(r.id)) s.delete(r.id); else s.add(r.id); setTicked(s); }} /></td>
                  <td className="px-2 py-2 tabular-nums text-ink-3">{i + 1}</td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{shortDate(r.date)}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{r.account}</td>
                  <td className="max-w-[16rem] px-2 py-2">{r.description}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.out ? money(r.cents) : ""}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.out ? "" : money(r.cents)}</td>
                  <td className="max-w-[18rem] px-2 py-2">{r.question}</td>
                  <td className="px-2 py-2"><StatusChip s={r.status} /></td>
                  <td className="px-2 py-2 whitespace-nowrap tabular-nums">{r.sentOn ? shortDate(r.sentOn) : ""}</td>
                  <td className="max-w-[18rem] px-2 py-2">{r.answer}</td>
                  <td className="px-2 py-2 text-center">{r.files > 0 && <span className="inline-flex items-center gap-0.5 text-ink-2" title={`${r.files} file${r.files === 1 ? "" : "s"} attached`}><Paperclip className="h-3.5 w-3.5" />{r.files}</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-sand-50 font-semibold"><td className="print:hidden" /><td colSpan={4} className="px-2 py-2">{rows.length} question{rows.length === 1 ? "" : "s"}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(sum(true))}</td><td className="px-2 py-2 text-right tabular-nums">{money(sum(false))}</td><td colSpan={5} /></tr></tfoot>
          </table>
        </div>
      )}
      {win === "notify" && <NotifyWindow fileId={data.fileId} lineIds={toNotify.map((r) => r.id)} onClose={() => setWin(null)}
        onSent={(who) => { setWin(null); setTicked(new Set()); notify(`Sent to ${who}`); router.refresh(); }} onCopied={() => { setTicked(new Set()); router.refresh(); }} />}
      {win === "mark" && <MarkSentWindow fileId={data.fileId} lineIds={toMark.map((r) => r.id)} n={toMark.length} onClose={() => setWin(null)}
        onDone={(n) => { setWin(null); setTicked(new Set()); notify(`${n} question${n === 1 ? "" : "s"} marked as sent`); router.refresh(); }} />}
    </div>
  );
}

export const StatusChip = ({ s }: { s: QStatus }) => <span className={`inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${Q_TONE[s]}`} data-chip={s}>{Q_LABEL[s]}</span>;
