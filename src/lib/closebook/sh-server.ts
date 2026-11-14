import "server-only";
// Round 14: the shareholder loan schedule, worked out live from the postings the reports use, with the
// state saved when the preparer prepares it (cb_sh_*). Benchmark: CaseWare's continuity working paper.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbAccount, CbEntry } from "./server";
import type { CbFileRow } from "./files";
import { loadReportData } from "./report-data";
import { keepsOwnBooks } from "./books";
import { buildSchedules, priorDueOn, type ShEntryInfo, type ShFlag, type ShSchedule } from "./sh-loans";

export type ShFlagRow = { account_key: string; flag: ShFlag; closing: number; note: string; noted_by: string | null; noted_at: string | null; accepted_by: string | null; accepted_at: string | null; accepted_why: string };
export type ShRepaidRow = { account_key: string; due_on: string; answer: "yes" | "no"; evidence_kind: "bank" | "entry" | null; evidence_ref: string | null; evidence_label: string; note: string;
  answered_by: string | null; answered_at: string; accepted_by: string | null; accepted_at: string | null; accepted_why: string };
export type ShStatus = { applies: boolean; prepared_at: string | null; prepared_by: string | null; stale: boolean; problems: string[]; waiting: string[] };
export type ShRow = ShSchedule & { priorDueOn: string | null };
export type ShData = { rows: ShRow[]; status: ShStatus; flags: ShFlagRow[]; repaid: ShRepaidRow[]; windowDays: number; own: boolean; savedKeys: string[] };

export async function loadShLoans(supabase: SupabaseClient, file: CbFileRow, accounts: CbAccount[], entries: CbEntry[],
  lines: { line_no: string; line_type: string; lead_sheet: string | null }[], sheets: { code: string; name: string }[]): Promise<ShData> {
  const [data, { data: st }, { data: set }, { data: flags }, { data: repaid }, { data: saved }] = await Promise.all([
    loadReportData(supabase, file, accounts, entries, lines, sheets),
    supabase.rpc("cb_sh_status", { p_file: file.id }),
    supabase.from("cb_settings").select("sh_repay_window_days").maybeSingle(),
    supabase.from("cb_sh_flags").select("account_key, flag, closing, note, noted_by, noted_at, accepted_by, accepted_at, accepted_why").eq("file_id", file.id),
    supabase.from("cb_sh_repaid").select("account_key, due_on, answer, evidence_kind, evidence_ref, evidence_label, note, answered_by, answered_at, accepted_by, accepted_at, accepted_why").eq("file_id", file.id),
    supabase.from("cb_sh_schedules").select("account_key").eq("file_id", file.id),
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
  const schedules = buildSchedules({
    accounts: data.accounts.map((a) => ({ key: a.key, number: a.number, name: a.name, line_no: a.line_no, tbCents: tb.get(a.key) ?? 0, lastCents: a.lastCents })),
    postings: data.postings, entries: info, own, yearEnd: file.year_end, windowDays,
  }).filter((s) => s.openingCents || s.closingCents || s.tbCents || s.movements.length);
  // A balance owed at the start of the year had its s.15(2) date one year after last year end: next
  // year's file asks whether it was repaid by then.
  const rows: ShRow[] = schedules.map((s) => ({ ...s, priorDueOn: s.openingCents > 0 ? priorDueOn(file.year_start) : null }));
  const raw = (st ?? {}) as Partial<ShStatus>;
  return {
    rows, windowDays, own,
    status: { applies: !!raw.applies, prepared_at: raw.prepared_at ?? null, prepared_by: raw.prepared_by ?? null, stale: !!raw.stale, problems: raw.problems ?? [], waiting: raw.waiting ?? [] },
    flags: ((flags ?? []) as ShFlagRow[]).map((f) => ({ ...f, closing: Number(f.closing) })),
    repaid: (repaid ?? []) as ShRepaidRow[],
    savedKeys: ((saved ?? []) as { account_key: string }[]).map((x) => x.account_key),
  };
}

// What the database keeps when the preparer prepares the schedule.
export const toSaved = (r: ShRow) => ({
  account_key: r.key, number: r.number, name: r.name, line_no: r.line_no,
  opening: r.openingCents / 100, closing: r.closingCents / 100, tb: r.tbCents / 100,
  movements: r.movements.map((m) => ({ kind: m.kind, amount: m.cents / 100, n: m.items.length })),
  flags: r.flags, due_on: r.dueOn ?? "", prior_due_on: r.priorDueOn ?? "",
});
