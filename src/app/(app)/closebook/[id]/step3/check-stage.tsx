"use client";
// Closebook step 3, the check stage (round 22, Hashim, Nov 16, 2026; mock screens 4, 5 and 6). Benchmark:
// QuickBooks Online "Verify details": the statement on the left (with the line outlined), the details and the
// lines on the right (All / For review), plain checks below. One statement at a time; "Import and next".
// A statement crossing the year is checked whole; lines outside the year are greyed and not imported (cards by
// the purchase date). Amounts are always positive with a Type. Leaving with unsaved edits asks "Save your
// changes?"; "Delete statement" sits in the "..." menu with Studio's own confirmation.
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, ChevronLeft, ExternalLink, MoreHorizontal, Pencil, Plus, X, XCircle } from "lucide-react";
import { confirmAction, leaveOk, notify, useUnsavedGuard } from "@/components/save-state";
import { amountTone } from "@/components/amount";
import { tidyAmount } from "@/lib/closebook/amount";
import { validDate } from "@/lib/closebook/bank-upload";
import { checkAccount } from "@/lib/statements/checks";
import { typeLabel, type ReadResult, type StatementAccount, type StatementLine } from "@/lib/statements/types";
import { cardSummary, longDate, yearCut, type UploadState } from "@/lib/closebook/step3";
import type { StatementRow } from "@/lib/statements/server";
import { StatementViewer, type Focus } from "../../../statements/[id]/statement-viewer";
import { DateField, MoneyField } from "../../../statements/[id]/verify";
import { parseMoney } from "../../../statements/format";
import { discardStatement, saveStatementEdits } from "../../../statements/actions";
import { importChecked, skipStatement } from "../../step3-actions";
import { readSession, writeSession, type Target } from "./upload-window";

const m = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (iso: string | null | undefined) => (iso ? `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}` : "");
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
type Draft = { date: string; posted: string; description: string; dir: "in" | "out"; amount: string };

export type CheckDetail = {
  id: string; row: StatementRow; data: ReadResult; fileUrl: string; state: UploadState; n: number; total: number; next: string | null;
  books: number | null; endBooks: number | null; readOnly: boolean;
};

export function CheckStage({ fileId, d, target, yearStart, yearEnd, dayBefore, href, closeHref, addHref }: {
  fileId: string; d: CheckDetail; target: Target; yearStart: string; yearEnd: string; dayBefore: string; href: string; closeHref: string; addHref: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<ReadResult>(d.data);
  const [saved, setSaved] = useState<ReadResult>(d.data);
  const [accKey, setAccKey] = useState(d.data.accounts[0]?.key ?? "");
  const [tab, setTab] = useState<"all" | "review">("all");
  const [focus, setFocus] = useState<Focus | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ date: "", posted: "", description: "", dir: "out", amount: "" });
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [dups, setDups] = useState<{ accountKey: string; lineIds: string[] }[] | null>(null);
  const [dupOk, setDupOk] = useState(false);
  const dirty = data !== saved;
  const ro = d.readOnly;

  const save = useCallback(async (): Promise<boolean> => {
    const r = await saveStatementEdits(d.id, data);
    if (!r.ok) { notify(r.error, "error"); return false; }
    setSaved(data);
    return true;
  }, [d.id, data]);
  useUnsavedGuard(dirty, { save: async () => save(), discard: () => setData(saved) });
  const go = async (to: string) => { if (dirty && !(await leaveOk(to))) return; router.push(to); };

  const acc = data.accounts.find((a) => a.key === accKey) ?? data.accounts[0];
  const chk = useMemo(() => (acc ? checkAccount(acc) : null), [acc]);
  const cut = useMemo(() => (acc ? yearCut(acc, yearStart, yearEnd) : null), [acc, yearStart, yearEnd]);
  const review = useMemo(() => new Map((chk?.review ?? []).map((r) => [r.lineId, r.reason])), [chk]);
  const card = acc?.kind === "card";
  const cs = acc && chk && card ? cardSummary(acc, chk.inTotal, chk.outTotal) : null;
  const inYear = new Set(cut?.inYear.map((l) => l.id));
  const lines = !acc ? [] : tab === "review" ? acc.lines.filter((l) => review.has(l.id)) : acc.lines;
  const st = d.state.status;
  const stop = st === "wrong_account" || st === "no_account";
  const outside = st === "outside" || !!cut?.outside;

  const updAcc = (patch: Partial<StatementAccount>) => setData((x) => ({ ...x, accounts: x.accounts.map((a) => (a.key === acc!.key ? { ...a, ...patch } : a)) }));
  const startEdit = (l: StatementLine | null) => {
    setDraftErr(null);
    if (l) { setEditing(l.id); setDraft({ date: l.date, posted: l.postedDate ?? "", description: l.description, dir: l.dir, amount: m(l.amountCents) }); }
    else { setEditing("new"); setDraft({ date: acc!.periodEnd, posted: "", description: "", dir: "out", amount: "" }); }
  };
  const saveDraft = () => {
    const c = parseMoney(draft.amount);
    if (!validDate(draft.date)) return setDraftErr("Enter the date.");
    if (!draft.description.trim()) return setDraftErr("Enter the description.");
    if (c === null || c <= 0) return setDraftErr("Enter the amount as a positive number. The Type says which way it goes.");
    const fields = { date: draft.date, postedDate: card && validDate(draft.posted) ? draft.posted : null, description: draft.description.trim(), dir: draft.dir, amountCents: c };
    if (editing === "new") {
      const n = Math.max(0, ...data.accounts.flatMap((a) => a.lines).map((l) => (/^a\d+$/.test(l.id) ? Number(l.id.slice(1)) : 0))) + 1;
      const line: StatementLine = { id: `a${n}`, ...fields, balanceCents: null, page: 1, unsure: false, unsureReason: "", source: "added" };
      const at = acc!.lines.findIndex((l) => l.date > draft.date);
      updAcc({ lines: at < 0 ? [...acc!.lines, line] : [...acc!.lines.slice(0, at), line, ...acc!.lines.slice(at)] });
    } else updAcc({ lines: acc!.lines.map((l) => (l.id === editing ? { ...l, ...fields, unsure: false, unsureReason: "", source: l.source === "added" ? "added" : "edited" } : l)) });
    setEditing(null);
  };

  const after = () => d.next ? `${href}&check=${d.next}` : `${href}&done=1`;
  const doImport = async (confirm: boolean) => {
    if (busy) return;
    setBusy(true); setErr(null);
    try {
      if (dirty && !(await save())) return;
      const r = await importChecked(d.id, target?.id ?? d.state.match?.id ?? null, confirm);
      if (!r.ok) { setErr(r.error); return; }
      if (!r.imported) { setDups(r.duplicates); setDupOk(false); return; }
      writeSession(fileId, target?.id ?? "all", (s) => ({ ...s, imported: { ...s.imported, [d.id]: { lines: r.lines, outside: r.outside, to: r.accounts } } }));
      notify(`Imported ${plural(r.lines, "line")}${r.outside ? `. ${r.outside} outside the year not imported` : ""}.`);
      router.push(after()); router.refresh();
    } catch { setErr("The import did not finish. Nothing was imported. Try again."); } finally { setBusy(false); }
  };
  const skip = async () => {
    setBusy(true);
    const r = await skipStatement(d.id, true, null);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    writeSession(fileId, target?.id ?? "all", (s) => ({ ...s, skipped: [...s.skipped, d.id] }));
    router.push(after()); router.refresh();
  };
  const del = async () => {
    setMenu(false);
    if (!(await confirmAction({ title: "Delete this statement?", body: "The uploaded file and what was read are deleted. Nothing is imported. You can upload it again.", confirm: "Delete statement", danger: true }))) return;
    const r = await discardStatement(d.id);
    if (!r.ok) return notify(r.error, "error");
    setData(saved);
    router.push(href); router.refresh();
  };
  const show = (l: StatementLine) => setFocus((f) => ({ n: (f?.n ?? 0) + 1, page: l.page, amountCents: l.amountCents, description: l.description }));
  void readSession;

  const word = card ? { in: "Charge", out: "Payment" } : { in: "Money in", out: "Money out" };
  const sideNote = (l: StatementLine) => inYear.has(l.id) ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-[11.5px] font-semibold text-success">Imports</span>
    : <span className="text-[12px]">{l.date < yearStart ? "Before the year" : "After the year"}</span>;
  const cols = card ? 7 : 7;
  const okIcon = (ok: boolean | null) => ok === null ? <span className="mt-0.5 h-4 w-4 shrink-0" /> : ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />;
  const s = acc?.summary;
  const startEdge = cut?.atStart ?? null, endEdge = cut?.atEnd ?? null;
  const thisYearMove = (cut?.inYear ?? []).reduce((n, l) => n + (l.dir === "in" ? l.amountCents : -l.amountCents), 0);

  return (
    <div className="fixed inset-0 z-[60] grid place-items-start justify-center overflow-y-auto bg-navy-950/40 px-3 py-5" role="dialog" aria-modal="true" aria-label="Check statement">
      <div className="flex min-h-[92vh] w-full max-w-[1560px] flex-col overflow-hidden rounded-[14px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex flex-wrap items-center gap-3 border-b border-sand-200 px-5 py-3">
          <button type="button" onClick={() => go(href)} className="inline-flex items-center gap-1 text-[14px] font-medium text-navy-700 hover:underline"><ChevronLeft className="h-4 w-4" aria-hidden />Back to the list</button>
          <span className="text-ink-3">|</span><h2 className="text-[17px] font-semibold">Check statement</h2>
          <span className="text-[13px] text-ink-3">{d.row.file_name}{d.row.pages ? ` · ${plural(d.row.pages, "page")}` : ""}</span>
          <span className="flex-1" />
          {dirty && !ro && <span className="text-[12.5px] text-warning">Changes not saved</span>}
          {d.total > 0 && <span className="text-[12.5px] text-ink-3">Statement {d.n} of {d.total}</span>}
          <span className="relative">
            <button type="button" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><MoreHorizontal className="h-5 w-5" /></button>
            {menu && (
              <div className="absolute top-9 right-0 z-10 grid min-w-[13rem] rounded-[10px] border border-sand-300 bg-white p-1 text-[13.5px] shadow-lg">
                <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded px-3 py-2 hover:bg-sand-50"><ExternalLink className="h-4 w-4" aria-hidden />Open the PDF in a new tab</a>
                {!ro && <button type="button" onClick={del} className="rounded px-3 py-2 text-left text-danger hover:bg-danger-soft">Delete statement…</button>}
              </div>
            )}
          </span>
          <button type="button" aria-label="Close" onClick={() => go(closeHref)} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid flex-1 items-start gap-5 px-5 py-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
          <div className="xl:sticky xl:top-2"><StatementViewer url={d.fileUrl} mediaType={d.row.media_type} pages={d.row.pages} focus={focus} /></div>

          <div className="grid min-w-0 content-start gap-3">
            {/* Point 13: the wrong-account stop */}
            {st === "wrong_account" && d.state.other && (
              <div role="alert" className="flex gap-3 rounded-[10px] border border-danger/40 bg-danger-soft px-4 py-3.5 text-[13.5px] text-[#7a1a12]">
                <XCircle className="h-5 w-5 shrink-0" aria-hidden /><div className="grid gap-2">
                  <b className="text-[15px]">This statement is for another account.</b>
                  <p>It is for <b>{d.state.other.number} {d.state.other.name}</b>. You are uploading to <b>{target?.label}</b>. It cannot be imported here.</p>
                  {!ro && <div className="flex flex-wrap gap-2">
                    <MoveButton id={d.id} to={d.state.other} fileId={fileId} accKey={target?.id ?? "all"} after={href} />
                    <button type="button" onClick={del} className="btn-secondary h-9">Remove it from this upload</button></div>}
                </div></div>
            )}
            {st === "no_account" && (
              <div role="alert" className="flex gap-3 rounded-[10px] border border-warning/50 bg-warning-soft px-4 py-3.5 text-[13.5px] text-[#5c4400]">
                <AlertTriangle className="h-5 w-5 shrink-0" aria-hidden /><div className="grid gap-2">
                  <b className="text-[15px]">{d.state.reason || "No account in this file matches this statement."}</b>
                  <p>The statement is for <b>••• {acc?.last4}</b>, a {acc?.kind === "card" ? "card" : "bank account"}. Add it to this file, then import.</p>
                  {!ro && <div className="flex flex-wrap gap-2"><Link href={addHref} scroll={false} className="btn h-9">Add it</Link>
                    <button type="button" onClick={del} className="btn-secondary h-9">Remove it from this upload</button></div>}
                </div></div>
            )}
            {st === "no_digits" && <p className="rounded-[10px] border border-warning/50 bg-warning-soft px-4 py-2.5 text-[13px] text-[#5c4400]"><b>Needs a look.</b> {d.state.reason}</p>}
            {st === "already" && <p className="rounded-[10px] border border-sand-300 bg-sand-50 px-4 py-2.5 text-[13px]"><b>Already imported.</b> {d.state.reason}</p>}

            {acc && !stop && <>
              <section className="rounded-[10px] border border-sand-200 bg-white px-4 py-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <b className="text-[14px]">{target?.label ?? d.state.match?.name ?? `••• ${acc.last4}`}</b>
                  {target && <span className="rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Account matches</span>}
                  <span className="flex-1" />
                  {cut?.crossesStart && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Crosses the year start</span>}
                  {cut?.crossesEnd && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning">Crosses the year end</span>}
                  {outside && <span className="rounded-full bg-sand-100 px-2 py-0.5 text-xs font-semibold text-ink-2">Outside the year: not needed</span>}
                  {data.accounts.length > 1 && data.accounts.map((a) => <button key={a.key} type="button" onClick={() => setAccKey(a.key)} aria-pressed={a.key === acc.key}
                    className={`rounded-md border px-2.5 py-1 text-[12.5px] ${a.key === acc.key ? "border-navy-700 bg-navy-700 text-white" : "border-sand-300"}`}>••• {a.last4}</button>)}
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <DateField label="Start date" value={acc.periodStart} disabled={ro} onChange={(v) => updAcc({ periodStart: v })} />
                  <DateField label="End date" value={acc.periodEnd} disabled={ro} onChange={(v) => updAcc({ periodEnd: v })} />
                  <MoneyField key={`o-${acc.key}`} label={card ? "Previous balance" : "Opening balance"} cents={acc.opening} disabled={ro} onChange={(c) => updAcc({ opening: c })} />
                  <MoneyField key={`c-${acc.key}`} label={card ? "New balance" : "Closing balance"} cents={acc.closing} disabled={ro} onChange={(c) => updAcc({ closing: c })} />
                </div>
              </section>

              {/* Point 20 and 21: the year cut-off */}
              {(cut?.crossesStart || cut?.crossesEnd) && (
                <p className="rounded-[10px] border border-warning/40 bg-warning-soft px-4 py-2.5 text-[13.5px] text-[#5c4400]">
                  {card ? <>The cut-off uses the <b>purchase date</b>, not the posting date. </> : null}
                  {cut.crossesStart ? <>Lines before {longDate(yearStart)} are greyed: they belong to last year and are not imported. </> : null}
                  {cut.crossesEnd ? <>Lines after {longDate(yearEnd)} are greyed: they belong to next year and are not imported. </> : null}
                  {card && cut.inYear.some((l) => l.postedDate && l.postedDate > yearEnd) && <>A purchase on or before {short(yearEnd)} posted after it is in the year and imports. </>}
                  The checks below use the whole statement. <b>{cut.inYear.length === 1 ? `1 line imports: ${short(cut.inYear[0].date)}, ${m(cut.inYear[0].amountCents)}.` : `${cut.inYear.length} lines import.`}</b></p>
              )}
              {outside && <p className="rounded-[10px] border border-sand-300 bg-sand-50 px-4 py-2.5 text-[13.5px]"><b>Outside the year: not needed.</b> The statement is from {longDate(acc.periodStart)} to {longDate(acc.periodEnd)}, outside {longDate(yearStart)} to {longDate(yearEnd)}. Skip it: it stays listed.</p>}

              <section className="overflow-hidden rounded-[10px] border border-sand-200 bg-white">
                <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3">
                  {([["all", `All (${acc.lines.length})`], ["review", `For review (${chk?.review.length ?? 0})`]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}
                      className={`-mb-px border-b-2 px-3 py-2.5 text-[13.5px] font-semibold ${tab === k ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2"}`}>{l}</button>))}
                  <span className="flex-1" />
                  {!ro && <button type="button" onClick={() => startEdit(null)} className="btn-secondary h-8 px-3 text-[13px]"><Plus className="h-3.5 w-3.5" aria-hidden />Add missing line</button>}
                </div>
                <div className="max-h-[52vh] overflow-auto">
                  <table className="table table-compact">
                    <thead><tr><th>{card ? "Purchase date" : "Date"}</th>{card && <th>Posted</th>}<th>Description</th><th>Type</th><th className="text-right">Amount</th>{!card && <th className="text-right">Balance</th>}<th /><th className="w-10" /></tr></thead>
                    <tbody>
                      {editing === "new" && <Edit draft={draft} setDraft={setDraft} card={card} err={draftErr} onSave={saveDraft} onCancel={() => setEditing(null)} />}
                      {lines.map((l) => editing === l.id ? <Edit key={l.id} draft={draft} setDraft={setDraft} card={card} err={draftErr} onSave={saveDraft} onCancel={() => setEditing(null)} /> : (
                        <tr key={l.id} onClick={() => show(l)} className={`cursor-pointer ${inYear.has(l.id) ? "" : "bg-sand-50 text-ink-3"} ${review.has(l.id) ? "bg-warning-soft/60" : ""} ${focus && focus.description === l.description && focus.amountCents === l.amountCents ? "bg-[#fff8dc]" : ""}`}>
                          <td className="whitespace-nowrap tabular-nums">{longDate(l.date)}</td>
                          {card && <td className="whitespace-nowrap text-ink-3">{short(l.postedDate)}</td>}
                          <td>{l.description}{l.source !== "read" && <span className="ml-1.5 rounded bg-sand-100 px-1 text-[10.5px] font-semibold text-ink-3">{l.source === "added" ? "Added" : "Edited"}</span>}
                            {review.has(l.id) && <div className="text-[12px] text-warning">{review.get(l.id)}</div>}</td>
                          <td className="whitespace-nowrap">{typeLabel(acc.kind, l.dir)}</td>
                          <td className="text-right tabular-nums">{m(l.amountCents)}</td>
                          {!card && <td className="text-right tabular-nums">{l.balanceCents === null ? "" : m(l.balanceCents)}</td>}
                          <td className="whitespace-nowrap">{sideNote(l)}</td>
                          <td onClick={(e) => e.stopPropagation()}>{!ro && <button type="button" aria-label={`Edit ${l.description}`} onClick={() => startEdit(l)} className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-sand-100"><Pencil className="h-3.5 w-3.5" /></button>}</td>
                        </tr>
                      ))}
                      {!lines.length && <tr><td colSpan={cols + 1} className="text-[12.5px] text-ink-3">No lines for review.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Points 16 and 17: plain checks */}
              {chk && (
                <section aria-label="Checks" className="grid gap-1.5 rounded-[10px] border border-sand-200 bg-white px-4 py-3 text-[13.5px]">
                  {card && cs ? (
                    <p className="flex gap-2">{okIcon(chk.differenceCents === 0)}<span>Previous balance {m(cs.previous)} + purchases {m(cs.purchases)} + interest {m(cs.interest)} + fees {m(cs.fees)} − payments {m(cs.payments)} = new balance {m(cs.newBalance)}{chk.differenceCents === 0 ? ", to the cent." : `. The lines add up to ${m(acc.closing - chk.differenceCents)}: a difference of ${m(chk.differenceCents)}.`}</span></p>
                  ) : (
                    <p className="flex gap-2">{okIcon(chk.differenceCents === 0)}<span>Opening {m(acc.opening)} + money in {m(chk.inTotal)} − money out {m(chk.outTotal)} = closing {m(acc.closing)}{chk.differenceCents === 0 ? ", to the cent." : `. The lines add up to ${m(acc.closing - chk.differenceCents)}: a difference of ${m(chk.differenceCents)}.`}</span></p>
                  )}
                  {s ? <p className="flex gap-2">{okIcon(chk.summaryOk.in !== false && chk.summaryOk.out !== false)}<span>{chk.summaryOk.in !== false && chk.summaryOk.out !== false
                      ? `Matches the printed summary: ${plural(chk.inCount, card ? "charge" : "deposit")} ${m(chk.inTotal)}, ${plural(chk.outCount, card ? "payment" : "withdrawal")} ${m(chk.outTotal)}.`
                      : `Does not match the printed summary: the statement shows ${word.in.toLowerCase()} ${m(s.inTotal)}${s.inCount !== null ? ` (${s.inCount})` : ""} and ${word.out.toLowerCase()} ${m(s.outTotal)}${s.outCount !== null ? ` (${s.outCount})` : ""}; the lines add up to ${m(chk.inTotal)} (${chk.inCount}) and ${m(chk.outTotal)} (${chk.outCount}).`}</span></p>
                    : <p className="flex gap-2">{okIcon(null)}<span className="text-ink-3">The statement prints no totals to check against.</span></p>}
                  {!card && acc.lines.some((l) => l.balanceCents !== null) && <p className="flex gap-2">{okIcon(!chk.runningBreak)}<span>{chk.runningBreak ? `The running balance stops matching at ${longDate(acc.lines.find((l) => l.id === chk.runningBreak!.lineId)?.date ?? acc.periodStart)}: a line above it may be missing or misread.` : "Running balance checks on every line."}</span></p>}
                  {chk.review.length > 0 && <p className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden /><span>{plural(chk.review.length, "line")} for review: look at them on the For review tab, fix or keep them.</span></p>}
                  {startEdge !== null && cut?.crossesStart !== undefined && (acc.periodStart <= dayBefore) && (
                    <p className="flex gap-2">{okIcon(d.books === null ? null : d.books === startEdge)}<span>Balance on {longDate(dayBefore)} from this statement: {m(acc.closing)} − {m(acc.lines.filter((l) => l.date >= yearStart).reduce((n, l) => n + (l.dir === "in" ? l.amountCents : -l.amountCents), 0))} = <b>{m(startEdge)}</b>.
                      {d.books === null ? " The books balance is not entered yet." : d.books === startEdge ? ` Books: ${m(d.books)}. Same.` : ` Books: ${m(d.books)}: a difference of ${m(d.books - startEdge)}. Explain it with outstanding items on the main page.`}</span></p>
                  )}
                  {endEdge !== null && cut?.crossesEnd && (
                    <p className="flex gap-2">{okIcon(d.endBooks === null ? null : d.endBooks + thisYearMove === endEdge)}<span>Balance {card ? "owing " : ""}on {longDate(yearEnd)} from this statement: <b>{m(endEdge)}</b>.
                      {d.endBooks === null ? "" : ` Books after import: ${m(d.endBooks + thisYearMove)}${d.endBooks + thisYearMove === endEdge ? ". Same." : `: a difference of ${m(d.endBooks + thisYearMove - endEdge)}. Check every statement is in, or explain it with outstanding items.`}`}</span></p>
                  )}
                </section>
              )}
            </>}

            {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
            {dups && acc && (
              <div role="alert" className="grid gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm">
                <p className="font-semibold text-danger">{plural(dups.reduce((n, x) => n + x.lineIds.length, 0), "line")} already in this file (point 14). Importing them again counts them twice.</p>
                <ul className="list-disc pl-5 text-[13px]">{dups.flatMap((x) => x.lineIds.map((id) => { const l = data.accounts.find((a) => a.key === x.accountKey)?.lines.find((y) => y.id === id); return l ? <li key={id}>{longDate(l.date)} · {l.description} · {m(l.amountCents)}</li> : null; }))}</ul>
                <label className="flex items-center gap-2"><input type="checkbox" checked={dupOk} onChange={(e) => setDupOk(e.target.checked)} className="h-4 w-4" />These are real transactions: import them (they go to the reviewer)</label>
                <div className="flex gap-2"><button type="button" className="btn h-9" disabled={!dupOk || busy} onClick={() => doImport(true)}>Import anyway</button><button type="button" className="btn-secondary" onClick={() => setDups(null)}>Cancel</button></div>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-sand-200 bg-[#fcfbf8] px-5 py-3">
          <span className="text-[12.5px] text-ink-3">{ro ? (d.row.status === "imported" ? "Imported." : "View only.") : stop ? "This statement cannot be imported here." : chk?.differenceCents !== 0 ? "Fix the difference to import." : chk?.ok ? "All checks pass." : "Look at the lines for review, then import."}
            {!d.next && !ro && !stop ? " Last statement in this upload." : ""}</span>
          <span className="flex-1" />
          {dirty && !ro && <button type="button" onClick={save} className="btn-secondary">Save changes</button>}
          <button type="button" onClick={() => go(href)} className="btn-secondary">Back to the list</button>
          {!ro && outside && <button type="button" disabled={busy} onClick={skip} className="btn h-9">Skip</button>}
          {!ro && !outside && (
            <button type="button" disabled={busy || stop || !!dups || chk?.differenceCents !== 0 || st === "already"} onClick={() => doImport(false)} className="btn h-9">{busy ? "Importing…" : d.next ? "Import and next" : "Import and finish"}</button>
          )}
        </div>
      </div>
    </div>
  );
}

function MoveButton({ id, to, fileId, accKey, after }: { id: string; to: { id: string; number: string; name: string }; fileId: string; accKey: string; after: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return <button type="button" disabled={busy} className="btn h-9" onClick={async () => {
    setBusy(true);
    const { setStatementTarget } = await import("../../step3-actions");
    const r = await setStatementTarget([id], to.id);
    setBusy(false);
    if (!r.ok) return notify(r.error, "error");
    writeSession(fileId, accKey, (s) => ({ ...s, moved: { ...s.moved, [id]: `${to.number} ${to.name}` } }));
    notify(`Moved to ${to.number} ${to.name}. It waits there to check.`);
    router.push(after); router.refresh();
  }}>Move it to {to.number} {to.name}</button>;
}

function Edit({ draft, setDraft, card, err, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; card: boolean; err: string | null; onSave: () => void; onCancel: () => void }) {
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); onSave(); } if (e.key === "Escape") onCancel(); };
  return (
    <tr className="bg-navy-50/60" onKeyDown={key}>
      <td><input type="date" aria-label={card ? "Purchase date" : "Date"} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="input input-compact w-[9.5rem]" autoFocus /></td>
      {card && <td><input type="date" aria-label="Posting date" value={draft.posted} onChange={(e) => setDraft({ ...draft, posted: e.target.value })} className="input input-compact w-[9.5rem]" /></td>}
      <td><input aria-label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="input input-compact" placeholder="As on the statement" />
        {err && <div className="mt-1 text-[12px] text-danger">{err}</div>}</td>
      <td><select aria-label="Type" value={draft.dir} onChange={(e) => setDraft({ ...draft, dir: e.target.value as "in" | "out" })} className="input input-compact w-[8.5rem]">
        <option value="in">{card ? "Charge" : "Money in"}</option><option value="out">{card ? "Payment" : "Money out"}</option></select></td>
      <td><input aria-label="Amount" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} onBlur={(e) => setDraft({ ...draft, amount: tidyAmount(e.target.value) })} className={`input input-compact w-[7.5rem] text-right tabular-nums ${amountTone(draft.amount)}`} placeholder="0.00" /></td>
      {!card && <td />}
      <td colSpan={2} className="text-right whitespace-nowrap"><button type="button" onClick={onSave} className="btn h-7 px-2.5 text-[12.5px]">Done</button><button type="button" onClick={onCancel} className="ml-1 text-[12.5px] text-ink-2 underline">Cancel</button></td>
    </tr>
  );
}
