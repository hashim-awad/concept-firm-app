"use client";
// Piece R1 (Hashim, Nov 19, 2026; mock N; benchmark CaseWare Cloud's account panel over the working trial balance): a
// click on a Trial balance row opens the account over the page: the account and its group, Prelim, Adjust, Reclass,
// Final and Prior (each amount opens the account's postings, as the table's amounts do), and links "Open the ledger",
// "New entry on this account", "Reclassify lines on this account", "Add a review note". On a shareholder account only,
// the Shareholder name (piece 8) with Save; History records it as before. The panel is not in the address: Close and
// Escape return to the same row, view, search and scroll, and a reload does not reopen it.
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { NoteOnItem } from "../note-on-item";
import { setShNameInline } from "../../sh-actions";

export type PanelAccount = { key: string; id: string; number: string; name: string; group: string; prelim: number; adjust: number; tje: number; reclass: number; final: number; last: number;
  sh: boolean; shName: string };

const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function AccountPanel({ fileId, a, view, year, canReview, editable, onClose, noteStep = "compare" }: {
  fileId: string; a: PanelAccount; view: string; year: number; canReview: boolean; editable: boolean; onClose: () => void; noteStep?: string;
}) {
  const base = `/closebook/${fileId}`;
  const here = `${base}?area=tb&tbv=${view}#a-${encodeURIComponent(a.key)}`;
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; });
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", esc);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", esc);
  }, []);
  // Keyboard focus stays inside the panel while it is open (Tab cycles from the last control back to the first).
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !panelRef.current) return;
    const els = [...panelRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled]), textarea")];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  const [name, setName] = useState(a.shName);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const drill = (col: string) => `${base}?area=tb&tbv=${view}&drill=${encodeURIComponent(a.key)}&col=${col}`;
  // Workpaper finding 15: the tax entries (TJE) on their own row when the account has any; Adjust is then the AJEs only.
  const figs: [string, number, string | null][] = [[`Prelim ${year}`, a.prelim, "prelim"], ...(a.tje ? [["Adjust", a.adjust - a.tje, "adjust"], ["Tax", a.tje, "adjust"]] as [string, number, string][] : [["Adjust", a.adjust, "adjust"]] as [string, number, string][]),
    ["Reclass", a.reclass, "reclass"], [`Final ${year}`, a.final, "final"], [`Prior ${year - 1}`, a.last, null]];
  const link = "text-[13px] text-navy-700 hover:underline";
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`${a.number} ${a.name}`.trim()} data-account-panel={a.key}>
      <div className="absolute inset-0 bg-navy-950/20" onClick={onClose} />
      <aside ref={panelRef} tabIndex={-1} onKeyDown={trap} className="absolute inset-y-0 right-0 flex w-[440px] max-w-full flex-col overflow-y-auto bg-white shadow-2xl outline-none">
        <div className="flex items-start gap-2 border-b border-sand-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold">{a.number && <span className="mr-2 tabular-nums">{a.number}</span>}{a.name}</h2>
            {a.group && <p className="text-[12.5px] text-ink-2">Group: {a.group}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1.5 text-ink-2 hover:bg-sand-100"><X className="h-5 w-5" /></button>
        </div>
        <table className="mx-5 mt-3 text-[13px]"><tbody>
          {figs.map(([l, c, col]) => (
            <tr key={l} className={l.startsWith("Final") ? "font-semibold" : ""}><td className="py-1 pr-6">{l}</td>
              <td className="py-1 text-right tabular-nums">{col && c ? <Link href={drill(col)} scroll={false} onClick={onClose} className="text-navy-700 hover:underline">{money(c)}</Link> : money(c)}</td></tr>
          ))}
        </tbody></table>
        <div className="mx-5 mt-4 grid gap-2 border-t border-sand-200 pt-3">
          <Link href={`${base}?area=reporting&report=gl&account=${encodeURIComponent(a.key)}&back=${encodeURIComponent(here)}`} className={link}>Open the ledger</Link>
          {editable && a.id && <Link href={`${base}?area=tb&tbv=${view}&new=journal&acct=${a.id}&back=${encodeURIComponent(here)}`} scroll={false} onClick={onClose} className={link}>New entry on this account</Link>}
          {editable && <Link href={`${base}?area=tb&tool=reclassify&account=${encodeURIComponent(a.key)}&back=${encodeURIComponent(here)}`} className={link}>Reclassify lines on this account</Link>}
          {canReview && editable && a.id && <div className="justify-self-start"><NoteOnItem fileId={fileId} step={noteStep} targetType="account" targetId={a.id} back={here} label="Add a review note" linkClass={`text-left ${link}`} /></div>}
        </div>
        {a.sh && (
          <form className="mx-5 mt-4 grid gap-1.5 border-t border-sand-200 pt-3" data-sh-name-form
            onSubmit={(e) => { e.preventDefault(); start(async () => { const err = await setShNameInline(fileId, a.key, name); setMsg(err ? { ok: false, text: err } : { ok: true, text: "Shareholder name saved." }); }); }}>
            <label htmlFor="sh-name" className="text-[13px] font-semibold">Shareholder name</label>
            <span className="flex items-center gap-2">
              <input id="sh-name" value={name} onChange={(e) => { setName(e.target.value); setMsg(null); }} maxLength={120} disabled={!editable} placeholder="Optional, for example Pat Dummy" className="input input-compact flex-1" />
              {editable && <button type="submit" disabled={pending} className="btn-secondary btn-compact w-20 justify-center">Save</button>}
            </span>
            <span className="text-xs text-ink-3">Shows on the Shareholder loans report. Rolls forward to next year.</span>
            {msg && !pending && <span role="status" className={`text-xs ${msg.ok ? "text-success" : "text-danger"}`}>{msg.text}</span>}
          </form>
        )}
      </aside>
    </div>
  );
}
