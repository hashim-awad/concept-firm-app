// Round 15b: the journal entry dialog over any tab (CaseWare Cloud's "Add adjustment"; QuickBooks Online's
// journal entry window). The address says what it opens:
//   new=journal [&acct=<account>]   a new entry, the account on line 1 (the trial balance "+")
//   new=std:<id>                    from a standard entry
//   new=revenue                     "Fix with an entry" from the revenue check, the difference filled in
//   new=dup:<id> / new=rev:<id>     Duplicate, Reverse (a new entry from an existing one)
//   open=<id> [&edit=1]             an entry, read-only, with its actions; Edit opens it in the form
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import type { ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Pencil, X } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { CbFileRow } from "@/lib/closebook/files";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import { loadEntryForm } from "@/lib/closebook/entry-form-server";
import { blankLine, type FormLine } from "@/lib/closebook/entry-form";
import { loadRevenue } from "@/lib/closebook/expenses-server";
import { entryNo } from "@/lib/closebook/reports";
import { formatAmount } from "@/lib/closebook/amount";
import { deleteEntry, reviewEntry } from "../../actions";
import { JournalForm, type JournalInit } from "../journal-form";
import { NoteOnItem } from "../note-on-item";
import { QBO_TYPES } from "../entries-tab";
import { initials } from "../shell/shell";

const KIND_WORD: Record<string, string> = { AJE: "Adjusting (AJE)", RJE: "Reclassifying (RJE)", TJE: "Tax, from ProFile (TJE)" };
const money = (n: number) => (Math.abs(n) / 1).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = (n: number) => formatAmount(Math.round(Math.abs(n) * 100));

function Frame({ closeHref, children, wide = true }: { closeHref: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 print:hidden">
      <Link href={closeHref} aria-label="Close" className="absolute inset-0 block bg-navy-950/35" scroll={false} />
      <div role="dialog" aria-modal="true" className={`relative mx-auto mt-[70px] ${wide ? "w-[1060px]" : "w-[820px]"} max-w-[96vw] rounded-[10px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]`}>{children}</div>
    </div>
  );
}

export async function entryDialog({ supabase, file, province, clientName, entries, accounts, names, me, isReviewer, editable, sp, closeHref, here }: {
  supabase: SupabaseClient; file: CbFileRow; province: string; clientName: string; entries: CbEntry[]; accounts: CbAccount[]; names: Map<string, string>;
  me: string; isReviewer: boolean; editable: boolean;
  sp: { new?: string; open?: string; edit?: string; acct?: string; error?: string | null };
  closeHref: string; here: string;
}): Promise<ReactNode> {
  if (!sp.new && !sp.open) return null;
  if (file.file_type !== "full") return null;
  const base = `/closebook/${file.id}`;
  const entry = sp.open ? entries.find((e) => e.id === sp.open) : sp.new?.match(/^(dup|rev):/) ? entries.find((e) => e.id === sp.new!.slice(4)) : undefined;
  const form = await loadEntryForm(supabase, file, province, clientName);
  const nextSeq = form.nextNo.slice(5);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const optOf = (accountId: string) => (form.opts.some((o) => o.value === accountId) ? accountId : (() => {
    const a = byId.get(accountId);
    return a?.account_key.startsWith("chart:") && form.opts.some((o) => o.value === a.account_key) ? a.account_key : accountId;
  })());
  // An entry's own lines, back as the form's lines (the GIFI/HST lines are worked out again).
  const linesOf = (e: CbEntry, flip = false): FormLine[] => e.lines.filter((l) => !l.is_tax).map((l) => {
    const v = flip ? -l.amount : l.amount;
    return { ...blankLine(), acct: optOf(l.account_id), desc: l.memo ?? "", dr: v > 0 ? cents(v) : "", cr: v < 0 ? cents(v) : "", tax: l.tax_code ?? "none" };
  });
  const formProps = { fileId: file.id, yearStart: file.year_start, yearEnd: file.year_end, clientList: file.books === "client_software" || file.books === "bookkeeper",
    opts: form.opts, gifiLines: form.gifiLines, codes: form.codes, ctx: form.ctx, standard: form.standard, threshold: form.threshold, qboTypes: QBO_TYPES,
    closeHref, backHref: here, problem: sp.error ?? null };

  // ---- An existing entry: read-only, with its actions (CaseWare).
  if (sp.open && entry && !sp.edit) {
    const no = entryNo(file.year_end, entry).split(" ")[0];
    const locked = file.phase === "locked";
    const canChange = editable && !locked && !entry.reviewed_at;
    const lines = entry.lines;
    const dr = lines.filter((l) => l.amount > 0).reduce((n, l) => n + l.amount, 0);
    const accName = (id: string) => { const a = byId.get(id); return a ? `${a.number ? `${a.number} ` : ""}${a.name}` : ""; };
    const act = "btn-secondary btn-compact";
    const prep = names.get(entry.created_by ?? "") ?? "";
    const rev = entry.reviewed_by ? names.get(entry.reviewed_by) ?? "" : "";
    const fieldsRow = (label: string, value: ReactNode) => <div className="grid gap-0.5"><span className="text-[11.5px] font-semibold text-ink-3">{label}</span><span className="text-[13px]">{value}</span></div>;
    return (
      <Frame closeHref={closeHref}>
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-5 py-3">
          <h2 className="text-[15px] font-bold">Journal entry {no}</h2>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${entry.reviewed_at ? "bg-success-soft text-success" : entry.needs_review ? "bg-warning-soft text-warning" : "bg-sand-100 text-ink-2"}`}>
            {entry.reviewed_at ? "Reviewed" : entry.needs_review ? "Needs review" : "No review needed"}</span>
          <span className="flex-1" />
          {canChange && entry.origin !== "expenses_personal" && <Link href={`${here}&edit=1`} className={act}><Pencil className="h-3.5 w-3.5" />Edit</Link>}
          {entry.origin === "expenses_personal" && editable && !locked && <Link href={`${base}?step=entries&paper=expenses`} className={act}>Open the paper</Link>}
          {editable && !locked && entry.origin !== "expenses_personal" && <Link href={`${closeHref}${closeHref.includes("?") ? "&" : "?"}new=dup:${entry.id}`} className={act}>Duplicate</Link>}
          {editable && !locked && <Link href={`${closeHref}${closeHref.includes("?") ? "&" : "?"}new=rev:${entry.id}`} className={act}>Reverse</Link>}
          {canChange && <form action={deleteEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={entry.id} />
            <button type="submit" className="btn-secondary btn-compact border-danger/30 text-danger">Delete</button></form>}
          <Link href={closeHref} aria-label="Close" className="ml-1 rounded p-1 text-ink-3 hover:bg-sand-100"><X className="h-[18px] w-[18px]" /></Link>
        </div>
        <div className="grid max-h-[calc(100vh-200px)] gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-4 md:grid-cols-[8rem_9rem_12rem_minmax(0,1fr)_12rem]">
            {fieldsRow("No.", <span className="tabular-nums">{no}</span>)}{fieldsRow("Date", formatDate(entry.entry_date ?? file.year_end))}{fieldsRow("Type", KIND_WORD[entry.kind] ?? entry.kind)}
            {fieldsRow("Description", entry.note)}{fieldsRow("W/P ref", entry.wp_ref || "–")}
          </div>
          <table className="w-full border-collapse text-[13px]">
            <thead><tr className="border-b border-sand-200 text-left text-[11px] font-semibold text-ink-3"><th className="w-8 py-1.5">#</th><th className="py-1.5">Account</th><th className="py-1.5">Description</th>
              <th className="py-1.5 text-right">Debit</th><th className="py-1.5 text-right">Credit</th>{form.ctx.registered && <th className="py-1.5 pl-4">Sales tax</th>}</tr></thead>
            <tbody>{lines.map((l, i) => (
              <tr key={i} className={`border-b border-sand-100 ${l.is_tax ? "text-ink-2" : ""}`}><td className="py-1.5 text-ink-3">{l.is_tax ? "" : i + 1}</td><td className="py-1.5">{accName(l.account_id)}</td>
                <td className="py-1.5 text-ink-2">{l.memo}</td><td className="py-1.5 text-right tabular-nums">{l.amount > 0 ? money(l.amount) : ""}</td><td className="py-1.5 text-right tabular-nums">{l.amount < 0 ? money(-l.amount) : ""}</td>
                {form.ctx.registered && <td className="py-1.5 pl-4 text-ink-2">{l.is_tax ? "" : l.tax_code ? form.codes.find((c) => c.code === l.tax_code)?.name ?? l.tax_code : "No tax"}</td>}</tr>
            ))}
              <tr className="font-bold"><td /><td className="py-1.5 text-right" colSpan={2}>Total</td><td className="border-t border-ink py-1.5 text-right tabular-nums">{money(dr)}</td><td className="border-t border-ink py-1.5 text-right tabular-nums">{money(dr)}</td>{form.ctx.registered && <td />}</tr></tbody>
          </table>
          <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-[10px] border border-sand-200">
              <h3 className="border-b border-sand-200 px-3.5 py-2 text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase">Sign-off</h3>
              <div className="grid gap-2 px-3.5 py-2.5 text-[12.5px]">
                <p className="flex items-center gap-2"><Circle kind="p" text={initials(prep)} />Prepared by {prep} · {formatDate(entry.created_at)}</p>
                {entry.needs_review ? (
                  <div className="flex items-center gap-2">{entry.reviewed_at ? <><Circle kind="r" text={initials(rev)} />Reviewed by {rev} · {formatDate(entry.reviewed_at)}</>
                    : <><Circle kind="no" />Not reviewed<span className="flex-1" />{isReviewer && editable && !locked && <form action={reviewEntry}><input type="hidden" name="file_id" value={file.id} /><input type="hidden" name="entry" value={entry.id} /><button type="submit" className="btn btn-compact">Approve</button></form>}</>}</div>
                ) : <p className="flex items-center gap-2 text-ink-3"><Circle kind="none" />No review needed: a standard entry at or under the threshold.</p>}
              </div>
            </section>
            <section className="rounded-[10px] border border-sand-200">
              <h3 className="border-b border-sand-200 px-3.5 py-2 text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase">Review note</h3>
              <div className="px-3.5 py-2.5 text-[12.5px]">{editable && !locked && me ? <NoteOnItem fileId={file.id} step="entries" targetType="entry" targetId={entry.id} back={here} label="Add a review note" />
                : <span className="text-ink-3">None.</span>}</div>
            </section>
          </div>
          <p className="text-[12px] text-ink-3">{entry.attachments?.length ? `Attachments: ${entry.attachments.map((p) => p.split("/").pop()!.replace(/^\d+-/, "")).join(", ")}` : "No attachment"}
            {" · "}{entry.reverse_next_year ? "Reverses on the first day of next year" : "Not reversed next year"}
            {entry.origin === "revenue_check" ? " · From the revenue check" : entry.origin === "expenses_personal" ? " · Expenses paid personally" : ""}</p>
        </div>
        <div className="flex justify-end rounded-b-[10px] border-t border-sand-200 bg-sand-50 px-5 py-3"><Link href={closeHref} className="btn-secondary btn-compact">Close</Link></div>
      </Frame>
    );
  }
  if (!editable || file.phase === "locked") return null;

  // ---- The form: new, from a standard entry, duplicate, reverse, revenue fix, or Edit.
  let init: JournalInit = {};
  let title = "New journal entry", origin: string | undefined, edit: string | undefined, lock = {};
  let kept: string[] = [];
  if (sp.open && entry && sp.edit) {
    if (entry.reviewed_at) return null;
    title = `Edit journal entry ${entryNo(file.year_end, entry).split(" ")[0]}`;
    edit = entry.id; kept = entry.attachments ?? [];
    origin = entry.origin === "revenue_check" ? "revenue_check" : undefined;
    if (origin) lock = { kind: true, wp: true };
    init = { seq: String(entry.seq), date: entry.entry_date ?? file.year_end, head: { kind: entry.kind, wpRef: entry.wp_ref ?? "", memo: entry.note, reverse: entry.reverse_next_year }, lines: linesOf(entry) };
  } else if (sp.new?.startsWith("std:")) {
    init = { std: sp.new.slice(4) };
  } else if ((sp.new?.startsWith("dup:") || sp.new?.startsWith("rev:")) && entry) {
    const rev = sp.new.startsWith("rev:");
    const no = entryNo(file.year_end, entry).split(" ")[0];
    title = rev ? `Reverse entry ${no}` : `Duplicate entry ${no}`;
    init = { head: { kind: entry.kind, wpRef: entry.wp_ref ?? "", memo: rev ? `To reverse entry ${no}: ${entry.note}`.slice(0, 500) : entry.note, reverse: false }, lines: linesOf(entry, rev) };
  } else if (sp.new === "revenue") {
    // Fix with an entry (Hashim, round 15b): the difference on the right side. The trial balance higher
    // than the source: debit revenue; lower: credit it. The revenue line keeps its sales tax code, so the
    // GST/HST reverses with the revenue. The other side is the preparer's to choose.
    const rv = await loadRevenue(supabase, file.id);
    const st = rv.state as any;
    const revOpts = form.opts.filter((o) => o.type === "Revenue");
    const big = accounts.filter((a) => revOpts.some((o) => o.value === a.id || o.value === a.account_key)).sort((a, b) => Math.abs(b.this_year) - Math.abs(a.this_year))[0];
    const acct = big ? optOf(big.id) : revOpts[0]?.value ?? "";
    let tax = "none";
    if (form.ctx.registered && big?.number) {
      const { data: bl } = await supabase.from("cb_bank_lines").select("tax_code").eq("file_id", file.id).eq("chart_account", big.number).not("tax_code", "is", null).limit(2000);
      const n = new Map<string, number>();
      for (const r of (bl ?? []) as { tax_code: string }[]) n.set(r.tax_code, (n.get(r.tax_code) ?? 0) + 1);
      tax = [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "none";
    }
    const diff = Math.round(Number(st?.diff ?? 0) * 100);
    title = "New journal entry"; origin = "revenue_check"; lock = { kind: true, wp: true };
    init = { balanceLast: true, head: { kind: "AJE", wpRef: "Revenue check", memo: "To adjust commission revenue to the brokerage statement.", reverse: false },
      lines: [{ ...blankLine(), acct, tax, dr: diff > 0 ? formatAmount(diff) : "", cr: diff < 0 ? formatAmount(-diff) : "" }, blankLine()] };
  } else {
    init = sp.acct ? { lines: [{ ...blankLine(), acct: optOf(sp.acct) }, blankLine()] } : {};
  }
  return (
    <Frame closeHref={closeHref}>
      <JournalForm {...formProps} title={title} nextSeq={nextSeq} init={init} lock={lock} origin={origin} edit={edit} keptAttachments={kept} />
    </Frame>
  );
}

// The sign-off circles (CaseWare): grey with a pencil, the preparer's initials with a blue pencil, the
// reviewer's initials with a green tick; dashed when no review is needed.
export function Circle({ kind, text = "", title }: { kind: "no" | "p" | "r" | "none"; text?: string; title?: string }) {
  if (kind === "none") return <span title={title ?? "No review needed"} className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full border-[1.5px] border-dashed border-[#d0d3da] text-[10px] text-[#b9bcc6]">–</span>;
  if (kind === "no") return <span title={title} className="grid h-[22px] w-[22px] flex-none place-items-center rounded-full border-[1.5px] border-[#c3c6cf] bg-white text-[#9aa0ae]"><Pencil className="h-2.5 w-2.5" /></span>;
  return (
    <span title={title} className={`relative grid h-[22px] w-[22px] flex-none place-items-center rounded-full border-[1.5px] bg-white text-[9px] font-bold ${kind === "p" ? "border-[#2f6fd6] text-navy-800" : "border-success text-success"}`}>{text}
      <span className={`absolute -right-1 -bottom-[3px] grid h-3 w-3 place-items-center rounded-full border-[1.5px] border-white text-[7px] text-white ${kind === "p" ? "bg-[#2f6fd6]" : "bg-success"}`}>{kind === "p" ? "✎" : "✓"}</span>
    </span>
  );
}
