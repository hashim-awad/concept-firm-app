// Round 15: the Statements tab, as CaseWare Cloud's Financial statements page. The package on screen,
// with the document map on the left and one print menu (print preview, PDF, Word). Clicking an amount in
// the statements opens "Account details": the accounts that make up the line, with Prelim, Adjust, Final
// and last year, and a highlighted line when ProFile-style rounding moved it. The DRAFT FOR REVIEW stamp
// stays until the reviewer signs step 9.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Printer, X } from "lucide-react";
import { loadPackage } from "@/lib/closebook/fs-server";
import { caption, type FsLine, type FsRow } from "@/lib/closebook/fs-model";
import { lawyerDef, malDef, packageDef } from "@/lib/closebook/fs-pdf";
import { DRAFT } from "@/lib/closebook/fs-text";
import { FS_LETTERHEAD } from "@/lib/closebook/fs-letterhead.generated";
import { trialBalance } from "@/lib/closebook/reports";
import type { ReportData } from "@/lib/closebook/report-data";
import { PageTitle, PanelHead, PanelLink } from "../shell/shell";
import { Popover } from "../shell/ui";
import { pages, renderNode } from "./pdf-html";
import { PrintNow } from "./print-now";

const DOCS: [string, string][] = [["cover", "Cover"], ["report", "Compilation report"], ["bs", "Balance sheet"], ["is", "Statement of earnings"], ["notes", "Notes"], ["mal", "MAL"], ["letter", "Minute book letter"]];
const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
const whole = (v: number) => (v === 0 ? "–" : v < 0 ? `(${Math.abs(v).toLocaleString("en-CA")})` : v.toLocaleString("en-CA"));
// The due to and due from shareholder lines swap sides with the balance (round 14).
const SH_PAIR: Record<string, string> = { "2780": "1300", "3260": "1300", "2781": "1301", "3261": "1301", "2782": "1302", "3262": "1302", "2783": "1303", "3263": "1303", "1300": "2780", "1301": "2781", "1302": "2782", "1303": "2783" };

export async function statementsArea({ supabase, fileId, data, isOwner, sp }: {
  supabase: SupabaseClient; fileId: string; data: ReportData; isOwner: boolean; sp: { doc?: string; line?: string };
}) {
  const base = `/closebook/${fileId}`;
  const doc = DOCS.find(([k]) => k === sp.doc)?.[0] ?? "bs";
  const left = <><PanelHead>Document map</PanelHead>{DOCS.map(([k, l]) => <PanelLink key={k} href={`${base}?area=statements&doc=${k}`} on={k === doc}>{l}</PanelLink>)}</>;
  const pk = await loadPackage(supabase, fileId);
  if (!pk) return { left, content: <><PageTitle>Statements</PageTitle><p className="rounded-[10px] border border-sand-200 bg-white px-4 py-3 text-[12.5px] text-ink-3">No trial balance yet.</p></> };
  const { m } = pk;
  const draft = pk.ctx.draft || !pk.reviewed;
  const ctx = { ...pk.ctx, draft };
  // The statements' lines with the accounts behind them: codes by caption, as the model groups them.
  const { data: gl } = await supabase.from("cb_master_lines").select("gifi_code, gifi_name, statement_line").like("line_no", "%.00");
  const lines = new Map<string, FsLine>(((gl ?? []) as { gifi_code: string; gifi_name: string; statement_line: string }[]).map((x) => [x.gifi_code, { code: x.gifi_code, name: x.gifi_name, caption: x.statement_line ?? "" }]));
  const tb = trialBalance(data.accounts, data.postings);
  const linkOf = (code: string) => `${base}?area=statements&doc=${doc}&line=${encodeURIComponent(code)}`;
  const linkRows = (rows: FsRow[]) => new Map(rows.map((r) => [r.cap, r]));
  const sectionRows: Record<string, FsRow[]> = doc === "bs" ? { a: [...m.bs.ca, ...m.bs.nca, ...m.bs.cl, ...m.bs.ncl, ...m.bs.eq] } : { a: [...m.is.rev, ...m.is.cos, ...m.is.exp] };
  const byCap = linkRows(sectionRows.a);
  // Each statement table's indented rows get a link on this year's amount.
  const decorate = (content: any[]) => content.map((n: any) => {
    if (!n?.table) return n;
    return { ...n, table: { ...n.table, body: n.table.body.map((row: any[]) => {
      const cap = row[0]?.text, indented = Array.isArray(row[0]?.margin) && row[0].margin[0] > 0;
      const r = indented ? byCap.get(cap) : undefined;
      if (!r || r.code === "HST") return row;
      return row.map((c: any, j: number) => (j === 2 ? (c?.stack ? { ...c, stack: [{ ...c.stack[0], link: linkOf(r.code) }, ...c.stack.slice(1)] } : { ...c, link: linkOf(r.code) }) : c));
    }) } };
  });
  const pkg = pages(packageDef(m, ctx, FS_LETTERHEAD).content);
  const content: Record<string, any[]> = { cover: pkg[0] ?? [], report: pkg[1] ?? [], bs: decorate(pkg[2] ?? []), is: decorate(pkg[3] ?? []), notes: pkg[4] ?? [],
    mal: malDef(m, ctx).content, letter: lawyerDef(m, ctx, pk.lawyer, FS_LETTERHEAD).content };
  const pdfDoc = doc === "mal" ? "mal" : doc === "letter" ? "letter" : "fs";

  // Account details for one line.
  let details: React.ReactNode = null;
  if (sp.line && (doc === "bs" || doc === "is")) {
    const row = sectionRows.a.find((r) => r.code === sp.line);
    if (row) {
      const credit = doc === "bs" ? [...m.bs.cl, ...m.bs.ncl, ...m.bs.eq].includes(row) : m.is.rev.includes(row);
      const inRange = (c: string) => { const n = Number(c); const lo = Number(row.code) < 1060 && Number(row.code) >= 1000 ? 1000 : Math.floor(Number(row.code) / 100) * 100; return n >= lo && n < lo + 1000; };
      const codes = new Set<string>();
      for (const t of tb) {
        const c = (t.line_no ?? "").slice(0, 4);
        if (!c) continue;
        const cash = Number(c) >= 1000 && Number(c) < 1060 && row.code === "1000";
        const same = !cash && inRange(c) && caption(lines.get(c), c) === row.cap;
        const pair = SH_PAIR[c] && (SH_PAIR[c] === row.code || c === row.code);
        if (cash || same || pair) codes.add(c);
      }
      // A shareholder code belongs to this line only on the side the line shows (round 14's reclass).
      const debitSide = !credit;
      const accts = tb.filter((t) => codes.has((t.line_no ?? "").slice(0, 4)) && (!SH_PAIR[(t.line_no ?? "").slice(0, 4)] || ((t.final > 0) === debitSide) || t.final === 0 && (t.line_no ?? "").startsWith(row.code)));
      const sum = (k: "prelim" | "adjust" | "reclass" | "final" | "last") => accts.reduce((n, t) => n + t[k], 0);
      const shownTb = (credit ? -1 : 1) * row.cur * 100, shownPri = (credit ? -1 : 1) * row.pri * 100;
      const round = shownTb - sum("final"), roundPri = shownPri - sum("last");
      details = (
        <div role="dialog" aria-label="Account details" className="fixed top-[206px] left-1/2 z-40 w-[680px] max-w-[95vw] -translate-x-1/2 rounded-[10px] border border-sand-300 bg-white shadow-[0_18px_40px_rgba(15,35,80,.22)]">
          <div className="flex items-center gap-2 border-b border-sand-200 px-4 py-2.5">
            <span className="flex-1 text-[13px] font-semibold">Account details · {row.cap}</span>{row.note && <span className="text-xs text-ink-3">Note {row.note}</span>}
            <Link href={`${base}?area=statements&doc=${doc}`} aria-label="Close" className="rounded p-0.5 text-ink-2 hover:bg-sand-100"><X className="h-4 w-4" /></Link>
          </div>
          <table className="w-full text-[12.5px]">
            <thead><tr className="bg-sand-50 text-[11px] text-ink-3"><th className="px-3 py-1.5 text-left font-semibold">Account</th><th className="px-3 py-1.5 text-right font-semibold">Prelim</th><th className="px-3 py-1.5 text-right font-semibold">Adjust</th><th className="px-3 py-1.5 text-right font-semibold">Final {m.y}</th>{m.hasPrior && <th className="px-3 py-1.5 text-right font-semibold">{m.py}</th>}</tr></thead>
            <tbody>
              {accts.map((t) => <tr key={t.key} className="border-t border-sand-100"><td className="px-3 py-1.5"><Link href={`${base}?area=tb&tbv=groups&drill=${encodeURIComponent(t.key)}&col=final&back=${encodeURIComponent(`${base}?area=statements&doc=${doc}`)}`} className="text-navy-700 hover:underline">{t.number ? `${t.number} ` : ""}{t.name}</Link></td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(t.prelim)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(t.adjust + t.reclass)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(t.final)}</td>{m.hasPrior && <td className="px-3 py-1.5 text-right tabular-nums">{money(t.last)}</td>}</tr>)}
              {(round !== 0 || (m.hasPrior && roundPri !== 0)) && <tr className="bg-[#fff6d6] font-semibold"><td className="px-3 py-1.5">Rounded to the dollar, ProFile&rsquo;s way</td><td /><td /><td className="px-3 py-1.5 text-right tabular-nums">{round ? money(round) : ""}</td>{m.hasPrior && <td className="px-3 py-1.5 text-right tabular-nums">{roundPri ? money(roundPri) : ""}</td>}</tr>}
              <tr className="border-t border-ink font-bold"><td className="px-3 py-1.5">On the statement</td><td /><td /><td className="px-3 py-1.5 text-right tabular-nums">{whole(credit ? -row.cur : row.cur)}</td>{m.hasPrior && <td className="px-3 py-1.5 text-right tabular-nums">{whole(credit ? -row.pri : row.pri)}</td>}</tr>
            </tbody>
          </table>
        </div>
      );
    }
  }
  const print = (
    <Popover align="right" width="w-44" label="Print" button={<span className="btn-secondary btn-compact"><Printer className="h-3.5 w-3.5" />Print</span>}>
      <ul className="grid gap-1">
        <li><PrintNow /></li>
        <li><a href={`${base}/package?doc=${pdfDoc}&format=pdf`} className="block rounded px-2 py-1 hover:bg-sand-100">PDF</a></li>
        {isOwner && <li><a href={`${base}/package?doc=${pdfDoc}&format=docx`} className="block rounded px-2 py-1 hover:bg-sand-100">Word</a></li>}
      </ul>
    </Popover>
  );
  const page = (
    <div className="mx-auto w-[820px] max-w-full border border-sand-200 bg-white px-[72px] py-12 text-[11.7px] leading-[1.35] text-black shadow-[0_2px_10px_rgba(0,0,0,.05)] print:border-0 print:shadow-none" style={{ fontFamily: "Helvetica, Arial, sans-serif" }}>
      {draft && <p className="mb-6 text-[10.4px] font-bold text-[#C00000]">{DRAFT}</p>}
      {(content[doc] ?? []).map((n, i) => <div key={i}>{renderNode(n, { lh: FS_LETTERHEAD })}</div>)}
    </div>
  );
  const body = (
    <>
      <PageTitle right={print}>Statements · {DOCS.find(([k]) => k === doc)![1]}</PageTitle>
      {pk.blocked.length > 0 && <p className="mb-2 text-[12.5px] text-danger">Stopped: {pk.blocked[0]}</p>}
      {page}
      {details}
    </>
  );
  return { left, content: body };
}
