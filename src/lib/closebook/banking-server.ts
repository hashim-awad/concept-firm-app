import "server-only";
// Step 3 "Banking" (round 23, Hashim, Nov 16, 2026): what its three sub-steps show, read with the signed-in
// person's client (row level security applies). Built on the round 22 loader (accounts, statements, uploads,
// coverage) with the rules in banking.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStep3, type S3Account, type S3Upload, type Step3 } from "./step3-server";
import { USUAL_LINES, band, calendarMonths, feedWord, findIt, findStatement, misread, roundingOf, tieBoxes, type Band, type FeedWord, type FindMonth, type FindStatement, type Misread, type MonthState, type TieBox } from "./banking";
import type { ReadResult, StatementAccount } from "../statements/types";

export type SubKey = "3.1" | "3.2" | "3.3";
export const SUBS: { key: SubKey; paper: "accounts" | "feeds" | "reconcile"; name: string }[] = [
  { key: "3.1", paper: "accounts", name: "3.1 Bank accounts & T2 tie-out" },
  { key: "3.2", paper: "feeds", name: "3.2 Bank feeds" },
  { key: "3.3", paper: "reconcile", name: "3.3 Reconcile" },
];
export type SubStatus = { prepared_by: string | null; prepared_at: string | null; reviewed_by: string | null; reviewed_at: string | null; problems: string[] };
export type BankingAccount = S3Account & {
  feed: FeedWord; months: { label: string; from: string; to: string; state: MonthState }[]; toFix: S3Upload[]; band: Band; waiting: number;
};
export type Banking = Omit<Step3, "accounts"> & { accounts: BankingAccount[]; boxes: TieBox[]; rounding: { gifi: string; title: string; cents: number }[];
  subs: Record<SubKey, SubStatus>; pending: S3Upload[];
  // Round 31: uploads removed as another copy of a statement already in the list, and the upload they are a copy of.
  copies: { id: string; file: string; of: string }[];
  // Round 25: the balance sheet lines in step 2 that hold an amount (for "Last year's T2 line"), and GIFI names.
  t2Lines: { code: string; name: string; cents: number }[]; gifiNames: Record<string, string> };

// GIFI code -> its name ("2707" -> "Credit card loans"), from the master lines' ".00" line.
export async function gifiNames(supabase: SupabaseClient, codes: string[]): Promise<Map<string, string>> {
  if (!codes.length) return new Map();
  const { data } = await supabase.from("cb_master_lines").select("gifi_code, gifi_name, line_no").in("gifi_code", [...new Set(codes)]);
  const out = new Map<string, string>();
  for (const r of (data ?? []) as { gifi_code: string; gifi_name: string; line_no: string }[]) if (r.line_no === `${r.gifi_code}.00` || !out.has(r.gifi_code)) out.set(r.gifi_code, r.gifi_name);
  return out;
}

// Round 24 (rule 17): what a signed 3.2 or 3.3 locks. canRemove: the person may remove it (a preparer's sign-off,
// or a reviewer's when they are the reviewer or hold Remove others' sign-offs, R3a-1). The database decides again on every change.
export function feedLock(subs: Record<SubKey, SubStatus> | null, reviewerOrRemover: boolean, me: string | null): { label: string; canRemove: boolean } | null {
  if (!subs) return null;
  const on = (["3.2", "3.3"] as const).filter((k) => subs[k].prepared_at);
  if (!on.length) return null;
  const reviewed = on.filter((k) => subs[k].reviewed_at);
  return { label: on.join(" and "), canRemove: !reviewed.length || reviewerOrRemover || on.some((k) => !!me && subs[k].reviewed_by === me) };
}

export async function loadSubsteps(supabase: SupabaseClient, fileId: string): Promise<Record<SubKey, SubStatus>> {
  const { data } = await supabase.rpc("cb_substep_status", { p_file: fileId });
  const none: SubStatus = { prepared_by: null, prepared_at: null, reviewed_by: null, reviewed_at: null, problems: [] };
  const d = (data ?? {}) as Partial<Record<SubKey, SubStatus>>;
  return { "3.1": d["3.1"] ?? none, "3.2": d["3.2"] ?? none, "3.3": d["3.3"] ?? none };
}

// Round 34: the 3.x sign-off this person's last action removed ("3.3 sign-off removed: <reason>"), from History,
// within the last minute; the page shows it once as a pill.
export async function loadSignoffPill(supabase: SupabaseClient, fileId: string, staffId: string): Promise<{ id: string; text: string } | null> {
  if (!staffId) return null;
  const { data } = await supabase.from("cb_file_history").select("id, detail").eq("file_id", fileId).eq("step", "records").eq("actor_id", staffId)
    .in("action", ["signoff_removed", "signoff_cleared"]).like("detail", "% removed: %").gte("at", new Date(Date.now() - 60_000).toISOString())
    .order("id", { ascending: false }).limit(1).maybeSingle();
  return data ? { id: String(data.id), text: String(data.detail) } : null;
}

export async function loadBanking(supabase: SupabaseClient, file: { id: string; year_start: string; year_end: string; opening_source: string | null; first_year: boolean | null },
  names: Map<string, string>, signed: boolean, known?: Record<SubKey, SubStatus> | null): Promise<Banking> {
  const [d, subs, { data: ob }, { data: cp }] = await Promise.all([loadStep3(supabase, file, names, signed), known ? Promise.resolve(known) : loadSubsteps(supabase, file.id),
    supabase.from("cb_opening_balances").select("code, amount").eq("file_id", file.id),
    supabase.from("cb_statement_imports").select("id, file_name, copy_of").eq("file_id", file.id).eq("status", "discarded").not("copy_of", "is", null)
      .gte("created_at", new Date(Date.now() - 2 * 86_400_000).toISOString())]);
  const t2 = new Map(((ob ?? []) as { code: string; amount: number }[]).map((o) => [o.code, Math.round(Number(o.amount) * 100)]));
  const bsLines = [...t2.entries()].filter(([c, v]) => v !== 0 && c >= "1000" && c <= "3499");
  const lineNames = await gifiNames(supabase, [...bsLines.map(([c]) => c), ...USUAL_LINES, ...d.accounts.map((a) => a.gifi), ...d.accounts.map((a) => a.t2Line ?? "").filter(Boolean)]);
  const boxes = tieBoxes(d.accounts.map((a) => ({ id: a.id, label: a.label, gifi: a.gifi, kind: a.kind, books: a.books, t2: a.t2Line })), t2, lineNames);
  // Statements read and waiting. Those that add up (opening + lines = closing) go in by themselves (the page imports
  // them); one that does not is "to fix" (a misread line).
  const open = d.uploads.filter((u) => u.state.status === "ready" || u.state.status === "needs_look");
  // Round 31: a statement whose import was refused keeps the reason (round 30) and waits in "To fix"; it is not tried
  // again by itself until it is changed in Fix it or read again (both clear the reason).
  const passes = (u: S3Upload) => u.difference_cents === 0 && !!u.account && !(u.status === "needs_look" && u.error);
  const accounts: BankingAccount[] = d.accounts.map((a) => {
    const toFix = open.filter((u) => u.account === a.id && !passes(u));
    const waived = !a.opened && !a.closed && !!a.note;
    const start = a.statements.find((s) => s.at_start !== null)?.at_start ?? null;
    const end = [...a.statements].reverse().find((s) => s.at_end !== null)?.at_end ?? null;
    const items = (edge: "start" | "end") => d.outstanding.filter((i) => i.account_id === a.id && i.edge === edge).reduce((n, i) => n + (i.dir === "in" ? i.amount : -i.amount), 0);
    const missing = a.statements.length ? a.gaps.length : 0;
    // The 12 month boxes: green covered, red missing, grey nothing uploaded (statements read and not imported are missing).
    return { ...a, toFix, feed: feedWord({ statements: a.statements.length, toFix: toFix.length, missing, waived }),
      months: calendarMonths(d.yearStart, d.yearEnd, waived ? [] : a.gaps, a.statements.length > 0 && !waived, { opened: a.opened, closed: a.closed }),
      band: band({ opening: a.books, lines: a.lines, bankStart: start, bankEnd: end, startItems: items("start"), endItems: items("end"), waiting: missing > 0 || toFix.length > 0 }),
      waiting: open.filter((u) => u.account === a.id).length };
  });
  return { ...d, accounts, boxes, rounding: d.t2Entered || d.firstYear ? roundingOf(boxes) : [], subs, pending: open.filter(passes),
    copies: ((cp ?? []) as { id: string; file_name: string; copy_of: string }[]).map((c) => ({ id: c.id, file: c.file_name, of: c.copy_of })),
    t2Lines: bsLines.sort(([a], [b]) => a.localeCompare(b)).map(([code, cents]) => ({ code, name: lineNames.get(code) ?? "", cents })), gifiNames: Object.fromEntries(lineNames) };
}

// The fix screen: the statement as read (or as edited), the account on it, and the line that looks misread.
// Round 26: the account the statement was uploaded to comes first (its last digits), then one with a problem.
export async function loadFix(supabase: SupabaseClient, importId: string, targetLast4 = ""): Promise<{ data: ReadResult; acc: StatementAccount; miss: Misread | null; fileName: string; notImported: string } | null> {
  const { data: row } = await supabase.from("cb_statement_imports").select("id, file_name, result, edited, error").eq("id", importId).maybeSingle();
  const data = (row?.edited ?? row?.result) as ReadResult | null;
  if (!row || !data?.accounts?.length) return null;
  const d = targetLast4.replace(/\D/g, ""), mine = (x: StatementAccount) => { const e = x.last4.replace(/\D/g, ""); return !!d && !!e && (d.endsWith(e) || e.endsWith(d)); };
  const acc = data.accounts.find(mine) ?? data.accounts.find((x) => misread(x)) ?? data.accounts[0];
  return { data, acc, miss: misread(acc), fileName: row.file_name as string, notImported: (row.error as string | null) ?? "" };
}

// "Find it": the bank month by month from the statements as read, against the file's lines.
export async function loadFindIt(supabase: SupabaseClient, a: BankingAccount, yearStart: string, yearEnd: string): Promise<{ months: FindMonth[]; statements: FindStatement[] }> {
  const ids = a.statements.map((s) => s.statement_import_id).filter((x): x is string => !!x);
  const { data } = ids.length ? await supabase.from("cb_statement_imports").select("id, result, edited").in("id", ids) : { data: [] };
  const read = new Map(((data ?? []) as { id: string; result: ReadResult | null; edited: ReadResult | null }[]).map((r) => [r.id, r.edited ?? r.result]));
  const sts = a.statements.map((s) => {
    const r = s.statement_import_id ? read.get(s.statement_import_id) : null;
    const acc = r?.accounts.find((x) => x.periodStart === s.period_start && x.periodEnd === s.period_end) ?? (r?.accounts.length === 1 ? r.accounts[0] : null);
    // A CSV keeps no reading of its own: its lines in the file stand for the bank.
    return acc ? findStatement(acc) : { periodStart: s.period_start, periodEnd: s.period_end, opening: s.opening,
      lines: a.lines.filter((l) => l.statement === s.id).map((l) => ({ date: l.date, cents: l.cents, description: l.description })) };
  });
  return { months: findIt(yearStart, yearEnd, sts, a.lines.map((l) => ({ date: l.date, cents: l.cents }))), statements: sts };
}

// The automatic "Opening balance rounding" (3.1): one per T2 line under 1.00, for the Entries tab.
export async function loadRounding(supabase: SupabaseClient, file: { id: string; opening_source: string | null; first_year: boolean | null }) {
  if (!file.opening_source && !file.first_year) return [];
  const [{ data: accs }, { data: chart }, { data: ob }] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, name, number, kind, gifi_line, chart_account, books_opening, t2_line").eq("file_id", file.id),
    supabase.from("cb_chart_accounts").select("number, line_no"),
    supabase.from("cb_opening_balances").select("code, amount").eq("file_id", file.id),
  ]);
  const line = new Map(((chart ?? []) as { number: string; line_no: string | null }[]).map((c) => [c.number, c.line_no ?? ""]));
  const t2 = new Map(((ob ?? []) as { code: string; amount: number }[]).map((o) => [o.code, Math.round(Number(o.amount) * 100)]));
  type A = { id: string; name: string; number: string; kind: "bank" | "card"; gifi_line: string | null; chart_account: string; books_opening: number | null; t2_line: string | null };
  return roundingOf(tieBoxes(((accs ?? []) as A[]).map((a) => ({ id: a.id, label: `${a.number} ${a.name}`, kind: a.kind, gifi: (a.gifi_line ?? line.get(a.chart_account) ?? "").slice(0, 4),
    books: a.books_opening === null ? null : Math.round(Number(a.books_opening) * 100), t2: a.t2_line })), t2));
}
