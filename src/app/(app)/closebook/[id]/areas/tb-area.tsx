// Round 15: the Trial balance tab, as CaseWare Cloud's Data page. Groups (the lead sheets, blue rows with
// their totals) open by default; Accounts is the flat list in account number order; GIFI lines groups the
// accounts under their line. The drill-down goes level by level with a path back, in the right panel:
// a Prelim or Final amount opens the account's postings (a posting opens its source); an Adjust or
// Reclass amount opens the entries on the account (an entry opens on the Entries tab, marked).
import Link from "next/link";
import { ExternalLink, X } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { flagged, NO_FLAG_TAX, reclassNote } from "@/lib/closebook/matching";
import { KIND_LABEL, ledger, NI_LAST, pctChange, tbByGroup, trialBalance, type TbLine } from "@/lib/closebook/reports";
import type { ReportData } from "@/lib/closebook/report-data";
import type { CbAccount, CbEntry } from "@/lib/closebook/server";
import type { CbFileRow } from "@/lib/closebook/files";
import type { ReviewNote } from "@/lib/closebook/review-server";
import { PageTitle } from "../shell/shell";
import { TB_HELP } from "../shell/help";
import { TbTable, type TbRow, type TbGroupRow } from "./tb-table";

const SECTION: Record<number, string> = { 0: "Assets", 1: "Liabilities", 2: "Equity", 3: "Revenue", 4: "Expenses" };
const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
// No year-over-year flag on retained earnings at the start of the year (Hashim, round 15).
export const noFlagLine = (line_no: string | null) => /^36(00|60)/.test(line_no ?? "");

export function TbArea({ fileId, data, file, accounts, notes, isOwner, editable, view, drill, col, flag, lineTax }: {
  fileId: string; data: ReportData; file: CbFileRow; accounts: CbAccount[]; entries: CbEntry[]; notes: ReviewNote[]; isOwner: boolean; editable: boolean;
  view: "groups" | "accounts" | "gifi"; drill?: string; col?: string; flag: { amount: number; percent: number };
  lineTax?: Map<string, string | null>;   // piece 6: each GIFI line's default tax code (INCTAX and AMORT lines are never flagged)
}) {
  const base = `/closebook/${fileId}`;
  const tb = trialBalance(data.accounts, data.postings);
  const y = Number(file.year_end.slice(0, 4));
  // Each report account's file account (for notes, the reviewer and the GIFI match).
  const idOf = new Map<string, CbAccount>();
  for (const a of accounts) { const k = data.acctOf(a.id)?.key ?? a.account_key; if (!idOf.has(k)) idOf.set(k, a); }
  const openNotes = new Map<string, number>();
  for (const n of notes) if (n.target_type === "account" && n.status !== "cleared" && n.target_id) openNotes.set(n.target_id, (openNotes.get(n.target_id) ?? 0) + 1);
  // Adjustments split by kind (Options: split adjustments into AJE, RJE and TJE columns).
  const byKind = new Map<string, { aje: number; tje: number }>();
  for (const p of data.postings) if (p.kind === "entry" && p.entryKind !== "RJE") { const k = byKind.get(p.key) ?? { aje: 0, tje: 0 }; if (p.entryKind === "TJE") k.tje += p.cents; else k.aje += p.cents; byKind.set(p.key, k); }
  const gifiName = new Map<string, string>();
  const row = (t: TbLine): TbRow => {
    const a = idOf.get(t.key);
    const k = byKind.get(t.key) ?? { aje: 0, tje: 0 };
    // Piece 6: the flag leaves out this year's tax entries and never applies to INCTAX or AMORT accounts.
    const taxFree = !!lineTax && NO_FLAG_TAX.includes(a?.tax_code ?? lineTax.get(t.line_no ?? "") ?? "");
    const isFlag = t.key !== NI_LAST && !noFlagLine(t.line_no) && !taxFree && flagged(t.last / 100, (t.final - (lineTax ? k.tje : 0)) / 100, flag.amount, flag.percent);
    return { key: t.key, id: a?.id ?? "", number: t.number, name: t.name, gifi: (t.line_no ?? "").replace(/\.00$/, ""), prelim: t.prelim, aje: k.aje, tje: k.tje, adjust: t.adjust, reclass: t.reclass,
      final: t.final, last: t.last, diff: t.diff, pct: pctChange(t.final, t.last), flagged: isFlag, lastFrom: reclassNote(a?.last_year_line, t.line_no), notes: a ? openNotes.get(a.id) ?? 0 : 0, reviewer: !!a?.needs_reviewer, drillable: t.key !== NI_LAST };
  };
  const { groups } = tbByGroup(tb, data.info);
  const sectionOf = (g: { rows: TbLine[]; code: string }) => {
    if (g.code === NI_LAST) return "Last year";
    const t = data.info(g.rows[0]?.line_no ?? null)?.type;
    const order: Record<string, number> = { Asset: 0, Liability: 1, Equity: 2, Revenue: 3, Expense: 4 };
    return t ? SECTION[order[t]] ?? "Other" : "Not yet sorted";
  };
  let tableGroups: TbGroupRow[];
  if (view === "accounts") {
    tableGroups = [{ code: "all", name: "", section: "", rows: [...tb].sort((a, b) => Number(!a.number) - Number(!b.number) || a.number.localeCompare(b.number, "en", { numeric: true })).map(row) }];
  } else if (view === "gifi") {
    const by = new Map<string, TbLine[]>();
    for (const t of tb) { const g = (t.line_no ?? "").slice(0, 4) || "—"; by.set(g, [...(by.get(g) ?? []), t]); }
    for (const l of accounts) if (l.line_no && !gifiName.has(l.line_no.slice(0, 4))) gifiName.set(l.line_no.slice(0, 4), "");
    tableGroups = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([g, rows]) => {
      const t = data.info(rows[0].line_no);
      const order: Record<string, number> = { Asset: 0, Liability: 1, Equity: 2, Revenue: 3, Expense: 4 };
      return { code: g, name: g === "—" ? "No GIFI line" : `GIFI ${g}`, section: t ? SECTION[order[t.type]] ?? "Other" : "Not yet sorted", rows: rows.map(row) };
    });
  } else {
    tableGroups = groups.map((g) => ({ code: g.code, name: g.name, section: sectionOf(g), rows: g.rows.map(row) }));
  }
  const drillPanel = drill ? <Drill fileId={fileId} data={data} tb={tb} drill={drill} col={col ?? "final"} view={view} /> : null;
  return (
    <>
      <PageTitle help={TB_HELP} right={<span className="text-[12.5px] text-ink-3">{formatDate(file.year_start)} to {formatDate(file.year_end)}</span>}>
        Trial balance · {view === "accounts" ? "Accounts" : view === "gifi" ? "GIFI lines" : "Groups"}</PageTitle>
      <TbTable fileId={fileId} groups={tableGroups} view={view} year={y} isOwner={isOwner} editable={editable}
        exportBase={`${base}/report-export?report=tb${view === "accounts" ? "&view=flat" : ""}`} />
      {drillPanel}
    </>
  );
}

// The drill panel: one level, with the path back to the trial balance.
function Drill({ fileId, data, tb, drill, col, view }: { fileId: string; data: ReportData; tb: TbLine[]; drill: string; col: string; view: string }) {
  const base = `/closebook/${fileId}`;
  const t = tb.find((x) => x.key === drill);
  if (!t) return null;
  const here = `${base}?area=tb&tbv=${view}&drill=${encodeURIComponent(drill)}&col=${col}`;
  const close = `${base}?area=tb&tbv=${view}#a-${encodeURIComponent(drill)}`;
  const label = `${t.number ? `${t.number} ` : ""}${t.name}`;
  const COL: Record<string, string> = { prelim: "Prelim", final: "Final", adjust: "Adjust", reclass: "Reclass" };
  const withBack = (href: string) => `${href}${href.includes("?") ? "&" : "?"}back=${encodeURIComponent(here)}`;
  const entryHref = (ref: string) => withBack(`${base}?area=entries&entry=${ref}`) + `#entry-${ref}`;
  const sourceHref = (kind: string, ref: string, acct?: string) => kind === "bank" ? withBack(`${base}?step=code&account=${acct}&line=${ref}`) + `#line-${ref}`
    : kind === "entry" ? entryHref(ref) : kind === "import" ? withBack(`${base}?step=records`) : ref.startsWith("stmt:") ? withBack(`${base}?step=records&account=${ref.slice(5)}`) : withBack(`${base}?step=opening`);
  let body: React.ReactNode;
  if (col === "adjust" || col === "reclass") {
    const lines = data.postings.filter((p) => p.key === drill && p.kind === "entry" && (col === "reclass" ? p.entryKind === "RJE" : p.entryKind !== "RJE"));
    body = (
      <table className="w-full text-[12.5px]"><thead><tr className="bg-sand-50 text-left text-[11px] text-ink-3"><th className="px-3 py-1.5 font-semibold">Entry</th><th className="px-2 py-1.5 font-semibold">Description</th><th className="px-3 py-1.5 text-right font-semibold">Debit</th><th className="px-3 py-1.5 text-right font-semibold">Credit</th></tr></thead>
        <tbody>{lines.map((p, i) => <tr key={i} className="border-t border-sand-100"><td className="px-3 py-1.5 whitespace-nowrap"><Link href={entryHref(p.ref)} className="text-navy-700 hover:underline">{data.entryLabel.get(p.ref) ?? KIND_LABEL.entry}</Link></td>
          <td className="px-2 py-1.5">{p.label.replace(/^\S+ \w+: /, "")}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.cents > 0 ? money(p.cents) : ""}</td><td className="px-3 py-1.5 text-right tabular-nums">{p.cents < 0 ? money(-p.cents) : ""}</td></tr>)}
          {!lines.length && <tr><td colSpan={4} className="px-3 py-2 text-ink-3">None.</td></tr>}</tbody></table>
    );
  } else {
    const [acct] = ledger(data.accounts, data.postings.filter((p) => col !== "prelim" || p.kind !== "entry"), { key: drill });
    const dr = acct?.lines.reduce((n, l) => n + Math.max(l.cents, 0), 0) ?? 0, cr = acct?.lines.reduce((n, l) => n + Math.max(-l.cents, 0), 0) ?? 0;
    body = (
      <table className="w-full text-[12.5px]"><thead><tr className="bg-sand-50 text-left text-[11px] text-ink-3"><th className="px-3 py-1.5 font-semibold">Date</th><th className="px-2 py-1.5 font-semibold">Source</th><th className="px-2 py-1.5 font-semibold">Description</th><th className="px-3 py-1.5 text-right font-semibold">Debit</th><th className="px-3 py-1.5 text-right font-semibold">Credit</th></tr></thead>
        <tbody>{(acct?.lines ?? []).map((l, i) => (
          <tr key={i} className="border-t border-sand-100"><td className="px-3 py-1.5 whitespace-nowrap">{l.date ? formatDate(l.date) : ""}</td>
            <td className="px-2 py-1.5 whitespace-nowrap"><Link href={sourceHref(l.kind, l.ref, l.acct)} className="text-navy-700 hover:underline">{l.kind === "entry" ? data.entryLabel.get(l.ref) ?? KIND_LABEL.entry : l.kind === "bank" ? "Bank line" : KIND_LABEL[l.kind]}</Link></td>
            <td className="px-2 py-1.5">{l.kind === "entry" ? l.label.replace(/^\S+ \w+: /, "") : l.label}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{l.cents > 0 ? money(l.cents) : ""}</td><td className="px-3 py-1.5 text-right tabular-nums">{l.cents < 0 ? money(-l.cents) : ""}</td></tr>))}
          <tr className="border-t border-ink font-bold"><td colSpan={3} className="px-3 py-1.5">Totals</td><td className="px-3 py-1.5 text-right tabular-nums">{money(dr)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(cr)}</td></tr>
          <tr className="font-bold"><td colSpan={3} className="px-3 py-1.5">Balance, {dr - cr >= 0 ? "debit" : "credit"}</td><td className="px-3 py-1.5 text-right tabular-nums">{dr - cr >= 0 ? money(dr - cr) : ""}</td><td className="px-3 py-1.5 text-right tabular-nums">{dr - cr < 0 ? money(cr - dr) : ""}</td></tr>
        </tbody></table>
    );
  }
  return (
    <aside aria-label="Drill-down" className="fixed top-[146px] right-0 bottom-0 z-20 flex w-[480px] max-w-full flex-col border-l border-sand-300 bg-white shadow-[-8px_0_24px_rgba(15,35,80,.10)]">
      <div className="flex items-start gap-2 border-b border-sand-200 px-4 py-2.5">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold"><Link href={close} className="text-navy-700 hover:underline">Trial balance</Link> <span className="text-ink-3">›</span> <span className="text-ink">{label} · {COL[col] ?? "Final"} {col === "prelim" || col === "final" ? "" : ""}</span></p>
        <Link href={`${base}?report=gl&account=${encodeURIComponent(drill)}&back=${encodeURIComponent(here)}`} className="inline-flex items-center gap-1 text-xs text-navy-700 hover:underline"><ExternalLink className="h-3.5 w-3.5" />Open full page</Link>
        <Link href={`${base}?area=tb&tool=reclassify&account=${encodeURIComponent(drill)}`} className="text-xs text-navy-700 hover:underline" data-drill-reclassify>Reclassify</Link>
        <Link href={close} aria-label="Close" className="rounded p-0.5 text-ink-2 hover:bg-sand-100"><X className="h-4 w-4" /></Link>
      </div>
      <div className="flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}
