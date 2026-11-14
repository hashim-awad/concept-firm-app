"use client";
// Round 15: the trial balance table, as CaseWare Cloud's Data page. One toolbar of dropdowns: Columns
// (show, hide, pin), Options (suppress zero balances, accounts on or off, split adjustments into AJE and
// TJE), Filters (amount range, flagged, with notes), Collapse all, Search (highlights as you type) and
// one export icon. Groups are blue rows with their totals; the group of the first visible row stays at
// the top while scrolling. "Out of balance" shows only when it is.
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Download, Flag, MessageSquare, Pencil, Plus, Search } from "lucide-react";
import { addNote, askReviewerInline } from "../../actions";
import { Popover } from "../shell/ui";

export type TbRow = { key: string; id: string; number: string; name: string; gifi: string; prelim: number; aje: number; tje: number; adjust: number; reclass: number;
  final: number; last: number; diff: number; pct: string; flagged: boolean; notes: number; reviewer: boolean; drillable: boolean };
export type TbGroupRow = { code: string; name: string; section: string; rows: TbRow[] };
type ColKey = "prelim" | "adjust" | "aje" | "tje" | "reclass" | "final" | "last" | "diff" | "pct";

const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pctOf = (final: number, prior: number) => (!prior ? (final ? "n/a" : "–") : final && (final > 0) !== (prior > 0) ? "n/m" : `${(((Math.abs(final) - Math.abs(prior)) / Math.abs(prior)) * 100).toFixed(1)}%`);
const DRILL: Partial<Record<ColKey, string>> = { prelim: "prelim", adjust: "adjust", aje: "adjust", tje: "adjust", reclass: "reclass", final: "final" };

export function TbTable({ fileId, groups, view, year, isOwner, editable, exportBase }: {
  fileId: string; groups: TbGroupRow[]; view: "groups" | "accounts" | "gifi"; year: number; isOwner: boolean; editable: boolean; exportBase: string;
}) {
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set());
  const [pin, setPin] = useState(true);
  const [zero, setZero] = useState(false);
  const [accts, setAccts] = useState(true);
  const [split, setSplit] = useState(false);
  const [min, setMin] = useState(""), [max, setMax] = useState("");
  const [onlyFlags, setOnlyFlags] = useState(false), [onlyNotes, setOnlyNotes] = useState(false);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [path, setPath] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ key: string; text: string } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);
  const grouped = view !== "accounts";

  const cols: [ColKey, string][] = [["prelim", `Prelim ${year}`], ...(split ? [["aje", "AJE"], ["tje", "TJE"]] as [ColKey, string][] : [["adjust", "Adjust"]] as [ColKey, string][]),
    ["reclass", "Reclass"], ["final", `Final ${year}`], ["last", `Prior ${year - 1}`], ["diff", "$ change"], ["pct", "% change"]];
  const shown = cols.filter(([k]) => !hidden.has(k) && !(split && hidden.has("adjust") && (k === "aje" || k === "tje")));
  const lo = min ? Math.round(Number(min.replace(/[$,\s]/g, "")) * 100) : null, hi = max ? Math.round(Number(max.replace(/[$,\s]/g, "")) * 100) : null;
  const keep = (r: TbRow) => (!zero || r.final || r.last || r.prelim) && (!onlyFlags || r.flagged || r.reviewer) && (!onlyNotes || r.notes > 0)
    && (lo === null || Math.abs(r.final) >= lo) && (hi === null || Math.abs(r.final) <= hi);
  const match = (s: string) => !!q && s.toLowerCase().includes(q.toLowerCase());
  const filtered = groups.map((g) => ({ ...g, rows: g.rows.filter(keep) })).filter((g) => g.rows.length);
  const sum = (rows: TbRow[], k: ColKey) => rows.reduce((n, r) => n + (r[k as keyof TbRow] as number), 0);
  const all = groups.flatMap((g) => g.rows);
  const out = sum(all, "final"), outPrelim = sum(all, "prelim");

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
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [grouped, filtered]);

  const hl = (s: string) => {
    if (!q) return s;
    const i = s.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? s : <>{s.slice(0, i)}<mark className="rounded-sm bg-[#fff2a8] px-px text-inherit">{s.slice(i, i + q.length)}</mark>{s.slice(i + q.length)}</>;
  };
  const drillHref = (r: TbRow, k: ColKey) => `/closebook/${fileId}?area=tb&tbv=${view}&drill=${encodeURIComponent(r.key)}&col=${DRILL[k]}`;
  const cell = (r: TbRow | null, k: ColKey, v: number | string, bold = false) => {
    const isNum = k !== "pct";
    const text = isNum ? money(v as number) : (v as string);
    const linkable = r && r.drillable && DRILL[k] && v;
    return <td key={k} className={`px-2.5 py-[5px] text-right whitespace-nowrap tabular-nums ${bold ? "font-bold" : ""} ${k === "diff" || k === "pct" ? "bg-[#f7f8fb]" : ""}`}>
      {linkable ? <Link href={drillHref(r!, k)} scroll={false} className="text-navy-700 hover:underline">{text}</Link> : text}</td>;
  };
  const sticky = pin ? "sticky left-0 z-[1] bg-inherit" : "";
  const toolbtn = "inline-flex items-center gap-1 rounded-md border border-sand-300 bg-white px-2 py-1 text-xs text-ink hover:bg-sand-50";
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
    <td className="w-[1%] px-2 text-right whitespace-nowrap text-[#9aa0ae]">
      {r.id && editable ? <span className="inline-flex items-center gap-2">
        <Link href={`/closebook/${fileId}?step=entries&newfor=${r.id}#new-entry`} title="New entry on this account" aria-label={`New entry on ${r.name}`} className="hover:text-navy-700"><Plus className="h-3.5 w-3.5" /></Link>
        {isOwner ? (
          <Popover align="right" width="w-80" label={r.notes ? `${r.notes} review note${r.notes === 1 ? "" : "s"}` : "Add review note"}
            button={<span className={`relative ${r.notes ? "text-danger" : "hover:text-navy-700"}`}><MessageSquare className="h-3.5 w-3.5" fill={r.notes ? "currentColor" : "none"} />{r.notes > 0 && <span className="absolute -top-2 -right-1.5 text-[9px] font-bold">{r.notes}</span>}</span>}>
            <form action={addNote} className="grid gap-2 text-left">
              <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="step" value="mapping" /><input type="hidden" name="target_type" value="account" />
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
          className={r.reviewer || r.flagged ? "text-warning" : "hover:text-navy-700"}><Flag className="h-3.5 w-3.5" fill={r.reviewer ? "currentColor" : "none"} /></button>
        <Link href={`/closebook/${fileId}?step=mapping&edit=${r.id}`} title="Change the GIFI line" aria-label={`Change the GIFI line of ${r.name}`} className="hover:text-navy-700"><Pencil className="h-3.5 w-3.5" /></Link>
      </span> : r.flagged ? <Flag className="inline h-3.5 w-3.5 text-warning" /> : null}
      {msg?.key === r.key && <span className={`ml-2 text-[11px] ${msg.text === "Sent to the reviewer." ? "text-success" : "text-danger"}`}>{msg.text}</span>}
    </td>
  );
  const accountRow = (r: TbRow, path: string) => (
    <tr key={r.key} id={`a-${r.key}`} data-path={path} className={`bg-white target:bg-navy-50 ${r.flagged ? "shadow-[inset_3px_0_0_#e0b04a]" : ""} ${match(`${r.number} ${r.name}`) ? "bg-[#fffbe0]" : ""}`}>
      <td className={`py-[5px] pr-1 pl-${grouped ? "8" : "3"} whitespace-nowrap text-ink-2 tabular-nums ${sticky}`} style={{ paddingLeft: grouped ? 30 : 12 }}>{hl(r.number)}</td>
      <td className={`px-2 py-[5px] ${sticky}`} style={pin ? { left: 70 } : undefined}>{hl(r.name)}{view === "accounts" && r.gifi && <span className="ml-2 text-[11px] text-ink-3">GIFI {r.gifi}</span>}</td>
      {shown.map(([k]) => cell(r, k, k === "pct" ? r.pct : (r[k] as number)))}
      {icons(r)}
    </tr>
  );
  return (
    <section className="rounded-[10px] border border-sand-200 bg-white" aria-label="Trial balance">
      <div className="sticky top-[90px] z-10 flex flex-wrap items-center gap-1.5 rounded-t-[10px] border-b border-sand-200 bg-white px-3 py-2">
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
            {check("Flagged or with the reviewer", onlyFlags, setOnlyFlags)}{check("With review notes", onlyNotes, setOnlyNotes)}
          </div>
        </Popover>
        {grouped && <button type="button" className={toolbtn} onClick={() => setClosed(anyClosed ? new Set() : new Set(filtered.map((g) => g.code)))}>
          {anyClosed ? <><ChevronsUpDown className="h-3 w-3" />Expand all</> : <><ChevronsDownUp className="h-3 w-3" />Collapse all</>}</button>}
        <span className="flex-1" />
        <label className="inline-flex w-56 items-center gap-1.5 rounded-md border border-sand-300 bg-white px-2 py-1 text-xs focus-within:border-navy-600">
          <Search className="h-3.5 w-3.5 text-ink-3" aria-hidden /><span className="sr-only">Search</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="min-w-0 flex-1 bg-transparent outline-none" />
        </label>
        <Popover align="right" width="w-40" label="Export" button={<span className="grid h-7 w-7 place-items-center rounded-md text-ink-2 hover:bg-sand-100"><Download className="h-4 w-4" /></span>}>
          <ul className="grid gap-1"><li><a href={`${exportBase}&format=xlsx`} className="block rounded px-2 py-1 hover:bg-sand-100">Excel</a></li><li><a href={`${exportBase}&format=pdf`} className="block rounded px-2 py-1 hover:bg-sand-100">PDF</a></li></ul>
        </Popover>
      </div>
      {grouped && path && <div className="sticky top-[136px] z-10 flex items-center gap-1.5 border-b border-navy-200 bg-navy-100 px-3 py-1.5 text-xs font-semibold text-navy-800"><ChevronRight className="h-3 w-3" />{path}</div>}
      <div className="overflow-x-auto">
        <table ref={tableRef} className="w-full border-collapse text-[12.5px]">
          <thead><tr className="bg-sand-50 text-[11px] text-ink-3">
            <th className={`py-1.5 pl-3 text-left font-semibold ${sticky}`} style={{ width: 70 }}>No.</th>
            <th className={`px-2 py-1.5 text-left font-semibold ${sticky}`} style={pin ? { left: 70 } : undefined}>Account
              {(out !== 0 || outPrelim !== 0) && <span className="ml-3 font-bold text-danger">Out of balance {money(out || outPrelim)}</span>}</th>
            {shown.map(([k, l]) => <th key={k} className="px-2.5 py-1.5 text-right font-semibold whitespace-nowrap">{l}</th>)}<th />
          </tr></thead>
          <tbody>
            {filtered.map((g, gi) => {
              const open = !closed.has(g.code);
              const section = grouped && (gi === 0 || filtered[gi - 1].section !== g.section) ? g.section : "";
              const path = `${g.section} › ${g.name}`;
              const tot = { prelim: sum(g.rows, "prelim"), aje: sum(g.rows, "aje"), tje: sum(g.rows, "tje"), adjust: sum(g.rows, "adjust"), reclass: sum(g.rows, "reclass"), final: sum(g.rows, "final"), last: sum(g.rows, "last"), diff: sum(g.rows, "diff") };
              return (
                <Fragment key={g.code}>
                  {section && <tr><td colSpan={shown.length + 3} className="bg-white px-3 pt-3 pb-1 text-[10.5px] font-bold tracking-[.1em] text-ink-3 uppercase">{section}</td></tr>}
                  {grouped && <tr data-group-head="" data-path={path} className="cursor-pointer border-b border-navy-100 bg-navy-50 font-bold text-navy-700 hover:bg-navy-100" onClick={() => toggleGroup(g.code)}>
                    <td colSpan={2} className={`px-2 py-[5px] whitespace-nowrap ${sticky}`}>{open ? <ChevronDown className="mr-1 inline h-3.5 w-3.5" /> : <ChevronRight className="mr-1 inline h-3.5 w-3.5" />}{hl(g.name)}</td>
                    {shown.map(([k]) => cell(null, k, k === "pct" ? pctOf(tot.final, tot.last) : (tot[k as keyof typeof tot] as number), true))}<td />
                  </tr>}
                  {(!grouped || (open && accts)) && g.rows.map((r) => accountRow(r, path))}
                </Fragment>
              );
            })}
            {!filtered.length && <tr><td colSpan={shown.length + 3} className="px-3 py-3 text-ink-3">Nothing matches.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}
