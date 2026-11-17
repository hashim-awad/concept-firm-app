import "server-only";
// Round 31, step 4 (Hashim, Nov 17, 2026): everything the Bank transactions page needs, read once with the signed-in
// person's client (row level security applies). The page works out the pairs, rules and badges itself
// (src/lib/closebook/bank-feed.ts), so posting, ticking and paging never reload the list.
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultTaxCode, type TaxCode, type TaxPart } from "./sales-tax";
import { codingHistory, type Coding } from "./vendor";
import { bankTypeLabel, chartTypeLabel, type BankRule, type FeedAccount, type FeedLine, type PairChoice } from "./bank-feed";

// Round 32: each line's questions to the client and the client's answers (our side shows initials; the client, their email).
export type FeedQ = { kind: "q" | "a"; body: string; at: string; by: string; files: string[] };
export type FeedChart = { number: string; name: string; type: string; tax_default: string };
export type FeedSplit = { account: string; tax: string; cents: number; memo: string };
export type FeedData = {
  fileId: string; yearStart: string; yearEnd: string; province: string;
  accounts: FeedAccount[]; chart: FeedChart[]; codes: TaxCode[]; ctx: { registered: boolean; quick: boolean }; gstAnswered: boolean;
  defaultTax: Record<string, string | null>;
  lines: FeedLine[]; splits: Record<string, FeedSplit[]>; files: Record<string, { id: string; name: string }[]>;
  rules: BankRule[]; choices: PairChoice[];
  history: [string, { coding: Coding; count: number }][]; firm: [string, Coding][];
  people: Record<string, { initials: string; name: string }>;
  excludedReviewed: { by: string | null; at: string | null; current: boolean };
  me: string | null;   // the signed-in staff member
  threads: Record<string, FeedQ[]>;
  error: string | null;
};

const initials = (n: string) => n.split(/\s+/).filter(Boolean).map((w) => w[0]!.toUpperCase()).slice(0, 3).join("");

export async function loadFeed(supabase: SupabaseClient, file: { id: string; client_id: string; year_start: string; year_end: string }, province: string,
  setup: { gst_registered?: boolean; quick_method?: boolean }): Promise<FeedData> {
  const fileId = file.id;
  const lastYear = `${Number(file.year_end.slice(0, 4)) - 1}${file.year_end.slice(4)}`;
  const [{ data: banks }, { data: chart, error: e1 }, { data: codes }, { data: parts }, { data: lines, error: e2 }, { data: transfers }, { data: splits }, { data: lfiles },
    { data: rules }, { data: choices }, { data: older }, { data: firm }, { data: staff }, { data: f }, { data: keyNow }] = await Promise.all([
    supabase.from("cb_bank_accounts").select("id, number, name, last4, kind, chart_account, account_type, books_opening").eq("file_id", fileId).order("number"),
    supabase.from("cb_chart_accounts").select("number, name, account_type, tax_default").order("sort_order"),
    supabase.from("cb_sales_tax_codes").select("code, name, provinces").order("sort_order"),
    supabase.from("cb_sales_tax_parts").select("code, name, rate, recoverable, liability, effective_from").lte("effective_from", file.year_end).order("effective_from"),
    supabase.from("cb_bank_lines").select("id, account_id, txn_date, acct_date, posted_date, printed_date, description, amount, status, source, chart_account, tax_code, transfer_account, is_split, rule_id, "
      + "reviewer_reason, memo, asked_at, client_question, client_answer, excluded_reason, excluded_note, excluded_by, excluded_at, coded_by, q_status, q_sent_on").eq("file_id", fileId).order("txn_date").order("row_no").limit(50000),
    supabase.from("cb_bank_transfers").select("out_line, in_line").eq("file_id", fileId).limit(50000),
    supabase.from("cb_line_splits").select("line_id, chart_account, tax_code, amount, memo").eq("file_id", fileId).order("row_no").limit(50000),
    supabase.from("cb_line_files").select("id, line_id, name").eq("file_id", fileId).order("uploaded_at").limit(20000),
    supabase.from("cb_bank_rules").select("id, priority, name, direction, accounts, match_all, conditions, txn_type, chart_account, bank_number, tax_code, memo, auto_post, active").eq("client_id", file.client_id).order("priority"),
    supabase.from("cb_bank_pair_choices").select("line_a, line_b, kind").eq("file_id", fileId),
    // How this client's file posted each vendor, this year and last year (transfers left out): the green ✓.
    supabase.from("cb_bank_lines").select("description, chart_account, tax_code, coded_at, file:file_id!inner(client_id, year_end)").in("status", ["done", "reviewer"]).not("chart_account", "is", null)
      .neq("source", "transfer").is("transfer_account", null).eq("file.client_id", file.client_id).lte("file.year_end", file.year_end).gte("file.year_end", lastYear).limit(20000),
    supabase.from("cb_firm_vendor_rules").select("vendor_key, chart_account, tax_mode"),
    supabase.from("staff").select("id, full_name"),
    supabase.from("cb_files").select("excluded_reviewed_key, excluded_reviewed_by, excluded_reviewed_at").eq("id", fileId).maybeSingle(),
    supabase.rpc("cb_excluded_key_of", { p_file: fileId }),
  ]);
  const threads = await readThreads(supabase, fileId, null);
  const latest = new Map<string, TaxPart & { code: string }>();
  for (const p of (parts ?? []) as (TaxPart & { code: string })[]) latest.set(`${p.code}|${p.name}`, { ...p, rate: Number(p.rate) });
  const taxCodes: TaxCode[] = ((codes ?? []) as { code: string; name: string; provinces: string[] | null }[])
    .filter((c) => !c.provinces || c.provinces.includes(province))
    .map((c) => ({ code: c.code, name: c.name, parts: [...latest.values()].filter((p) => p.code === c.code).map(({ name, rate, recoverable, liability }) => ({ name, rate, recoverable, liability })) }));
  const chartRows = (chart ?? []) as { number: string; name: string; account_type: string; tax_default: string }[];
  const chartOf = new Map(chartRows.map((c) => [c.number, c]));
  const accounts: FeedAccount[] = ((banks ?? []) as { id: string; number: string; name: string; last4: string | null; kind: "bank" | "card"; chart_account: string; account_type: string | null; books_opening: number | null }[])
    .map((b) => ({ id: b.id, number: b.number, name: b.name, label: `${b.number} ${b.name}${b.last4 && !b.name.includes(b.last4) ? ` ••• ${b.last4}` : ""}`,
      kind: b.kind, chart: b.chart_account, type: bankTypeLabel(b.account_type, b.kind), openingCents: Math.round(Number(b.books_opening ?? 0) * 100) }));
  // The bank, card and loan accounts' own chart numbers are not offered as expense accounts: they are "Transfer to".
  const bankCharts = new Set(accounts.map((a) => a.chart));
  const defaultTax: Record<string, string | null> = {};
  for (const c of chartRows) defaultTax[c.number] = defaultTaxCode(c.tax_default, province, c.number);
  const tr = (transfers ?? []) as { out_line: string; in_line: string }[];
  const role = new Map<string, FeedLine["transfer"]>();
  for (const t of tr) { role.set(t.out_line, { other: t.in_line, role: "posts" }); role.set(t.in_line, { other: t.out_line, role: "matched" }); }
  const fileRows = (lfiles ?? []) as { id: string; line_id: string; name: string }[];
  const files: FeedData["files"] = {};
  for (const x of fileRows) (files[x.line_id] ??= []).push({ id: x.id, name: x.name });
  const out: FeedLine[] = ((lines ?? []) as unknown as (Omit<FeedLine, "cents" | "files" | "transfer"> & { amount: number })[]).map(({ amount, ...l }) => ({
    ...l, acct_date: l.acct_date ?? l.txn_date, memo: l.memo ?? "", cents: Math.round(Number(amount) * 100), files: files[l.id]?.length ?? 0, transfer: role.get(l.id) ?? null,
  }));
  const sp: FeedData["splits"] = {};
  for (const x of (splits ?? []) as { line_id: string; chart_account: string; tax_code: string; amount: number; memo: string }[])
    (sp[x.line_id] ??= []).push({ account: x.chart_account, tax: x.tax_code, cents: Math.round(Number(x.amount) * 100), memo: x.memo ?? "" });
  const history = codingHistory((older ?? []) as unknown as { description: string; chart_account: string; tax_code: string | null; coded_at: string | null }[]);
  const firmTax = (mode: string, account: string) => mode === "taxable" ? defaultTaxCode("GST/HST", province, account)
    : mode === "none" ? (chartOf.get(account)?.tax_default === "Exempt" ? "EXEMPT" : "OUT_OF_SCOPE") : null;
  const people: FeedData["people"] = {};
  for (const s of (staff ?? []) as { id: string; full_name: string }[]) people[s.id] = { initials: initials(s.full_name ?? ""), name: s.full_name ?? "" };
  const fr = f as { excluded_reviewed_key: string | null; excluded_reviewed_by: string | null; excluded_reviewed_at: string | null } | null;
  const err = e1 ?? e2;
  return {
    fileId, yearStart: file.year_start, yearEnd: file.year_end, province, accounts,
    chart: chartRows.filter((c) => !bankCharts.has(c.number)).map((c) => ({ number: c.number, name: c.name, type: chartTypeLabel(c), tax_default: c.tax_default })),
    codes: taxCodes, ctx: { registered: setup.gst_registered !== false, quick: setup.quick_method === true }, gstAnswered: setup.gst_registered !== undefined, defaultTax,
    lines: out, splits: sp, files, rules: ((rules ?? []) as BankRule[]).map((r) => ({ ...r, conditions: Array.isArray(r.conditions) ? r.conditions : [] })),
    choices: ((choices ?? []) as { line_a: string; line_b: string; kind: "chosen" | "rejected" }[]).map((c) => ({ a: c.line_a, b: c.line_b, kind: c.kind })),
    history: [...history.entries()],
    firm: ((firm ?? []) as { vendor_key: string; chart_account: string; tax_mode: string }[]).map((r) => [r.vendor_key, { account: r.chart_account, tax: firmTax(r.tax_mode, r.chart_account) }]),
    me: (await supabase.auth.getUser()).data.user?.id ?? null,
    threads, people, excludedReviewed: { by: fr?.excluded_reviewed_by ?? null, at: fr?.excluded_reviewed_at ?? null, current: !!fr?.excluded_reviewed_key && fr.excluded_reviewed_key === (keyNow as string | null) },
    error: err ? `Step 4 could not be read: ${err.message}` : null,
  };
}

// Some lines again, after a change (posting, undo, a pair): their status, coding and transfer as the database has them.
export async function readLines(supabase: SupabaseClient, fileId: string, ids: string[]): Promise<{ lines: FeedLine[]; splits: Record<string, FeedSplit[]> }> {
  if (!ids.length) return { lines: [], splits: {} };
  const [{ data: lines }, { data: tr }, { data: lf }, { data: splits }] = await Promise.all([
    supabase.from("cb_bank_lines").select("id, account_id, txn_date, acct_date, posted_date, printed_date, description, amount, status, source, chart_account, tax_code, transfer_account, is_split, rule_id, "
      + "reviewer_reason, memo, asked_at, client_question, client_answer, excluded_reason, excluded_note, excluded_by, excluded_at, coded_by, q_status, q_sent_on").eq("file_id", fileId).in("id", ids),
    supabase.from("cb_bank_transfers").select("out_line, in_line").eq("file_id", fileId).or(`out_line.in.(${ids.join(",")}),in_line.in.(${ids.join(",")})`),
    supabase.from("cb_line_files").select("line_id").eq("file_id", fileId).in("line_id", ids),
    supabase.from("cb_line_splits").select("line_id, chart_account, tax_code, amount, memo").eq("file_id", fileId).in("line_id", ids).order("row_no"),
  ]);
  const role = new Map<string, FeedLine["transfer"]>();
  for (const t of (tr ?? []) as { out_line: string; in_line: string }[]) { role.set(t.out_line, { other: t.in_line, role: "posts" }); role.set(t.in_line, { other: t.out_line, role: "matched" }); }
  const nFiles = new Map<string, number>();
  for (const x of (lf ?? []) as { line_id: string }[]) nFiles.set(x.line_id, (nFiles.get(x.line_id) ?? 0) + 1);
  const sp: Record<string, FeedSplit[]> = {};
  for (const x of (splits ?? []) as { line_id: string; chart_account: string; tax_code: string; amount: number; memo: string }[])
    (sp[x.line_id] ??= []).push({ account: x.chart_account, tax: x.tax_code, cents: Math.round(Number(x.amount) * 100), memo: x.memo ?? "" });
  return {
    lines: ((lines ?? []) as unknown as (Omit<FeedLine, "cents" | "files" | "transfer"> & { amount: number })[]).map(({ amount, ...l }) => ({
      ...l, acct_date: l.acct_date ?? l.txn_date, memo: l.memo ?? "", cents: Math.round(Number(amount) * 100), files: nFiles.get(l.id) ?? 0, transfer: role.get(l.id) ?? null })),
    splits: sp,
  };
}

// Rules with Auto-post, run after a statement is imported (as when step 4 opens): the Pending lines they find post.
export async function autoPostRules(supabase: SupabaseClient, fileId: string): Promise<number> {
  const { data: f } = await supabase.from("cb_files").select("id, client_id, year_start, year_end, setup, client:client_id(province)").eq("id", fileId).maybeSingle();
  if (!f) return 0;
  const setup = (f.setup ?? {}) as { gst_registered?: boolean; quick_method?: boolean };
  if (setup.gst_registered === undefined) return 0;
  const { count } = await supabase.from("cb_bank_rules").select("id", { count: "exact", head: true }).eq("client_id", f.client_id as string).eq("auto_post", true).eq("active", true);
  if (!count) return 0;
  const d = await loadFeed(supabase, { id: fileId, client_id: f.client_id as string, year_start: f.year_start as string, year_end: f.year_end as string },
    ((f.client as unknown as { province: string } | null)?.province ?? "ON"), setup);
  const { findPairs, applyRules, rowView, postItem } = await import("./bank-feed");
  const pairs = findPairs(d.lines, d.accounts, d.choices);
  const rules = applyRules(d.lines, d.rules, d.accounts, pairs);
  const history = new Map(d.history), firm = new Map(d.firm);
  const items = d.lines.filter((l) => rules.get(l.id)?.auto_post).map((l) => {
    const v = rowView(l, pairs, rules, history, firm, d.accounts, (a) => d.defaultTax[a] ?? null);
    return v.source === "auto" ? postItem(l, v) : null;
  }).filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return 0;
  const { error } = await supabase.rpc("cb_post_lines", { p_file: fileId, p_items: items });
  return error ? 0 : items.length;
}

// Round 32: the question threads, for the whole file or some lines.
export async function readThreads(supabase: SupabaseClient, fileId: string, ids: string[] | null): Promise<Record<string, FeedQ[]>> {
  let qq = supabase.from("cb_line_questions").select("id, line_id, kind, body, asked_by, answered_by, created_at").eq("file_id", fileId).order("created_at").limit(20000);
  let ff = supabase.from("cb_line_files").select("line_id, name, question_id").eq("file_id", fileId).not("question_id", "is", null).limit(20000);
  if (ids) { qq = qq.in("line_id", ids); ff = ff.in("line_id", ids); }
  const [{ data: qs }, { data: fs }, { data: staff }] = await Promise.all([qq, ff, supabase.from("staff").select("id, full_name")]);
  const ini = new Map(((staff ?? []) as { id: string; full_name: string }[]).map((s) => [s.id, initials(s.full_name ?? "")]));
  const names = new Map<string, string[]>();
  for (const f of (fs ?? []) as { question_id: string; name: string }[]) names.set(f.question_id, [...(names.get(f.question_id) ?? []), f.name]);
  const out: Record<string, FeedQ[]> = {};
  for (const q of (qs ?? []) as { id: string; line_id: string; kind: "q" | "a"; body: string; asked_by: string | null; answered_by: string; created_at: string }[])
    (out[q.line_id] ??= []).push({ kind: q.kind, body: q.body, at: q.created_at, by: q.kind === "q" ? ini.get(q.asked_by ?? "") ?? "" : q.answered_by, files: names.get(q.id) ?? [] });
  return out;
}
