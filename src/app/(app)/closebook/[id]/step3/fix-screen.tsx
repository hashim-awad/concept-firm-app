"use client";
// Step 3 "Fix it" (round 23, Hashim, Nov 16, 2026; image 5). Round 26 (Hashim, Nov 17, 2026): before import the
// person can add a missing line, remove a line read wrongly (with a reason), take in another cardholder's section
// the reader put apart, and have the file read again. Each change is saved and logged at once; the checks run
// again. The message says what is wrong and never guesses: a line is highlighted only when a running balance
// points to it; a card with a summary box is checked kind by kind ("Purchases and debits: statement 250.00, lines
// read 0.00, 250.00 missing"). Import turns on when the difference is 0.00.
// Benchmark: QuickBooks Online "Verify details"; Dext's line editing before publishing.
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";
import { confirmAction, notify } from "@/components/save-state";
import { AmountInput } from "@/components/amount";
import { tidyAmount } from "@/lib/closebook/amount";
import { checkAccount } from "@/lib/statements/checks";
import { typeLabel, type ReadResult, type StatementAccount } from "@/lib/statements/types";
import { amt, misread } from "@/lib/closebook/banking";
import { StatementViewer } from "../../../statements/[id]/statement-viewer";
import { parseMoney } from "../../../statements/format";
import { saveStatementEdits } from "../../../statements/actions";
import { importChecked, skipStatement } from "../../step3-actions";
import { addMissingLine, readStatementsAgain, removeReadLine, takeHolderLines } from "../../fix-actions";
import { guarded } from "./guard";
import { Menu } from "./banking-ui";
import { ExpandButton, useExpand } from "./windows";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;
const REMOVE_REASONS = ["Read twice", "Not on the statement", "Belongs to another statement"];

export function FixScreen({ id, title, data: data0, accKey, notImported = "", fileUrl: fileUrl0, mediaType, pages, backHref, target, editable }: {
  id: string; title: string; data: ReadResult; accKey: string; notImported?: string; /* round 30: why the last import did not go through */ fileUrl: string; mediaType: string; pages: number | null;
  backHref: string; target: string | null; editable: boolean;
}) {
  const router = useRouter();
  const [data, setData] = useState(data0);
  // The file's signed address as first given: a page refresh signs a new one, and the viewer would reload mid-change.
  const [fileUrl] = useState(fileUrl0);
  const acc0 = data.accounts.find((a) => a.key === accKey) ?? data.accounts[0];
  const miss0 = useMemo(() => misread(acc0), [acc0]);
  const line0 = miss0?.lineId ? acc0.lines.find((l) => l.id === miss0.lineId) ?? null : null;
  const [value, setValue] = useState(line0 ? tidyAmount((line0.amountCents / 100).toFixed(2)) : "");
  const [busy, setBusy] = useState(false);
  const [big, toggleBig] = useExpand();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  // The statement with the highlighted amount as typed.
  const acc: StatementAccount = useMemo(() => {
    const c = parseMoney(value);
    if (!line0 || c === null) return acc0;
    return { ...acc0, lines: acc0.lines.map((l) => (l.id === line0.id ? { ...l, amountCents: Math.abs(c), source: "edited" as const } : l)) };
  }, [acc0, line0, value]);
  const miss = misread(acc);
  const diff = checkAccount(acc).differenceCents;
  const focus = line0 ? { n: acc0.lines.indexOf(line0) + 1, page: line0.page, amountCents: miss0?.printed ?? line0.amountCents, description: line0.description } : null;
  // Another cardholder's section the reader put apart: the same card statement, another card number.
  const holders = data.accounts.filter((a) => a.key !== acc0.key && a.kind === "card" && acc0.kind === "card" && a.periodStart === acc0.periodStart && a.periodEnd === acc0.periodEnd && a.lines.length);

  const run = async (f: () => Promise<{ ok: true; data: ReadResult } | { ok: false; error: string }>, done: string) => {
    setBusy(true);
    try {
      const r = await f();
      if (!r.ok) { notify(r.error, "error"); return false; }
      setData(r.data); notify(done); return true;
    } finally { setBusy(false); }
  };
  const doImport = async () => {
    setBusy(true);
    try {
      const saved = await saveStatementEdits(id, { ...data, accounts: data.accounts.map((a) => (a.key === acc.key ? acc : a)) });
      if (!saved.ok) { notify(saved.error, "error"); return; }
      const r = await guarded((confirm) => importChecked(id, target, true, confirm).then((x) => (!x.ok && /^Nothing was imported\. This removes/.test(x.error)
        ? { ...x, confirm: x.error.replace(/^Nothing was imported\. /, "") } : x)));
      if (!r) return;
      if (!r.ok) { notify(r.error, "error"); return; }
      notify("Imported.");
      router.push(backHref); router.refresh();
    } finally { setBusy(false); }
  };
  const readAgain = async () => {
    if (!(await confirmAction({ title: "Read this statement again?", body: "The reader reads the same file again. The lines read and the changes made here are replaced. Nothing is imported.", confirm: "Read again" }))) return;
    const r = await readStatementsAgain([id]);
    if (!r.ok) { notify(r.error, "error"); return; }
    notify("Sent to the reader. It shows in the list when it is read.");
    router.push(backHref); router.refresh();
  };

  return (
    <div className={`fixed inset-0 z-[60] grid overflow-y-auto bg-navy-950/45 ${big ? "" : "place-items-center px-4 py-6"}`} role="dialog" aria-modal="true" aria-label="Fix it">
      <div className={`flex w-full flex-col overflow-hidden bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)] ${big ? "h-screen" : "h-[min(92vh,940px)] max-w-[1500px] rounded-[16px]"}`}>
        <div className="flex items-center gap-4 border-b border-sand-200 px-6 py-4">
          <Link href={backHref} scroll={false} className="inline-flex items-center gap-1 text-[14px] font-semibold text-navy-700"><ArrowLeft className="h-4 w-4" />Back</Link>
          <h2 className="text-[19px] font-semibold">{title}</h2><span className="flex-1" />
          {editable && <button type="button" onClick={readAgain} disabled={busy} className="btn-secondary h-9">Read again</button>}
          <ExpandButton on={big} toggle={toggleBig} />
          {editable && <Menu label="More for this statement">
            {/* Round 24: nothing uploaded is deleted here. A statement not needed is skipped; it stays in the list. */}
            <button type="button" className="block w-full rounded px-3 py-2 text-left hover:bg-sand-50"
              onClick={async () => { if (await confirmAction({ title: "Skip this statement?", body: "It is not imported. It stays in the upload list as Skipped.", confirm: "Skip" })) { const r = await skipStatement(id, true, null); if (!r.ok) notify(r.error, "error"); else { router.push(backHref); router.refresh(); } } }}>
              Skip statement</button>
          </Menu>}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="min-h-0 overflow-auto border-r border-sand-200 bg-sand-100/70 p-4"><StatementViewer url={fileUrl} mediaType={mediaType} pages={pages} focus={focus} /></div>
          <div className="min-h-0 overflow-auto px-6 py-5">
            {notImported && <p className="mb-4 rounded-[12px] border border-danger/30 bg-danger-soft px-5 py-3.5 text-[14.5px]" role="alert"><b>Not imported.</b> {notImported}</p>}
            {miss && (
              <div className="mb-4 rounded-[12px] border border-[#efd9a6] bg-warning-soft/60 px-5 py-3.5 text-[14.5px] leading-relaxed" role="status" aria-label="What is wrong">
                <p><b>{miss.title}</b> {miss.sentence}{miss.lineId ? " Check the amount on the highlighted line against the statement." : ""}</p>
                {miss.rows.length > 0 && <ul className="mt-1.5 grid gap-0.5">{miss.rows.map((r) => <li key={r}>{r}</li>)}</ul>}
                {!miss.lineId && <p className="mt-1.5 text-[13.5px] text-ink-2">Compare the lines with the statement. Add a missing line, or remove one read wrongly.</p>}
              </div>
            )}
            {editable && holders.map((h) => (
              <div key={h.key} className="mb-4 flex flex-wrap items-center gap-3 rounded-[12px] border border-sand-300 bg-sand-50 px-5 py-3 text-[14px]">
                <span className="flex-1">The reader put {h.lines.length} line{h.lines.length === 1 ? "" : "s"} under card ••• {h.last4 || "?"} ({amt(h.lines.reduce((n, l) => n + (l.dir === "in" ? l.amountCents : -l.amountCents), 0))}). A second cardholder on the same statement belongs to this account.</span>
                <button type="button" disabled={busy} className="btn-secondary h-9" onClick={() => run(() => takeHolderLines(id, acc0.key, h.key), "Lines added.")}>Add them to this account</button>
              </div>
            ))}
            <table className="w-full text-[14.5px]">
              <thead><tr className="border-b border-sand-200 text-left text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">
                <th className="py-2.5 pr-3">Date</th><th className="py-2.5 pr-3">Description</th><th className="py-2.5 pr-3">Type</th><th className="py-2.5 pr-3 text-right">Amount</th>
                <th className="py-2.5 pr-3 text-right">Bank balance</th>{editable && <th className="w-8" />}</tr></thead>
              <tbody>
                {acc0.lines.map((l) => {
                  const on = l.id === line0?.id;
                  return [
                    <tr key={l.id} className={`border-b border-sand-100 ${on ? "bg-warning-soft/60" : ""} ${l.noEffect ? "bg-sand-50/60 text-ink-3" : ""}`}>
                      <td className="py-3 pr-3 whitespace-nowrap">{day(l.date)}{l.printedDate && <span className="block text-[12px] text-ink-3">Transaction date: {day(l.printedDate)}</span>}</td>
                      <td className="py-3 pr-3">{l.description}
                        {(l.holder || l.source !== "read" || l.noEffect) && <span className="block text-[12px] text-ink-3">{[l.noEffect ? "No effect on balance" : "", l.holder ? `Card ••• ${l.holder}` : "", l.source === "added" ? "Added" : l.source === "edited" ? "Edited" : ""].filter(Boolean).join(" · ")}</span>}</td>
                      <td className="py-3 pr-3">{typeLabel(acc0.kind, l.dir)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{on && editable
                        ? <AmountInput name="amount" value={value} onValue={setValue} aria-label={`Amount for ${l.description}`} className="input h-10 w-[10rem] border-2 border-[#d08a1a] text-right text-[15px]" />
                        : amt(l.amountCents)}</td>
                      <td className="py-3 pr-3 text-right text-ink-3 tabular-nums">{l.balanceCents === null ? "" : amt(l.balanceCents)}</td>
                      {editable && <td className="py-2 text-right"><button type="button" aria-label={`Remove line ${l.description}`} title="Remove line" disabled={busy}
                        onClick={() => setRemoving(removing === l.id ? null : l.id)} className="grid h-7 w-7 place-items-center rounded text-ink-3 hover:bg-sand-100 hover:text-danger"><X className="h-4 w-4" /></button></td>}
                    </tr>,
                    removing === l.id && editable ? <RemoveRow key={`${l.id}-rm`} busy={busy} onCancel={() => setRemoving(null)}
                      onRemove={async (why) => { if (await run(() => removeReadLine(id, acc0.key, l.id, why), "Line removed.")) setRemoving(null); }} /> : null,
                  ];
                })}
              </tbody>
            </table>
            {editable && (adding
              ? <AddLine kind={acc0.kind} busy={busy} onCancel={() => setAdding(false)}
                  onAdd={async (v) => { if (await run(() => addMissingLine(id, acc0.key, v), "Line added.")) setAdding(false); }} />
              : <button type="button" onClick={() => setAdding(true)} className="mt-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-navy-700"><Plus className="h-4 w-4" />Add missing line</button>)}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-sand-200 px-6 py-4">
          <span className={`text-[14.5px] ${diff === 0 ? "text-success" : "text-danger"}`}>{diff === 0 ? "Difference 0.00." : `Difference ${amt(Math.abs(diff))}. Import turns on at 0.00.`}</span>
          <span className="flex-1" />
          {editable && <button type="button" disabled={diff !== 0 || busy} onClick={doImport} className="btn h-11 px-8 text-[15px]">{busy ? "Working…" : "Import"}</button>}
        </div>
      </div>
    </div>
  );
}

function RemoveRow({ busy, onCancel, onRemove }: { busy: boolean; onCancel: () => void; onRemove: (why: string) => void }) {
  const [pick, setPick] = useState(REMOVE_REASONS[0]);
  const [other, setOther] = useState("");
  const why = pick === "Other" ? other.trim() : pick;
  return (
    <tr className="border-b border-sand-100 bg-sand-50"><td colSpan={6} className="px-3 py-3">
      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <span className="font-semibold">Remove this line?</span>
        <select aria-label="Reason" value={pick} onChange={(e) => setPick(e.target.value)} className="input h-9">
          {[...REMOVE_REASONS, "Other"].map((r) => <option key={r}>{r}</option>)}</select>
        {pick === "Other" && <input aria-label="Say why" value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} placeholder="Say why" className="input h-9 w-[16rem]" />}
        <span className="flex-1" />
        <button type="button" onClick={onCancel} className="btn-secondary h-9">Cancel</button>
        <button type="button" disabled={busy || why.length < 3} onClick={() => onRemove(why)} className="btn-danger h-9">Remove line</button>
      </div>
    </td></tr>
  );
}

function AddLine({ kind, busy, onCancel, onAdd }: { kind: StatementAccount["kind"]; busy: boolean; onCancel: () => void;
  onAdd: (v: { date: string; description: string; dir: "in" | "out"; amount: string }) => void }) {
  const [date, setDate] = useState(""), [description, setDescription] = useState(""), [dir, setDir] = useState<"in" | "out">("in"), [amount, setAmount] = useState("");
  return (
    <div className="mt-3 grid gap-3 rounded-[12px] border border-sand-300 bg-sand-50 px-4 py-3.5" role="group" aria-label="Add missing line">
      <p className="text-[13.5px] font-semibold">Add missing line <span className="font-normal text-ink-3">· as printed on the statement</span></p>
      <div className="grid gap-2.5 sm:grid-cols-[10rem_1fr_9rem_9rem]">
        <label className="grid gap-1 text-[12px] text-ink-2">Date<input type="date" aria-label="Date" value={date} onChange={(e) => setDate(e.target.value)} className="input h-9" /></label>
        <label className="grid gap-1 text-[12px] text-ink-2">Description<input aria-label="Description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} className="input h-9" /></label>
        <label className="grid gap-1 text-[12px] text-ink-2">Type<select aria-label="Type" value={dir} onChange={(e) => setDir(e.target.value as "in" | "out")} className="input h-9">
          <option value="in">{typeLabel(kind, "in")}</option><option value="out">{typeLabel(kind, "out")}</option></select></label>
        <label className="grid gap-1 text-[12px] text-ink-2">Amount<AmountInput name="add_amount" value={amount} onValue={setAmount} aria-label="Amount" className="input h-9 text-right" placeholder="0.00" /></label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-secondary h-9">Cancel</button>
        <button type="button" disabled={busy || !date || !description.trim() || !amount} onClick={() => onAdd({ date, description, dir, amount })} className="btn h-9">Add line</button>
      </div>
    </div>
  );
}
