// Closebook reports as full pages (Hashim, Nov 15, 2026; benchmark: QuickBooks Online's reports and
// CaseWare's lead sheets). Opened from "Reports" under the year-end steps; built live from the postings.
// Drill-down, three levels like QuickBooks: an amount opens the account's ledger, a ledger line opens its
// source (the bank line, the adjusting entry or the opening balance), and Back returns to the view and
// the row it came from.
import Link from "next/link";
import type { PostingKind } from "@/lib/closebook/tb-build";
import { journal, KIND_LABEL, ledger, NET_INCOME, statements, trialBalance, type StmtGroup, type StmtSection } from "@/lib/closebook/reports";
import type { ReportData } from "@/lib/closebook/report-data";
import { formatDate } from "@/lib/dates";

export type ReportKey = "tb" | "bs" | "pl" | "gl" | "journal";
export const REPORTS: [ReportKey, string][] = [["tb", "Trial balance"], ["bs", "Balance sheet"], ["pl", "Income statement"], ["gl", "General ledger"], ["journal", "Journal"]];
export const STAMP = "Working paper: not for the client";

export const money = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(-c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })})`
  : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const dateText = (d: string) => (d ? formatDate(d) : "");
const gifi = (line_no: string | null) => (line_no ? line_no.replace(/\.00$/, "") : "");

// back: where this view itself returns to, kept in every link out of it so Back works at every level.
type Params = { report: ReportKey; account?: string; from?: string; to?: string; source?: string; open?: string; back?: string };

export function ReportView({ fileId, data, p, yearEnd, yearStart }: { fileId: string; data: ReportData; p: Params; yearEnd: string; yearStart: string }) {
  const base = `/closebook/${fileId}`;
  const qs = (o: Record<string, string | undefined>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
  const here = (extra: Record<string, string | undefined> = {}) => `${base}?${qs({ report: p.report, account: p.account, from: p.from, to: p.to, source: p.source, open: p.open, back: p.back, ...extra })}`;
  const withBack = (href: string, back: string) => `${href}${href.includes("?") ? "&" : "?"}back=${encodeURIComponent(back)}`;
  const toLedger = (key: string, back: string) => withBack(`${base}?report=gl&account=${encodeURIComponent(key)}`, back);
  const name = (key: string) => { const a = data.accounts.find((x) => x.key === key); return a ? `${a.number ? `${a.number} ` : ""}${a.name}` : key; };
  const exportHref = (format: "xlsx" | "pdf") => `${base}/report-export?${qs({ report: p.report, account: p.account, from: p.from, to: p.to, source: p.source, format })}`;
  const title = REPORTS.find(([k]) => k === p.report)![1];
  const tb = trialBalance(data.accounts, data.postings);

  // The source of one posting: the bank line in Code the transactions, the adjusting entry, or the
  // opening balance in step 2 (the statement in Bank statements for a statement's opening balance).
  const sourceHref = (kind: PostingKind, ref: string, acct: string | undefined, back: string) => {
    if (kind === "bank") return withBack(`${base}?step=code&account=${acct}&line=${ref}`, back) + `#line-${ref}`;
    if (kind === "entry") return withBack(`${base}?step=entries&entry=${ref}`, back) + `#entry-${ref}`;
    if (kind === "import") return withBack(`${base}?step=records`, back);
    if (ref.startsWith("stmt:")) return withBack(`${base}?step=records&account=${ref.slice(5)}`, back);
    return withBack(`${base}?step=opening`, back) + (ref.startsWith("gifi:") ? `#gifi-${ref.slice(5)}` : "");
  };
  const sourceText = (kind: PostingKind, ref: string) => (kind === "entry" ? data.entryLabel.get(ref) ?? KIND_LABEL.entry : KIND_LABEL[kind]);

  const header = (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        <p className="text-sm text-ink-2">{p.report === "bs" ? `As at ${dateText(yearEnd)}` : `${dateText(yearStart)} to ${dateText(yearEnd)}`} · built live from the postings</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-warning-soft px-3 py-1 text-xs font-semibold text-warning">{STAMP}</span>
        <a href={exportHref("xlsx")} className="btn-secondary">Excel</a>
        <a href={exportHref("pdf")} className="btn-secondary">PDF</a>
      </div>
    </div>
  );

  let body: React.ReactNode;
  if (p.report === "tb") {
    const cols: [keyof (typeof tb)[number], string][] = [["last", "Last year"], ["opening", "Opening"], ["activity", data.bankFile ? "Coded activity" : "Imported"], ["adjustments", "Adjusting entries"], ["final", "Final"], ["diff", "Change from last year"]];
    const total = (k: (typeof cols)[number][0]) => tb.reduce((n, t) => n + (t[k] as number), 0);
    body = (
      <div className="card overflow-x-auto p-0">
        <table className="w-full min-w-[760px] table-fixed text-[13px]">
          <colgroup><col /><col className="w-14" />{cols.map(([k]) => <col key={k} className="w-[5.75rem]" />)}</colgroup>
          <thead><tr className="border-b border-sand-200 text-left text-xs text-ink-3"><th className="px-4 py-2 font-semibold">Account</th><th className="px-2 py-2 font-semibold">GIFI</th>
            {cols.map(([, l]) => <th key={l} className="px-2 py-2 text-right font-semibold">{l}</th>)}</tr></thead>
          <tbody>
            {tb.map((t) => (
              <tr key={t.key} id={`a-${t.key}`} className="border-b border-sand-100 target:bg-navy-50">
                <td className="px-4 py-1.5">{t.number && <span className="mr-2 tabular-nums text-ink-3">{t.number}</span>}{t.name}</td>
                <td className="px-2 py-1.5 tabular-nums text-ink-3">{gifi(t.line_no)}</td>
                {cols.map(([k]) => (
                  <td key={k} className={`px-2 py-1.5 text-right whitespace-nowrap tabular-nums ${k === "final" ? "font-semibold" : ""}`}>
                    {(t[k] as number) ? <Link href={toLedger(t.key, here() + `#a-${t.key}`)} className="hover:text-navy-700 hover:underline">{money(t[k] as number)}</Link> : "–"}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="border-t-2 border-ink font-semibold"><td className="px-4 py-2">Total</td><td />{cols.map(([k]) => <td key={k} className="px-2 py-2 text-right tabular-nums">{k === "diff" || k === "last" ? "" : money(total(k))}</td>)}</tr>
          </tbody>
        </table>
        <p className="px-4 py-2 text-xs text-ink-3">Debits positive, credits in brackets. Click an amount to open the account&rsquo;s ledger.</p>
      </div>
    );
  } else if (p.report === "bs" || p.report === "pl") {
    const s = statements(tb, data.info);
    const open = new Set((p.open ?? "").split(",").filter(Boolean));
    const all = open.has("all");
    const group = (g: StmtGroup) => {
      if (g.code === NET_INCOME) return (
        <tr key={g.code} className="border-b border-sand-100"><td className="px-4 py-1.5 pl-8">Net income for the year</td>
          <td className="px-3 py-1.5 text-right tabular-nums"><Link href={withBack(`${base}?report=pl`, here())} className="hover:text-navy-700 hover:underline">{money(g.now)}</Link></td>
          <td className="px-3 py-1.5 text-right tabular-nums text-ink-3">{money(g.last)}</td></tr>
      );
      const backOpen = [...new Set([...open, g.code])].join(",");
      return (
        <tr key={g.code}><td colSpan={3} className="p-0">
          <details open={all || open.has(g.code)} className="group border-b border-sand-100">
            <summary className="flex cursor-pointer list-none items-center px-4 py-1.5 hover:bg-sand-50">
              <span className="flex-1 pl-4"><span aria-hidden className="mr-2 inline-block text-ink-3 transition group-open:rotate-90">›</span>{g.name}</span>
              <span className="w-36 px-3 text-right font-medium tabular-nums">{money(g.now)}</span><span className="w-36 px-3 text-right tabular-nums text-ink-3">{money(g.last)}</span>
            </summary>
            <table className="w-full text-sm"><tbody>
              {g.accounts.map((a) => (
                <tr key={a.key} id={`a-${a.key}`} className="target:bg-navy-50">
                  <td className="px-4 py-1 pl-14 text-ink-2">{a.number && <span className="mr-2 tabular-nums text-ink-3">{a.number}</span>}{a.name}{a.line_no && <span className="ml-2 text-xs text-ink-3">GIFI {gifi(a.line_no)}</span>}</td>
                  <td className="w-36 px-3 py-1 text-right tabular-nums"><Link href={toLedger(a.key, here({ open: backOpen }) + `#a-${a.key}`)} className="hover:text-navy-700 hover:underline">{money(a.now)}</Link></td>
                  <td className="w-36 px-3 py-1 text-right tabular-nums text-ink-3">{money(a.last)}</td>
                </tr>
              ))}
            </tbody></table>
          </details>
        </td></tr>
      );
    };
    const sec = (x: StmtSection, total: string, warn = false) => (
      <>
        <tr><th colSpan={3} className={`px-4 pt-4 pb-1 text-left text-xs font-bold tracking-wide uppercase ${warn ? "text-warning" : "text-navy-700"}`}>{x.title}</th></tr>
        {x.groups.map(group)}
        <tr className="border-b border-sand-300 font-semibold"><td className="px-4 py-1.5">{total}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(x.now)}</td><td className="px-3 py-1.5 text-right tabular-nums text-ink-3">{money(x.last)}</td></tr>
      </>
    );
    const grand = (label: string, v: { now: number; last: number }) => (
      <tr className="border-t-2 border-ink font-semibold"><td className="px-4 py-2">{label}</td><td className="px-3 py-2 text-right tabular-nums">{money(v.now)}</td><td className="px-3 py-2 text-right tabular-nums text-ink-3">{money(v.last)}</td></tr>
    );
    body = (
      <div className="card overflow-x-auto p-0">
        {p.report === "bs" && s.bs.unsorted && <p className="m-4 rounded-lg border border-warning/40 bg-warning-soft px-4 py-2 text-sm">{money(s.bs.unsorted.now)} is not yet sorted: lines still to code, opening balances to enter, or accounts without a GIFI line. It shows under &ldquo;Not yet sorted&rdquo; until it is zero.</p>}
        <div className="flex justify-end px-4 pt-3"><Link href={here({ open: all ? undefined : "all" })} className="text-sm text-navy-700 underline">{all ? "Collapse all" : "Expand all"}</Link></div>
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="text-xs text-ink-3"><th /><th className="w-36 px-3 py-1 text-right font-semibold">This year</th><th className="w-36 px-3 py-1 text-right font-semibold">Last year</th></tr></thead>
          <tbody>
            {p.report === "bs" ? (
              <>
                {sec(s.bs.assets, "Total assets")}
                {sec(s.bs.liabilities, "Total liabilities")}
                {sec(s.bs.equity, "Total equity")}
                {s.bs.unsorted && sec(s.bs.unsorted, "Total not yet sorted", true)}
                {grand("Total liabilities and equity", s.bs.totalLE)}
              </>
            ) : (
              <>
                {sec(s.pl.revenue, "Total revenue")}
                {sec(s.pl.expenses, "Total expenses")}
                {grand("Net income", s.pl.net)}
              </>
            )}
          </tbody>
        </table>
        {p.report === "pl" && s.pl.lastFromT2 && <p className="px-4 py-2 text-sm text-ink-2">Last year&rsquo;s income statement (Schedule 125) was not entered in step 2, so last year shows only its net income, {money(s.pl.net.last)}, the figure on last year&rsquo;s T2.</p>}
        {p.report === "bs" && !s.bs.balanced && <p className="px-4 py-2 text-sm text-danger">The balance sheet does not balance: total assets {money(s.bs.assets.now)}, total liabilities and equity {money(s.bs.totalLE.now)}.</p>}
        <p className="px-4 py-2 text-xs text-ink-3">Liabilities, equity and revenue show as positive; brackets are the opposite side. Click a lead sheet to open its accounts, and an amount to open the ledger.</p>
      </div>
    );
  } else if (p.report === "gl") {
    const accts = ledger(data.accounts, data.postings, { key: p.account, from: p.from, to: p.to });
    body = (
      <div className="grid gap-4">
        <form className="card flex flex-wrap items-end gap-3" action={base}>
          <input type="hidden" name="report" value="gl" />
          {p.back && <input type="hidden" name="back" value={p.back} />}
          <label className="grid gap-1 text-sm">Account
            <select name="account" defaultValue={p.account ?? ""} className="input min-w-64"><option value="">All accounts</option>
              {[...data.accounts].sort((a, b) => Number(!a.number) - Number(!b.number) || a.number.localeCompare(b.number)).map((a) => <option key={a.key} value={a.key}>{a.number ? `${a.number} ` : ""}{a.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm">From<input type="date" name="from" defaultValue={p.from ?? ""} className="input" /></label>
          <label className="grid gap-1 text-sm">To<input type="date" name="to" defaultValue={p.to ?? ""} className="input" /></label>
          <button type="submit" className="btn-secondary">Show</button>
        </form>
        {accts.length === 0 && <p className="card text-sm text-ink-2">No postings for this account and dates.</p>}
        {accts.map((a) => (
          <section key={a.key} className="card overflow-x-auto p-0">
            <h3 className="flex flex-wrap items-baseline justify-between gap-2 border-b border-sand-200 px-4 py-3 font-semibold">
              <span>{a.number && <span className="mr-2 tabular-nums text-ink-3">{a.number}</span>}{a.name}</span>
              {a.line_no && <span className="text-sm font-normal text-ink-3">GIFI {gifi(a.line_no)}</span>}
            </h3>
            <table className="w-full min-w-[760px] text-sm">
              <thead><tr className="text-left text-xs text-ink-3"><th className="px-4 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Source</th><th className="px-2 py-2 font-semibold">Description</th><th className="px-3 py-2 text-right font-semibold">Amount</th><th className="px-4 py-2 text-right font-semibold">Balance</th></tr></thead>
              <tbody>
                {p.from && <tr className="border-t border-sand-100 text-ink-2"><td className="px-4 py-1.5">{dateText(p.from)}</td><td className="px-2 py-1.5" colSpan={2}>Balance before this date</td><td /><td className="px-4 py-1.5 text-right tabular-nums">{money(a.before)}</td></tr>}
                {a.lines.map((l, i) => {
                  const id = `p-${a.key}-${i}`;
                  return (
                    <tr key={id} id={id} className="border-t border-sand-100 target:bg-navy-50">
                      <td className="px-4 py-1.5 whitespace-nowrap">{dateText(l.date)}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap"><Link href={sourceHref(l.kind, l.ref, l.acct, here() + `#${id}`)} className="text-navy-700 hover:underline">{sourceText(l.kind, l.ref)}</Link></td>
                      <td className="px-2 py-1.5">{l.label}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{money(l.cents)}</td>
                      <td className="px-4 py-1.5 text-right tabular-nums">{money(l.running)}</td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-ink font-semibold"><td className="px-4 py-2" colSpan={4}>Balance{p.to ? ` at ${dateText(p.to)}` : ""}</td><td className="px-4 py-2 text-right tabular-nums">{money(a.end)}</td></tr>
              </tbody>
            </table>
          </section>
        ))}
      </div>
    );
  } else {
    const kind = (["opening", "bank", "entry", "import"].includes(p.source ?? "") ? p.source : "") as PostingKind | "";
    const txns = journal(data.postings, kind);
    body = (
      <div className="grid gap-4">
        <form className="card flex flex-wrap items-end gap-3" action={base}>
          <input type="hidden" name="report" value="journal" />
          {p.back && <input type="hidden" name="back" value={p.back} />}
          <label className="grid gap-1 text-sm">Source
            <select name="source" defaultValue={kind} className="input min-w-56"><option value="">Every source</option>
              <option value="bank">Bank lines</option><option value="entry">Adjusting entries</option><option value="opening">Opening balances</option>{!data.bankFile && <option value="import">Trial balance import</option>}</select></label>
          <button type="submit" className="btn-secondary">Show</button>
        </form>
        <div className="card overflow-x-auto p-0">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="border-b border-sand-200 text-left text-xs text-ink-3"><th className="px-4 py-2 font-semibold">Date</th><th className="px-2 py-2 font-semibold">Source</th><th className="px-2 py-2 font-semibold">Account</th><th className="px-3 py-2 text-right font-semibold">Debit</th><th className="px-4 py-2 text-right font-semibold">Credit</th></tr></thead>
            <tbody>
              {txns.length === 0 && <tr><td colSpan={5} className="px-4 py-3 text-ink-2">No postings from this source.</td></tr>}
              {txns.map((t, i) => {
                const id = `t-${i}`;
                return [
                  <tr key={id} id={id} className="border-t-2 border-sand-200 bg-sand-50 target:bg-navy-50">
                    <td className="px-4 py-1.5 whitespace-nowrap">{dateText(t.date)}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{t.kind === "opening" ? <Link href={withBack(`${base}?step=opening`, here() + `#${id}`)} className="text-navy-700 hover:underline">{KIND_LABEL.opening}</Link>
                      : <Link href={sourceHref(t.kind, t.ref, t.acct, here() + `#${id}`)} className="text-navy-700 hover:underline">{sourceText(t.kind, t.ref)}</Link>}</td>
                    <td className="px-2 py-1.5 text-ink-2" colSpan={3}>{t.label}</td>
                  </tr>,
                  ...t.lines.map((l) => (
                    <tr key={`${id}-${l.key}`} className="border-t border-sand-100">
                      <td /><td />
                      <td className="px-2 py-1"><Link href={toLedger(l.key, here() + `#${id}`)} className="hover:text-navy-700 hover:underline">{name(l.key)}</Link></td>
                      <td className="px-3 py-1 text-right tabular-nums">{l.cents > 0 ? money(l.cents) : ""}</td>
                      <td className="px-4 py-1 text-right tabular-nums">{l.cents < 0 ? money(-l.cents) : ""}</td>
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
  return <div>{header}{body}</div>;
}
