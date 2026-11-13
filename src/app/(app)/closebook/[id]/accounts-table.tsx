"use client";
// Trial balance tab, matching (Phase 3 batch 4.5; layout borrowed from QuickBooks' tax mapping screen,
// Hashim Nov 11, 2026):
// 1. A card at the top: the accounts that need a decision, with their dollar total.
// 2. Accounts, or By GIFI line: one row per GIFI line with its account count and total, opened to
//    show its accounts.
// 3. An amber flag on a GIFI line whose total sits on the wrong side.
// 4. Changing a line happens in a side panel opened by the pencil: no change by a stray click.
import { useState, useTransition } from "react";
import { AlertCircle, ChevronRight, Info, Lock, Pencil, X } from "lucide-react";
import { askReviewerInline, matchInline, taxCodeInline } from "../actions";

export type Row = {
  id: string; number: string; name: string; last: string; current: string; final: string; finalNum: number; change: string;
  lineNo: string; lineLabel: string; movedFrom: string; source: string; needsReviewer: boolean; reason: string; mismatch: string;
  tax: string; taxDefault: string; taxOverride: boolean; attention: boolean;
  // "Opening balances to enter": one line per cause, adding up to the row (round 2 item 8).
  buildUp?: { text: string; amount: string }[];
};
export type Group = { lineNo: string; label: string; count: number; total: string; warn: string; ids: string[] };
export type Option = { no: string; label: string; section: string; hint: string; locked: boolean; normal: "debit" | "credit" };


export function MatchWorkspace({ fileId, view, rows, groups, options, taxes, isReviewer, editable, totals, edit }: {
  fileId: string; view: string; base: string; rows: Row[]; groups: Group[]; options: Option[]; taxes: { code: string; name: string }[];
  isReviewer: boolean; editable: boolean; totals: { last: string; current: string }; edit?: string;
}) {
  // edit: open the panel for one account on arrival (the "Wrong GIFI line? Change it" link from lead sheets).
  const [open, setOpen] = useState<Row | null>(() => (edit && editable ? rows.find((r) => r.id === edit) ?? null : null));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const attention = rows.filter((r) => r.attention);
  // "See all" opens the list in place (round 2 item 12); the accounts table below stays on the page.
  const [all, setAll] = useState(view === "attention");
  const pencil = (r: Row, label = "Change") => editable && (
    <button type="button" onClick={() => setOpen(r)} title={label} aria-label={`${label}: ${r.name}`} className="rounded p-1.5 text-ink-3 hover:bg-sand-100 hover:text-navy-700"><Pencil className="h-4 w-4" /></button>
  );
  const accountCell = (r: Row) => <>{r.number && <span className="mr-2 text-ink-3 tabular-nums">{r.number}</span>}{r.name}</>;
  const lineCell = (r: Row) => (
    <>
      {r.lineLabel || <span className={r.needsReviewer ? "text-danger" : "text-ink-3"}>{r.needsReviewer ? "Waiting for the reviewer" : "Not matched yet"}</span>}
      <span className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted">
        {r.needsReviewer && <Reason r={r} />}
        {r.movedFrom && <span>Opposite balance: shown on its paired line (matched to {r.movedFrom})</span>}
        {r.mismatch && <span className={r.mismatch.startsWith("Check") ? "font-semibold text-warning" : ""}>{r.mismatch}</span>}
      </span>
    </>
  );

  return (
    <>
      {attention.length > 0 && (
        <section className="card mb-4 overflow-x-auto p-0">
          {/* The count only: adding debits and credits together gives no useful total (round 2 item 12). */}
          <p className="flex items-center gap-2 px-4 pt-3 pb-1.5 font-medium"><AlertCircle className="h-5 w-5 text-warning" aria-hidden />
            {attention.length} account{attention.length === 1 ? " needs" : "s need"} a decision</p>
          <table className="table table-compact">
            <thead><tr><th>Account</th><th>Why</th><th className="w-36 text-right">This year</th><th className="w-10"></th></tr></thead>
            <tbody>{attention.slice(0, all ? attention.length : 5).map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{accountCell(r)}</td>
                <td className="text-sm">{r.needsReviewer ? <Reason r={r} /> : !r.lineLabel ? "Not matched" : r.mismatch}</td>
                <td className="text-right tabular-nums">{r.final}</td>
                <td>{pencil(r, "Assign GIFI line")}</td>
              </tr>
            ))}</tbody>
          </table>
          {attention.length > 5 && <p className="px-4 pb-2.5"><button type="button" onClick={() => setAll(!all)} className="text-sm text-navy-700 underline">{all ? "Show less" : `See all ${attention.length}`}</button></p>}
        </section>
      )}

      {view === "lines" ? (
        <section className="card overflow-x-auto p-0">
          <table className="table table-compact min-w-[900px]">
            <thead><tr><th>GIFI line</th><th>Accounts</th><th className="w-8"></th><th className="text-right">This year</th></tr></thead>
            <tbody>{groups.map((g) => <GroupRows key={g.lineNo} g={g} byId={byId} accountCell={accountCell} pencil={pencil} />)}</tbody>
          </table>
        </section>
      ) : (
        <section className="card overflow-x-auto p-0">
          <table className="table table-compact min-w-[1000px]">
            <thead><tr><th>Account</th><th className="w-[36%]">GIFI line</th><th className="w-24">Source</th><th>Tax code</th><th className="text-right">Last year</th><th className="text-right">This year</th><th className="text-right">Change</th><th className="w-10"></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.needsReviewer ? "bg-danger/5" : !r.lineLabel ? "bg-warning-soft/50" : ""}>
                  <td>{accountCell(r)}</td>
                  <td>{lineCell(r)}</td>
                  <td className="text-xs text-ink-2">{r.source}</td>
                  <td>{r.tax}{r.taxOverride && <span className="block text-xs text-muted">Reviewer&rsquo;s choice</span>}</td>
                  <td className="text-right tabular-nums">{r.last}</td>
                  <td className="text-right tabular-nums">{r.current}</td>
                  <td className="text-right tabular-nums">{r.change}</td>
                  <td>{pencil(r)}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td>Total (must be 0)</td><td></td><td></td><td></td><td className="text-right tabular-nums">{totals.last}</td><td className="text-right tabular-nums">{totals.current}</td><td></td><td></td></tr>
            </tbody>
          </table>
        </section>
      )}

      {open && <Panel key={open.id} fileId={fileId} r={open} options={options} taxes={taxes} isReviewer={isReviewer} onClose={() => setOpen(null)} />}
    </>
  );
}

function GroupRows({ g, byId, accountCell, pencil }: { g: Group; byId: Map<string, Row>; accountCell: (r: Row) => React.ReactNode; pencil: (r: Row, label?: string) => React.ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <>
      <tr className="cursor-pointer hover:bg-sand-50" onClick={() => setShown(!shown)}>
        <td><ChevronRight className={`mr-1 inline h-4 w-4 transition-transform ${shown ? "rotate-90" : ""}`} aria-hidden /><b className="tabular-nums">{g.lineNo.replace(/\.00$/, "")}</b> {g.label}</td>
        <td className="text-ink-2">{g.count === 1 && !shown ? accountCell(byId.get(g.ids[0])!) : `(${g.count})`}</td>
        <td>{g.warn && <span title={g.warn} aria-label={g.warn}><AlertCircle className="h-5 w-5 text-warning" /></span>}</td>
        <td className={`text-right tabular-nums ${g.warn ? "font-semibold text-danger" : ""}`}>{g.total}</td>
      </tr>
      {shown && g.ids.map((id) => {
        const r = byId.get(id)!;
        return (
          <tr key={id} className="bg-sand-50/60 text-sm">
            <td className="pl-10">{accountCell(r)}</td><td className="text-xs text-muted">{r.source}</td><td>{pencil(r)}</td><td className="text-right tabular-nums">{r.final}</td>
          </tr>
        );
      })}
    </>
  );
}

// The side panel (borrowed from QuickBooks' "Change tax line"): the account's facts, From, To, and
// for the reviewer the tax code. Nothing changes until Save.
function Panel({ fileId, r, options, taxes, isReviewer, onClose }: { fileId: string; r: Row; options: Option[]; taxes: { code: string; name: string }[]; isReviewer: boolean; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [tax, setTax] = useState(r.taxOverride ? r.tax : "");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const canPick = !r.needsReviewer || isReviewer;
  const hit = [options.find((o) => o.label === to) ?? options.find((o) => o.no === to.trim() || o.no === `${to.trim()}.00`)].find((o) => o && !o.locked);
  const taxChanged = isReviewer && (r.lineLabel || hit) && tax !== (r.taxOverride ? r.tax : "");
  const save = () => start(async () => {
    setErr("");
    if (hit && hit.no !== r.lineNo) { const e = await matchInline(fileId, r.id, hit.no); if (e) { setErr(e); return; } }
    if (taxChanged) { const e = await taxCodeInline(fileId, r.id, tax); if (e) { setErr(e); return; } }
    onClose();
  });
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Change GIFI line">
      <div className="absolute inset-0 bg-navy-950/30" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col gap-5 overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Change GIFI line</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1.5 hover:bg-sand-100"><X className="h-5 w-5" /></button></div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-semibold">Account</dt><dd>{r.number} {r.name}</dd>
          <dt className="font-semibold">This year</dt><dd className="tabular-nums">{r.final}</dd>
          <dt className="font-semibold">Last year</dt><dd className="tabular-nums">{r.last}</dd>
          {r.mismatch && <><dt className="font-semibold">Check</dt><dd>{r.mismatch}</dd></>}
        </dl>
        <hr className="border-sand-200" />
        <div className="grid gap-1 text-sm"><p className="font-semibold">From</p><p>{r.lineLabel || (r.needsReviewer ? `Waiting for the reviewer: ${r.reason}` : "Not matched yet")}</p></div>
        {canPick ? (
          <div className="grid gap-1">
            <label htmlFor="to" className="text-sm font-semibold">To (line number or name)</label>
            <LinePicker options={options} value={to} onChange={setTo} balance={r.finalNum} />
            {to && !hit && <span className="text-xs text-muted">Pick a line from the list.</span>}
          </div>
        ) : <p className="rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">This account is on the reviewer&rsquo;s list. The reviewer decides it once, for this client&rsquo;s future years too.</p>}
        {isReviewer && (r.lineLabel || hit) && (
          <div className="grid gap-1">
            <label htmlFor="tax" className="text-sm font-semibold">Tax code (reviewer only)</label>
            <select id="tax" value={tax} onChange={(e) => setTax(e.target.value)} className="input">
              <option value="">The line&rsquo;s default{r.taxDefault ? ` (${r.taxDefault})` : ""}</option>
              {taxes.map((t) => <option key={t.code} value={t.code}>{t.code}: {t.name}</option>)}
            </select>
          </div>
        )}
        {err && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{err}</p>}
        <div className="mt-auto flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={pending || (!(hit && hit.no !== r.lineNo) && !taxChanged)} className="btn">{pending ? "Saving..." : "Save"}</button>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          {!isReviewer && !r.needsReviewer && (
            <button type="button" disabled={pending} className="ml-auto text-sm text-navy-700 underline"
              onClick={() => start(async () => { const e = await askReviewerInline(fileId, r.id); if (e) setErr(e); else onClose(); })}>Not sure? Ask the reviewer</button>
          )}
        </div>
      </aside>
    </div>
  );
}

// The line picker (borrowed from QuickBooks): each line with its section in grey italics and an info
// mark that shows CRA's description of the GIFI code. Type a number or words; arrows and Enter work.
function LinePicker({ options, value, onChange, balance }: { options: Option[]; value: string; onChange: (v: string) => void; balance: number }) {
  // Only lines on the account's side (a credit balance sees liability, equity and revenue lines), unless "Show all lines".
  const [all, setAll] = useState(false);
  const side = balance > 0 ? "debit" : balance < 0 ? "credit" : null;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = value.trim().toLowerCase();
  const chosen = options.some((o) => o.label === value);
  const words = q.split(/\s+/).filter(Boolean);
  // Numbers match the start of the line number; words match the start of words ("to" does not match "director").
  const esc = (w: string) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const res = words.map((w) => new RegExp(`(^|[^a-z0-9])${esc(w)}`, "i"));
  const sided = all || !side ? options : options.filter((o) => o.normal === side);
  const list = (chosen || !q ? sided : sided.filter((o) => (/^\d/.test(q) ? o.no.startsWith(q) : res.every((re) => re.test(`${o.label} ${o.section}`))))).slice(0, 60);
  const pick = (o: Option) => { if (o.locked) return; onChange(o.label); setOpen(false); };
  return (
    <div className="relative">
      <input id="to" value={value} autoFocus autoComplete="off" role="combobox" aria-expanded={open} aria-controls="cb-line-list" placeholder="For example: office, rent, 8810" className="input"
        onFocus={() => setOpen(true)} onClick={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
          else if (e.key === "Enter" && open && list[active]) { e.preventDefault(); pick(list[active]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {side && <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setAll(!all); setOpen(true); }} className="mt-1 text-xs text-navy-700 underline">{all ? `Show only ${side} lines` : "Show all lines"}</button>}
      {open && list.length > 0 && (
        <ul id="cb-line-list" role="listbox" className="absolute z-10 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-sand-200 bg-white py-1 shadow-xl">
          {list.map((o, i) => (
            <li key={o.no} role="option" aria-selected={i === active} aria-disabled={o.locked} onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}
              title={o.locked ? "Locked: choose one of its sub-lines" : undefined}
              className={`flex items-baseline gap-2 px-3 py-2 text-sm ${o.locked ? "cursor-not-allowed text-ink-3" : "cursor-pointer"} ${i === active && !o.locked ? "bg-navy-50" : ""}`}>
              <span className="flex-1"><b className="tabular-nums">{o.no.slice(0, 4)}</b>{!o.no.endsWith(".00") && <span className="text-ink-3 tabular-nums">{o.no.slice(4)}</span>} {o.label.slice(o.no.length + 1)}</span>
              {o.locked && <Lock className="h-3.5 w-3.5 shrink-0 self-center text-ink-3" aria-label="Locked" />}
              <span className="text-xs text-ink-3 italic">{o.section}</span>
              {o.hint && <span title={o.hint} aria-label={`CRA: ${o.hint}`} className="ml-auto shrink-0 text-ink-3"><Info className="h-3.5 w-3.5" /></span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// A reviewer's reason on one line, with "more" for the rest; "Opening balances to enter" opens to its
// build-up, one line per cause, adding to the row (round 2 items 8 and 12).
function Reason({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const long = !!r.buildUp || r.reason.length > 90;
  return (
    <span className="text-danger">
      <span className={open ? "" : "line-clamp-1"}>For the reviewer: {r.buildUp ? `${r.buildUp.length} ${r.buildUp.length === 1 ? "difference" : "differences"} with last year's closing balances` : r.reason}</span>
      {long && <button type="button" onClick={() => setOpen(!open)} className="ml-1 text-xs text-navy-700 underline">{open ? "less" : "more"}</button>}
      {open && r.buildUp && (
        <table className="mt-1 w-full text-xs text-ink">
          <tbody>
            {r.buildUp.map((c, i) => <tr key={i}><td className="py-0.5 pr-3">{c.text}</td><td className="py-0.5 text-right tabular-nums whitespace-nowrap">{c.amount}</td></tr>)}
            <tr className="border-t border-sand-300 font-semibold"><td className="py-0.5 pr-3">Opening balances to enter</td><td className="py-0.5 text-right tabular-nums">{r.final}</td></tr>
          </tbody>
        </table>
      )}
    </span>
  );
}
