// CB2-1 Part 3d: the Books reports, built with today's report code (src/lib/closebook/reports.ts) from the client's
// continuous ledger for a date range. The screen and the Excel and PDF exports read the same figures.
import "server-only";
import type { Posting } from "@/lib/closebook/tb-build";
import { journal, ledger, netIncomeBox, statements, tbByGroup, trialBalance } from "@/lib/closebook/reports";
import type { BooksData } from "@/lib/books/server";
import { GEN_MEMO, type GenOrigin } from "@/lib/books/ledger";
import { balanceSheetInput, inputFor } from "../../data";

export const REPORTS = {
  tb: "Trial balance", tbg: "Trial balance by group", bs: "Balance sheet", pl: "Profit and loss", gl: "General ledger", journal: "Journal",
} as const;
export type ReportKey = keyof typeof REPORTS;
export const isReport = (k: string): k is ReportKey => k in REPORTS;

// A transaction behind a posting: an entry (saved or worked out) opens in its window; a bank line in its own view.
export function txnOf(b: BooksData, p: Pick<Posting, "kind" | "ref" | "label">): { type: string; no: string; text: string; href: string } | null {
  if (!p.ref) return null;
  const base = `/cb/${b.client.id}`;
  if (p.ref.startsWith("gen:")) {
    const g = b.books.generated.find((x) => x.id === p.ref);
    return { type: "Journal entry", no: "", text: g ? GEN_MEMO[g.origin as GenOrigin] : p.label, href: `${base}/journal/${encodeURIComponent(p.ref)}` };
  }
  if (p.kind === "bank") return { type: "Bank transaction", no: "", text: p.label, href: `${base}/txn/${p.ref}` };
  const e = b.entries.find((x) => x.id === p.ref);
  if (!e) return null;
  return { type: "Journal entry", no: e.no, text: e.note, href: `${base}/journal/${e.id}` };
}

export function computeReport(b: BooksData, key: ReportKey, from: string, to: string, account?: string) {
  const input = key === "bs" ? balanceSheetInput(b, to) : inputFor(b, from, to);
  const tb = trialBalance(input.accounts, input.postings);
  // The journal and the ledger list transactions; the balance at the start is not one.
  const real = input.postings.filter((p) => p.ref);
  return {
    input, tb,
    groups: key === "tbg" ? tbByGroup(tb, b.info) : null,
    stmts: key === "bs" || key === "pl" ? statements(tb, b.info) : null,
    ledger: key === "gl" ? ledger(input.accounts, input.postings, { key: account, from, to }).map((a) => ({ ...a, lines: a.lines.filter((l) => l.ref) })) : null,
    journal: key === "journal" ? journal(real) : null,
    box: key === "journal" ? netIncomeBox(input.accounts, real, b.info) : null,
  };
}
