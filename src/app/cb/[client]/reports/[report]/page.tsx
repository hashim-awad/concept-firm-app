import Link from "next/link";
import { notFound } from "next/navigation";
import { Fragment, type ReactNode } from "react";
import { ChevronLeft, FileSpreadsheet, FileText } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { NET_INCOME, pctChange, type StmtSection, type TbLine } from "@/lib/closebook/reports";
import { fiscalStart, yearBefore } from "@/lib/books/ledger";
import { acctLabel, getBooks, rangeOf } from "../../../data";
import { computeReport, isReport, REPORTS, txnOf } from "../compute";

// CB2-1 Part 3d: one Books report. Date range (default: the client's current fiscal year), Excel and PDF, and every amount
// opens the transactions behind it (the general ledger), then the transaction itself. Back at every level.
const amt = (c: number) => (c === 0 ? "–" : c < 0 ? `(${(Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })})` : (c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 }));
const SP = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function ReportPage({ params, searchParams }: { params: Promise<{ client: string; report: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { client, report } = await params;
  if (!isReport(report)) notFound();
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const { from, to } = rangeOf(b, { from: SP(sp.from), to: SP(sp.to) });
  const account = SP(sp.account) || undefined;
  const view = SP(sp.view);
  const back = SP(sp.back);
  const base = `/cb/${client}`;
  const here = `${base}/reports/${report}?from=${from}&to=${to}${account ? `&account=${encodeURIComponent(account)}` : ""}${view ? `&view=${view}` : ""}`;
  const r = computeReport(b, report, from, to, account);
  const name = (key: string) => { const a = r.input.accounts.find((x) => x.key === key); return a ? acctLabel(a) : key.replace(/^name:/, ""); };
  // An amount opens the account's general ledger for the same range; Back returns here.
  const gl = (key: string, f = from, t = to) => `${base}/reports/gl?from=${f}&to=${t}&account=${encodeURIComponent(key)}&back=${encodeURIComponent(here)}`;
  const link = (key: string, c: number, f?: string, t?: string): ReactNode => (c === 0 || key.startsWith("total") || key === "ni-last" ? amt(c) : <Link href={gl(key, f, t)} className="hover:underline">{amt(c)}</Link>);
  const exp = (format: string) => `${base}/reports/${report}/export?format=${format}&from=${from}&to=${to}${account ? `&account=${encodeURIComponent(account)}` : ""}${view ? `&view=${view}` : ""}`;
  const bsFrom = fiscalStart(b.books, to);
  const period = report === "bs" ? `As of ${formatDate(to)}` : `${formatDate(from)} to ${formatDate(to)}`;

  const tbRow = (t: TbLine, indent = false, bold = false) => (
    <tr key={t.key} className={bold ? "font-semibold" : ""} data-tb-row={t.key}>
      <td className={indent ? "pl-6" : ""}>{t.number}</td><td>{t.name}</td><td>{(t.line_no ?? "").replace(/\.00$/, "")}</td>
      <td className="text-right tabular-nums">{link(t.key, t.prelim)}</td><td className="text-right tabular-nums">{link(t.key, t.adjust)}</td>
      <td className="text-right tabular-nums">{link(t.key, t.reclass)}</td><td className="text-right tabular-nums">{link(t.key, t.final)}</td>
      <td className="text-right tabular-nums">{link(t.key, t.last, yearBefore(from), yearBefore(to))}</td><td className="text-right tabular-nums">{amt(t.diff)}</td>
      <td className="text-right tabular-nums">{bold && !t.number && t.key === "total" ? "" : pctChange(t.final, t.last)}</td>
    </tr>
  );
  const sec = (s: StmtSection, total: string, f: string, t: string, pf: string, pt: string) => (
    <>
      <tr className="font-bold"><td colSpan={3} className="pt-4">{s.title}</td></tr>
      {s.groups.map((g) => (
        <Fragment key={g.code}>
          <tr key={`g${g.code}`} className={g.code === NET_INCOME ? "" : "font-semibold"}><td className="pl-4">{g.name}</td>
            <td className="text-right tabular-nums">{g.code === NET_INCOME ? <Link href={`${base}/reports/pl?from=${f}&to=${t}&back=${encodeURIComponent(here)}`} className="hover:underline">{amt(g.now)}</Link> : g.accounts.length ? "" : amt(g.now)}</td>
            <td className="text-right tabular-nums">{g.code === NET_INCOME || !g.accounts.length ? amt(g.last) : ""}</td></tr>
          {g.accounts.map((a) => <tr key={a.key} data-stmt-row={a.key}><td className="pl-8">{acctLabel(a)}</td>
            <td className="text-right tabular-nums">{a.now ? <Link href={gl(a.key, f, t)} className="hover:underline">{amt(a.now)}</Link> : "–"}</td>
            <td className="text-right tabular-nums">{a.last ? <Link href={gl(a.key, pf, pt)} className="hover:underline">{amt(a.last)}</Link> : "–"}</td></tr>)}
          {g.accounts.length > 0 && <tr key={`t${g.code}`} className="font-semibold"><td className="pl-4">Total {g.name.charAt(0).toLowerCase()}{g.name.slice(1)}</td>
            <td className="border-t border-sand-300 text-right tabular-nums">{amt(g.now)}</td><td className="border-t border-sand-300 text-right tabular-nums">{amt(g.last)}</td></tr>}
        </Fragment>
      ))}
      <tr className="font-bold"><td>{total}</td><td className="border-t border-ink text-right tabular-nums">{amt(s.now)}</td><td className="border-t border-ink text-right tabular-nums">{amt(s.last)}</td></tr>
    </>
  );

  let body: ReactNode = null;
  if (report === "tb") {
    let dr = 0, cr = 0;
    for (const t of r.tb) { if (t.final > 0) dr += t.final; else cr -= t.final; }
    body = (
      <table className="table" data-report="tb">
        <thead><tr><th>Number</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
        <tbody>{r.tb.filter((t) => t.final).map((t) => (
          <tr key={t.key} data-tb-row={t.key}><td>{t.number}</td><td>{t.name}</td>
            <td className="text-right tabular-nums">{t.final > 0 ? link(t.key, t.final) : ""}</td><td className="text-right tabular-nums">{t.final < 0 ? link(t.key, -t.final) : ""}</td></tr>))}
          <tr className="font-bold"><td /><td>Total</td><td className="border-t border-ink text-right tabular-nums">{amt(dr)}</td><td className="border-t border-ink text-right tabular-nums">{amt(cr)}</td></tr></tbody>
      </table>
    );
  } else if (report === "tbg" && r.groups) {
    body = (
      <table className="table table-compact" data-report="tbg">
        <thead><tr><th>Number</th><th>Account</th><th>GIFI</th><th className="text-right">Prelim</th><th className="text-right">Adj&apos;s</th><th className="text-right">Reclass</th>
          <th className="text-right">Final</th><th className="text-right">Prior</th><th className="text-right">$ change</th><th className="text-right">% change</th></tr></thead>
        <tbody>{r.groups.groups.map((g) => (
          <Fragment key={g.code}>
            <tr key={`h${g.code}`} className="font-bold"><td colSpan={10} className="pt-3">{g.name}</td></tr>
            {g.rows.map((t) => tbRow(t, true))}
            {tbRow(g.total, false, true)}
          </Fragment>
        ))}{tbRow(r.groups.total, false, true)}</tbody>
      </table>
    );
  } else if ((report === "bs" || report === "pl") && r.stmts) {
    const s = r.stmts;
    const [f, t] = report === "bs" ? [bsFrom, to] : [from, to];
    const [pf, pt] = [yearBefore(f), yearBefore(t)];
    body = (
      <table className="table" data-report={report}>
        <thead><tr><th /><th className="text-right">{report === "bs" ? formatDate(to) : `${formatDate(from)} to ${formatDate(to)}`}</th><th className="text-right">{report === "bs" ? formatDate(pt) : `${formatDate(pf)} to ${formatDate(pt)}`}</th></tr></thead>
        <tbody>{report === "bs" ? <>
          {sec(s.bs.assets, "Total assets", f, t, pf, pt)}{sec(s.bs.liabilities, "Total liabilities", f, t, pf, pt)}{sec(s.bs.equity, "Total equity", f, t, pf, pt)}
          {s.bs.clearing && sec(s.bs.clearing, "Total clearing accounts", f, t, pf, pt)}{s.bs.unsorted && sec(s.bs.unsorted, "Total not yet sorted", f, t, pf, pt)}
          <tr className="font-bold"><td className="pt-3">Total liabilities and equity</td><td className="border-t-2 border-ink text-right tabular-nums">{amt(s.bs.totalLE.now)}</td><td className="border-t-2 border-ink text-right tabular-nums">{amt(s.bs.totalLE.last)}</td></tr>
        </> : <>
          {sec(s.pl.revenue, "Total income", f, t, pf, pt)}{sec(s.pl.expenses, "Total expenses", f, t, pf, pt)}
          <tr className="font-bold" data-net-income><td className="pt-3">Net income</td><td className="border-t-2 border-ink text-right tabular-nums">{amt(s.pl.net.now)}</td><td className="border-t-2 border-ink text-right tabular-nums">{amt(s.pl.net.last)}</td></tr>
        </>}</tbody>
      </table>
    );
  } else if (report === "gl" && r.ledger) {
    body = (
      <table className="table table-compact" data-report="gl">
        <thead><tr><th>Date</th><th>Transaction type</th><th>No.</th><th>Description</th><th className="text-right">Amount</th><th className="text-right">Balance</th></tr></thead>
        <tbody>{r.ledger.map((a) => (
          <Fragment key={a.key}>
            <tr key={`h${a.key}`} className="font-bold"><td colSpan={6} className="pt-3">{acctLabel(a)}</td></tr>
            <tr key={`b${a.key}`} className="text-ink-2"><td>{formatDate(from)}</td><td colSpan={3}>Balance at start</td><td /><td className="text-right tabular-nums">{amt(a.before)}</td></tr>
            {a.lines.map((l, i) => {
              const tx = txnOf(b, l);
              const href = tx ? `${tx.href}${tx.href.includes("?") ? "&" : "?"}back=${encodeURIComponent(here)}` : null;
              return (
                <tr key={`${a.key}${i}`} data-gl-line>
                  <td className="whitespace-nowrap">{formatDate(l.date)}</td><td>{tx ? <Link href={href!} className="text-navy-700 hover:underline">{tx.type}</Link> : ""}</td>
                  <td>{tx?.no ?? ""}</td><td className="min-w-[14rem]">{href ? <Link href={href} className="hover:underline">{tx?.text || l.label}</Link> : l.label}</td>
                  <td className="text-right tabular-nums">{amt(l.cents)}</td><td className="text-right tabular-nums">{amt(l.running)}</td>
                </tr>
              );
            })}
            <tr key={`e${a.key}`} className="font-semibold"><td colSpan={5}>Total {acctLabel(a)}</td><td className="border-t border-sand-300 text-right tabular-nums">{amt(a.end)}</td></tr>
          </Fragment>
        ))}
          {!r.ledger.length && <tr><td colSpan={6} className="text-ink-3">No transaction in this range.</td></tr>}</tbody>
      </table>
    );
  } else if (report === "journal" && r.journal && r.box) {
    body = (
      <table className="table table-compact" data-report="journal">
        <thead><tr><th>Date</th><th>Transaction type</th><th>No.</th><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
        <tbody>{r.journal.map((t, i) => {
          const tx = txnOf(b, { kind: t.kind, ref: t.ref, label: t.label });
          const href = tx ? `${tx.href}${tx.href.includes("?") ? "&" : "?"}back=${encodeURIComponent(here)}` : null;
          return (
            <Fragment key={i}>
              <tr key={`h${i}`} className="border-t border-sand-300 font-semibold"><td className="whitespace-nowrap">{formatDate(t.date)}</td>
                <td>{href ? <Link href={href} className="text-navy-700 hover:underline">{tx!.type}</Link> : ""}</td><td>{tx?.no}</td><td colSpan={3}>{tx?.text || t.label}</td></tr>
              {t.lines.map((l, k) => <tr key={`${i}-${k}`}><td colSpan={3} /><td>{name(l.key)}</td><td className="text-right tabular-nums">{l.cents > 0 ? amt(l.cents) : ""}</td><td className="text-right tabular-nums">{l.cents < 0 ? amt(-l.cents) : ""}</td></tr>)}
            </Fragment>
          );
        })}
          <tr><td colSpan={6} className="pt-4" /></tr>
          {([["Net income before entries", r.box.before], ["Adjusting entries", r.box.adjust], ["Reclass entries", r.box.reclass], ["Adjusted net income", r.box.after]] as const).map(([l, v], i) => (
            <tr key={l} className={i === 3 ? "font-bold" : ""} data-ni-box><td colSpan={5} className="text-right">{l}</td><td className="text-right tabular-nums">{amt(v)}</td></tr>))}</tbody>
      </table>
    );
  }
  return (
    <div className="mx-auto grid max-w-6xl gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {back ? <Link href={back} className="inline-flex items-center gap-1 text-[13px] font-semibold text-navy-700 hover:underline" data-back><ChevronLeft className="h-4 w-4" />Back</Link>
          : <Link href={`${base}/reports`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-navy-700 hover:underline"><ChevronLeft className="h-4 w-4" />Reports</Link>}
      </div>
      <form method="get" className="card flex flex-wrap items-end gap-3 p-3" data-report-range>
        {report !== "bs" && <label className="grid gap-1 text-[12px] font-semibold text-ink-3">From<input type="date" name="from" defaultValue={from} className="input input-compact" /></label>}
        {report === "bs" && <input type="hidden" name="from" value={from} />}
        <label className="grid gap-1 text-[12px] font-semibold text-ink-3">{report === "bs" ? "As of" : "To"}<input type="date" name="to" defaultValue={to} className="input input-compact" /></label>
        {account && <input type="hidden" name="account" value={account} />}
        {back && <input type="hidden" name="back" value={back} />}
        <button type="submit" className="btn btn-compact">Run report</button>
        <span className="flex-1" />
        <a href={exp("xlsx")} className="btn-secondary btn-compact" data-export="xlsx"><FileSpreadsheet className="h-4 w-4" />Excel</a>
        <a href={exp("pdf")} target="_blank" rel="noreferrer" className="btn-secondary btn-compact" data-export="pdf"><FileText className="h-4 w-4" />PDF</a>
      </form>
      <div className="card overflow-x-auto p-4">
        <div className="mb-3 text-center"><p className="text-[13px] text-ink-3">{b.client.name}</p><h1 className="text-[18px] font-bold">{REPORTS[report]}{account ? `: ${account.split(",").map(name).join(", ")}` : ""}</h1><p className="text-[13px] text-ink-3">{period}</p></div>
        {body}
      </div>
    </div>
  );
}
