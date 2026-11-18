import "server-only";
// Round 38 (Hashim, Nov 18, 2026): the Reclassify transactions page (benchmarks: QuickBooks Online's "Reclassify
// Transactions", Xero's "Find and recode"). One row per amount on an account: a bank line's coded side and an entry
// line can move; the bank, card or loan side, a transfer, a split, sales tax, opening balances and an imported trial
// balance show greyed, with where they change instead.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportData } from "./report-data";
import type { CbEntry } from "./server";
import type { CbFileRow } from "./files";
import { entryNo } from "./reports";

export type RcKind = "bank" | "entry";
export type RcRow = {
  id: string;                  // unique per row
  kind: RcKind | "other";
  item: string | null;         // the bank line or entry line to change (null when greyed)
  date: string; source: string; key: string; number: string; account: string; description: string; tax: string;
  cents: number;               // in the account's own sense: money in on revenue, money out on an expense
  why: string;                 // why the row can't change here ('' when it can)
  step: "code" | "entries" | "";
};
export type RcAccount = { key: string; number: string; name: string; type: string; pl: boolean; cents: number };
export type RcTarget = { value: string; label: string; type: string };
export type ReclassifyData = {
  fileId: string; yearStart: string; yearEnd: string; bankFile: boolean; locked: boolean;
  accounts: RcAccount[]; rows: RcRow[]; targets: RcTarget[]; codes: { code: string; name: string }[];
  signed: { code: boolean; entries: boolean };
};

// The account's type from its GIFI line: what the left panel shows under each account, and its normal sense.
export function typeOfLine(line_no: string | null): { type: string; pl: boolean; credit: boolean } {
  const g = Number((line_no ?? "").slice(0, 4));
  if (!g) return { type: "Not matched", pl: false, credit: false };
  if (g < 2600) return { type: "Asset", pl: false, credit: false };
  if (g < 3500) return { type: "Liability", pl: false, credit: true };
  if (g < 8000) return { type: "Equity", pl: false, credit: true };
  if (g < 8300) return { type: "Revenue", pl: true, credit: true };
  return { type: "Expense", pl: true, credit: false };
}

export async function loadReclassify(supabase: SupabaseClient, file: CbFileRow, rdata: ReportData, entries: CbEntry[]): Promise<ReclassifyData> {
  const bankFile = rdata.bankFile;
  const [{ data: lines }, { data: chart }, { data: codes }, { data: signs }, { data: banks }, { data: stored }] = await Promise.all([
    bankFile ? supabase.from("cb_bank_lines").select("id, account_id, status, chart_account, tax_code, is_split, transfer_account, source, memo, description").eq("file_id", file.id).limit(50000)
      : Promise.resolve({ data: [] }),
    supabase.from("cb_chart_accounts").select("number, name, account_type, line_no").order("sort_order"),
    supabase.from("cb_sales_tax_codes").select("code, name").order("code"),
    supabase.from("cb_step_signoffs").select("step, prepared_at").eq("file_id", file.id),
    supabase.from("cb_bank_accounts").select("id, chart_account, number").eq("file_id", file.id),
    supabase.from("cb_accounts").select("id, account_key, number, name, line_no").eq("file_id", file.id),
  ]);
  type L = { id: string; account_id: string; status: string; chart_account: string | null; tax_code: string | null; is_split: boolean; transfer_account: string | null; source: string | null; memo: string | null; description: string };
  const lineById = new Map(((lines ?? []) as L[]).map((l) => [l.id, l]));
  const acc = new Map(rdata.accounts.map((a) => [a.key, a]));
  const kindOf = (key: string) => typeOfLine(acc.get(key)?.line_no ?? null);
  const sense = (key: string, cents: number) => (kindOf(key).credit ? -cents : cents);
  const bankNos = new Set<string>(["10000", "10100", "10200", "22000", "22100", "25000", "25200",
    ...((banks ?? []) as { chart_account: string | null; number: string | null }[]).flatMap((b) => [b.chart_account ?? "", b.number ?? ""]).filter(Boolean)]);
  const rows: RcRow[] = [];
  let n = 0;
  for (const p of rdata.postings) {
    const a = acc.get(p.key);
    const base = { id: `p${n++}`, date: p.date, key: p.key, number: a?.number ?? "", account: a?.name ?? p.key, description: p.label, cents: sense(p.key, p.cents) };
    if (p.kind === "bank") {
      const l = lineById.get(p.ref);
      const coded = !!l && !!l.chart_account && p.key === `chart:${l.chart_account}`;
      const transfer = !!l && (!!l.transfer_account || ["transfer", "outstanding"].includes(l.source ?? ""));
      const why = !l ? "Change in step 4" : transfer ? (l.source === "outstanding" ? "Outstanding item: change in step 3" : "Transfer: change in step 4")
        : l.is_split ? (bankNos.has(a?.number ?? "") ? "Change in step 4" : "Split line: change it with Split in step 4")
        : coded ? "" : ["chart:21500", "chart:21550"].includes(p.key) ? "Sales tax: follows the line's tax code" : "Change in step 4";
      rows.push({ ...base, kind: why ? "other" : "bank", item: why ? null : l!.id, source: "Bank line", tax: l?.tax_code ?? "",
        description: l?.memo ? `${l.description} · ${l.memo}` : base.description, why, step: why ? "" : "code" });
    } else if (p.kind === "opening") {
      rows.push({ ...base, kind: "other", item: null, source: "Opening balance", tax: "", why: "Opening balance: change in step 2", step: "" });
    } else if (p.kind === "import") {
      rows.push({ ...base, kind: "other", item: null, source: "Trial balance import", tax: "", why: "From the imported trial balance: change in step 2", step: "" });
    }
  }
  // Entry lines, one row each (the postings carry the entry, not the line).
  for (const e of entries) {
    const no = entryNo(file.year_end, e);
    for (const l of e.lines) {
      const a = rdata.acctOf(l.account_id);
      const c = Math.round(l.amount * 100);
      if (!a || !c || !l.id) continue;
      const why = l.is_tax ? "Sales tax line: follows the entry (step 5)" : e.origin ? "From a working paper: change it there" : "";
      rows.push({ id: `e${l.id}`, kind: why ? "other" : "entry", item: why ? null : l.id, date: e.entry_date ?? file.year_end, source: no, key: a.key, number: a.number, account: a.name,
        description: [e.note, l.memo].filter(Boolean).join(" · "), tax: l.tax_code ?? "", cents: sense(a.key, c), why, step: why ? "" : "entries" });
    }
  }
  if (file.phase === "locked") for (const r of rows) { r.why = "The file is locked"; r.item = null; r.kind = "other"; r.step = ""; }
  rows.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));

  // The accounts on the left: this year's balance from the same postings.
  const bal = new Map<string, number>();
  for (const p of rdata.postings) bal.set(p.key, (bal.get(p.key) ?? 0) + p.cents);
  const accounts: RcAccount[] = rdata.accounts.filter((a) => a.key !== "uncoded").map((a) => {
    const t = typeOfLine(a.line_no);
    return { key: a.key, number: a.number, name: a.name, type: t.type, pl: t.pl, cents: sense(a.key, bal.get(a.key) ?? 0) };
  }).filter((a) => a.cents !== 0 || rows.some((r) => r.key === a.key)).sort((x, y) => (x.number || "zz").localeCompare(y.number || "zz") || x.name.localeCompare(y.name));

  // Where lines can move: the standard chart (a bank file; never a bank, card or loan account), or this file's accounts.
  type Ch = { number: string; name: string; account_type: string; line_no: string | null };
  const targets: RcTarget[] = bankFile
    ? ((chart ?? []) as Ch[]).filter((c) => !bankNos.has(c.number)).map((c) => ({ value: c.number, label: `${c.number} ${c.name}`, type: c.account_type }))
    : ((stored ?? []) as { id: string; account_key: string; number: string; name: string; line_no: string | null }[])
      .filter((a) => a.line_no && !["opening", "uncoded"].includes(a.account_key))
      .map((a) => ({ value: a.id, label: `${a.number ? `${a.number} ` : ""}${a.name}`, type: typeOfLine(a.line_no).type }));
  const signed = new Set(((signs ?? []) as { step: string; prepared_at: string | null }[]).filter((s) => s.prepared_at).map((s) => s.step));
  return { fileId: file.id, yearStart: file.year_start, yearEnd: file.year_end, bankFile, locked: file.phase === "locked", accounts, rows, targets,
    codes: (codes ?? []) as { code: string; name: string }[], signed: { code: signed.has("code"), entries: signed.has("entries") } };
}
