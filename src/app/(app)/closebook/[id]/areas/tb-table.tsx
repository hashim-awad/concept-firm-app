"use client";
// Round 15: the trial balance table, as CaseWare Cloud's Data page. One toolbar of dropdowns: Columns
// (show, hide, pin), Options (suppress zero balances, accounts on or off, split adjustments into AJE and
// TJE), Filters (amount range, with the reviewer, with notes), Collapse all, Search (highlights as you type) and
// one export icon. Groups are blue rows with their totals; the group of the first visible row stays at
// the top while scrolling. "Out of balance" shows only when it is.
// Piece UI1 (Hashim, Nov 20, 2026; closebook specialist items 7 to 11): rows 28 px, 24 px with Compact; the table scrolls in
// its own box so the headings stay on top and No. and Account stay at the left; "Change from prior" over $ and %; negative
// % in brackets; a folded group keeps its totals; no year-over-year flag (CB2-0, rule 7); the footer names the column that is out.
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Flag, MessageSquare, Plus, Search } from "lucide-react";
import { AccountPanel } from "./account-panel";
import { addNote, askReviewerInline } from "../../actions";
import { Popover } from "../shell/ui";
import { parseAmount } from "@/lib/closebook/amount";
import { pctShow } from "@/lib/closebook/pct-show";
import { outLines } from "@/lib/closebook/tb-footer";
import { pctChange } from "@/lib/closebook/reports";

// Piece R1: no GIFI on the Trial balance tab; group, sh and shName feed the account panel (mock N).
export type TbRow = { key: string; id: string; number: string; name: string; group: string; sh: boolean; shName: string; prelim: number; aje: number; tje: number; adjust: number; reclass: number;
  final: number; last: number; diff: number; pct: string; notes: number; reviewer: boolean; drillable: boolean;
  lastFrom?: string };   // round 25: "Reclassified from 2707 to 2701"
export type TbGroupRow = { code: string; name: string; section: string; rows: TbRow[] };
type ColKey = "prelim" | "adjust" | "aje" | "tje" | "reclass" | "final" | "last" | "diff" | "pct";

const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// Accounting review: the one % calculation (reports.ts), not a second copy.
const pctOf = pctChange;

const DRILL: Partial<Record<ColKey, string>> = { prelim: "prelim", adjust: "adjust", aje: "adjust", tje: "adjust", reclass: "reclass", final: "final" };

export function TbTable({ fileId, groups, view, year, canReview, editable, exportBase, openKey, noteStep = "compare" }: {
  fileId: string; groups: TbGroupRow[]; view: "groups" | "accounts"; year: number; canReview: boolean; editable: boolean; exportBase: string;
  openKey?: string;   // piece R1: an old drill= link (no column) opens the account panel once
  noteStep?: string;  // piece R1: the step the panel's review note is filed under
}) {
  const [panel, setPanel] = useState<TbRow | null>(() => (openKey ? groups.flatMap((g) => g.rows).find((r) => r.key === openKey) ?? null : null));
  // The panel is not in the address: an old link's drill= is dropped once the panel is open, so a reload does not reopen it.
  useEffect(() => {
    if (!openKey) return;
    const u = new URL(window.location.href);
    u.searchParams.delete("drill"); u.searchParams.delete("col");
    window.history.replaceState(window.history.state, "", u.toString());
  }, [openKey]);
  const closePanel = () => { const k = panel?.key; setPanel(null); if (k) setTimeout(() => document.getElementById(`ab-${k}`)?.focus(), 0); };
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set());
  const [pin, setPin] = useState(true);
  const [zero, setZero] = useState(false);
  const [accts, setAccts] = useState(true);
  const [split, setSplit] = useState(false);
  const [min, setMin] = useState(""), [max, setMax] = useState("");
  const [onlyFlags, setOnlyFlags] = useState(false), [onlyNotes, setOnlyNotes] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [compact, setCompact] = useState(false);
  const [path, setPath] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const footRef = useRef<HTMLDivElement>(null);
  // ui-reviewer (D6): the box fills the screen below its own top, less the footer and the page's bottom padding, so
  // the page itself never scrolls and the headings never slide under the bars. The hint shows only when the table
  // really scrolls sideways.
  const [boxH, setBoxH] = useState<number | null>(null);
  const extra = useRef(0);   // what the page still overflowed by last time; kept, so the height settles instead of flipping
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const w = wrapRef.current; if (!w) return;
    const fit = () => {
      const top = w.getBoundingClientRect().top + window.scrollY;
      const foot = footRef.current?.offsetHeight ?? 40;
      const first = Math.max(240, Math.floor(window.innerHeight - top - foot - 50 - extra.current));
      setBoxH(first);
      setWide(w.scrollWidth > w.clientWidth + 1);
      // Then take off whatever the page still overflows by (padding and borders below the table).
      requestAnimationFrame(() => {
        const over = document.documentElement.scrollHeight - window.innerHeight;
        if (over > 0 && window.scrollY === 0) { extra.current += over; setBoxH(Math.max(240, first - over)); }
      });
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(w); if (w.firstElementChild) ro.observe(w.firstElementChild); if (footRef.current) ro.observe(footRef.current);
    window.addEventListener("resize", fit);
    return () => { ro.disconnect(); window.removeEventListener("resize", fit); };
  }, []);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ key: string; text: string } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const grouped = view !== "accounts";

  const cols: [ColKey, string][] = [["prelim", `Prelim ${year}`], ...(split ? [["aje", "AJE"], ["tje", "TJE"]] as [ColKey, string][] : [["adjust", "Adjust"]] as [ColKey, string][]),
    ["reclass", "Reclass"], ["final", `Final ${year}`], ["last", `Prior ${year - 1}`], ["diff", "$ change"], ["pct", "% change"]];
  const shown = cols.filter(([k]) => !hidden.has(k) && !(split && hidden.has("adjust") && (k === "aje" || k === "tje")));
  // A size filter: "(500)" or "-500" reads as 500 (item C: either way a minus or brackets is accepted).
  const size = (t: string) => { const c = t.trim() ? parseAmount(t) : null; return c === null ? null : Math.abs(c); };
  const lo = size(min), hi = size(max);
  const keep = (r: TbRow) => (!zero || r.final || r.last || r.prelim) && (!onlyFlags || r.reviewer) && (!onlyNotes || r.notes > 0)
    && (lo === null || Math.abs(r.final) >= lo) && (hi === null || Math.abs(r.final) <= hi);
  const match = (s: string) => !!q && s.toLowerCase().includes(q.toLowerCase());
  const filtered = groups.map((g) => ({ ...g, rows: g.rows.filter(keep) })).filter((g) => g.rows.length);
  const sum = (rows: TbRow[], k: ColKey) => rows.reduce((n, r) => n + (r[k as keyof TbRow] as number), 0);
  const all = groups.flatMap((g) => g.rows);
  // UI1 item 10: each money column of the whole trial balance should net to nil; the footer names any that does not.
  const OUT_COLS: [ColKey, string][] = [["prelim", `Prelim ${year}`], ["adjust", "Adjust"], ["reclass", "Reclass"], ["final", `Final ${year}`], ["last", `Prior ${year - 1}`]];
  const outs = outLines(OUT_COLS.map(([k, l]) => ({ key: k, label: l, by: sum(all, k) })));

  // The group path of the first visible row, under the toolbar.
  useEffect(() => {
    if (!grouped) return;
    const onScroll = () => {
      const t = tableRef.current; if (!t) return;
      const head = t.querySelector("thead")?.getBoundingClientRect().bottom ?? 0;
      const rows = t.querySelectorAll<HTMLTableRowElement>("tbody tr[data-path]");
      let p = "";
      for (const r of rows) { if (r.getBoundingClientRect().bottom > head + 2) { p = r.dataset.path ?? ""; break; } }
      const firstHead = t.querySelector<HTMLTableRowElement>("tbody tr[data-group-head]");
      setPath(firstHead && firstHead.getBoundingClientRect().top < head ? p : "");
    };
    const w = wrapRef.current;
    w?.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => { w?.removeEventListener("scroll", onScroll); window.removeEventListener("scroll", onScroll); };
  }, [grouped, filtered]);

  const hl = (s: string) => {
    if (!q) return s;
    const i = s.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? s : <>{s.slice(0, i)}<mark className="rounded-sm bg-[#fff2a8] px-px text-inherit">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
  };
  const drillHref = (r: TbRow, k: ColKey) => `/closebook/${fileId}?area=tb&tbv=${view}&drill=${encodeURIComponent(r.key)}&col=${DRILL[k]}`;
  const cell = (r: TbRow | null, k: ColKey, v: number | string, bold = false) => {
    const isNum = k !== "pct";
    const text = isNum ? money(v as number) : pctShow(v as string);
    // Screen only: a hidden ")" after a figure without brackets, so the decimals line up down the column (D9).
    const pad = !text.endsWith(")") ? "amt-pad" : "";
    const linkable = r && r.drillable && DRILL[k] && v;
    return <td key={k} className={`px-[7px] text-right whitespace-nowrap tabular-nums ${bold ? "font-semibold" : ""} ${k === "diff" ? "border-l border-sand-200" : ""}`}>
      {linkable ? <Link href={drillHref(r!, k)} scroll={false} className={`text-navy-700 hover:underline ${pad}`}>{text}</Link> : <span className={pad}>{text}</span>}</td>;
  };
  const sticky = pin ? "sticky left-0 z-[1] bg-inherit" : "";
  const rowH = compact ? "h-6" : "h-7";
  const toolbtn = "inline-flex h-8 items-center gap-1 border border-sand-300 bg-white px-2.5 text-[13px] text-ink hover:bg-sand-50";
  const check = (label: string, on: boolean, set: (v: boolean) => void) => (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-sand-50"><input type="checkbox" checked={on} onChange={(e) => set(e.target.checked)} />{label}</label>
  );
  const anyClosed = closed.size > 0;
  const toggleGroup = (code: string) => setClosed((c) => { const n = new Set(c); if (n.has(code)) n.delete(code); else n.add(code); return n; });

  const sendToReviewer = (r: TbRow) => start(async () => {
    const e = await askReviewerInline(fileId, r.id);
    setMsg({ key: r.key, text: e ?? "Sent to the reviewer." });
  });
  const icons = (r: TbRow) => (
    <td className="w-[1%] pr-1.5 pl-0.5 text-right whitespace-nowrap text-ink-3" onClick={(e) => e.stopPropagation()}>
      {r.id && editable ? <span className="inline-flex items-center gap-1">
        <Link href={`/closebook/${fileId}?area=tb&tbv=${view}&new=journal&acct=${r.id}`} scroll={false} title="New entry on this account" aria-label={`New entry on ${r.name}`} className="hover:text-navy-700"><Plus className="h-3.5 w-3.5" /></Link>
        {canReview ? (
          <Popover align="right" width="w-80" label={r.notes ? `${r.notes} review note${r.notes === 1 ? "" : "s"}` : "Add review note"}
            button={<span className={`relative ${r.notes ? "text-danger" : "hover:text-navy-700"}`}><MessageSquare className="h-3.5 w-3.5" fill={r.notes ? "currentColor" : "none"} />{r.notes > 0 && <span className="absolute -top-2 -right-1.5 text-[9px] font-bold">{r.notes}</span>}</span>}>
            <form action={addNote} className="grid gap-2 text-left">
              <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="step" value="compare" /><input type="hidden" name="target_type" value="account" />
              <input type="hidden" name="target_id" value={r.id} /><input type="hidden" name="back" value={`/closebook/${fileId}?area=tb&tbv=${view}#a-${r.key}`} />
              <label className="text-xs font-bold" htmlFor={`tn-${r.key}`}>Review note · {r.number} {r.name}</label>
              <textarea id={`tn-${r.key}`} name="body" rows={3} maxLength={2000} className="input" />
              <span className="flex items-center gap-3"><button type="submit" className="btn-secondary btn-compact">Add review note</button>
                {r.notes > 0 && <Link href={`/closebook/${fileId}?area=notes`} className="text-xs text-navy-700 underline">Open notes</Link>}</span>
            </form>
          </Popover>
        ) : r.notes ? <Link href={`/closebook/${fileId}?area=notes`} title={`${r.notes} review note${r.notes === 1 ? "" : "s"}`} className="relative text-danger"><MessageSquare className="h-3.5 w-3.5" fill="currentColor" /><span className="absolute -top-2 -right-1.5 text-[9px] font-bold">{r.notes}</span></Link>
          : <span title="No review note"><MessageSquare className="h-3.5 w-3.5" /></span>}
        <button type="button" disabled={pending || r.reviewer} onClick={() => sendToReviewer(r)} title={r.reviewer ? "With the reviewer" : "Send to the reviewer"} aria-label={`Send ${r.name} to the reviewer`}
          className={r.reviewer ? "text-warning" : "hover:text-navy-700"}><Flag className="h-3.5 w-3.5" fill={r.reviewer ? "currentColor" : "none"} /></button>
      </span> : null}
      {msg?.key === r.key && <span className={`ml-2 text-[11px] ${msg.text === "Sent to the reviewer." ? "text-success" : "text-danger"}`}>{msg.text}</span>}
    </td>
  );
  const accountRow = (r: TbRow, path: string) => (
    <tr key={r.key} id={`a-${r.key}`} data-path={path} onClick={(e) => { if (r.drillable && !(e.target as HTMLElement).closest("a,button,input,form")) setPanel(r); }}
      className={`${rowH} border-b border-sand-100 bg-white target:bg-navy-50 ${r.drillable ? "cursor-pointer hover:bg-sand-50" : ""} ${panel?.key === r.key ? "bg-navy-50" : ""} ${match(`${r.number} ${r.name}`) ? "bg-[#fffbe0]" : ""}`}>
      <td className={`pr-1 whitespace-nowrap text-ink-2 tabular-nums ${sticky}`} style={{ paddingLeft: grouped ? 30 : 12, width: 70, minWidth: 70 }}>{hl(r.number)}</td>
      <td className={`px-2 ${sticky} ${pin ? "shadow-[1px_0_0_var(--color-sand-200)]" : ""}`} style={pin ? { left: 70 } : undefined}>{r.drillable
        ? <button type="button" id={`ab-${r.key}`} onClick={() => setPanel(r)} className="text-left hover:underline" aria-haspopup="dialog">{hl(r.name)}</button> : hl(r.name)}
        {r.lastFrom && <span className="ml-2 text-[11px] text-ink-2">{r.lastFrom}</span>}</td>
      {shown.map(([k]) => cell(r, k, k === "pct" ? r.pct : (r[k] as number)))}
      {icons(r)}
    </tr>
  );
  return (
    <section className="border border-sand-200 bg-white" aria-label="Trial balance">
      <div className="sticky top-[var(--top,56px)] z-10 flex flex-wrap items-center gap-1.5 border-b border-sand-200 bg-white px-3 py-2">
        <Popover label="Columns" button={<span className={toolbtn}>Columns <ChevronDown className="h-3 w-3" /></span>} width="w-56">
          <div className="grid text-[12.5px]">{cols.map(([k, l]) => check(l, !hidden.has(k), (v) => setHidden((h) => { const n = new Set(h); if (v) n.delete(k); else n.add(k); return n; })))}
            <div className="mt-1 border-t border-sand-200 pt-1">{check("Pin the account column", pin, setPin)}</div></div>
        </Popover>
        <Popover label="Options" button={<span className={toolbtn}>Options <ChevronDown className="h-3 w-3" /></span>} width="w-64">
          <div className="grid text-[12.5px]">{check("Suppress zero balances", zero, setZero)}{grouped && check("Accounts (off: groups only)", accts, setAccts)}{check("Split adjustments into AJE and TJE", split, setSplit)}</div>
        </Popover>
        <Popover label="Filters" button={<span className={`${toolbtn} ${lo !== null || hi !== null || onlyFlags || onlyNotes ? "border-navy-600 text-navy-800" : ""}`}>Filters <ChevronDown className="h-3 w-3" /></span>} width="w-64">
          <div className="grid gap-1 text-[12.5px]">
            <p className="text-[11px] font-bold text-ink-3 uppercase">Final balance, either side</p>
            <div className="flex items-center gap-2"><input value={min} onChange={(e) => setMin(e.target.value)} placeholder="From" inputMode="decimal" className="input input-compact w-24 text-right" />
              <input value={max} onChange={(e) => setMax(e.target.value)} placeholder="To" inputMode="decimal" className="input input-compact w-24 text-right" /></div>
            {check("With the reviewer", onlyFlags, setOnlyFlags)}{check("With review notes", onlyNotes, setOnlyNotes)}
          </div>
        </Popover>
        {grouped && <button type="button" className={toolbtn} onClick={() => setClosed(anyClosed ? new Set() : new Set(filtered.map((g) => g.code)))}>
          {anyClosed ? <><ChevronsUpDown className="h-3 w-3" />Expand all</> : <><ChevronsDownUp className="h-3 w-3" />Collapse all</>}</button>}
        <button type="button" aria-pressed={compact} onClick={() => setCompact(!compact)} className={`${toolbtn} ${compact ? "!bg-navy-700 !text-white" : ""}`}>Compact</button>
        {grouped && path && <span className="inline-flex min-w-0 items-center gap-1 truncate text-xs font-semibold text-navy-800 max-[1279px]:hidden" data-group-path><ChevronRight className="h-3 w-3 flex-none" aria-hidden />{path}</span>}
        <span className="flex-1" />
        <label className="inline-flex w-56 items-center gap-1.5 rounded-md border border-sand-300 bg-white px-2 py-1 text-xs focus-within:border-navy-600">
          <Search className="h-3.5 w-3.5 text-ink-3" aria-hidden /><span className="sr-only">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <Popover align="right" width="w-40" label="Export" button={<span className="grid h-7 w-7 place-items-center rounded-md text-ink-2 hover:bg-sand-100"><Download className="h-4 w-4" /></span>}>
          <ul className="grid gap-1"><li><a href={`${exportBase}&format=xlsx`} className="block rounded px-2 py-1 hover:bg-sand-100">Excel</a></li><li><a href={`${exportBase}&format=pdf`} className="block rounded px-2 py-1 hover:bg-sand-100">PDF</a></li></ul>
        </Popover>
      </div>
      {/* The group path now sits in the toolbar row, so it never changes the page height. */}
      <div ref={wrapRef} style={boxH ? { maxHeight: boxH } : undefined} className="relative max-h-[calc(100vh-var(--top,56px)-170px)] overflow-auto" tabIndex={0} aria-label="Trial balance table, scrolls both ways">
        <table ref={tableRef} className={`w-full border-separate border-spacing-0 ${compact ? "text-[12.5px]" : "text-[13px]"}`}>
          {/* Headings stay on top while the table scrolls; "Change from prior" spans $ and %. */}
          <thead className="sticky top-0 z-[2] bg-sand-50 text-[11px] tracking-[.04em] text-ink-2 uppercase [&_th]:bg-sand-50">
            {shown.some(([k]) => k === "diff" || k === "pct") && <tr>
              <th className={sticky} style={{ width: 70 }} /><th className={sticky} style={pin ? { left: 70 } : undefined} />
              {shown.map(([k]) => k === "diff" || (k === "pct" && !shown.some(([x]) => x === "diff")) ? <th key={k} colSpan={shown.filter(([x]) => x === "diff" || x === "pct").length} className="border-b border-sand-200 border-l px-2.5 pt-1.5 pb-0.5 text-right text-[10.5px] font-semibold">Change from prior</th> : k === "pct" ? null : <th key={k} />)}<th />
            </tr>}
            <tr>
            <th className={`border-b-2 border-navy-700 py-1.5 pl-3 text-left font-semibold ${sticky}`} style={{ width: 70 }}>No.</th>
            <th className={`border-b-2 border-navy-700 px-2 py-1.5 text-left font-semibold ${sticky}`} style={pin ? { left: 70 } : undefined}>Account</th>
            {shown.map(([k, l]) => <th key={k} className={`border-b-2 border-navy-700 px-2.5 py-1.5 text-right font-semibold whitespace-nowrap ${k === "diff" ? "border-l border-l-sand-200" : ""}`}>{k === "diff" ? "$" : k === "pct" ? "%" : l}</th>)}<th className="border-b-2 border-navy-700" />
          </tr></thead>
          <tbody>
            {filtered.map((g, gi) => {
              const open = !closed.has(g.code);
              const section = grouped && (gi === 0 || filtered[gi - 1].section !== g.section) ? g.section : "";
              const path = `${g.section} › ${g.name}`;
              // Accounting review: a group total is the whole group's, whatever the filters show (CaseWare's Data page).
              const allRows = groups.find((x) => x.code === g.code)?.rows ?? g.rows;
              const tot = { prelim: sum(allRows, "prelim"), aje: sum(allRows, "aje"), tje: sum(allRows, "tje"), adjust: sum(allRows, "adjust"), reclass: sum(allRows, "reclass"), final: sum(allRows, "final"), last: sum(allRows, "last"), diff: sum(allRows, "diff") };
              return (
                <Fragment key={g.code}>
                  {section && <tr><td colSpan={shown.length + 3} className="bg-white px-3 pt-3 pb-1 text-[10.5px] font-bold tracking-[.1em] text-ink-3 uppercase">{section}</td></tr>}
                  {grouped && <tr data-group-head="" data-path={path} className={`${rowH} cursor-pointer bg-white font-semibold text-navy-700 hover:bg-navy-50`} onClick={() => toggleGroup(g.code)}>
                    <td colSpan={2} className={`px-2 whitespace-nowrap ${sticky}`}><button type="button" aria-expanded={open} onClick={(e) => { e.stopPropagation(); toggleGroup(g.code); }} className="text-left text-[12px] font-bold tracking-[.04em] uppercase">{open ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" aria-hidden /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" aria-hidden />}{hl(g.name)}</button></td>
                    {/* UI1 item 8: a folded group (or groups only) keeps its totals on its own line. */}
                    {open && accts ? <td colSpan={shown.length + 1} /> : <>{shown.map(([k]) => cell(null, k, k === "pct" ? pctOf(tot.final, tot.last) : (tot[k as keyof typeof tot] as number), true))}<td /></>}
                  </tr>}
                  {(!grouped || (open && accts)) && g.rows.map((r) => accountRow(r, path))}
                  {grouped && open && accts && <tr data-group-total={g.code} className={`${rowH} bg-white font-semibold [&>td]:border-t [&>td]:border-b-2 [&>td]:border-sand-300`}>
                    <td className={sticky} /><td className={`px-2 ${sticky}`} style={pin ? { left: 70 } : undefined}>Total {g.name.toLowerCase()}</td>
                    {shown.map(([k]) => cell(null, k, k === "pct" ? pctOf(tot.final, tot.last) : (tot[k as keyof typeof tot] as number), true))}<td />
                  </tr>}
                </Fragment>
              );
            })}
            {!filtered.length && <tr><td colSpan={shown.length + 3} className="px-3 py-3 text-ink-3">Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>
      {/* D6: the balance check stays in view at the bottom of the screen while the table is on it. */}
      <div ref={footRef} className={`sticky bottom-0 z-[3] flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-sand-200 px-3 py-2 text-[13px] ${outs.length ? "bg-warning-soft text-warning" : "bg-white"}`} data-tb-foot role={outs.length ? "status" : undefined}>
        <b className="font-semibold">Out of balance</b>
        {outs.length ? <span>{outs.join(". ")}.</span>
          : <span className="inline-flex items-center gap-1 text-success">0.00<Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden /> Debits equal credits</span>}
        <span className="ml-auto text-ink-2">{wide && "Scroll sideways for more columns. No. and Account stay in place. "}% change is worked out on the size of the balance.</span>
      </div>
      {panel && <AccountPanel fileId={fileId} a={panel} view={view} year={year} canReview={canReview} editable={editable} onClose={closePanel} noteStep={noteStep} />}
    </section>
  );
}
