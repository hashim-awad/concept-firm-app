"use client";
// Piece R1 (Hashim, Nov 19, 2026; mock M; benchmark QuickBooks Online Workpapers > Tax mapping): step 8's first paper,
// "Match accounts to GIFI". The accounts that need a decision in one amber box above (hidden when empty); one table,
// GIFI LINE | ACCOUNTS | AMOUNT, one row per GIFI line with a balance in GIFI order, opened to show its accounts each
// with a pencil, then a Total row; one ties line under it. No filters, no extra columns, no notes. The pencil and each
// box line open the existing Change window over the page; Save or Cancel returns to the same row, still open.
import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ChevronRight, Pencil } from "lucide-react";
import { Panel, type Option, type Row } from "./accounts-table";
import type { MatchRow, TieItem } from "@/lib/closebook/match-gifi";

export type BoxItem = { row: Row; why: string; cents: number; kind: string; fix?: { href: string; label: string } };

const amt = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };

export function MatchStep({ fileId, rows, panelRows, box, ties, options, groupOptions, taxes, isReviewer, editable }: {
  fileId: string; rows: MatchRow[]; panelRows: Record<string, Row>; box: BoxItem[]; ties: TieItem[]; options: Option[]; groupOptions: Option[]; taxes: { code: string; name: string }[];
  isReviewer: boolean; editable: boolean;
}) {
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<{ r: Row; mode: "override" | "group" } | null>(null);
  const toggle = (code: string) => setShown((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const pencil = (r: Row, mode: "override" | "group" = "override") => editable && (
    <button type="button" onClick={() => setOpen({ r, mode })} title="Change the GIFI line" aria-label={`Change the GIFI line: ${r.name}`}
      className="rounded p-1.5 text-ink-3 hover:bg-sand-100 hover:text-navy-700"><Pencil className="h-4 w-4" /></button>
  );
  return (
    <div className="grid gap-4" data-match-paper>
      {box.length > 0 && (
        <section aria-label="Accounts that need a decision" className="overflow-x-auto rounded-lg border border-warning/50 bg-warning-soft/40" data-match-box>
          <p className="flex items-center gap-2 px-4 pt-3 pb-1.5 font-medium"><AlertCircle className="h-5 w-5 text-warning" aria-hidden />
            {box.length} account{box.length === 1 ? " needs" : "s need"} a decision</p>
          <table className="table table-compact">
            <thead><tr><th>Account</th><th>Why</th><th className="w-36 text-right">Amount</th><th className="w-40"></th></tr></thead>
            <tbody>{box.map((b) => (
              <tr key={b.row.id} data-box-row={b.kind}>
                <td className="whitespace-nowrap">{b.row.number && <span className="mr-2 text-ink-3 tabular-nums">{b.row.number}</span>}{b.row.name}</td>
                <td className="text-sm">{b.why}</td>
                <td className="text-right tabular-nums">{amt(b.cents)}</td>
                <td className="text-right">{b.fix ? <Link href={b.fix.href} className="text-sm text-navy-700 underline">{b.fix.label}</Link>
                  : b.kind === "no_group" ? (editable && <button type="button" onClick={() => setOpen({ r: b.row, mode: "group" })} className="text-sm text-navy-700 underline">Choose a group</button>)
                  : b.kind === "reviewer" && !isReviewer ? <span className="text-xs text-ink-3">With the reviewer</span>
                  : pencil(b.row)}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}

      <section aria-label="GIFI lines" className="card overflow-x-auto p-0">
        <table className="table table-compact">
          <thead><tr><th>GIFI line</th><th>Accounts</th><th className="w-40 text-right">Amount</th><th className="w-10"></th></tr></thead>
          <tbody>{rows.map((g) => {
            const on = shown.has(g.code);
            return [
              <tr key={g.code} className="cursor-pointer hover:bg-sand-50" onClick={() => toggle(g.code)} data-gifi-row={g.code}>
                <td><button type="button" aria-expanded={on} onClick={(e) => { e.stopPropagation(); toggle(g.code); }} className="text-left">
                  <ChevronRight className={`mr-1 inline h-4 w-4 transition-transform ${on ? "rotate-90" : ""}`} aria-hidden /><b className="tabular-nums">{g.code}</b> {g.name}</button></td>
                <td className="text-ink-2">({g.accounts.length})</td>
                <td className="text-right tabular-nums">{amt(g.cents)}</td><td />
              </tr>,
              ...(on ? [
                ...g.accounts.map((a) => (
                  <tr key={`${g.code}-${a.id}`} className="bg-sand-50/60 text-sm" data-sub-row={a.id}>
                    <td /><td className="pl-6">{a.label}</td>
                    <td className="text-right tabular-nums">{amt(a.cents)}</td>
                    <td>{panelRows[a.id] && pencil(panelRows[a.id])}</td>
                  </tr>
                )),
                <tr key={`${g.code}-total`} className="bg-sand-50/60 text-sm font-semibold"><td /><td className="pl-6">Total</td>
                  <td className="border-t border-ink text-right tabular-nums">{amt(g.cents)}</td><td /></tr>,
              ] : []),
            ];
          })}</tbody>
        </table>
      </section>

      <p className="text-sm" data-ties>Ties: {ties.map((t, i) => (
        <span key={t.code}>{i > 0 && " · "}{t.ok ? <>{t.label} {amt(t.chart)} = GIFI {t.code} <span className="font-semibold text-success" aria-label="ties">✓</span></>
          : <span className="font-semibold text-danger">{t.label} {amt(t.chart)} · GIFI {t.code} {amt(t.gifi)} · Out of balance {amt(t.diff)}</span>}</span>
      ))}</p>

      {open && <Panel key={open.r.id} fileId={fileId} r={open.r} options={open.mode === "group" ? groupOptions : options} taxes={taxes} isReviewer={isReviewer} onClose={() => setOpen(null)} mode={open.mode} />}
    </div>
  );
}
