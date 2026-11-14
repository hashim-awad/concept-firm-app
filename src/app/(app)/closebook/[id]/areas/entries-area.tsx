// Round 15: the Entries tab, as CaseWare Cloud's Adjustments page. Every entry on the file with its
// number, type, date, description, W/P ref, amount and status; each opens to its lines. Filters by type,
// status and source in the left panel. Entries are made on step 5; an entry reached from the trial
// balance is marked with a blue bar, with the path back at the top.
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronRight, Plus } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import { entryNo } from "@/lib/closebook/reports";
import { PageTitle, PanelHead, PanelLink } from "../shell/shell";

export type EntryStatus = "For the reviewer" | "Approved" | "Posted";
export const entryStatus = (e: CbEntry): EntryStatus => (e.reviewed_at ? "Approved" : e.needs_review ? "For the reviewer" : "Posted");
const STATUS_CLS: Record<EntryStatus, string> = { "For the reviewer": "bg-warning-soft text-warning", Approved: "bg-success-soft text-success", Posted: "bg-sand-100 text-ink-2" };
type Source = "Typed" | "Standard entry" | "Revenue check" | "Expenses paid personally";
const sourceOf = (e: CbEntry & { standard_id?: string | null }): Source => (e.origin === "revenue_check" ? "Revenue check" : e.origin === "expenses_personal" ? "Expenses paid personally"
  : /^Standard entry/.test(e.wp_ref ?? "") || e.standard_id ? "Standard entry" : "Typed");
const money = (n: number) => { const t = Math.abs(n).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${t})` : t; };

export async function entriesArea({ supabase, file, entries, accounts, names, sp }: {
  supabase: SupabaseClient; file: CbFileRow; entries: CbEntry[]; accounts: CbAccount[]; names: Map<string, string>;
  sp: { type?: string; status?: string; source?: string; entry?: string; back?: string };
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
      {["AJE", "RJE", "TJE"].map((t) => <PanelLink key={t} href={q({ type: t })} on={sp.type === t} count={count((r) => r.type === t)}>{t}</PanelLink>)}
      <PanelHead>Status</PanelHead>
      {(["For the reviewer", "Approved", "Posted"] as EntryStatus[]).map((s) => <PanelLink key={s} href={q({ status: sp.status === s ? undefined : s })} on={sp.status === s} count={count((r) => r.status === s)}>{s}</PanelLink>)}
      <PanelHead>Source</PanelHead>
      {(["Typed", "Standard entry", "Revenue check", "Expenses paid personally"] as Source[]).map((s) => <PanelLink key={s} href={q({ source: sp.source === s ? undefined : s })} on={sp.source === s} count={count((r) => r.source === s)}>{s}</PanelLink>)}
    </>
  );
  const shown = rows.filter((r) => (!sp.type || r.type === sp.type) && (!sp.status || r.status === sp.status) && (!sp.source || r.source === sp.source));
  const byId = new Map(accounts.map((a) => [a.id, a]));
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
        {(file.setup as Record<string, unknown> | null)?.owner_paid === true && <Link href={`${base}?step=entries#expenses-personal`} className="btn-secondary btn-compact">Expenses paid personally</Link>}
        <Link href={`${base}?step=entries#new-entry`} className="btn btn-compact"><Plus className="h-3.5 w-3.5" />New entry</Link>
      </>}>Entries <span className="ml-1 font-normal tracking-normal text-ink-3">{shown.length}</span></PageTitle>
      <section className="overflow-hidden rounded-[10px] border border-sand-200 bg-white" aria-label="Entries">
        <div className="grid grid-cols-[22px_92px_44px_104px_minmax(0,1fr)_minmax(0,180px)_110px_128px] gap-x-2 border-b border-sand-200 bg-sand-50 px-3 py-1.5 text-[11px] font-semibold text-ink-3">
          <span /><span>No.</span><span>Type</span><span>Date</span><span>Description</span><span>W/P ref</span><span className="text-right">Amount</span><span>Status</span>
        </div>
        {shown.map(({ e, status }) => {
          const total = e.lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0);
          const on = e.id === marked;
          return (
            <details key={e.id} id={`entry-${e.id}`} open={on} className={`group border-b border-sand-100 last:border-0 ${on ? "bg-[#eef4ff] shadow-[inset_4px_0_0_#2f6fd6]" : ""}`}>
              <summary className="grid cursor-pointer list-none grid-cols-[22px_92px_44px_104px_minmax(0,1fr)_minmax(0,180px)_110px_128px] items-center gap-x-2 px-3 py-[7px] text-[12.5px] hover:bg-sand-50 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="h-3.5 w-3.5 text-navy-600 transition group-open:rotate-90" aria-hidden />
                <span className="tabular-nums">{entryNo(file.year_end, e).split(" ")[0]}</span><span className="text-ink-3">{e.kind}</span>
                <span className="whitespace-nowrap">{formatDate(e.entry_date ?? file.year_end)}</span>
                <span className="truncate" title={e.note}>{e.note}</span><span className="truncate text-ink-3">{e.wp_ref || "–"}</span>
                <span className="text-right tabular-nums">{money(total)}</span>
                <span><span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATUS_CLS[status]}`}>{status}</span></span>
              </summary>
              <div className="px-3 pt-0.5 pb-2.5 pl-[34px]">
                <table className="w-full max-w-4xl text-[12.5px]"><tbody>
                  {e.lines.map((l, i) => {
                    const a = byId.get(l.account_id);
                    const hit = backAcct && a?.account_key === decodeURIComponent(backAcct);
                    return <tr key={i} className="border-t border-sand-100"><td className="w-16 py-1 text-[11px] text-ink-3">{l.amount > 0 ? "Debit" : "Credit"}</td>
                      <td className="py-1"><span className={hit ? "rounded bg-[#dbe7ff] px-1" : ""}>{a?.number ? `${a.number} ` : ""}{a?.name ?? ""}</span>{l.memo && <span className="ml-2 text-ink-3">{l.memo}</span>}</td>
                      <td className="w-28 py-1 text-right tabular-nums">{money(l.amount)}</td></tr>;
                  })}
                </tbody></table>
                <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[11.5px] text-ink-3">{names.get(e.created_by ?? "") ?? ""} · {formatDate(e.created_at)}
                  {!!e.attachments?.length && <span>{e.attachments.length} attachment{e.attachments.length === 1 ? "" : "s"}</span>}
                  <Link href={`${base}?step=entries#entry-${e.id}`} className="font-semibold text-navy-700 hover:underline">Open on step 5</Link></p>
              </div>
            </details>
          );
        })}
        {!shown.length && <p className="px-3 py-3 text-[12.5px] text-ink-3">No entries.</p>}
      </section>
    </>
  );
  return { left, content };
}
