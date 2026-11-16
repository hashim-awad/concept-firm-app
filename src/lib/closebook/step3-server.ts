// Closebook step 3 (round 22, Hashim, Nov 16, 2026): everything the main page and its windows show, read with
// the signed-in person's client (row level security applies), worked out with the pure rules in step3.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listStatementsWithKick, type StatementRow } from "@/lib/statements/server";
import type { Conversion } from "./bank-server";
import { accountLabel, cardStatus, copiesOf, coverageStrip, edge, longDate, placement, possibleAccounts, ties, todoList, toCents, uploadState, type AccountType, type CardStatus, type Cell,
  type Edge, type FileAccount, type Gap, type Outstanding, type Possible, type Tie, type Todo, type UploadState } from "./step3";

export type S3Account = FileAccount & {
  label: string; chart: string; gifi: string; accountType: AccountType | null; bank: string; longTerm: boolean; books: number | null;
  opened: string | null; closed: string | null; note: string; reasonBy: string | null; reasonAt: string | null; origin: string;
  cells: Cell[]; cycleDay: number;
  statements: S3Statement[]; start: Edge; end: Edge; endBooks: number | null; waiting: number;
  early: { id: string; label: string }[];   // lines in the first 90 days, to name the one that cleared an outstanding item
  gaps: Gap[]; card: CardStatus;            // round 22 correction: red rows in the list, one status word on the card
  // Round 23: the account's lines in the year, in date order (outstanding: cleared a start-of-year item, posts nothing).
  lines: { id: string; date: string; description: string; cents: number; outstanding: boolean; statement: string }[];
};
export type S3Statement = { id: string; account_id: string; file_name: string; period_start: string; period_end: string; opening: number; closing: number; lines: number;
  outside_lines: number; at_start: number | null; at_end: number | null; statement_import_id: string | null; source: string; uploaded_at: string; who: string;
  coded: number; transfers: number; cleared: number; conversion: Conversion; attachment_path: string | null };
export type S3Upload = StatementRow & { file_sha256: string | null; target_account: string | null; state: UploadState; account: string | null };
export type Step3 = {
  yearStart: string; yearEnd: string; dayBefore: string; accounts: S3Account[]; uploads: S3Upload[]; outstanding: Outstanding[];
  ties: Tie[]; t2Entered: boolean; possible: Possible[]; notOurs: { last4: string; label: string; by: string; at: string }[];
  todo: Todo[]; chartNumbers: string[]; taken: string[]; kick: boolean; firstYear: boolean;
};

const dayBefore = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) - 1)).toISOString().slice(0, 10);

export async function loadStep3(supabase: SupabaseClient, file: { id: string; year_start: string; year_end: string; opening_source: string | null; first_year: boolean | null },
  names: Map<string, string>, signed: boolean): Promise<Step3> {
  const fileId = file.id;
  const [{ data: accs }, { data: sts }, { data: chart }, { data: ob }, { data: items }, { data: no }, { data: lines }, { data: tr }, { data: extra }, list] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, name, number, kind, chart_account, gifi_line, account_type, bank, last4, long_term, books_opening, opened_on, closed_on, coverage_note, coverage_by, coverage_at, origin").eq("file_id", fileId).order("number"),
    supabase.from("cb_bank_statements").select("id, account_id, file_name, period_start, period_end, opening, closing, lines, outside_lines, at_start, at_end, statement_import_id, source, uploaded_at, uploaded_by, attachment_path, "
      + "model, pages, cost_usd, input_tokens, output_tokens, converted_at, check_result, edits, conv:converted_by(full_name)").eq("file_id", fileId).order("period_start"),
    supabase.from("cb_chart_accounts").select("number, line_no"),
    supabase.from("cb_opening_balances").select("code, amount").eq("file_id", fileId),
    supabase.from("cb_bank_outstanding").select("id, account_id, edge, item_date, description, dir, amount, cleared_line, kind").eq("file_id", fileId).order("item_date"),
    supabase.from("cb_bank_not_ours").select("last4, label, decided_by, decided_at").eq("file_id", fileId),
    supabase.from("cb_bank_lines").select("id, account_id, statement_id, txn_date, description, amount, status, source, row_no").eq("file_id", fileId).limit(50000),
    supabase.from("cb_bank_transfers").select("out_line, in_line").eq("file_id", fileId),
    supabase.from("cb_statement_imports").select("id, file_sha256, target_account").eq("file_id", fileId).not("status", "in", "(discarded,uploading)"),
    listStatementsWithKick(fileId),
  ]);
  const lineNo = new Map(((chart ?? []) as { number: string; line_no: string | null }[]).map((c) => [c.number, c.line_no ?? ""]));
  type Line = { id: string; account_id: string; statement_id: string; txn_date: string; description: string; amount: number; status: string; source: string; row_no: number };
  const ls = (lines ?? []) as Line[];
  const inTransfer = new Set(((tr ?? []) as { out_line: string; in_line: string }[]).flatMap((t) => [t.out_line, t.in_line]));
  const its = ((items ?? []) as (Omit<Outstanding, "amount"> & { amount: number })[]).map((i) => ({ ...i, amount: toCents(i.amount)! }));

  type RawSt = Omit<S3Statement, "who" | "coded" | "transfers" | "cleared" | "opening" | "closing" | "at_start" | "at_end" | "conversion"> & Omit<Conversion, "source" | "statement_import_id">
    & { opening: number; closing: number; at_start: number | null; at_end: number | null; uploaded_by: string | null };
  const statements: S3Statement[] = ((sts ?? []) as unknown as RawSt[]).map((s) => {
    const mine = ls.filter((l) => l.statement_id === s.id);
    const conversion: Conversion = { source: s.source as Conversion["source"], statement_import_id: s.statement_import_id, model: s.model, pages: s.pages, cost_usd: s.cost_usd === null ? null : Number(s.cost_usd),
      input_tokens: s.input_tokens, output_tokens: s.output_tokens, converted_at: s.converted_at, check_result: s.check_result, edits: s.edits, conv: s.conv };
    return { ...s, conversion, opening: toCents(s.opening)!, closing: toCents(s.closing)!, at_start: toCents(s.at_start), at_end: toCents(s.at_end), who: s.uploaded_by ? names.get(s.uploaded_by) ?? "" : "",
      coded: mine.filter((l) => l.status !== "new" && l.source !== "outstanding" && !inTransfer.has(l.id)).length, transfers: mine.filter((l) => inTransfer.has(l.id)).length,
      cleared: mine.filter((l) => l.source === "outstanding").length };
  });

  type RawAcc = { id: string; name: string; number: string; kind: "bank" | "card"; chart_account: string; gifi_line: string | null; account_type: AccountType | null; bank: string | null; last4: string | null;
    long_term: boolean; books_opening: number | null; opened_on: string | null; closed_on: string | null; coverage_note: string; coverage_by: string | null; coverage_at: string | null; origin: string };
  const raw = (accs ?? []) as RawAcc[];
  const fileAccounts: FileAccount[] = raw.map((a) => ({ id: a.id, number: a.number, name: a.name, kind: a.kind, last4: a.last4 }));
  const importedShas = new Set(((extra ?? []) as { id: string; file_sha256: string | null }[]).filter((x) => x.file_sha256).flatMap((x) => list.rows.some((r) => r.id === x.id && r.status === "imported") ? [x.file_sha256!] : []));
  const xMap = new Map(((extra ?? []) as { id: string; file_sha256: string | null; target_account: string | null }[]).map((x) => [x.id, x]));
  // One copy of each statement (round 22 fixes): a later copy of one already in the list shows as "Copy".
  const copies = copiesOf(list.rows.map((r) => ({ ...r, file_sha256: xMap.get(r.id)?.file_sha256 ?? null, target_account: xMap.get(r.id)?.target_account ?? null })));
  const uploads: S3Upload[] = list.rows.map((r) => {
    const x = xMap.get(r.id);
    const target = fileAccounts.find((a) => a.id === x?.target_account) ?? null;
    const state = uploadState({ ...r, file_sha256: x?.file_sha256 ?? null, target_account: x?.target_account ?? null }, {
      yearStart: file.year_start, yearEnd: file.year_end, accounts: fileAccounts, target,
      importedShas: new Set([...importedShas].filter((h) => !(r.status === "imported" && x?.file_sha256 === h))),
      importedPeriods: statements.filter((s) => s.statement_import_id !== r.id).map((s) => ({ account_id: s.account_id, period_start: s.period_start, period_end: s.period_end })), copies });
    const account = target?.id ?? state.match?.id ?? statements.find((s) => s.statement_import_id === r.id)?.account_id ?? null;
    return { ...r, file_sha256: x?.file_sha256 ?? null, target_account: x?.target_account ?? null, state, account };
  });

  const stStart = new Map(statements.map((x) => [x.id, x.period_start]));
  const accounts: S3Account[] = raw.map((a) => {
    const mine = statements.filter((s) => s.account_id === a.id);
    const pend = uploads.filter((u) => u.account === a.id && (u.state.status === "ready" || u.state.status === "needs_look") && u.period_start && u.period_end)
      .map((u) => ({ period_start: u.period_start!, period_end: u.period_end! }));
    const cov = coverageStrip(file.year_start, file.year_end, mine, { opened: a.opened_on, closed: a.closed_on }, pend);
    const waived = !a.opened_on && !a.closed_on && !!a.coverage_note;
    const books = toCents(a.books_opening);
    const firstEdge = mine.find((s) => s.at_start !== null) ?? null;
    const lastEdge = [...mine].reverse().find((s) => s.at_end !== null) ?? null;
    const movement = ls.filter((l) => l.account_id === a.id && !(l.status === "matched" && l.source === "outstanding")).reduce((n, l) => n + toCents(l.amount)!, 0);
    const endBooks = books === null ? null : books + movement;
    const start = edge(firstEdge?.at_start ?? null, books, its.filter((i) => i.account_id === a.id && i.edge === "start"));
    const end = edge(cov.gaps.length || waived || cov.cells.some((c) => c.state === "wait") ? null : lastEdge?.at_end ?? null, endBooks, its.filter((i) => i.account_id === a.id && i.edge === "end"));
    const waiting = uploads.filter((u) => u.account === a.id && (u.state.status === "ready" || u.state.status === "needs_look")).length;
    const label = accountLabel(a);
    const limit = new Date(Date.UTC(+file.year_start.slice(0, 4), +file.year_start.slice(5, 7) - 1, +file.year_start.slice(8, 10) + 90)).toISOString().slice(0, 10);
    const early = ls.filter((l) => l.account_id === a.id && l.txn_date <= limit && (l.status === "new" || l.source === "outstanding"))
      .sort((x, y) => x.txn_date.localeCompare(y.txn_date)).map((l) => ({ id: l.id, label: `${shortDate(l.txn_date)} · ${l.description} · ${money(toCents(l.amount)!)}` }));
    // A statement already uploaded for the gap, waiting to check: the row says so and offers "Check".
    const gaps = cov.gaps.map((g) => ({ ...g, waiting: uploads.find((u) => u.account === a.id && (u.state.status === "ready" || u.state.status === "needs_look")
      && u.period_start && u.period_end && u.period_start <= g.to && u.period_end >= g.from) ?? null }))
      .map((g) => ({ ...g, waiting: g.waiting ? { id: g.waiting.id, file_name: g.waiting.file_name } : null }));
    const shownGaps = waived ? [] : gaps;
    const card = cardStatus({ waiting, gaps: mine.length ? shownGaps.length : 0, notExplained: (!start.explained && start.difference !== null) || (!end.explained && end.difference !== null),
      books, statements: mine.length, reason: waived || !!a.opened_on || !!a.closed_on });
    const myLines = ls.filter((l) => l.account_id === a.id).map((l) => ({ id: l.id, date: l.txn_date, description: l.description, cents: toCents(l.amount)!,
      outstanding: l.status === "matched" && l.source === "outstanding", statement: l.statement_id, row: l.row_no }))
      .sort((x, y) => x.date.localeCompare(y.date) || (stStart.get(x.statement) ?? "").localeCompare(stStart.get(y.statement) ?? "") || x.row - y.row);
    return { ...fileAccounts.find((f) => f.id === a.id)!, label, early, gaps: shownGaps, card, lines: myLines, chart: a.chart_account, gifi: (a.gifi_line ?? lineNo.get(a.chart_account) ?? "").slice(0, 4),
      accountType: a.account_type, bank: a.bank ?? "", longTerm: a.long_term, books, opened: a.opened_on, closed: a.closed_on, note: a.coverage_note,
      reasonBy: a.coverage_by ? names.get(a.coverage_by) ?? "" : null, reasonAt: a.coverage_at, origin: a.origin,
      cells: waived ? cov.cells.map((c) => ({ ...c, state: "na" as const })) : cov.cells, cycleDay: cov.cycleDay, statements: mine, start, end, endBooks, waiting };
  });

  const t2 = new Map(((ob ?? []) as { code: string; amount: number }[]).map((o) => [o.code, toCents(o.amount)!]));
  const entered = !!file.opening_source || !!file.first_year;
  const tieList = ties(accounts.map((a) => ({ number: a.number, gifi: a.gifi, books: a.books })), t2, entered);
  const bankIds = new Set(accounts.filter((a) => a.kind === "bank").map((a) => a.id));
  const notOurs = ((no ?? []) as { last4: string; label: string; decided_by: string | null; decided_at: string }[]).map((n) => ({ last4: n.last4, label: n.label, by: n.decided_by ? names.get(n.decided_by) ?? "" : "", at: n.decided_at }));
  const possible = possibleAccounts(ls.map((l) => ({ date: l.txn_date, description: l.description, cents: toCents(l.amount)!, bank: bankIds.has(l.account_id) })), fileAccounts, new Set(notOurs.map((n) => n.last4)));
  const byAccount = new Map<string | null, number>();
  for (const u of uploads) if (u.state.status === "ready" || u.state.status === "needs_look" || u.state.status === "no_account" || u.state.status === "no_digits") byAccount.set(u.account, (byAccount.get(u.account) ?? 0) + 1);
  const todo = todoList({
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, statements: a.statements.length, gaps: a.statements.length ? a.gaps.length : 0, books: a.books,
      reason: !!(a.note || a.opened || a.closed) && !a.gaps.length, start: a.start, end: a.end, startDay: longDate(dayBefore(file.year_start)), endDay: longDate(file.year_end) })),
    waiting: [...byAccount.entries()].map(([k, n]) => ({ account: k, label: accounts.find((a) => a.id === k)?.label ?? null, n })),
    reading: uploads.filter((u) => u.state.status === "reading").length, failed: uploads.filter((u) => u.state.status === "failed").length,
    wrong: uploads.filter((u) => u.state.status === "wrong_account").length, ties: tieList, possible, signed,
  });
  const chartNumbers = [...lineNo.keys()];
  return { yearStart: file.year_start, yearEnd: file.year_end, dayBefore: dayBefore(file.year_start), accounts, uploads, outstanding: its, ties: tieList, t2Entered: entered,
    possible, notOurs, todo, chartNumbers, taken: accounts.map((a) => a.number), kick: list.kick, firstYear: !!file.first_year };
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
export const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
export { placement };
