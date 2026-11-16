"use client";
// Step 2, Opening balances (Hashim, Nov 14, 2026; board "Step 2, Opening balances"; round 21, Nov 15): last
// year's T2 in two tabs. Schedule 100 (required): Assets, Liabilities, Equity and the fixed retained earnings
// block in the T2's order (3660, 3680, 3700, 3720, 3740, 3849). Schedule 125 (enter it when the prior T2 has
// one): it gives last year's column on the statement of earnings and the year-over-year review, and 3680
// fills from its 9999. Every amount is typed as printed on the T2 (src/lib/closebook/schedule.ts). Totals
// calculate live with their codes; a total that does not tie is highlighted yellow with one line under it.
// One Save, one Discard and one "Sign as preparer" for the whole step (round 21's save pattern,
// src/components/save-state.tsx). Benchmark: ProFile's GIFI Schedule 100 and 125 entry.
import { Fragment, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockOf, BLOCK_TITLE, fromGifi, isDividend, needsAccount, RE_BLOCK, RE_TIE_AFTER, RE_TIE_BEFORE, scheduleTotals, toGifi, type Block } from "@/lib/closebook/schedule";
import { bracketAmount, parseAmount } from "@/lib/closebook/amount";
import { Amount, AmountInput } from "@/components/amount";
import { confirmAction, DiscardButton, notify, SaveButton, useSaveState, useUnsavedGuard } from "@/components/save-state";
import { saveOpeningInline, signOpeningInline, uploadOpeningPdfInline } from "../actions";
import { InfoTip } from "@/components/ds/info-tip";

type Row = { id: number; block: Block; code: string; amount: string; account: string };
type Code = { name: string; type: string };
type Choice = { number: string; name: string; label?: string };
const TOTALS = new Set(["2599", "3499", "3600", "3620", "3640", "3680", "3849", "8299", "9368", "9999"]);
// The retained earnings lines typed as rows (3680 and 3849 are boxes of their own).
const FIXED_RE = ["3660", "3700", "3720", "3740"];
const RE_NAME = new Map(RE_BLOCK);
const typedText = (code: string, cents: number) => bracketAmount(fromGifi(code, cents));
const cents = (t: string) => (t.trim() === "" ? null : parseAmount(t));

export function OpeningSchedule({ fileId, codes, initial, s125Before = [], reStated, niTyped, note, pdf, signed, source, bankIssue, editable, choices = {}, initialAccounts = {}, savedAt = null }: {
  fileId: string; codes: [string, Code][]; initial: [string, number][]; reStated: number | null; niTyped: number | null; note: string;
  // Last year's Schedule 125 saved before Nov 15 in its own box (cb_opening_s125), when the tab has no lines.
  s125Before?: [string, number][];
  choices?: Record<string, Choice[]>; initialAccounts?: Record<string, string>; savedAt?: string | null;
  pdf: { href: string; name: string } | null; signed: { by: string; at: string } | null; source: string | null; bankIssue: string; editable: boolean;
}) {
  const router = useRouter();
  const info = useMemo(() => new Map(codes), [codes]);
  const typeOf = (c: string) => info.get(c)?.type;
  const nameOf = (c: string) => RE_NAME.get(c) ?? info.get(c)?.name ?? "";

  // The screen's starting point, from what is saved (also what Discard goes back to).
  const fromSaved = () => {
    let next = 1;
    const has125 = initial.some(([c]) => ["revenue", "expenses"].includes(blockOf(c, typeOf(c)) ?? ""));
    const lines = has125 ? initial : [...initial, ...s125Before];
    const rows: Row[] = lines.map(([code, gifi]) => ({ id: next++, block: blockOf(code, typeOf(code)) ?? "assets", code, amount: typedText(code, gifi), account: initialAccounts[code] ?? "" }));
    for (const c of FIXED_RE) if (!rows.some((r) => r.code === c)) rows.push({ id: next++, block: "re", code: c, amount: "", account: "" });
    for (const b of ["assets", "liabilities", "equity", "revenue", "expenses"] as Block[]) if (!rows.some((r) => r.block === b)) rows.push({ id: next++, block: b, code: "", amount: "", account: "" });
    return { rows, re: reStated === null ? "" : bracketAmount(reStated), ni: niTyped === null ? "" : bracketAmount(niTyped), src: note, moved: !has125 && s125Before.length > 0 };
  };
  const [start] = useState(fromSaved);
  const [rows, setRows] = useState<Row[]>(start.rows);
  const [tab, setTab] = useState<"s100" | "s125">("s100");
  const [re, setRe] = useState(start.re);
  const [ni, setNi] = useState(start.ni);
  const [src, setSrc] = useState(start.src);
  // A Schedule 125 from the old separate box shows in its tab, unsaved, until Save puts it with the rest.
  const st = useSaveState({ dirty: start.moved, savedAt });
  const [err, setErr] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const [uploading, setUploading] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const asked = useRef(false);

  // A change on a signed step asks once: saving removes the sign-off.
  const touch = () => {
    st.markDirty();
    if (signed && !asked.current) {
      asked.current = true;
      void confirmAction({ title: "This step is signed", body: `Prepared by ${signed.by}, ${signed.at}. Saving a change removes the sign-off.`, confirm: "Change it", cancel: "Keep it signed" })
        .then((ok) => { if (!ok) discard(); });
    }
  };

  const usable = (r: Row) => /^\d{4}$/.test(r.code) && info.has(r.code) && !TOTALS.has(r.code) && cents(r.amount) !== null;
  const valid = rows.filter(usable);
  const lines: [string, number][] = valid.map((r) => [r.code, toGifi(r.code, cents(r.amount)!)]);
  const reC = cents(re), niC = cents(ni);
  const { totals: t, flags } = scheduleTotals(lines, typeOf, reC, niC);
  const flag = (code: string) => flags.find((f) => f.code === code);
  const choicesOf = (code: string) => choices[code] ?? [];
  // The account on a row: the one picked, or the only one there is.
  const accountOf = (r: Row) => r.account || (choicesOf(r.code).length === 1 ? choicesOf(r.code)[0].number : "");
  const rowProblem = (r: Row) => !r.code ? "" : r.code.length < 4 ? "" : TOTALS.has(r.code) ? "This is a total: it calculates by itself." : !info.has(r.code) ? "Not a GIFI code Closebook can use."
    : blockOf(r.code, typeOf(r.code)) !== r.block ? `This is a ${BLOCK_TITLE[blockOf(r.code, typeOf(r.code))!].toLowerCase()} code: it counts there.` : r.amount.trim() && cents(r.amount) === null ? "Type an amount, for example 1,250.00 or (1,250.00)." : "";
  const noAccount = (r: Row) => usable(r) && needsAccount(r.block, cents(r.amount)) && !accountOf(r);
  const badRows = rows.filter((r) => rowProblem(r));
  const pick = rows.filter(noAccount);
  const needs = { source: !src.trim(), pdf: !pdf };
  const issues = flags.length + badRows.length + pick.length + (needs.source ? 1 : 0) + (needs.pdf ? 1 : 0);

  const save = async () => {
    const accounts = Object.fromEntries(valid.filter((r) => accountOf(r)).map((r) => [r.code, accountOf(r)]));
    const e = await saveOpeningInline(fileId, lines, reC, t.ni9999From125 ? null : niC, src, accounts);
    if (e) { setErr(e); notify(e, "error"); return false; }
    st.markSaved(new Date()); asked.current = false;
    notify(signed ? "Opening balances saved. The step's sign-off was removed." : "Opening balances saved.");
    return true;
  };
  const onSave = () => run(async () => { setErr(null); if (await save()) router.refresh(); });
  const onSign = () => run(async () => {
    setErr(null);
    if (st.dirty && !(await save())) return;
    const r = await signOpeningInline(fileId);
    // As every step's "Sign as preparer" (round 21): a note naming the next step, which opens by itself.
    if ("error" in r) { setErr(r.error); notify(r.error, "error"); } else { notify(r.note); router.push(r.next); }
  });
  function discard() {
    const s = fromSaved();
    setRows(s.rows); setRe(s.re); setNi(s.ni); setSrc(s.src); setErr(null);
    st.markClean(); asked.current = false;
  }
  useUnsavedGuard(st.dirty, { save: async () => { setErr(null); const ok = await save(); if (ok) router.refresh(); return ok; }, discard });

  const attach = async (file: File | undefined) => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file_id", fileId); fd.set("pdf", file);
    setUploading(true);
    const e = await uploadOpeningPdfInline(fd);
    setUploading(false);
    if (pdfInput.current) pdfInput.current.value = "";
    if (e) { setErr(e); notify(e, "error"); } else { notify("PDF attached."); router.refresh(); }
  };

  const setRow = (id: number, k: "code" | "amount" | "account", v: string) => { setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [k]: k === "code" ? v.replace(/\D/g, "").slice(0, 4) : v } : r))); touch(); };
  const add = (b: Block) => { setRows((rs) => [...rs, { id: Math.max(0, ...rs.map((r) => r.id)) + 1, block: b, code: "", amount: "", account: "" }]); touch(); };
  const remove = (id: number) => { setRows((rs) => rs.filter((r) => r.id !== id)); touch(); };
  const goTo = (code: string) => { const el = document.getElementById(`amount-${code}`) as HTMLInputElement | null; el?.scrollIntoView({ block: "center" }); el?.focus(); el?.select(); };

  const head = (b: Block) => <tr><td colSpan={5} className="bg-sand-100 px-4 py-1.5 text-xs font-bold tracking-wide text-navy-700 uppercase">{BLOCK_TITLE[b]}</td></tr>;
  // The account choice, the same on every Schedule 100 line (item 13): a list of the standard chart
  // accounts on the GIFI line (or the file's bank accounts on it); "Pick an account" until there is one.
  const accountCell = (r: Row) => {
    if (r.block === "revenue" || r.block === "expenses" || rowProblem(r) || !r.code) return null;
    const list = choicesOf(r.code), value = accountOf(r), missing = noAccount(r);
    return (
      <>
        <select aria-label={`Account for GIFI ${r.code}`} value={value} disabled={!editable || list.length === 0} onChange={(e) => setRow(r.id, "account", e.target.value)}
          className={`input input-compact w-full ${missing ? "border-warning text-warning" : ""}`}>
          {(!value || list.length === 0) && <option value="">Pick an account</option>}
          {list.map((c) => <option key={c.number} value={c.number}>{c.label ?? `${c.number} ${c.name}`}</option>)}
        </select>
        {missing && list.length === 0 && <span className="block text-xs text-warning">No standard chart account on GIFI {r.code} yet. Ask Hashim to add one.</span>}
      </>
    );
  };
  const amountBox = (r: Row, bold = false) => (
    <AmountInput id={`amount-${r.code || r.id}`} aria-label={`Amount ${r.code}`} value={r.amount} disabled={!editable} onValue={(v) => { if (v !== r.amount) setRow(r.id, "amount", v); }}
      className={`input input-compact w-full ${bold ? "font-bold" : ""} ${flag(r.code) ? "bg-[#FFF35C]" : ""}`} />
  );
  const lineRow = (r: Row, fixed = false) => (
    <tr key={r.id} id={r.code ? `gifi-${r.code}` : undefined} className="border-b border-sand-100 align-top target:bg-navy-50">
      <td className="px-4 py-1">{fixed || r.block === "re"
        ? <span className="inline-block py-1 text-sm text-ink-3 tabular-nums">{r.code}</span>
        : <input aria-label="GIFI code" inputMode="numeric" value={r.code} disabled={!editable} onChange={(e) => setRow(r.id, "code", e.target.value)} className="input input-compact w-[4.5rem] text-center tabular-nums" />}</td>
      <td className="px-2 py-1.5 text-sm">{nameOf(r.code)}{rowProblem(r) ? <span className="block text-xs text-warning">{rowProblem(r)}</span>
        : isDividend(r.code) && <span className="block text-xs text-ink-3">As printed on the T2. It is subtracted.</span>}</td>
      <td className="px-2 py-1">{accountCell(r)}</td>
      <td className="px-2 py-1 text-right">{amountBox(r)}</td>
      <td className="py-1 text-right">{editable && !fixed && <button type="button" aria-label="Remove the line" onClick={() => remove(r.id)} className="px-2 text-ink-3 hover:text-danger">×</button>}</td>
    </tr>
  );
  const lineRows = (b: Block) => (
    <>
      {rows.filter((r) => r.block === b).map((r) => lineRow(r))}
      {editable && <tr><td colSpan={5} className="px-4 py-1"><button type="button" onClick={() => add(b)} className="text-sm text-navy-700 underline">+ Add a line</button></td></tr>}
    </>
  );
  const flagLine = (code: string) => {
    const f = flag(code);
    if (!f) return null;
    // Item 10: the retained earnings message, with the difference shown as every negative is (red brackets).
    const body = code === "3849" && t.reDifference
      ? <>{RE_TIE_BEFORE}<Amount cents={t.reDifference} />{RE_TIE_AFTER}{" "}
          <button type="button" onClick={() => goTo("3660")} className="font-semibold text-navy-700 underline">Go to line 3660</button></>
      : code === "3660" ? <>{f.text} <button type="button" onClick={() => goTo("3660")} className="font-semibold text-navy-700 underline">Go to line 3660</button></> : f.text;
    return <tr><td /><td colSpan={3} role="alert" className="px-2 pb-1.5 text-right text-sm font-normal text-warning">{body}</td><td /></tr>;
  };
  const total = (code: string, label: string, value: number, input?: { v: string; set: (v: string) => void }) => (
    <>
      <tr id={`gifi-${code}`} className="font-bold target:bg-navy-50">
        <td className="px-4 py-1.5 text-ink-3">{code}</td><td colSpan={2} className="px-2 py-1.5">{label}</td>
        <td className="px-2 py-1.5 text-right">
          {input ? <AmountInput id={`amount-${code}`} aria-label={`${code} ${label}`} value={input.v} disabled={!editable} onValue={(v) => { if (v !== input.v) { input.set(v); touch(); } }}
              className={`input input-compact w-full font-bold ${flag(code) ? "bg-[#FFF35C]" : ""}`} />
            : <span className={`inline-block rounded px-2 py-0.5 ${flag(code) ? "bg-[#FFF35C]" : ""}`}><Amount cents={value} /></span>}
        </td><td />
      </tr>
      {flagLine(code)}
    </>
  );
  // The retained earnings block (item 9): always shown, labelled, in the T2's order; other retained
  // earnings lines saved on the file (3701, 3741 and so on) show in their place by code.
  const reRows = rows.filter((r) => r.block === "re").sort((a, b) => Number(a.code) - Number(b.code));
  const reBlock = (
    <>
      {head("re")}
      {reRows.map((r) => (
        <Fragment key={r.id}>
          {lineRow(r, FIXED_RE.includes(r.code))}
          {r.code === "3660" && flagLine("3660")}
          {r.code === "3660" && (t.ni9999From125
            ? total("3680", `${nameOf("3680")} (from 9999 on the Schedule 125 tab)`, t.t9999)
            : total("3680", nameOf("3680"), t.t9999, { v: ni, set: setNi }))}
        </Fragment>
      ))}
      {total("3849", nameOf("3849"), t.t3849calc, { v: re, set: setRe })}
    </>
  );

  return (
    <div className="form-col grid gap-4">
      <section className="card grid gap-3">
        <h2 className="font-semibold">Last year&rsquo;s T2{source === "closebook" && <InfoTip label="Where these come from">From last year&rsquo;s file.</InfoTip>}</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid flex-1 gap-1 text-sm">Source
            <input value={src} disabled={!editable} onChange={(e) => { setSrc(e.target.value); touch(); }} placeholder="For example: Prior T2, year ended Oct 31, 2025"
              className={`input ${needs.source ? "border-warning" : ""}`} /></label>
          <span className="flex items-end gap-2 pb-0.5">
            {pdf && <a href={pdf.href} data-no-guard className="pb-1.5 text-sm text-navy-700 underline">{pdf.name}</a>}
            {editable && (
              <label className={`btn-secondary cursor-pointer ${uploading ? "pointer-events-none opacity-60" : ""}`}>{uploading ? "Attaching…" : pdf ? "Replace PDF" : "Attach PDF"}
                <input ref={pdfInput} type="file" accept=".pdf,application/pdf" aria-label="Attach the T2 or assessment PDF" className="sr-only" onChange={(e) => void attach(e.target.files?.[0])} /></label>
            )}
          </span>
        </div>
        {(needs.source || needs.pdf) && <p className="text-xs text-warning">{needs.source && needs.pdf ? "The source and the PDF are" : needs.source ? "The source is" : "The PDF is"} needed before &ldquo;Sign as preparer&rdquo;.</p>}
        <div className="flex flex-wrap items-center gap-2" role="tablist">
          {([["s100", "Schedule 100 (balance sheet) · required"], ["s125", "Schedule 125 (income statement)"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-full px-4 py-2 text-sm ${tab === k ? "bg-navy-700 font-semibold text-white" : "border border-sand-200 text-ink-2"}`}>{l}</button>
          ))}
          <InfoTip label="About Schedule 125">Enter it when the prior T2 has one. It gives last year&rsquo;s column on the statement of earnings and the year-over-year review, and line 3680 fills from its 9999.</InfoTip>
        </div>
        <p className="text-sm text-ink-2">Type amounts as printed on the T2.
          <InfoTip label="The sign rule">Schedule 125 revenue and expenses are positive. A deficit, a loss or a contra account (accumulated amortization, an allowance) is negative: type a minus or brackets, for example (2,000.00). Dividends declared (3700) are typed as printed and subtracted.</InfoTip></p>
      </section>

      {signed && bankIssue && <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">{/\.\s*$/.test(bankIssue) ? bankIssue : `${bankIssue}.`} The difference sits in &ldquo;Opening balances to enter&rdquo; for the reviewer.</p>}
      {start.moved && st.dirty && <p className="rounded-lg border border-sand-200 bg-sand-50 px-4 py-3 text-sm">Last year&rsquo;s Schedule 125 was saved in a separate box before. It now sits in the Schedule 125 tab: save to keep it with the balance sheet.</p>}
      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{err}</p>}

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] table-fixed border-collapse text-sm">
          <colgroup><col className="w-24" /><col /><col className="w-[17rem]" /><col className="w-40" /><col className="w-8" /></colgroup>
          <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-2 font-semibold">GIFI</th><th className="px-2 py-2 font-semibold">Name</th><th className="px-2 py-2 font-semibold">{tab === "s100" ? "Account" : ""}</th><th className="px-2 py-2 text-right font-semibold">Amount</th><th /></tr></thead>
          {tab === "s100" ? (
            <tbody>
              {head("assets")}{lineRows("assets")}{total("2599", "Total assets", t.t2599)}
              {head("liabilities")}{lineRows("liabilities")}{total("3499", "Total liabilities", t.t3499)}
              {head("equity")}{lineRows("equity")}
              {total("3600", "Retained earnings (3849, below)", t.t3600)}{total("3620", "Total equity", t.t3620)}{total("3640", "Total liabilities and equity", t.t3640)}
              {reBlock}
            </tbody>
          ) : (
            <tbody>
              {head("revenue")}{lineRows("revenue")}{total("8299", "Total revenue", t.t8299)}
              {head("expenses")}{lineRows("expenses")}{total("9368", "Total expenses", t.tExpenses)}
              {total("9999", "Net income/loss (goes to 3680 on Schedule 100)", t.t8299 - t.tExpenses)}
            </tbody>
          )}
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 bg-sand-50 px-4 py-3">
          <span className="text-sm text-ink-2">{signed && `Prepared by ${signed.by}, ${signed.at}.${st.dirty ? " Saving a change removes the sign-off." : ""} `}
            {issues > 0 ? <>{/* One problem, one issue (item 11): each counted once, each shown once on its own row. */}
              <span className="font-semibold text-warning">{issues} {issues === 1 ? "issue" : "issues"}:</span>{" "}
              {[flags.length > 0 && <a key="f" href={`#gifi-${flags[0].code}`} onClick={() => setTab("s100")} className="font-semibold text-navy-700 underline">{flags.length} {flags.length === 1 ? "total does" : "totals do"} not tie</a>,
                badRows.length > 0 && <a key="b" href={`#gifi-${badRows[0].code}`} className="font-semibold text-navy-700 underline">{badRows.length} {badRows.length === 1 ? "line needs" : "lines need"} you</a>,
                pick.length > 0 && <a key="p" href={`#gifi-${pick[0].code}`} onClick={() => setTab("s100")} className="font-semibold text-navy-700 underline">{pick.length} {pick.length === 1 ? "account" : "accounts"} to pick</a>,
                needs.source && <span key="s">source to type</span>, needs.pdf && <span key="d">PDF to attach</span>]
                .filter(Boolean).flatMap((x, i) => (i ? [" · ", x] : [x]))}
              <span className="text-ink-3"> · sign-off opens when none is left</span></> : !signed && "Everything ties."}</span>
          {editable && (
            <span className="flex gap-2">
              <DiscardButton dirty={st.dirty} onDiscard={discard} />
              <SaveButton type="button" dirty={st.dirty} savedAt={st.savedAt} saving={pending} onClick={onSave} className="btn-secondary btn-compact" />
              <button type="button" className="btn btn-compact" disabled={pending || issues > 0 || (!!signed && !st.dirty)} onClick={onSign}>Sign as preparer</button>
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
