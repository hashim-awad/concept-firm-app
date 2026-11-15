"use client";
// Round 20 (Hashim, Nov 15, 2026; mocks 02 and 03): Verify details. Benchmark: QuickBooks Online's
// "Verify details" after a PDF statement import, plus a running-balance check. Left: the statement.
// Right: the accounts found (Closebook: each assigned to one of the file's bank accounts, or skipped),
// the statement details, the lines (All / For review), and the footer checks against the printed totals.
// Every amount is positive with a Type; signs are set on import and in the CSV.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Download, FileText, Pencil, Plus, X } from "lucide-react";
import type { StatementRow } from "@/lib/statements/server";
import type { ReadResult, StatementAccount, StatementLine } from "@/lib/statements/types";
import { typeLabel } from "@/lib/statements/types";
import { checkAccount } from "@/lib/statements/checks";
import { validDate } from "@/lib/closebook/bank-upload";
import { discardStatement, importStatement, saveStatementEdits } from "../actions";
import { accountLabel, money, parseMoney, plural, shortDate } from "../format";
import { StatementViewer, type Focus } from "./statement-viewer";

export type FileCtx = { id: string; yearStart: string; yearEnd: string; bankAccounts: { id: string; name: string; kind: "bank" | "card"; last4: string | null }[] };
export type Nav = { index: number; total: number; prev: string | null; next: string | null };

const PAGE = 100;
type SortCol = "date" | "description" | "type" | "amount";
type Draft = { date: string; description: string; dir: "in" | "out"; amount: string };
type Dup = { accountKey: string; lineIds: string[] };

const lastDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
// The file's bank account whose last digits match the statement's, when exactly one does.
function suggest(acc: StatementAccount, file: FileCtx | null): string {
  const d = lastDigits(acc.last4);
  if (!file || d.length < 3) return "";
  const m = file.bankAccounts.filter((b) => { const x = lastDigits(b.last4) || lastDigits(b.name.match(/\d{3,}\s*$/)?.[0]); return !!x && (x.endsWith(d) || d.endsWith(x)); });
  return m.length === 1 ? m[0].id : "";
}

export function Verify({ id, row, initial, fileUrl, file, nav, backHref, canEdit, warnings, eyebrow }: {
  id: string; row: StatementRow; initial: ReadResult; fileUrl: string; file: FileCtx | null; nav: Nav; backHref: string;
  canEdit: boolean; warnings: string[]; eyebrow: React.ReactNode;
}) {
  const router = useRouter();
  const closebook = !!row.file_id;
  const imported = row.status === "imported";
  const readOnly = !canEdit || imported;
  const [data, setData] = useState<ReadResult>(initial);
  const [accKey, setAccKey] = useState(initial.accounts[0]?.key ?? "");
  const [tab, setTab] = useState<"all" | "review">("all");
  const [sort, setSort] = useState<{ col: SortCol; asc: boolean }>({ col: "date", asc: true });
  const [pageNo, setPageNo] = useState(0);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);   // a line id, "new", or null
  const [draft, setDraft] = useState<Draft>({ date: "", description: "", dir: "out", amount: "" });
  const [draftErr, setDraftErr] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [assign, setAssign] = useState<Record<string, string>>(() => Object.fromEntries(initial.accounts.map((a) => [a.key, suggest(a, file)])));
  const [save, setSave] = useState<{ state: "saved" | "dirty" | "saving" | "error"; error?: string }>({ state: "saved" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dups, setDups] = useState<Dup[] | null>(null);
  const [dupOk, setDupOk] = useState(false);
  const version = useRef(0);
  const latest = useRef(data);
  useEffect(() => { latest.current = data; }, [data]);

  // ---------- Saving: a second after the last change, and before leaving.
  const flush = useCallback(async (): Promise<boolean> => {
    if (readOnly) return true;
    const v = version.current;
    setSave({ state: "saving" });
    try {
      const r = await saveStatementEdits(id, latest.current);
      if (!r.ok) { setSave({ state: "error", error: r.error }); return false; }
      if (version.current === v) setSave({ state: "saved" });
      return true;
    } catch {
      setSave({ state: "error", error: "Not saved. Check the connection and try again." });
      return false;
    }
  }, [id, readOnly]);
  const change = (f: (d: ReadResult) => ReadResult) => {
    if (readOnly) return;
    version.current++;
    setData((d) => f(d));
    setSave({ state: "dirty" });
  };
  useEffect(() => {
    if (save.state !== "dirty") return;
    const t = setTimeout(flush, 1000);
    return () => clearTimeout(t);
  }, [save.state, data, flush]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (save.state === "dirty" || save.state === "saving") e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [save.state]);
  const go = async (href: string) => { if (save.state !== "saved" && !(await flush())) return; router.push(href); };

  // ---------- The account shown, and the checks.
  const acc = data.accounts.find((a) => a.key === accKey) ?? data.accounts[0];
  const checks = useMemo(() => new Map(data.accounts.map((a) => [a.key, checkAccount(a)])), [data]);
  const chk = acc ? checks.get(acc.key)! : null;
  const reviewReason = useMemo(() => new Map((chk?.review ?? []).map((r) => [r.lineId, r.reason])), [chk]);

  const updAcc = (patch: Partial<StatementAccount>) => change((d) => ({ ...d, accounts: d.accounts.map((a) => (a.key === acc!.key ? { ...a, ...patch } : a)) }));
  const updLines = (f: (ls: StatementLine[]) => StatementLine[]) => updAcc({ lines: f(acc!.lines) });

  // ---------- The table: tab, sort, page.
  const all = useMemo(() => acc?.lines ?? [], [acc]);
  const shown = useMemo(() => {
    const base = tab === "review" ? all.filter((l) => reviewReason.has(l.id)) : all;
    const idx = new Map(all.map((l, i) => [l.id, i]));
    const k = (l: StatementLine): string | number => sort.col === "date" ? l.date : sort.col === "description" ? l.description.toLowerCase() : sort.col === "type" ? l.dir : l.amountCents;
    return [...base].sort((a, b) => {
      const x = k(a), y = k(b);
      const c = x < y ? -1 : x > y ? 1 : idx.get(a.id)! - idx.get(b.id)!;
      return sort.asc ? c : -c;
    });
  }, [all, tab, sort, reviewReason]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pg = Math.min(pageNo, pages - 1);
  const visible = shown.slice(pg * PAGE, pg * PAGE + PAGE);
  // A new account or tab starts on its first page, with nothing ticked.
  const pickAcc = (k: string) => { setAccKey(k); setPageNo(0); setTicked(new Set()); setEditing(null); };
  const pickTab = (t: "all" | "review") => { setTab(t); setPageNo(0); setTicked(new Set()); setEditing(null); };

  const sortBy = (col: SortCol) => setSort((s) => (s.col === col ? { col, asc: !s.asc } : { col, asc: true }));
  const arrow = (col: SortCol) => (sort.col === col ? (sort.asc ? " ▾" : " ▴") : "");

  const startEdit = (l: StatementLine | null) => {
    setDraftErr(null);
    if (l) { setEditing(l.id); setDraft({ date: l.date, description: l.description, dir: l.dir, amount: money(l.amountCents) }); }
    else { setEditing("new"); setDraft({ date: acc?.periodEnd ?? "", description: "", dir: "out", amount: "" }); }
  };
  const saveDraft = () => {
    const cents = parseMoney(draft.amount);
    if (!validDate(draft.date)) return setDraftErr("Enter the date as YYYY-MM-DD.");
    if (!draft.description.trim()) return setDraftErr("Enter the description.");
    if (cents === null || cents <= 0) return setDraftErr("Enter the amount as a positive number, for example 96.48. The Type says which way it goes.");
    const fields = { date: draft.date, description: draft.description.trim(), dir: draft.dir, amountCents: cents };
    if (editing === "new") {
      const n = Math.max(0, ...data.accounts.flatMap((a) => a.lines).map((l) => (/^a\d+$/.test(l.id) ? Number(l.id.slice(1)) : 0))) + 1;
      const before = [...all].filter((l) => l.date <= draft.date).pop();
      const line: StatementLine = { id: `a${n}`, ...fields, balanceCents: null, page: before?.page ?? 1, unsure: false, unsureReason: "", source: "added" };
      // In date order, after the lines of the same date.
      const at = all.findIndex((l) => l.date > draft.date);
      updLines((ls) => (at < 0 ? [...ls, line] : [...ls.slice(0, at), line, ...ls.slice(at)]));
    } else {
      updLines((ls) => ls.map((l) => (l.id === editing ? { ...l, ...fields, unsure: false, unsureReason: "", source: l.source === "added" ? "added" : "edited" } : l)));
    }
    setEditing(null);
  };
  const deleteTicked = () => {
    if (!ticked.size) return;
    updLines((ls) => ls.filter((l) => !ticked.has(l.id)));
    setTicked(new Set());
  };
  const show = (l: StatementLine) => setFocus((f) => ({ n: (f?.n ?? 0) + 1, page: l.page, amountCents: l.amountCents, description: l.description }));

  // ---------- Import readiness (Closebook) and download readiness (standalone).
  const live = data.accounts.filter((a) => assign[a.key] !== "skip");
  const unassigned = closebook ? data.accounts.filter((a) => !assign[a.key]) : [];
  const unbalanced = (closebook ? live : data.accounts).filter((a) => checks.get(a.key)!.differenceCents !== 0);
  const importLines = live.reduce((n, a) => n + a.lines.length, 0);
  const ready = !unassigned.length && !unbalanced.length && (closebook ? live.length > 0 : true);
  const many = data.accounts.length > 1;
  const nameOf = (a: StatementAccount) => accountLabel(a.name, a.last4);
  const problems: string[] = [];
  for (const a of closebook ? live : data.accounts) {
    const c = checks.get(a.key)!, who = many ? `${nameOf(a)}: ` : "";
    const ws = a.kind === "card" ? ["charges", "payments"] : ["money in", "money out"];
    const bits: string[] = [];
    if (c.differenceCents !== 0) bits.push(`the difference is ${money(c.differenceCents)}`);
    if (c.summaryOk.in === false) bits.push(`${ws[0]} does not match the statement's total`);
    if (c.summaryOk.out === false) bits.push(`${ws[1]} does not match the statement's total`);
    if (bits.length) problems.push(`${who}${bits.join(", ")}.`);
    if (c.runningBreak) {
      const l = a.lines.find((x) => x.id === c.runningBreak!.lineId);
      if (l) problems.push(`${who}Running balance: the first line that does not match is ${shortDate(l.date)}.`);
    }
  }
  for (const a of unassigned) problems.push(`${plural(a.lines.length, `${nameOf(a)} line`)} ${a.lines.length === 1 ? "has" : "have"} no account.`);

  const doImport = async (confirm: boolean) => {
    if (!ready || busy) return;
    setBusy(true); setErr(null);
    try {
      if (save.state !== "saved" && !(await flush())) return;
      const r = await importStatement(id, assign, confirm);
      if (!r.ok) { setErr(r.error); return; }
      if (r.duplicates?.length && !confirm) { setDups(r.duplicates); setDupOk(false); return; }
      router.push(nav.next ? `/statements/${nav.next}` : backHref);
      router.refresh();
    } catch {
      setErr("The import did not finish. Nothing was imported. Try again.");
    } finally { setBusy(false); }
  };
  const download = async (format: "csv" | "xlsx") => {
    if (!ready || busy) return;
    setBusy(true);
    if (save.state !== "saved" && !(await flush())) { setBusy(false); return; }
    const a = document.createElement("a");
    a.href = `/api/statements/${id}/download?format=${format}`;
    a.download = "";
    document.body.appendChild(a); a.click(); a.remove();
    // The statement is deleted after the download: back to the list once it has started.
    setTimeout(() => { router.push(backHref); router.refresh(); }, 2500);
  };
  const discard = async () => {
    if (!confirm(closebook ? "Discard this statement? The file and what was read are deleted. Nothing is imported." : "Discard this statement? The file and what was read are deleted.")) return;
    setBusy(true);
    const r = await discardStatement(id);
    setBusy(false);
    if (!r.ok) return setErr(r.error);
    router.push(backHref); router.refresh();
  };

  const modelName = row.model === "fixture" ? "the test reader" : (row.model ?? "").replace(/^claude-/, "Claude ").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-/g, " ").replace(/\b(sonnet|opus|haiku)\b/g, (w) => w[0].toUpperCase() + w.slice(1));
  const words = acc?.kind === "card" ? { in: "Total charges", out: "Total payments" } : { in: "Total money in", out: "Total money out" };
  const allTicked = visible.length > 0 && visible.every((l) => ticked.has(l.id));
  const reviewCount = chk?.review.length ?? 0;

  return (
    <div className="grid gap-3">
      {eyebrow}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">Verify details</h1>
        <span className="text-[13px] text-ink-3">{row.file_name}{row.pages ? ` · ${plural(row.pages, "page")}` : ""}{row.model ? ` · read by ${modelName}` : ""}</span>
        {imported && <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold text-success">Imported</span>}
        <span className="flex-1" />
        <span className={`text-[12.5px] ${save.state === "error" ? "text-danger" : "text-ink-3"}`} aria-live="polite">
          {readOnly ? "" : save.state === "saving" ? "Saving…" : save.state === "dirty" ? "Changes not saved yet" : save.state === "error" ? save.error : "All changes saved"}</span>
        {nav.total > 0 && (
          <span className="inline-flex items-center gap-1 text-[12.5px] text-ink-2">
            <button type="button" aria-label="Previous statement" disabled={!nav.prev} onClick={() => nav.prev && go(`/statements/${nav.prev}`)} className="grid h-7 w-7 place-items-center rounded hover:bg-sand-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            Statement {nav.index} of {nav.total}
            <button type="button" aria-label="Next statement" disabled={!nav.next} onClick={() => nav.next && go(`/statements/${nav.next}`)} className="grid h-7 w-7 place-items-center rounded hover:bg-sand-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </span>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[5fr_7fr]">
        <div className="xl:sticky xl:top-[72px]"><StatementViewer url={fileUrl} mediaType={row.media_type} pages={row.pages} focus={focus} /></div>

        <div className="grid min-w-0 gap-3">
          {/* Accounts found */}
          <section aria-label="Accounts found" className="overflow-hidden rounded-[10px] border border-sand-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-4 py-2.5">
              <h2 className="text-[14px] font-semibold">Accounts found in this statement ({data.accounts.length})</h2>
              <span className="flex-1" />
              {closebook && !imported && (unassigned.length
                ? <span className="text-[12.5px] font-semibold text-danger">{plural(unassigned.reduce((n, a) => n + a.lines.length, 0), "line")} not assigned: import is blocked</span>
                : <span className="text-[12.5px] font-semibold text-success">{data.accounts.length === 2 ? "Both assigned" : data.accounts.length === 1 ? "Assigned" : "All assigned"}</span>)}
            </div>
            <table className="w-full text-sm">
              <tbody>{data.accounts.map((a) => {
                const v = assign[a.key] ?? "", sug = suggest(a, file);
                const state = v === "skip" ? ["Skipped", "text-ink-3"] : !v ? ["Not assigned", "text-danger"] : v === sug ? ["Digits match", "text-success"]
                  : lastDigits(a.last4) && lastDigits(file?.bankAccounts.find((b) => b.id === v)?.last4) ? ["Digits differ", "text-warning"] : ["Assigned", "text-ink-2"];
                return (
                  <tr key={a.key} onClick={() => pickAcc(a.key)} className={`cursor-pointer border-b border-sand-100 last:border-0 ${a.key === acc?.key ? "bg-navy-50" : "hover:bg-sand-50"}`}>
                    <td className="px-4 py-2.5"><b className="font-semibold">{nameOf(a)}</b>
                      <div className="text-[12.5px] text-ink-3">{a.kind === "card" ? "Card or line of credit" : "Bank account"} · {plural(a.lines.length, "line")}</div></td>
                    {closebook && <>
                      <td className="px-2 text-ink-2 whitespace-nowrap">Import into</td>
                      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
                        <select aria-label={`Import ${nameOf(a)} into`} disabled={readOnly} value={v} onChange={(e) => setAssign({ ...assign, [a.key]: e.target.value })}
                          className={`input input-compact h-9 min-w-[14rem] font-medium ${!v ? "border-danger/50 text-danger" : ""}`}>
                          <option value="">Choose an account or Skip</option>
                          {file?.bankAccounts.map((b) => <option key={b.id} value={b.id}>{accountLabel(b.name, b.last4 ?? "")}</option>)}
                          <option value="skip">Skip: do not import</option>
                        </select>
                      </td>
                      <td className={`px-4 text-[12.5px] font-semibold whitespace-nowrap ${state[1]}`}>{imported ? "" : state[0]}</td>
                    </>}
                    {!closebook && <td className="px-4 text-right text-[12.5px] whitespace-nowrap text-ink-3">{shortDate(a.periodStart)} to {shortDate(a.periodEnd)}</td>}
                  </tr>
                );
              })}</tbody>
            </table>
            {closebook && !file?.bankAccounts.length && <p className="border-t border-sand-200 px-4 py-2 text-[12.5px] text-warning">This file has no bank accounts yet. Add one on step 3 (Upload CSV, then Add an account), then come back.</p>}
          </section>

          {/* Ready or not */}
          {!imported && (ready
            ? <p className="rounded-[10px] border border-success/30 bg-success-soft px-3.5 py-2.5 text-[13px] text-success"><b>{closebook ? "Ready to import." : "Ready to download."}</b> Opening plus the lines equals the closing balance{many ? " on every account" : ""}.
                {(() => { const s = [...checks.values()]; const sum = s.every((c) => c.summaryOk.in !== false && c.summaryOk.out !== false) && s.some((c) => c.summaryOk.in !== null || c.summaryOk.out !== null);
                  return <>{sum && " The totals of money in and money out match the statement's totals."}{s.every((c) => !c.runningBreak) && data.accounts.some((a) => a.lines.some((l) => l.balanceCents !== null)) && " The running balance matches on every line."}</>; })()}</p>
            : <p role="alert" className="rounded-[10px] border border-danger/30 bg-danger-soft px-3.5 py-2.5 text-[13px] text-danger"><b>{closebook ? "Not ready to import." : "Not ready to download."}</b> {problems.join(" ")}</p>)}
          {warnings.length > 0 && !imported && (
            <ul className="grid gap-1 rounded-[10px] border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[13px] text-warning">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}

          {acc && <>
          {/* Statement details */}
          <section aria-label="Statement details" className="rounded-[10px] border border-sand-200 bg-white px-4 py-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h2 className="text-[14px] font-semibold">{nameOf(acc)}</h2>
              <span className="flex-1" />
              {many && (
                <span className="inline-flex overflow-hidden rounded-md border border-sand-300 text-[13px]">
                  {data.accounts.map((a) => <button key={a.key} type="button" onClick={() => pickAcc(a.key)} aria-pressed={a.key === acc.key}
                    className={`px-3 py-1 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-sand-300 ${a.key === acc.key ? "bg-navy-700 font-semibold text-white" : "text-ink-2 hover:bg-sand-50"}`}>{nameOf(a)}</button>)}
                </span>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-4">
              <DateField label="Start date" value={acc.periodStart} disabled={readOnly} onChange={(v) => updAcc({ periodStart: v })} />
              <DateField label="End date" value={acc.periodEnd} disabled={readOnly} onChange={(v) => updAcc({ periodEnd: v })} />
              <MoneyField key={`o-${acc.key}`} label="Opening balance" cents={acc.opening} disabled={readOnly} onChange={(c) => updAcc({ opening: c })} />
              <MoneyField key={`c-${acc.key}`} label="Closing balance" cents={acc.closing} disabled={readOnly} onChange={(c) => updAcc({ closing: c })} />
            </div>
          </section>

          {/* Lines */}
          <section aria-label="Lines" className="overflow-hidden rounded-[10px] border border-sand-200 bg-white">
            <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-4 pt-1.5">
              <nav className="flex gap-1" aria-label="Lines">
                {([["all", `All (${all.length})`], ["review", `For review (${reviewCount})`]] as const).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => pickTab(k)} aria-current={tab === k ? "page" : undefined}
                    className={`-mb-px border-b-2 px-3 py-2.5 text-[13.5px] font-semibold ${tab === k ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>{l}</button>
                ))}
              </nav>
              <span className="flex-1" />
              {!readOnly && ticked.size > 0 && <>
                <span className="text-[12.5px] text-ink-3">{ticked.size} ticked</span>
                <button type="button" onClick={deleteTicked} className="btn-danger h-8 px-3 text-[13px]"><X className="h-3.5 w-3.5" aria-hidden />Delete</button>
              </>}
              {!readOnly && <button type="button" onClick={() => startEdit(null)} className="btn-secondary h-8 px-3 text-[13px]"><Plus className="h-3.5 w-3.5" aria-hidden />Add missing line</button>}
            </div>
            <div className="overflow-x-auto">
              <table className="table table-compact">
                <thead><tr>
                  <th className="w-8">{!readOnly && <input type="checkbox" aria-label="Tick every line on this page" checked={allTicked}
                    onChange={() => setTicked(allTicked ? new Set() : new Set(visible.map((l) => l.id)))} className="h-4 w-4" />}</th>
                  {([["date", "Date"], ["description", "Description"], ["type", "Type"], ["amount", "Amount"]] as const).map(([c, l]) => (
                    <th key={c} className={c === "amount" ? "text-right" : ""}><button type="button" onClick={() => sortBy(c)} className="font-semibold uppercase hover:text-ink">{l}{arrow(c)}</button></th>
                  ))}
                  <th className="w-16" />
                </tr></thead>
                <tbody>
                  {editing === "new" && <EditRow draft={draft} setDraft={setDraft} kind={acc.kind} err={draftErr} onSave={saveDraft} onCancel={() => setEditing(null)} />}
                  {visible.map((l) => {
                    if (editing === l.id) return <EditRow key={l.id} draft={draft} setDraft={setDraft} kind={acc.kind} err={draftErr} onSave={saveDraft} onCancel={() => setEditing(null)} />;
                    const why = reviewReason.get(l.id);
                    const isBreak = chk?.runningBreak?.lineId === l.id;
                    return (
                      <tr key={l.id} data-line={l.id} onClick={() => show(l)} className={`cursor-pointer ${why ? "bg-warning-soft/70 hover:bg-warning-soft" : ""} ${focus && l.page === focus.page && l.amountCents === focus.amountCents && l.description === focus.description ? "outline-2 -outline-offset-2 outline-[#e8b100]" : ""}`}>
                        <td onClick={(e) => e.stopPropagation()}>{!readOnly && <input type="checkbox" aria-label={`Tick ${l.description}`} checked={ticked.has(l.id)}
                          onChange={() => { const t = new Set(ticked); if (t.has(l.id)) t.delete(l.id); else t.add(l.id); setTicked(t); }} className="h-4 w-4" />}</td>
                        <td className="whitespace-nowrap tabular-nums">{l.date}</td>
                        <td>{l.description}
                          {l.source !== "read" && <span className="ml-1.5 rounded bg-sand-100 px-1 text-[10.5px] font-semibold text-ink-3">{l.source === "added" ? "Added" : "Edited"}</span>}
                          {why && <div className={`text-[12px] leading-snug ${isBreak ? "text-danger" : "text-warning"}`}>{why}</div>}</td>
                        <td className="whitespace-nowrap">{typeLabel(acc.kind, l.dir)}</td>
                        <td className="text-right tabular-nums">{money(l.amountCents)}</td>
                        <td className="text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <button type="button" title="Show on the statement" aria-label={`Show ${l.description} on the statement`} onClick={() => show(l)} className="inline-grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-sand-100 hover:text-navy-700"><FileText className="h-4 w-4" /></button>
                          {!readOnly && <button type="button" title="Edit" aria-label={`Edit ${l.description}`} onClick={() => startEdit(l)} className="inline-grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-sand-100 hover:text-navy-700"><Pencil className="h-3.5 w-3.5" /></button>}
                        </td>
                      </tr>
                    );
                  })}
                  {tab === "review" && (
                    <tr><td colSpan={6} className="text-[12.5px] text-ink-3">{reviewCount ? `Showing the ${plural(reviewCount, "line")} for review. Fix them, or keep them as read, then check the footer.` : "No lines for review."}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-end gap-2 border-t border-sand-200 px-4 py-2 text-[12.5px] text-ink-2">
                <span className="tabular-nums">{pg * PAGE + 1} to {Math.min(shown.length, pg * PAGE + PAGE)} of {shown.length}</span>
                <button type="button" disabled={pg === 0} onClick={() => setPageNo(pg - 1)} className="btn-secondary h-7 px-2 text-[12.5px]">Previous</button>
                <button type="button" disabled={pg >= pages - 1} onClick={() => setPageNo(pg + 1)} className="btn-secondary h-7 px-2 text-[12.5px]">Next</button>
              </div>
            )}
            {chk && (
              <div className="grid border-t border-sand-200 sm:grid-cols-3">
                <div className="px-4 py-2.5"><div className="text-[12.5px] text-ink-3">Difference (must be 0.00)</div>
                  <b data-difference className={`text-[17px] tabular-nums ${chk.differenceCents === 0 ? "text-success" : "text-danger"}`}>{money(chk.differenceCents)}</b></div>
                <Total label={`${words.in} (${chk.inCount})`} cents={chk.inTotal} ok={chk.summaryOk.in} printed={acc.summary?.inTotal ?? null} printedCount={acc.summary?.inCount ?? null} count={chk.inCount} />
                <Total label={`${words.out} (${chk.outCount})`} cents={chk.outTotal} ok={chk.summaryOk.out} printed={acc.summary?.outTotal ?? null} printedCount={acc.summary?.outCount ?? null} count={chk.outCount} />
              </div>
            )}
          </section>
          </>}

          {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">{err}</p>}
          {dups && (
            <div role="alert" className="grid gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2.5 text-sm">
              <p className="font-semibold text-danger">{plural(dups.reduce((n, d) => n + d.lineIds.length, 0), "line")} {dups.reduce((n, d) => n + d.lineIds.length, 0) === 1 ? "is" : "are"} already in this file. Importing them again counts them twice.</p>
              <div className="max-h-48 overflow-y-auto"><table className="w-full text-xs">
                <thead><tr className="text-left text-ink-3"><th className="pr-2">Account</th><th className="pr-2">Date</th><th className="pr-2">Description</th><th className="text-right">Amount</th></tr></thead>
                <tbody>{dups.flatMap((d) => { const a = data.accounts.find((x) => x.key === d.accountKey); return d.lineIds.map((lid) => { const l = a?.lines.find((x) => x.id === lid); return l && a ? (
                  <tr key={`${d.accountKey}-${lid}`}><td className="pr-2">{nameOf(a)}</td><td className="pr-2 tabular-nums">{l.date}</td><td className="pr-2">{l.description}</td><td className="text-right tabular-nums">{money(l.amountCents)}</td></tr>) : null; }); })}</tbody>
              </table></div>
              <p className="text-ink-2">Most often the same statement was imported twice, or a CSV of the same month is already in. Skip the account, or if these are real (two equal charges on the same day), confirm:</p>
              <label className="flex items-center gap-2"><input type="checkbox" checked={dupOk} onChange={(e) => setDupOk(e.target.checked)} className="h-4 w-4" />These are real transactions: import them</label>
              <div className="flex gap-2"><button type="button" className="btn h-9" disabled={!dupOk || busy} onClick={() => doImport(true)}>Import anyway</button>
                <button type="button" className="btn-secondary" onClick={() => setDups(null)}>Cancel</button></div>
            </div>
          )}

          {/* Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-[16rem] flex-1 text-[12.5px] text-ink-3">{acc?.kind === "card" ? "Card: charges are added to the balance owing, payments are taken off." : "Bank account: Money in is added, Money out is taken off."} Signs are set on {closebook ? "import and " : ""}in the CSV.</span>
            {!imported && canEdit && <button type="button" onClick={discard} disabled={busy} className="btn-danger">Discard</button>}
            <button type="button" onClick={() => go(backHref)} className="btn-secondary">Back to the list</button>
            {closebook && !imported && canEdit && (
              <button type="button" onClick={() => doImport(false)} disabled={!ready || busy || !!dups} className="btn h-9">Import {plural(importLines, "line")}</button>
            )}
            {!closebook && <>
              <button type="button" onClick={() => download("csv")} disabled={!ready || busy} className="btn-secondary"><Download className="h-4 w-4" aria-hidden />Download CSV</button>
              <button type="button" onClick={() => download("xlsx")} disabled={!ready || busy} className="btn h-9"><Download className="h-4 w-4" aria-hidden />Download Excel</button>
            </>}
          </div>
          {!closebook && <p className="text-right text-[12.5px] text-ink-3">The file and its lines are deleted after you download them.</p>}
        </div>
      </div>
    </div>
  );
}

function Total({ label, cents, ok, printed, printedCount, count }: { label: string; cents: number; ok: boolean | null; printed: number | null; printedCount: number | null; count: number }) {
  return (
    <div className="px-4 py-2.5"><div className="text-[12.5px] text-ink-3">{label}</div>
      <b className="text-[17px] tabular-nums">{money(cents)}</b>{" "}
      {ok === true && <span className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-success"><Check className="h-3.5 w-3.5" aria-hidden />matches the statement</span>}
      {ok === false && <span className="inline-flex items-center gap-0.5 text-[12.5px] font-semibold text-danger"><X className="h-3.5 w-3.5" aria-hidden />statement: {printed !== null ? money(printed) : ""}{printedCount !== null && printedCount !== count ? ` (${printedCount})` : ""}</span>}
      {ok === null && <span className="text-[12.5px] text-ink-3">no total printed</span>}
    </div>
  );
}

function DateField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1 text-[12.5px] text-ink-2">{label}
      <input type="date" value={value} disabled={disabled} onChange={(e) => { if (validDate(e.target.value)) onChange(e.target.value); }} className="input input-compact h-9 tabular-nums" />
    </label>
  );
}

// Typed as on the statement (12,480.15); saved when it reads as an amount.
function MoneyField({ label, cents, disabled, onChange }: { label: string; cents: number; disabled: boolean; onChange: (c: number) => void }) {
  const [text, setText] = useState(money(cents));
  const bad = parseMoney(text) === null;
  return (
    <label className="grid gap-1 text-[12.5px] text-ink-2">{label}
      <input inputMode="decimal" value={text} disabled={disabled} aria-invalid={bad || undefined}
        onChange={(e) => { setText(e.target.value); const c = parseMoney(e.target.value); if (c !== null) onChange(c); }}
        onBlur={() => { const c = parseMoney(text); if (c !== null) setText(money(c)); }}
        className={`input input-compact h-9 tabular-nums ${bad ? "border-danger text-danger" : ""}`} />
    </label>
  );
}

function EditRow({ draft, setDraft, kind, err, onSave, onCancel }: { draft: Draft; setDraft: (d: Draft) => void; kind: "bank" | "card"; err: string | null; onSave: () => void; onCancel: () => void }) {
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); onSave(); } if (e.key === "Escape") onCancel(); };
  return (
    <tr className="bg-navy-50/60" onKeyDown={key}>
      <td />
      <td><input type="date" aria-label="Date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="input input-compact w-[9.5rem]" autoFocus /></td>
      <td><input aria-label="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="input input-compact" placeholder="As on the statement" />
        {err && <div className="mt-1 text-[12px] text-danger">{err}</div>}</td>
      <td><select aria-label="Type" value={draft.dir} onChange={(e) => setDraft({ ...draft, dir: e.target.value as "in" | "out" })} className="input input-compact w-[8.5rem]">
        <option value="in">{typeLabel(kind, "in")}</option><option value="out">{typeLabel(kind, "out")}</option></select></td>
      <td><input aria-label="Amount" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} className="input input-compact w-[7.5rem] text-right tabular-nums" placeholder="0.00" /></td>
      <td className="text-right whitespace-nowrap">
        <button type="button" onClick={onSave} className="btn h-7 px-2.5 text-[12.5px]">Save</button>
        <button type="button" onClick={onCancel} className="ml-1 text-[12.5px] text-ink-2 underline">Cancel</button>
      </td>
    </tr>
  );
}

