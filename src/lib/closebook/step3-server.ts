// Closebook step 3 (round 22, Hashim, Nov 16, 2026): everything the main page and its windows show, read with
// the signed-in person's client (row level security applies), worked out with the pure rules in step3.ts.
import type { SupabaseClient } from "@supabase/supabase-js";
import { listStatementsWithKick, type StatementRow } from "@/lib/statements/server";
import type { Conversion } from "./bank-server";
import { accountLabel, cardStatus, copiesOf, coverageStrip, edge, longDate, placement, possibleAccounts, ties, todoList, toCents, uploadState, type AccountType, type CardStatus, type Cell,
  type Edge, type FileAccount, type Gap, type Outstanding, type Possible, type Tie, type Todo, type UploadState } from "./step3";

export type S3Account = FileAccount & {
  label: string; chart: string; gifi: string; accountType: AccountType | null; bank: string; longTerm: boolean; books: number | null;
  t2Line: string | null;   // round 25: last year's T2 line (empty: the type's usual line)
  opened: string | null; closed: string | null; note: string; reasonBy: string | null; reasonAt: string | null; origin: string;
  cells: Cell[]; cycleDay: number;
  statements: S3Statement[]; start: Edge; end: Edge; endBooks: number | null; waiting: number;
  early: { id: string; label: string }[];   // the account's lines, to name the one that cleared an outstanding item (CB2-0 step 5: no 90-day limit)
  gaps: Gap[]; card: CardStatus;            // round 22 correction: red rows in the list, one status word on the card
  // Round 23: the account's lines in the year, in date order (outstanding: cleared a start-of-year item, posts nothing).
  lines: { id: string; date: string; description: string; cents: number; outstanding: boolean; statement: string; acctDate: string; memo: string; coded: boolean; printed: string | null }[];
  // Round 28: lines with no effect on the balance (information only, greyed; never posted or coded).
  info: { id: string; date: string; printed: string | null; description: string; cents: number; statement: string }[];
  // Round 24: statements excluded (out of the feed), with the reason.
  excluded: S3Excluded[];
};
export type S3Excluded = { id: string; period_start: string; period_end: string; file_name: string; lines: number; reason: string; note: string; by: string; at: string; hasFile: boolean };
export type S3FileHistory = { id: string; statement_id: string; file_name: string; replaced_at: string; by: string; hasFile: boolean };
export type S3Statement = { id: string; account_id: string; file_name: string; period_start: string; period_end: string; opening: number; closing: number; lines: number;
  outside_lines: number; at_start: number | null; at_end: number | null; statement_import_id: string | null; source: string; uploaded_at: string; who: string;
  coded: number; transfers: number; cleared: number; conversion: Conversion; attachment_path: string | null;
  statement_last4: string | null;   // round 28: the digits read from the statement, information only
  earlier: S3FileHistory[] };   // round 24: the files it had before Replace file
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
  const [{ data: accs }, { data: sts }, { data: chart }, { data: ob }, { data: items }, { data: no }, { data: lines }, { data: tr }, { data: extra }, list, { data: exc }, { data: hist }, { data: infos }] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, name, number, kind, chart_account, gifi_line, account_type, bank, last4, long_term, books_opening, opened_on, closed_on, coverage_note, coverage_by, coverage_at, origin, t2_line").eq("file_id", fileId).order("number"),
    supabase.from("cb_bank_statements").select("id, account_id, file_name, period_start, period_end, opening, closing, lines, outside_lines, at_start, at_end, statement_import_id, source, uploaded_at, uploaded_by, attachment_path, statement_last4, "
      + "model, pages, cost_usd, input_tokens, output_tokens, converted_at, check_result, edits, conv:converted_by(full_name)").eq("file_id", fileId).order("period_start"),
    supabase.from("cb_chart_accounts").select("number, line_no"),
    supabase.from("cb_opening_balances").select("code, amount").eq("file_id", fileId),
    supabase.from("cb_bank_outstanding").select("id, account_id, edge, item_date, description, dir, amount, cleared_line, kind").eq("file_id", fileId).order("item_date"),
    supabase.from("cb_bank_not_ours").select("last4, label, decided_by, decided_at").eq("file_id", fileId),
    supabase.from("cb_bank_lines").select("id, account_id, statement_id, txn_date, acct_date, memo, description, amount, status, source, row_no, chart_account, is_split, printed_date").eq("file_id", fileId).limit(50000),
    supabase.from("cb_bank_transfers").select("out_line, in_line").eq("file_id", fileId),
    supabase.from("cb_statement_imports").select("id, file_sha256, target_account, replaces_statement").eq("file_id", fileId).not("status", "in", "(discarded,uploading)"),
    listStatementsWithKick(fileId),
    supabase.from("cb_excluded_statements").select("id, account_id, period_start, period_end, file_name, lines, reason, note, excluded_by, excluded_at, attachment:statement->>attachment_path").eq("file_id", fileId).order("period_start"),
    supabase.from("cb_statement_files").select("id, statement_id, file_name, attachment_path, replaced_by, replaced_at").eq("file_id", fileId).order("replaced_at"),
    supabase.from("cb_bank_info_lines").select("id, account_id, statement_id, txn_date, printed_date, description, amount, row_no").eq("file_id", fileId).limit(20000),
  ]);
  // Round 24: a file uploaded to replace a statement's file is not a statement to import.
  const replacing = new Set(((extra ?? []) as { id: string; replaces_statement: string | null }[]).filter((x) => x.replaces_statement).map((x) => x.id));
  list.rows = list.rows.filter((r) => !replacing.has(r.id));
  const lineNo = new Map(((chart ?? []) as { number: string; line_no: string | null }[]).map((c) => [c.number, c.line_no ?? ""]));
  type Line = { id: string; account_id: string; statement_id: string; txn_date: string; acct_date: string | null; memo: string | null; description: string; amount: number; status: string; source: string; row_no: number; chart_account: string | null; is_split?: boolean; printed_date: string | null };
  const infoRows = (infos ?? []) as { id: string; account_id: string; statement_id: string; txn_date: string; printed_date: string | null; description: string; amount: number; row_no: number }[];
  const ls = (lines ?? []) as Line[];
  const inTransfer = new Set(((tr ?? []) as { out_line: string; in_line: string }[]).flatMap((t) => [t.out_line, t.in_line]));
  const its = ((items ?? []) as (Omit<Outstanding, "amount"> & { amount: number })[]).map((i) => ({ ...i, amount: toCents(i.amount)! }));

  type RawSt = Omit<S3Statement, "who" | "coded" | "transfers" | "cleared" | "opening" | "closing" | "at_start" | "at_end" | "conversion"> & Omit<Conversion, "source" | "statement_import_id">
    & { opening: number; closing: number; at_start: number | null; at_end: number | null; uploaded_by: string | null };
  const statements: S3Statement[] = ((sts ?? []) as unknown as RawSt[]).map((s) => {
    const mine = ls.filter((l) => l.statement_id === s.id);
    const conversion: Conversion = { source: s.source as Conversion["source"], statement_import_id: s.statement_import_id, model: s.model, pages: s.pages, cost_usd: s.cost_usd === null ? null : Number(s.cost_usd),
      input_tokens: s.input_tokens, output_tokens: s.output_tokens, converted_at: s.converted_at, check_result: s.check_result, edits: s.edits, conv: s.conv };
    const earlier = ((hist ?? []) as { id: string; statement_id: string; file_name: string; attachment_path: string | null; replaced_by: string | null; replaced_at: string }[])
      .filter((h) => h.statement_id === s.id).map((h) => ({ id: h.id, statement_id: h.statement_id, file_name: h.file_name, replaced_at: h.replaced_at, by: h.replaced_by ? names.get(h.replaced_by) ?? "" : "", hasFile: !!h.attachment_path }));
    return { ...s, earlier, conversion, opening: toCents(s.opening)!, closing: toCents(s.closing)!, at_start: toCents(s.at_start), at_end: toCents(s.at_end), who: s.uploaded_by ? names.get(s.uploaded_by) ?? "" : "",
      coded: mine.filter((l) => l.status !== "new" && l.source !== "outstanding" && !inTransfer.has(l.id)).length, transfers: mine.filter((l) => inTransfer.has(l.id)).length,
      cleared: mine.filter((l) => l.source === "outstanding").length };
  });

  type RawAcc = { id: string; name: string; number: string; kind: "bank" | "card"; chart_account: string; gifi_line: string | null; account_type: AccountType | null; bank: string | null; last4: string | null;
    long_term: boolean; books_opening: number | null; opened_on: string | null; closed_on: string | null; coverage_note: string; coverage_by: string | null; coverage_at: string | null; origin: string;
    t2_line: string | null };
  const raw = (accs ?? []) as RawAcc[];
  const fileAccounts: FileAccount[] = raw.map((a) => ({ id: a.id, number: a.number, name: a.name, kind: a.kind, last4: a.last4 }));
  // Round 24: only statements in the feed count as imported; an excluded one never blocks a new upload.
  const linked = new Set(statements.map((x) => x.statement_import_id).filter(Boolean));
  const importedShas = new Set(((extra ?? []) as { id: string; file_sha256: string | null }[]).filter((x) => x.file_sha256 && linked.has(x.id)).map((x) => x.file_sha256!));
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
    // Round 24: a coded line can be named too (it keeps its coding, and gets it back if the item goes).
    const early = ls.filter((l) => l.account_id === a.id && l.source !== "transfer" && (l.status === "new" || l.status === "done" || l.source === "outstanding"))
      .sort((x, y) => x.txn_date.localeCompare(y.txn_date)).map((l) => ({ id: l.id, label: `${shortDate(l.txn_date)} · ${l.description} · ${money(toCents(l.amount)!)}` }));
    // A statement already uploaded for the gap, waiting to check: the row says so and offers "Check".
    const gaps = cov.gaps.map((g) => ({ ...g, waiting: uploads.find((u) => u.account === a.id && (u.state.status === "ready" || u.state.status === "needs_look")
      && u.period_start && u.period_end && u.period_start <= g.to && u.period_end >= g.from) ?? null }))
      .map((g) => ({ ...g, waiting: g.waiting ? { id: g.waiting.id, file_name: g.waiting.file_name } : null }));
    const shownGaps = waived ? [] : gaps;
    const card = cardStatus({ waiting, gaps: mine.length ? shownGaps.length : 0, notExplained: (!start.explained && start.difference !== null) || (!end.explained && end.difference !== null),
      books, statements: mine.length, reason: waived || !!a.opened_on || !!a.closed_on });
    const myLines = ls.filter((l) => l.account_id === a.id).map((l) => ({ id: l.id, date: l.txn_date, description: l.description, cents: toCents(l.amount)!,
      outstanding: l.status === "matched" && l.source === "outstanding", statement: l.statement_id, row: l.row_no, acctDate: l.acct_date ?? l.txn_date, memo: l.memo ?? "",
      coded: (!!l.chart_account || !!l.is_split) && ["done", "reviewer"].includes(l.status), printed: l.printed_date ?? null }))
      .sort((x, y) => x.date.localeCompare(y.date) || (stStart.get(x.statement) ?? "").localeCompare(stStart.get(y.statement) ?? "") || x.row - y.row);
    const info = infoRows.filter((l) => l.account_id === a.id).sort((x, y) => x.txn_date.localeCompare(y.txn_date) || x.row_no - y.row_no)
      .map((l) => ({ id: l.id, date: l.txn_date, printed: l.printed_date, description: l.description, cents: toCents(l.amount)!, statement: l.statement_id }));
    return { ...fileAccounts.find((f) => f.id === a.id)!, label, early, gaps: shownGaps, card, lines: myLines, info, chart: a.chart_account, gifi: (a.gifi_line ?? lineNo.get(a.chart_account) ?? "").slice(0, 4),
      accountType: a.account_type, bank: a.bank ?? "", longTerm: a.long_term, books, t2Line: a.t2_line, opened: a.opened_on, closed: a.closed_on, note: a.coverage_note,
      reasonBy: a.coverage_by ? names.get(a.coverage_by) ?? "" : null, reasonAt: a.coverage_at, origin: a.origin,
      cells: waived ? cov.cells.map((c) => ({ ...c, state: "na" as const })) : cov.cells, cycleDay: cov.cycleDay, statements: mine, start, end, endBooks, waiting,
      excluded: ((exc ?? []) as { id: string; account_id: string; period_start: string; period_end: string; file_name: string; lines: number; reason: string; note: string; excluded_by: string | null; excluded_at: string; attachment: string | null }[])
        .filter((x) => x.account_id === a.id).map((x) => ({ id: x.id, period_start: x.period_start, period_end: x.period_end, file_name: x.file_name, lines: x.lines, reason: x.reason, note: x.note,
          by: x.excluded_by ? names.get(x.excluded_by) ?? "" : "", at: x.excluded_at, hasFile: !!x.attachment })) };
  });

  const t2 = new Map(((ob ?? []) as { code: string; amount: number }[]).map((o) => [o.code, toCents(o.amount)!]));
  const entered = !!file.opening_source || !!file.first_year;
  const tieList = ties(accounts.map((a) => ({ number: a.number, gifi: a.gifi, books: a.books })), t2, entered);
  const bankIds = new Set(accounts.filter((a) => a.kind === "bank").map((a) => a.id));
  const notOurs = ((no ?? []) as { last4: string; label: string; decided_by: string | null; decided_at: string }[]).map((n) => ({ last4: n.last4, label: n.label, by: n.decided_by ? names.get(n.decided_by) ?? "" : "", at: n.decided_at }));
  const possible = possibleAccounts(ls.map((l) => ({ date: l.txn_date, description: l.description, cents: toCents(l.amount)!, bank: bankIds.has(l.account_id) })), fileAccounts, new Set(notOurs.map((n) => n.last4)));
  const byAccount = new Map<string | null, number>();
  for (const u of uploads) if (u.state.status === "ready" || u.state.status === "needs_look" || u.state.status === "no_account") byAccount.set(u.account, (byAccount.get(u.account) ?? 0) + 1);
  const todo = todoList({
    accounts: accounts.map((a) => ({ id: a.id, label: a.label, statements: a.statements.length, gaps: a.statements.length ? a.gaps.length : 0, books: a.books,
      reason: !!(a.note || a.opened || a.closed) && !a.gaps.length, start: a.start, end: a.end, startDay: longDate(dayBefore(file.year_start)), endDay: longDate(file.year_end) })),
    waiting: [...byAccount.entries()].map(([k, n]) => ({ account: k, label: accounts.find((a) => a.id === k)?.label ?? null, n })),
    reading: uploads.filter((u) => u.state.status === "reading").length, failed: uploads.filter((u) => u.state.status === "failed").length,
    wrong: 0, ties: tieList, possible, signed,
  });
  const chartNumbers = [...lineNo.keys()];
  return { yearStart: file.year_start, yearEnd: file.year_end, dayBefore: dayBefore(file.year_start), accounts, uploads, outstanding: its, ties: tieList, t2Entered: entered,
    possible, notOurs, todo, chartNumbers, taken: accounts.map((a) => a.number), kick: list.kick, firstYear: !!file.first_year };
}

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDate = (iso: string) => `${MONTH[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}`;
export const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };
export { placement };
