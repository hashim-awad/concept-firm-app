"use client";
// Step 2, Opening balances (Hashim, Nov 14, 2026; board "Step 2, Opening balances"): last year's closing
// balance sheet laid out like ProFile's Schedule 101 (Assets, Liabilities, Equity, Retained earnings), and
// last year's income statement (Schedule 125) when available. Each row: GIFI code, name (from the code),
// amount as it shows on the T2. Totals calculate live with their codes; a total that does not tie is
// highlighted yellow with one line under it. "Sign as preparer" stays off while any total is highlighted.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { blockOf, BLOCK_TITLE, fromGifi, isDividend, scheduleTotals, toGifi, type Block } from "@/lib/closebook/schedule";
import { typedCents } from "@/lib/closebook/bank-upload";
import { fileInputClass } from "@/components/ds/primitives";
import { saveOpeningInline, signOpeningInline, uploadOpeningPdf } from "../actions";

type Row = { id: number; block: Block; code: string; amount: string };
type Code = { name: string; type: string };
const TOTALS = new Set(["2599", "3499", "3600", "3620", "3640", "3849", "8299", "9368", "9999"]);
const fmt = (c: number) => (c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 }));
const typedText = (c: number) => (c / 100).toFixed(2);

export function OpeningSchedule({ fileId, codes, initial, reStated, niTyped, note, pdf, signed, source, bankIssue, editable }: {
  fileId: string; codes: [string, Code][]; initial: [string, number][]; reStated: number | null; niTyped: number | null; note: string;
  pdf: { href: string; name: string } | null; signed: { by: string; at: string } | null; source: string | null; bankIssue: string; editable: boolean;
}) {
  const router = useRouter();
  const info = useMemo(() => new Map(codes), [codes]);
  const typeOf = (c: string) => info.get(c)?.type;
  let next = 1;
  const start: Row[] = initial.map(([code, gifi]) => ({ id: next++, block: blockOf(code, typeOf(code)) ?? "assets", code, amount: typedText(fromGifi(code, gifi)) }));
  for (const b of ["assets", "liabilities", "equity", "re", "revenue", "expenses"] as Block[]) if (!start.some((r) => r.block === b)) start.push({ id: next++, block: b, code: "", amount: "" });
  const [rows, setRows] = useState<Row[]>(start);
  const [tab, setTab] = useState<"bs" | "is">("bs");
  const [re, setRe] = useState(reStated === null ? "" : typedText(reStated));
  const [ni, setNi] = useState(niTyped === null ? "" : typedText(niTyped));
  const [src, setSrc] = useState(note);
  const [dirty, setDirty] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, run] = useTransition();
  const touch = () => setDirty(true);

  const valid = rows.filter((r) => /^\d{4}$/.test(r.code) && info.has(r.code) && !TOTALS.has(r.code) && typedCents(r.amount) !== null);
  const lines: [string, number][] = valid.map((r) => [r.code, toGifi(r.code, typedCents(r.amount)!)]);
  const reC = typedCents(re), niC = typedCents(ni);
  const { totals: t, flags } = scheduleTotals(lines, typeOf, reC, niC);
  const flag = (code: string) => flags.find((f) => f.code === code);
  const rowProblem = (r: Row) => !r.code ? "" : r.code.length < 4 ? "" : TOTALS.has(r.code) ? "This is a total: it calculates by itself." : !info.has(r.code) ? "Not a GIFI code Closebook can use."
    : blockOf(r.code, typeOf(r.code)) !== r.block ? `This is a ${BLOCK_TITLE[blockOf(r.code, typeOf(r.code))!].toLowerCase()} code: it counts there.` : r.amount && typedCents(r.amount) === null ? "Type an amount, for example 1250.00." : "";
  const badRows = rows.filter((r) => rowProblem(r)).length;

  const save = async () => {
    const e = await saveOpeningInline(fileId, lines, reC, t.ni9999From125 ? null : niC, src);
    if (e) { setErr(e); return false; }
    setDirty(false); return true;
  };
  const onSave = () => run(async () => { setErr(null); if (await save()) router.refresh(); });
  const onSign = () => run(async () => {
    setErr(null);
    if (dirty && !(await save())) return;
    const e = await signOpeningInline(fileId);
    if (e) setErr(e); else router.refresh();
  });

  const setRow = (id: number, k: "code" | "amount", v: string) => { setRows(rows.map((r) => (r.id === id ? { ...r, [k]: k === "code" ? v.replace(/\D/g, "").slice(0, 4) : v } : r))); touch(); };
  const add = (b: Block) => { setRows([...rows, { id: Math.max(0, ...rows.map((r) => r.id)) + 1, block: b, code: "", amount: "" }]); touch(); };
  const remove = (id: number) => { setRows(rows.filter((r) => r.id !== id)); touch(); };

  const head = (b: Block) => <tr><td colSpan={4} className="bg-sand-100 px-4 py-2 text-xs font-bold tracking-wide text-navy-700 uppercase">{BLOCK_TITLE[b]}</td></tr>;
  const lineRows = (b: Block) => (
    <>
      {rows.filter((r) => r.block === b).map((r) => (
        <tr key={r.id} className="border-b border-sand-100 align-top">
          <td className="w-28 px-4 py-1.5"><input aria-label="GIFI code" inputMode="numeric" value={r.code} disabled={!editable} onChange={(e) => setRow(r.id, "code", e.target.value)} className="input w-[5.5rem] px-2 text-center tabular-nums" /></td>
          <td className="px-2 py-1.5 text-sm">{info.get(r.code)?.name ?? ""}{rowProblem(r) ? <span className="block text-xs text-warning">{rowProblem(r)}</span>
            : isDividend(r.code) && <span className="block text-xs text-ink-3">A deduction: kept negative, whatever sign is typed.</span>}</td>
          <td className="w-44 px-2 py-1.5 text-right"><input aria-label={`Amount ${r.code}`} inputMode="decimal" value={r.amount} disabled={!editable} onChange={(e) => setRow(r.id, "amount", e.target.value)} className="input w-40 text-right tabular-nums" /></td>
          <td className="w-8 py-1.5 text-right">{editable && <button type="button" aria-label="Remove the line" onClick={() => remove(r.id)} className="px-2 text-ink-3 hover:text-danger">×</button>}</td>
        </tr>
      ))}
      {editable && <tr><td colSpan={4} className="px-4 py-1.5"><button type="button" onClick={() => add(b)} className="text-sm text-navy-700 underline">+ Add a line</button></td></tr>}
    </>
  );
  const total = (code: string, label: string, value: number, input?: { v: string; set: (v: string) => void }) => {
    const f = flag(code);
    return (
      <>
        <tr className="font-bold">
          <td className="px-4 py-2 text-ink-3">{code}</td><td className="px-2 py-2">{label}</td>
          <td className="px-2 py-2 text-right tabular-nums">
            {input ? <input aria-label={`${code} ${label}`} inputMode="decimal" value={input.v} disabled={!editable} onChange={(e) => { input.set(e.target.value); touch(); }}
              className={`input w-40 text-right font-bold tabular-nums ${f ? "bg-[#FFF35C]" : ""}`} />
              : <span className={`inline-block rounded px-3 py-1 ${f ? "bg-[#FFF35C]" : ""}`}>{fmt(value)}</span>}
          </td><td />
        </tr>
        {f && <tr><td /><td colSpan={2} className="px-2 pb-2 text-right text-sm font-normal text-warning">{f.text}</td><td /></tr>}
      </>
    );
  };
  const blocking = flags.length > 0 || badRows > 0;

  return (
    <div className="grid gap-4">
      <section className="card grid gap-3">
        <div>
          <h2 className="font-semibold">Last year&rsquo;s closing balances</h2>
          {source === "closebook" && <p className="text-sm text-ink-2">Filled from last year&rsquo;s Closebook file, for checking and sign-off.</p>}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid flex-1 gap-1 text-sm">Source
            <input value={src} disabled={!editable} onChange={(e) => { setSrc(e.target.value); touch(); }} placeholder="For example: Prior T2, year ended Oct 31, 2025" className="input" /></label>
          {pdf ? <a href={pdf.href} className="pb-2 text-sm text-navy-700 underline">{pdf.name}</a>
            : editable && (
              <form action={uploadOpeningPdf} className="flex items-end gap-2">
                <input type="hidden" name="file_id" value={fileId} />
                <input name="pdf" type="file" accept=".pdf,application/pdf" required aria-label="The T2 or assessment PDF" className={fileInputClass} />
                <button type="submit" className="btn-secondary">Attach PDF</button>
              </form>
            )}
        </div>
        <div className="flex flex-wrap gap-2" role="tablist">
          {([["bs", "Balance sheet (Schedule 100) · required"], ["is", "Income statement (Schedule 125) · when available"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`rounded-full px-4 py-2 text-sm ${tab === k ? "bg-navy-700 font-semibold text-white" : "border border-sand-200 text-ink-2"}`}>{l}</button>
          ))}
        </div>
      </section>

      {signed && bankIssue && <p className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-sm">{bankIssue} The difference sits in &ldquo;Opening balances to enter&rdquo; for the reviewer.</p>}
      {err && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">{err}</p>}

      <section className="card overflow-x-auto p-0">
        <table className="w-full min-w-[620px] border-collapse text-sm">
          <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-2 font-semibold">GIFI</th><th className="px-2 py-2 font-semibold">Name (fills in from the code)</th><th className="px-2 py-2 text-right font-semibold">Amount</th><th /></tr></thead>
          {tab === "bs" ? (
            <tbody>
              {head("assets")}{lineRows("assets")}{total("2599", "Total assets", t.t2599)}
              {head("liabilities")}{lineRows("liabilities")}{total("3499", "Total liabilities", t.t3499)}
              {head("equity")}{lineRows("equity")}
              {total("3600", "Retained earnings (from below)", t.t3600)}{total("3620", "Total equity", t.t3620)}{total("3640", "Total liabilities and equity", t.t3640)}
              {head("re")}{lineRows("re")}
              {t.ni9999From125 ? total("9999", "Net income last year (Schedule 125 tab)", t.t9999) : total("9999", "Net income last year (or enter the Schedule 125 tab)", t.t9999, { v: ni, set: setNi })}
              {total("3849", "Retained earnings, end of last year (from the T2)", t.t3849calc, { v: re, set: setRe })}
            </tbody>
          ) : (
            <tbody>
              {head("revenue")}{lineRows("revenue")}{total("8299", "Total revenue", t.t8299)}
              {head("expenses")}{lineRows("expenses")}{total("9368", "Total expenses", t.tExpenses)}
              {total("9999", "Net income", t.t8299 - t.tExpenses)}
            </tbody>
          )}
        </table>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-sand-200 bg-sand-50 px-4 py-3">
          <span className="text-sm text-ink-2">{signed ? `Signed by ${signed.by}, ${signed.at}.${dirty ? " Saving a change clears the sign-off." : ""}`
            : blocking ? "A highlighted total does not tie. Sign-off opens when no total is highlighted." : "Everything ties."}</span>
          {editable && (
            <span className="flex gap-2">
              <button type="button" className="btn-secondary" disabled={pending || !dirty} onClick={onSave}>Save</button>
              <button type="button" className="btn" disabled={pending || blocking || (!!signed && !dirty)} onClick={onSign}>Sign as preparer</button>
            </span>
          )}
        </div>
      </section>
    </div>
  );
}
