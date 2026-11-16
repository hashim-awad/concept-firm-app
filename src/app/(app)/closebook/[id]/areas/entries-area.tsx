// Round 15b: the Entries tab, as CaseWare Cloud's Adjustments page: every entry on the file, filtered by
// type, review and source in the left panel. Sign-off circles replace the status chips: a preparer circle
// on every entry, a reviewer circle only on entries that need review. A row opens the entry in its dialog;
// "New entry" is a menu (QuickBooks Online's + New): a journal entry, a standard entry, or the Expenses
// paid personally paper. An entry reached from the trial balance is marked with a blue bar.
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import { entryNo } from "@/lib/closebook/reports";
import { PageTitle, PanelHead, PanelLink, initials } from "../shell/shell";
import { Popover } from "../shell/ui";
import { reviewEntry } from "../../actions";
import { Circle } from "./entry-dialog";

export type EntryStatus = "Needs review" | "Reviewed" | "No review needed";
export const entryStatus = (e: CbEntry): EntryStatus => (!e.needs_review ? "No review needed" : e.reviewed_at ? "Reviewed" : "Needs review");
type Source = "Typed" | "Standard entry" | "Revenue check" | "Expenses paid personally";
const sourceOf = (e: CbEntry & { standard_id?: string | null }): Source => (e.origin === "revenue_check" ? "Revenue check" : e.origin === "expenses_personal" ? "Expenses paid personally"
  : /^Standard entry/.test(e.wp_ref ?? "") || e.standard_id ? "Standard entry" : "Typed");
const COLS = "grid-cols-[18px_92px_44px_104px_minmax(0,1fr)_minmax(0,190px)_110px_70px]";
const money = (n: number) => { const t = Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${t})` : t; };

export async function entriesArea({ supabase, file, entries, accounts, names, sp, editable, isReviewer, standard, rounding = [] }: {
  supabase: SupabaseClient; file: CbFileRow; entries: CbEntry[]; accounts: CbAccount[]; names: Map<string, string>;
  sp: { type?: string; status?: string; source?: string; entry?: string; back?: string };
  editable: boolean; isReviewer: boolean; standard: { id: string; name: string }[];
  rounding?: { gifi: string; title: string; cents: number }[];   // round 23: posted by itself from 3.1, one per T2 line under 1.00
}) {
  const base = `/closebook/${file.id}`;
  const { data: std } = await supabase.from("cb_entries").select("id, standard_id").eq("file_id", file.id);
  const stdOf = new Map(((std ?? []) as { id: string; standard_id: string | null }[]).map((x) => [x.id, x.standard_id]));
  const rows = entries.map((e) => ({ e, type: e.kind, status: entryStatus(e), source: sourceOf({ ...e, standard_id: stdOf.get(e.id) ?? null }) }));
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const q = (o: Record<string, string | undefined>) => `${base}?area=entries${Object.entries({ type: sp.type, status: sp.status, source: sp.source, ...o }).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join("")}`;
  const left = (
    <>
      <PanelHead>Type</PanelHead>
      <PanelLink href={q({ type: undefined })} on={!sp.type} count={rows.length}>All</PanelLink>
      {([["AJE", "Adjusting (AJE)"], ["RJE", "Reclassifying (RJE)"], ["TJE", "Tax (TJE)"]] as const).map(([t, l]) => <PanelLink key={t} href={q({ type: t })} on={sp.type === t} count={count((r) => r.type === t)}>{l}</PanelLink>)}
      <PanelHead>Review</PanelHead>
      {(["Needs review", "Reviewed", "No review needed"] as EntryStatus[]).map((s) => <PanelLink key={s} href={q({ status: sp.status === s ? undefined : s })} on={sp.status === s} count={count((r) => r.status === s)}>{s}</PanelLink>)}
      <PanelHead>Source</PanelHead>
      {(["Typed", "Standard entry", "Revenue check", "Expenses paid personally"] as Source[]).map((s) => <PanelLink key={s} href={q({ source: sp.source === s ? undefined : s })} on={sp.source === s} count={count((r) => r.source === s)}>{s}</PanelLink>)}
    </>
  );
  const shown = rows.filter((r) => (!sp.type || r.type === sp.type) && (!sp.status || r.status === sp.status) && (!sp.source || r.source === sp.source));
  const marked = sp.entry;
  // The path back: the trial balance and the account the entry was reached from.
  const backAcct = sp.back && /drill=([^&]+)/.exec(sp.back)?.[1];
  const backName = backAcct ? (() => { const k = decodeURIComponent(backAcct); const a = accounts.find((x) => x.account_key === k); return a ? `${a.number ? `${a.number} ` : ""}${a.name}` : k; })() : null;
  const markedEntry = entries.find((e) => e.id === marked);
  const content = (
    <>
      {sp.back && (
        <p className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] font-semibold text-navy-700">
          <Link href={sp.back.replace(/&drill=.*$/, "")} className="hover:underline">Trial balance</Link>
          {backName && <><ChevronRight className="h-3 w-3" /><Link href={sp.back} className="hover:underline">{backName}</Link></>}
          {markedEntry && <><ChevronRight className="h-3 w-3" /><span className="text-ink">{entryNo(file.year_end, markedEntry)}</span></>}
        </p>
      )}
      <PageTitle right={<>
        {file.books !== "statements" && file.books !== "paper" && entries.length > 0 && <a href={`/closebook/${file.id}/client-entries`} className="btn-secondary btn-compact">Client entry list (PDF)</a>}
        {editable && file.phase !== "locked" && file.file_type === "full" && (
          <Popover align="right" width="w-64" label="New entry" button={<span className="btn btn-compact"><Plus className="h-3.5 w-3.5" />New entry<ChevronDown className="h-3.5 w-3.5" /></span>}>
            <ul className="-mx-3 -my-1.5 grid text-[13px]">
              <li><Link href={`${base}?area=entries&new=journal`} className="flex items-center gap-2 px-3 py-1.5 hover:bg-navy-50"><Plus className="h-3.5 w-3.5" />Journal entry</Link></li>
              {standard.length > 0 && <><li className="mt-1 border-t border-sand-200 px-3 pt-2 pb-0.5 text-[10.5px] font-bold tracking-[.1em] text-ink-3 uppercase">From a standard entry</li>
                {standard.map((x) => <li key={x.id}><Link href={`${base}?area=entries&new=std:${x.id}`} className="block py-1.5 pr-3 pl-6 hover:bg-navy-50">{x.name}</Link></li>)}</>}
              {(file.setup as Record<string, unknown> | null)?.owner_paid === true && <li className="mt-1 border-t border-sand-200 pt-1"><Link href={`${base}?step=entries&paper=expenses`} className="block px-3 py-1.5 hover:bg-navy-50">Expenses paid personally</Link></li>}
            </ul>
          </Popover>
        )}
      </>}>Entries <span className="ml-1 font-normal tracking-normal text-ink-3">{shown.length}</span></PageTitle>
      <section className="overflow-hidden rounded-[10px] border border-sand-200 bg-white" aria-label="Entries">
        <div className={`grid ${COLS} gap-x-2 border-b border-sand-200 bg-sand-50 px-3 py-1.5 text-[11px] font-semibold text-ink-3`}>
          <span /><span>No.</span><span>Type</span><span>Date</span><span>Description</span><span>W/P ref</span><span className="text-right">Amount</span><span>Sign-off</span>
        </div>
        {shown.map(({ e }) => {
          const total = e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0);
          const on = e.id === marked;
          const open = `${base}?area=entries${["type", "status", "source"].map((k) => (sp as Record<string, string | undefined>)[k] ? `&${k}=${encodeURIComponent((sp as Record<string, string>)[k])}` : "").join("")}&open=${e.id}`;
          const prep = names.get(e.created_by ?? "") ?? "";
          const rev = e.reviewed_by ? names.get(e.reviewed_by) ?? "" : "";
          return (
            <div key={e.id} id={`entry-${e.id}`} className={`grid ${COLS} items-center gap-x-2 border-b border-sand-100 px-3 py-[6px] text-[12.5px] last:border-0 hover:bg-sand-50 ${on ? "bg-[#eef4ff] shadow-[inset_4px_0_0_#2f6fd6]" : ""}`}>
              <ChevronRight className="h-3.5 w-3.5 text-navy-600" aria-hidden />
              <Link href={open} scroll={false} className="tabular-nums font-medium text-navy-700 hover:underline">{entryNo(file.year_end, e).split(" ")[0]}</Link><span className="text-ink-3">{e.kind}</span>
              <span className="whitespace-nowrap">{formatDate(e.entry_date ?? file.year_end)}</span>
              <Link href={open} scroll={false} className="truncate hover:underline" title={e.note}>{e.note}</Link><span className="truncate text-ink-3">{e.wp_ref || "–"}</span>
              <span className="text-right tabular-nums">{money(total)}</span>
              <span className="flex items-center gap-1">
                <Circle kind="p" text={initials(prep)} title={`Prepared by ${prep} · ${formatDate(e.created_at)}`} />
                {!e.needs_review ? <Circle kind="none" title="No review needed: a standard entry at or under the threshold" />
                  : e.reviewed_at ? <Circle kind="r" text={initials(rev)} title={`Reviewed by ${rev} · ${formatDate(e.reviewed_at)}`} />
                  : isReviewer && editable && file.phase !== "locked" ? (
                    <Popover align="right" width="w-60" label="Review" button={<Circle kind="no" title="Not reviewed" />}>
                      <p className="font-semibold">Reviewer</p><p className="mb-2 text-ink-3">Not reviewed.</p>
                      <form action={reviewEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={e.id} /><button type="submit" className="btn btn-compact">Approve</button></form>
                    </Popover>) : <Circle kind="no" title="Not reviewed" />}
              </span>
            </div>
          );
        })}
        {!sp.type && !sp.status && !sp.source && rounding.map((r) => (
          <div key={`rounding-${r.gifi}`} className={`grid ${COLS} items-center gap-x-2 border-b border-sand-100 px-3 py-[6px] text-[12.5px] text-ink-2 last:border-0`}>
            <span /><span>–</span><span className="text-ink-3">Opening</span><span className="whitespace-nowrap">{formatDate(new Date(Date.UTC(+file.year_start.slice(0, 4), +file.year_start.slice(5, 7) - 1, +file.year_start.slice(8, 10) - 1)).toISOString().slice(0, 10))}</span>
            <span className="truncate">Opening balance rounding · GIFI {r.gifi} {r.title}, to retained earnings</span><span className="truncate text-ink-3">3.1</span>
            <span className="text-right tabular-nums">{money(Math.abs(r.cents) / 100)}</span><span className="text-[11.5px] text-ink-3">Automatic</span>
          </div>
        ))}
        {!shown.length && !rounding.length && <p className="px-3 py-3 text-[12.5px] text-ink-3">No entries.</p>}
      </section>
    </>
  );
  return { left, content };
}
