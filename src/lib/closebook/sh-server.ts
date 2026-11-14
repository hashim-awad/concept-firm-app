import "server-only";
// Round 14: the shareholder loan schedule, worked out live from the postings the reports use, with the
// state saved when the preparer prepares it (cb_sh_*). Benchmark: CaseWare's continuity working paper.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbAccount, CbEntry } from "./server";
import type { CbFileRow } from "./files";
import { loadReportData } from "./report-data";
import { keepsOwnBooks } from "./books";
import { buildGroups, buildSchedules, CHART_SHAREHOLDER, type ShEntryInfo, type ShFlag, type ShGroup, type ShSchedule } from "./sh-loans";

export type ShFlagRow = { account_key: string; flag: ShFlag; closing: number; note: string; noted_by: string | null; noted_at: string | null; accepted_by: string | null; accepted_at: string | null; accepted_why: string };
export type ShRepaidRow = { account_key: string; due_on: string; opening: number; repaid: number; unpaid: number; answered_by: string | null; answered_at: string };
export type ShStatus = { applies: boolean; prepared_at: string | null; prepared_by: string | null; stale: boolean; problems: string[]; waiting: string[] };
export type OwnerSource = "chart" | "picked" | "rolled" | "none";
export type ShData = {
  rows: ShSchedule[]; groups: ShGroup[]; owners: Record<string, { shareholder: number | null; source: OwnerSource }>;
  status: ShStatus; flags: ShFlagRow[]; repaid: ShRepaidRow[]; windowDays: number; own: boolean; savedKeys: string[]; yearEnd: string;
};
export const groupKey = (g: Pick<ShGroup, "shareholder" | "keys">) => (g.shareholder === null ? `none:${g.keys[0]}` : `sh:${g.shareholder}`);

export async function loadShLoans(supabase: SupabaseClient, file: CbFileRow, accounts: CbAccount[], entries: CbEntry[],
  lines: { line_no: string; line_type: string; lead_sheet: string | null }[], sheets: { code: string; name: string }[]): Promise<ShData> {
  const [data, { data: st }, { data: set }, { data: flags }, { data: repaid }, { data: saved }, { data: picks }] = await Promise.all([
    loadReportData(supabase, file, accounts, entries, lines, sheets),
    supabase.rpc("cb_sh_status", { p_file: file.id }),
    supabase.from("cb_settings").select("sh_repay_window_days").maybeSingle(),
    supabase.from("cb_sh_flags").select("account_key, flag, closing, note, noted_by, noted_at, accepted_by, accepted_at, accepted_why").eq("file_id", file.id),
    supabase.from("cb_sh_repaid").select("account_key, due_on, opening, repaid, unpaid, answered_by, answered_at").eq("file_id", file.id),
    supabase.from("cb_sh_schedules").select("account_key").eq("file_id", file.id),
    // This file's picks, then the client's earlier files', newest first: the first pick per account wins.
    supabase.from("cb_sh_owners").select("account_key, shareholder, file:file_id!inner(id, client_id, year_end)")
      .eq("file.client_id", file.client_id).lte("file.year_end", file.year_end),
  ]);
  const own = keepsOwnBooks(file);
  // The trial balance as stored (cb_account_final: the balance plus entries), on the reports' accounts.
  const onAcct = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) onAcct.set(l.account_id, (onAcct.get(l.account_id) ?? 0) + Math.round(l.amount * 100));
  const tb = new Map<string, number>();
  for (const a of accounts) {
    const key = data.acctOf(a.id)?.key ?? a.account_key;
    tb.set(key, (tb.get(key) ?? 0) + Math.round(a.this_year * 100) + (onAcct.get(a.id) ?? 0));
  }
  const lineOf = new Map(accounts.map((a) => [a.id, a.line_no ?? ""]));
  const info = new Map<string, ShEntryInfo>(entries.map((e) => [e.id, { origin: e.origin ?? null, gifis: e.lines.map((l) => lineOf.get(l.account_id) ?? "") }]));
  const windowDays = Number((set as { sh_repay_window_days?: number } | null)?.sh_repay_window_days ?? 30);
  const rows = buildSchedules({
    accounts: data.accounts.map((a) => ({ key: a.key, number: a.number, name: a.name, line_no: a.line_no, tbCents: tb.get(a.key) ?? 0, lastCents: a.lastCents })),
    postings: data.postings, entries: info, own, yearEnd: file.year_end,
  }).filter((s) => s.openingCents || s.closingCents || s.tbCents || s.movements.length);
  // Each account's shareholder: the standard chart's, else the preparer's pick here, else the pick rolled
  // forward from the client's last file, else not picked.
  type Pick = { account_key: string; shareholder: number; file: { id: string; year_end: string } };
  const ps = ((picks ?? []) as unknown as Pick[]).sort((a, b) => b.file.year_end.localeCompare(a.file.year_end));
  const owners: ShData["owners"] = {};
  for (const r of rows) {
    const chart = CHART_SHAREHOLDER[r.key];
    const here = ps.find((p) => p.account_key === r.key && p.file.id === file.id);
    const before = ps.find((p) => p.account_key === r.key && p.file.id !== file.id);
    owners[r.key] = chart ? { shareholder: chart, source: "chart" } : here ? { shareholder: here.shareholder, source: "picked" }
      : before ? { shareholder: before.shareholder, source: "rolled" } : { shareholder: null, source: "none" };
  }
  const groups = buildGroups(rows, new Map(rows.map((r) => [r.key, owners[r.key].shareholder])), { yearStart: file.year_start, yearEnd: file.year_end, windowDays, own });
  const raw = (st ?? {}) as Partial<ShStatus>;
  const n = (v: unknown) => Number(v ?? 0);
  return {
    rows, groups, owners, windowDays, own, yearEnd: file.year_end,
    status: { applies: !!raw.applies, prepared_at: raw.prepared_at ?? null, prepared_by: raw.prepared_by ?? null, stale: !!raw.stale, problems: raw.problems ?? [], waiting: raw.waiting ?? [] },
    flags: ((flags ?? []) as ShFlagRow[]).map((f) => ({ ...f, closing: n(f.closing) })),
    repaid: ((repaid ?? []) as ShRepaidRow[]).map((r) => ({ ...r, opening: n(r.opening), repaid: n(r.repaid), unpaid: n(r.unpaid) })),
    savedKeys: ((saved ?? []) as { account_key: string }[]).map((x) => x.account_key),
  };
}

// What the database keeps when the preparer prepares the schedule.
export const toSavedRow = (r: ShSchedule, o: ShData["owners"][string]) => ({
  account_key: r.key, number: r.number, name: r.name, line_no: r.line_no,
  opening: r.openingCents / 100, closing: r.closingCents / 100, tb: r.tbCents / 100,
  movements: r.movements.map((m) => ({ kind: m.kind, amount: m.cents / 100, n: m.items.length })),
  shareholder: o.shareholder ?? "", owner_source: o.source,
});
export const toSavedGroup = (g: ShGroup) => ({
  group_key: groupKey(g), shareholder: g.shareholder ?? "", accounts: g.keys,
  opening: g.openingCents / 100, closing: g.closingCents / 100, reductions: g.reductionsCents / 100,
  last_part: g.lastPartCents / 100, this_part: g.thisPartCents / 100, due_on: g.dueOn ?? "",
  prior_due_on: g.prior?.dueOn ?? "", prior_opening: g.prior ? g.prior.openingCents / 100 : null,
  prior_repaid: g.prior ? g.prior.repaidCents / 100 : null, prior_unpaid: g.prior ? g.prior.unpaidCents / 100 : null,
  flags: g.flags, flag_amounts: { earlier_debit: g.lastPartCents / 100, late_repayment: g.closingCents / 100 },
});
