"use client";
// CB2-1 PR B part h: Upload from file (QBO). Choose the account and the CSV; map the columns once (the mapping is kept for
// the account, so the next upload is: account, file, Upload); preview; Upload. Opening and closing balances are optional;
// a difference is a warning. A line already uploaded (same date, amount and description) is flagged and left out unless ticked.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { bracketAmount, parseAmount, tidyAmount } from "@/lib/closebook/amount";
import { formatDate } from "@/lib/dates";
import { DATE_FORMATS, dupKey, guessMapping, headersOf, parseCsv, rowsOf, type CsvMapping, type DateFormat } from "@/lib/books/csv";
import { isOut } from "@/lib/books/bank";
import { Picker } from "../../../picker";
import { existingKeys, uploadBankFile } from "../../../bank-actions";

type Acct = { value: string; label: string; kind: "bank" | "card" };
const money = (c: number) => `$${bracketAmount(c)}`;
const fits = (m: CsvMapping, cols: number) => [m.date, m.description, m.amount, m.moneyIn, m.moneyOut].every((i) => i === null || i < cols);

export function UploadView({ clientId, accounts, initial, saved, years }: { clientId: string; accounts: Acct[]; initial: string; saved: Record<string, CsvMapping>;
  years: { from: string; to: string }[] }) {
  const router = useRouter();
  const [ident, setIdent] = useState(initial);
  const [fileName, setFileName] = useState("");
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [map, setMap] = useState<CsvMapping | null>(null);
  const [mapping, setMapping] = useState(false);   // the column mapping is open
  const [dups, setDups] = useState<Set<string>>(new Set());
  const [take, setTake] = useState<Set<number>>(new Set());   // duplicates ticked to upload anyway (by CSV line)
  const [opening, setOpening] = useState("");
  const [closing, setClosing] = useState("");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<{ lines: number; auto: number } | null>(null);
  const [busy, start] = useTransition();
  const acct = accounts.find((a) => a.value === ident);

  const choose = async (f: File | undefined, id = ident) => {
    setErr(""); setResult(null); setTake(new Set());
    if (!f) return;
    const g = parseCsv(await f.text());
    if (!g.length) { setErr("The file has no rows."); return; }
    // The lines already uploaded first, so the preview never shows a duplicate as new.
    const keys = await existingKeys(clientId, id);
    const keep = saved[id] && fits(saved[id], g[0].length) ? saved[id] : null;
    setDups(new Set(keys)); setFileName(f.name); setGrid(g);
    setMap(keep ?? guessMapping(g)); setMapping(!keep);
  };
  const parsed = useMemo(() => (grid && map ? rowsOf(grid, map) : null), [grid, map]);
  // The account's own signs: money in positive on a bank account; a charge positive on a card.
  const rows = useMemo(() => (parsed?.rows ?? []).map((r) => {
    const cents = acct?.kind === "card" ? -r.cents : r.cents;
    const outside = !years.some((y) => r.date >= y.from && r.date <= y.to);
    return { ...r, cents, dup: dups.has(dupKey({ date: r.date, cents, description: r.description })), outside };
  }), [parsed, acct, dups, years]);
  const included = rows.filter((r) => !r.dup || take.has(r.line));
  const outside = included.filter((r) => r.outside);
  const sum = included.reduce((n, r) => n + r.cents, 0);
  const op = opening.trim() ? parseAmount(opening) : null, cl = closing.trim() ? parseAmount(closing) : null;
  const diff = op !== null && cl !== null ? cl - (op + sum) : null;
  const headers = grid && map ? headersOf(grid, map.header) : [];
  const colOpts = headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }));
  const set = (p: Partial<CsvMapping>) => map && setMap({ ...map, ...p });

  const upload = () => start(async () => {
    setErr("");
    if (!included.length) { setErr("Nothing to upload."); return; }
    if (outside.length) { setErr(`No year in Closebook covers ${[...new Set(outside.map((r) => formatDate(r.date)))].slice(0, 3).join(", ")}. Add the year first, or leave those lines out.`); return; }
    const r = await uploadBankFile(clientId, ident, fileName, included.map((x) => ({ date: x.date, description: x.description, amount: x.cents / 100 })),
      op === null ? null : op / 100, cl === null ? null : cl / 100, map);
    if (!r.ok) { setErr(r.error); return; }
    setResult({ lines: r.lines, auto: r.auto }); setGrid(null); setMap(null);
    router.refresh();
  });

  if (!accounts.length) return (
    <div className="mx-auto grid max-w-4xl gap-4"><h1 className="text-[22px] font-bold">Upload bank file</h1>
      <div className="card p-5 text-[14px]">This client has no bank or card account in Closebook yet. Add one in the year file first.</div></div>
  );
  return (
    <div className="mx-auto grid max-w-5xl gap-4">
      <div className="flex items-center gap-2"><h1 className="text-[22px] font-bold">Upload bank file</h1><span className="flex-1" />
        <Link href={`/cb/${clientId}/bank?account=${encodeURIComponent(ident)}`} className="btn btn-secondary btn-compact">Back to Bank transactions</Link></div>

      {result && (
        <div role="status" className="card border-success p-4 text-[14px]" data-upload-done>
          <b>{result.lines} line{result.lines === 1 ? "" : "s"} uploaded.</b>{result.auto ? ` ${result.auto} confirmed by rules set to Automatically confirm.` : ""}{" "}
          <Link href={`/cb/${clientId}/bank?account=${encodeURIComponent(ident)}`} className="font-semibold text-navy-700 underline" data-upload-review>Review them</Link>
        </div>
      )}

      <div className="card grid gap-3 p-4 sm:grid-cols-2">
        <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Account
          <Picker value={ident} options={accounts} onChange={(v) => { setIdent(v); setGrid(null); setMap(null); }} ariaLabel="Account" /></label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-3">CSV file
          <input type="file" accept=".csv,text/csv" onChange={(e) => choose(e.target.files?.[0])} className="input input-compact" data-upload-file /></label>
        {saved[ident] && <p className="text-[12px] text-ink-3 sm:col-span-2">The column mapping from the last upload to this account is used. <button type="button" className="font-semibold text-navy-700 underline" onClick={() => setMapping(true)} disabled={!grid}>Change it</button></p>}
      </div>

      {grid && map && mapping && (
        <div className="card grid gap-3 p-4" data-upload-map>
          <h2 className="text-[15px] font-bold">Map the columns</h2>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={map.header} onChange={(e) => set({ header: e.target.checked })} />The first row is column names</label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Date<Picker value={String(map.date)} options={colOpts} onChange={(v) => set({ date: +v })} ariaLabel="Date column" compact /></label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Date format
              <select value={map.dateFormat} onChange={(e) => set({ dateFormat: e.target.value as DateFormat })} className="input input-compact">{DATE_FORMATS.map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Description<Picker value={String(map.description)} options={colOpts} onChange={(v) => set({ description: +v })} ariaLabel="Description column" compact /></label>
          </div>
          <div className="flex flex-wrap gap-4 text-[13px]" role="radiogroup" aria-label="Amounts">
            <label className="flex items-center gap-1.5"><input type="radio" checked={map.amount !== null} onChange={() => set({ amount: map.moneyOut ?? 2, moneyIn: null, moneyOut: null })} />One amount column</label>
            <label className="flex items-center gap-1.5"><input type="radio" checked={map.amount === null} onChange={() => set({ amount: null, moneyOut: map.amount ?? 2, moneyIn: Math.min((map.amount ?? 2) + 1, headers.length - 1) })} />Two columns: money out and money in</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {map.amount !== null
              ? <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Amount<Picker value={String(map.amount)} options={colOpts} onChange={(v) => set({ amount: +v })} ariaLabel="Amount column" compact /></label>
              : <>
                <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Money out<Picker value={String(map.moneyOut ?? "")} options={colOpts} onChange={(v) => set({ moneyOut: +v })} ariaLabel="Money out column" compact /></label>
                <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Money in<Picker value={String(map.moneyIn ?? "")} options={colOpts} onChange={(v) => set({ moneyIn: +v })} ariaLabel="Money in column" compact /></label>
              </>}
            <label className="flex items-center gap-2 self-end text-[13px]"><input type="checkbox" checked={!!map.flip} onChange={(e) => set({ flip: e.target.checked })} data-upload-flip />The signs are the other way round</label>
          </div>
        </div>
      )}

      {grid && map && parsed && (
        <div className="card grid gap-3 p-4" data-upload-preview>
          <div className="flex flex-wrap items-center gap-3"><h2 className="text-[15px] font-bold">Preview</h2>
            <span className="text-[13px] text-ink-3">{included.length} to upload{rows.length > included.length ? `, ${rows.length - included.length} duplicate${rows.length - included.length === 1 ? "" : "s"} left out` : ""}</span>
            <span className="flex-1" />{!mapping && <button type="button" className="text-[13px] font-semibold text-navy-700 underline" onClick={() => setMapping(true)}>Change the mapping</button>}</div>
          {parsed.problems.length > 0 && <ul className="grid gap-1 text-[13px] text-danger" data-upload-problems>{parsed.problems.slice(0, 10).map((p) => <li key={p}>{p}</li>)}
            {parsed.problems.length > 10 && <li>and {parsed.problems.length - 10} more.</li>}</ul>}
          <div className="max-h-[26rem] overflow-auto rounded border border-sand-200">
            <table className="w-full text-[13px]">
              <thead className="sticky top-0 bg-sand-50 text-left text-[12px] text-ink-3"><tr><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5 text-right">Spent</th><th className="px-2 py-1.5 text-right">Received</th><th className="px-2 py-1.5">Duplicate</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.line} className={`border-t border-sand-100 ${r.dup && !take.has(r.line) ? "text-ink-3 line-through" : ""}`} data-preview-line={r.line}>
                  <td className="whitespace-nowrap px-2 py-1.5">{formatDate(r.date)}{r.outside && <span className="ml-1 text-danger" title="No year in Closebook covers this date">!</span>}</td>
                  <td className="px-2 py-1.5">{r.description}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{acct && isOut(acct.kind, r.cents) ? money(Math.abs(r.cents)) : ""}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums">{acct && !isOut(acct.kind, r.cents) ? money(Math.abs(r.cents)) : ""}</td>
                  <td className="px-2 py-1.5">{r.dup && <label className="flex items-center gap-1.5 no-underline"><input type="checkbox" checked={take.has(r.line)} data-dup-take
                    onChange={(e) => { const n = new Set(take); if (e.target.checked) n.add(r.line); else n.delete(r.line); setTake(n); }} />Already uploaded: upload anyway</label>}</td>
                </tr>))}</tbody>
            </table>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Opening balance (optional)<input value={opening} onChange={(e) => setOpening(e.target.value)} onBlur={(e) => setOpening(tidyAmount(e.target.value))} inputMode="decimal" className="input input-compact text-right" data-upload-opening /></label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-3">Closing balance (optional)<input value={closing} onChange={(e) => setClosing(e.target.value)} onBlur={(e) => setClosing(tidyAmount(e.target.value))} inputMode="decimal" className="input input-compact text-right" data-upload-closing /></label>
            <div className="self-end text-[13px]">Lines to upload, net: <b className="tabular-nums">{money(sum)}</b></div>
          </div>
          {diff !== null && diff !== 0 && <p className="flex items-center gap-2 text-[13px] font-semibold text-warning" data-upload-diff><AlertTriangle className="h-4 w-4" />Opening plus the lines is {money((op ?? 0) + sum)}, not the closing balance {money(cl ?? 0)}. Difference: {money(diff)}. You can still upload.</p>}
          {diff === 0 && <p className="text-[13px] text-success">Opening plus the lines equals the closing balance.</p>}
          {err && <p role="alert" className="text-[13px] font-semibold text-danger" data-upload-err>{err}</p>}
          <div><button type="button" className="btn" disabled={busy || !included.length} onClick={upload} data-upload-go>Upload {included.length} line{included.length === 1 ? "" : "s"}</button></div>
        </div>
      )}
      {!grid && err && <p role="alert" className="text-[13px] font-semibold text-danger">{err}</p>}
    </div>
  );
}
