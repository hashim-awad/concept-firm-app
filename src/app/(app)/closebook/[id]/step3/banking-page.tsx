// Step 3 "Banking" (round 23, Hashim, Nov 16, 2026; images 1 to 5). Three sub-steps, each its own screen:
//   3.1 Bank accounts & T2 tie-out: one box per T2 line (accounts, Total, Last year's T2, Difference).
//   3.2 Bank feeds: one row per account with 12 month boxes and one status word; a row opens View statements.
//   3.3 Reconcile: one tab per account; OPENING + MONEY IN − MONEY OUT = CLOSING against the BANK; the start
//       band with Explain; the year's lines, 50 a page; "Find it" for any other difference.
// Windows over the page, named by the address: add (and edit), upload, view, fix, find, explain. Round 24 (control
// rules): excl (Exclude statement), repl (Replace file), line (a line's date and memo); View statements has
// Imported and Excluded (vx=1). Nothing is deleted.
// Rules for every screen: no sentences in rows, each action once, numbers right-aligned with negatives in brackets.
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CheckCircle2, XCircle } from "lucide-react";
import { getStatement } from "@/lib/statements/server";
import { loadBanking, loadFindIt, loadFix, loadSubsteps, type BankingAccount, type SubKey } from "@/lib/closebook/banking-server";
import { typeLabel } from "@/lib/statements/types";
import { formatDate } from "@/lib/dates";
import type { AccountType } from "@/lib/closebook/step3";
import { AddAccountWindow, Win } from "./windows";
import { AutoImport, BankingUpload, type UploadSummary } from "./banking-upload";
import { FixScreen } from "./fix-screen";
import { Menu, Pill, date, money, span } from "./banking-ui";
import { addOutstanding, removeOutstanding, setCoverage } from "../../step3-actions";
import { ExcludeWindow, ExcludedActions, LineWindow, ReplaceWindow } from "./feed-windows";
import { reasonLabel } from "@/lib/closebook/feed";
import type { Lock } from "./guard";

type Sp = Record<string, string | string[] | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const PAPER: Record<SubKey, string> = { "3.1": "accounts", "3.2": "feeds", "3.3": "reconcile" };
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const PAGE = 50;

export async function BankingPage({ supabase, file, names, sp, editable, sub, subs, isOwner = false, lock = null }: {
  supabase: SupabaseClient; file: { id: string; year_start: string; year_end: string; opening_source: string | null; first_year: boolean | null };
  names: Map<string, string>; sp: Sp; editable: boolean; sub: SubKey;
  subs?: Awaited<ReturnType<typeof loadSubsteps>>;   // already read by the file page
  isOwner?: boolean; lock?: Lock;                    // round 24: Purge is for owners; a signed 3.2 or 3.3 asks first
}) {
  const fileId = file.id;
  const d = await loadBanking(supabase, file, names, false, subs);
  const base = `/closebook/${fileId}?step=records&paper=${PAPER[sub]}`;
  const accountId = str(sp.account);
  const tab = d.accounts.find((a) => a.id === accountId) ?? d.accounts[0] ?? null;
  const here = `${base}${sub === "3.3" && tab ? `&account=${tab.id}` : ""}${str(sp.page) ? `&page=${str(sp.page)}` : ""}`;
  const opening = `OPENING · ${formatDate(d.dayBefore).toUpperCase()}`;
  const closingDay = formatDate(d.yearEnd).toUpperCase();
  let win: React.ReactNode = null;

  // ---------- Add or edit an account (3.1)
  if (editable && str(sp.add) === "1") {
    const e = d.accounts.find((a) => a.id === str(sp.edit)) ?? null;
    win = <AddAccountWindow lock={lock} c={{ fileId, closeHref: base, then: "", dayBefore: formatDate(d.dayBefore), chartNumbers: d.chartNumbers, taken: d.taken, t2: {}, t2Entered: false,
      others: [], edit: e ? { id: e.id, number: e.number, type: (e.accountType ?? (e.kind === "bank" ? "chequing" : "card")) as AccountType, bank: e.bank, last4: e.last4 ?? "", books: e.books, longTerm: e.longTerm, hasStatements: e.statements.length > 0 } : null,
      prefill: { type: str(sp.type), last4: str(sp.last4), bank: str(sp.bank) } }} />;
  }

  // ---------- Upload statements (3.2, image 3)
  if (str(sp.upload) === "1" && editable && !win) {
    const a = d.accounts.find((x) => x.id === str(sp.acc)) ?? (d.accounts.length === 1 ? d.accounts[0] : null);
    win = <BankingUpload fileId={fileId} accounts={d.accounts.map((x) => ({ id: x.id, label: x.label }))} account={a?.id ?? null} opening={a?.books ?? null}
      closeHref={`/closebook/${fileId}?step=records&paper=feeds`} summary={a ? uploadSummary(d, a) : null} fixBase={base} lock={lock} />;
  }

  // ---------- View statements (one line per statement; QuickBooks Online's). Round 24: Imported and Excluded; each
  // imported statement's "..." menu: Download, Replace file, Exclude statement. Nothing is deleted.
  const viewing = d.accounts.find((a) => a.id === str(sp.view));
  if (viewing && !win) {
    const back = `${here}&view=${viewing.id}`;
    const vx = str(sp.vx) === "1";
    const reason = [viewing.opened && `Opened ${date(viewing.opened)}`, viewing.closed && `Closed ${date(viewing.closed)}`, viewing.note].filter(Boolean).join(". ");
    const tab = (on: boolean, href: string, label: string) => <Link href={href} scroll={false} className={`px-3 py-1 ${on ? "bg-navy-700 font-semibold text-white" : "text-ink-2 hover:bg-sand-50"}`}>{label}</Link>;
    win = (
      <Win title="View statements" sub={viewing.label} closeHref={here} width={760}>
        <div className="inline-flex w-fit overflow-hidden rounded-md border border-sand-300 text-[13px]">
          {tab(!vx, back, "Imported")}<span className="border-l border-sand-300" />{tab(vx, `${back}&vx=1`, `Excluded (${viewing.excluded.length})`)}</div>
        {!vx ? (
          <table className="w-full text-[14px]">
            <thead><tr className="border-b border-sand-200 text-left text-[11.5px] font-semibold tracking-[.06em] text-ink-3 uppercase"><th className="py-2">Period</th><th className="py-2">Uploaded on</th><th className="w-12" /></tr></thead>
            <tbody>
              {viewing.statements.map((s) => (
                <tr key={s.id} className="border-b border-sand-100 align-top">
                  <td className="py-2.5">{span(s.period_start, s.period_end)}
                    {s.earlier.map((h) => <span key={h.id} className="block text-[12.5px] text-ink-3">Earlier file: {h.hasFile ? <a href={`/closebook/${fileId}/statement-pdf?h=${h.id}`} className="underline">{h.file_name}</a> : h.file_name}, replaced {formatDate(h.replaced_at)}{h.by ? ` by ${h.by}` : ""}</span>)}</td>
                  <td className="py-2.5 text-ink-2">{formatDate(s.uploaded_at)}</td>
                  <td className="py-1.5 text-right">
                    <Menu label={`More for ${span(s.period_start, s.period_end)}`}>
                      {s.attachment_path && <a href={`/closebook/${fileId}/statement-pdf?s=${s.id}`} className="block rounded px-3 py-2 hover:bg-sand-50">Download file</a>}
                      {editable && s.source !== "csv" && <Link href={`${back}&repl=${s.id}`} scroll={false} className="block rounded px-3 py-2 hover:bg-sand-50">Replace file</Link>}
                      {editable && <Link href={`${back}&excl=${s.id}`} scroll={false} className="block rounded px-3 py-2 hover:bg-sand-50">Exclude statement</Link>}
                    </Menu>
                  </td>
                </tr>
              ))}
              {viewing.toFix.map((u) => (
                <tr key={u.id} className="border-b border-sand-100">
                  <td className="py-2.5">{u.period_start && u.period_end ? span(u.period_start, u.period_end) : u.file_name}</td><td className="py-2.5"><Pill tone="bad">1 to fix</Pill></td>
                  <td className="py-2.5 text-right"><Link href={`${base}&fix=${u.id}`} scroll={false} className="text-[13px] text-navy-700 underline">Fix it</Link></td>
                </tr>
              ))}
              {!viewing.statements.length && !viewing.toFix.length && <tr><td colSpan={3} className="py-4 text-center text-ink-3">None uploaded.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-[14px]">
            <thead><tr className="border-b border-sand-200 text-left text-[11.5px] font-semibold tracking-[.06em] text-ink-3 uppercase"><th className="py-2">Period</th><th className="py-2">Reason</th><th className="py-2">Excluded by</th><th /></tr></thead>
            <tbody>
              {viewing.excluded.map((x) => (
                <tr key={x.id} className="border-b border-sand-100 align-top">
                  <td className="py-2.5">{span(x.period_start, x.period_end)}<span className="block text-[12.5px] text-ink-3">{x.lines} line{x.lines === 1 ? "" : "s"}{x.hasFile ? <> · <a href={`/closebook/${fileId}/statement-pdf?x=${x.id}`} className="underline">file</a></> : null}</span></td>
                  <td className="py-2.5">{reasonLabel(x.reason, x.note)}</td>
                  <td className="py-2.5 text-ink-2">{x.by}<span className="block text-[12.5px] text-ink-3">{formatDate(x.at)}</span></td>
                  <td className="py-2.5 text-right">{editable && <ExcludedActions fileId={fileId} statement={x.id} canPurge={isOwner && x.reason === "wrong_client"} />}</td>
                </tr>
              ))}
              {!viewing.excluded.length && <tr><td colSpan={4} className="py-4 text-center text-ink-3">None excluded.</td></tr>}
            </tbody>
          </table>
        )}
        {editable && !vx && (viewing.gaps.length > 0 || !viewing.statements.length || reason) && (
          <details className="rounded-[10px] border border-sand-200 px-4 py-3" open={!!reason}>
            <summary className="cursor-pointer text-[13.5px] font-semibold text-navy-700">Record why a period has no statement</summary>
            <form action={setCoverage} className="mt-3 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={viewing.id} /><input type="hidden" name="back" value={back} />
              <label className="grid gap-1 text-[12.5px] text-ink-2">Opened in the year, on<input type="date" name="opened" defaultValue={viewing.opened ?? ""} className="input h-9" /></label>
              <label className="grid gap-1 text-[12.5px] text-ink-2">Closed in the year, on<input type="date" name="closed" defaultValue={viewing.closed ?? ""} className="input h-9" /></label>
              <label className="grid gap-1 text-[12.5px] text-ink-2 sm:col-span-2">No statements (say why)<input name="note" defaultValue={viewing.note} maxLength={300} className="input h-9" /></label>
              <div className="sm:col-span-2"><button type="submit" className="btn-secondary h-9">Save</button></div>
            </form>
          </details>
        )}
      </Win>
    );
  }

  // ---------- Exclude statement, Replace file (round 24)
  const pick = (k: string) => d.accounts.flatMap((a) => a.statements.map((s) => ({ a, s }))).find((x) => x.s.id === str(sp[k]));
  const excl = pick("excl"), repl = pick("repl");
  if (excl && editable) {
    const back = `${here}&view=${excl.a.id}`;
    win = <ExcludeWindow fileId={fileId} statement={excl.s.id} title="Exclude statement" sub={`${excl.a.label} · ${span(excl.s.period_start, excl.s.period_end)}`} closeHref={back}
      lineHref={`/closebook/${fileId}?step=code&account=${excl.a.id}&line=`} explainHref={`/closebook/${fileId}?step=records&paper=reconcile&account=${excl.a.id}&explain=${excl.a.id}&edge=start`} />;
  } else if (repl && editable) {
    win = <ReplaceWindow fileId={fileId} statement={repl.s.id} sub={`${repl.a.label} · ${span(repl.s.period_start, repl.s.period_end)}`} closeHref={`${here}&view=${repl.a.id}`} />;
  }

  // ---------- A line: its date and memo (round 24)
  const lineAcc = str(sp.line) ? d.accounts.find((a) => a.lines.some((l) => l.id === str(sp.line))) : undefined;
  const lineOne = lineAcc?.lines.find((l) => l.id === str(sp.line));
  if (lineAcc && lineOne && editable && !win) {
    win = <LineWindow fileId={fileId} closeHref={here} yearStart={d.yearStart} yearEnd={d.yearEnd}
      line={{ id: lineOne.id, bankDate: lineOne.date, acctDate: lineOne.acctDate, description: lineOne.description, cents: lineOne.cents, memo: lineOne.memo, account: lineAcc.label }} />;
  }

  // ---------- Fix a misread line (image 5)
  if (str(sp.fix) && !win) {
    const [fx, st] = await Promise.all([loadFix(supabase, str(sp.fix)!), getStatement(str(sp.fix)!)]);
    const u = d.uploads.find((x) => x.id === str(sp.fix));
    const a = d.accounts.find((x) => x.id === u?.account);
    if (fx && st) {
      win = <FixScreen id={str(sp.fix)!} title={`${a?.label ?? ""}${fx.acc.periodStart ? ` · ${span(fx.acc.periodStart, fx.acc.periodEnd)}` : ""}`} data={fx.data} accKey={fx.acc.key} miss={fx.miss}
        fileUrl={st.fileUrl} mediaType={st.row.media_type} pages={st.row.pages} backHref={here} target={a?.id ?? null} editable={editable} />;
    }
  }

  // ---------- Find it (QuickBooks Online's reconciliation discrepancy report)
  const finding = d.accounts.find((a) => a.id === str(sp.find));
  if (finding && !win) {
    const f = await loadFindIt(supabase, finding, d.yearStart, d.yearEnd);
    const month = str(sp.month);
    const m = f.months.find((x) => x.from.slice(0, 7) === month) ?? null;
    const findHref = `${here}&find=${finding.id}`;
    const inMonth = <T extends { date: string }>(xs: T[]) => (m ? xs.filter((x) => x.date >= m.from && x.date <= m.to) : []);
    const bankLines = m ? f.statements.flatMap((s) => inMonth(s.lines)) : [];
    const ours = m ? inMonth(finding.lines) : [];
    // A line with no twin on the other side (same day, same amount) is marked.
    const unmatched = (xs: { date: string; cents: number }[], ys: { date: string; cents: number }[]) => {
      const left = [...ys];
      return xs.map((x) => { const i = left.findIndex((y) => y.date === x.date && y.cents === x.cents); if (i >= 0) { left.splice(i, 1); return false; } return true; });
    };
    const bankOff = unmatched(bankLines, ours), oursOff = unmatched(ours, bankLines);
    const lineTable = (title: string, rows: { date: string; description?: string; cents: number }[], off: boolean[]) => (
      <div className="min-w-0"><b className="text-[13.5px]">{title}</b>
        <table className="mt-1.5 w-full text-[13px]"><tbody>
          {rows.map((l, i) => <tr key={i} className={`border-b border-sand-100 ${off[i] ? "bg-warning-soft/70" : ""}`}><td className="py-1.5 pr-2 whitespace-nowrap">{date(l.date).replace(/, \d{4}$/, "")}</td><td className="py-1.5 pr-2">{l.description ?? ""}</td><td className="py-1.5 text-right tabular-nums">{money(l.cents)}</td></tr>)}
          {!rows.length && <tr><td className="py-2 text-ink-3">None.</td></tr>}
        </tbody></table></div>
    );
    win = (
      <Win title="Find it" sub={finding.label} closeHref={here} width={m ? 1100 : 900}>
        <table className="w-full text-[14px]">
          <thead><tr className="border-b border-sand-200 text-[11.5px] font-semibold tracking-[.06em] text-ink-3 uppercase">
            <th className="py-2 pr-4 text-left">Month</th><th className="px-4 py-2 text-right">Bank at the start</th><th className="px-4 py-2 text-right">Bank at the end</th><th className="px-4 py-2 text-right">Our lines</th><th className="py-2 pl-4 text-right">Difference</th></tr></thead>
          <tbody>
            {f.months.map((r) => (
              <tr key={r.from} className={`border-b border-sand-100 ${r.first ? "bg-warning-soft font-semibold" : ""} ${m?.from === r.from ? "outline-2 -outline-offset-2 outline-navy-700" : ""}`}>
                <td className="py-2"><Link href={`${findHref}&month=${r.from.slice(0, 7)}`} scroll={false} className="text-navy-700 underline">{r.label}</Link></td>
                <td className="px-4 py-2 text-right tabular-nums">{r.bankStart === null ? "—" : money(r.bankStart)}</td><td className="px-4 py-2 text-right tabular-nums">{r.bankEnd === null ? "—" : money(r.bankEnd)}</td>
                <td className="px-4 py-2 text-right tabular-nums">{money(r.ours)}</td>
                <td className={`py-2 pl-4 text-right tabular-nums ${r.difference ? "text-danger" : ""}`}>{r.difference === null ? "—" : money(r.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {m && <div className="grid gap-5 border-t border-sand-200 pt-4 md:grid-cols-2">{lineTable(`The statement · ${m.label}`, bankLines, bankOff)}{lineTable(`Our lines · ${m.label}`, ours, oursOff)}</div>}
      </Win>
    );
  }

  // ---------- Explain the start of the year (outstanding items, round 22)
  const explaining = d.accounts.find((a) => a.id === str(sp.explain));
  if (explaining && !win) win = explainWindow(d, explaining, fileId, here, editable);

  // ---------- The sub-step's own screen
  let body: React.ReactNode;
  if (sub === "3.1") {
    body = (
      <div className="grid gap-5">
        {!d.boxes.length && <p className="rounded-[14px] border border-sand-200 bg-white px-6 py-6 text-[14.5px] text-ink-3">No accounts yet.</p>}
        {d.boxes.map((b) => (
          <section key={b.gifi} aria-label={b.title} className="overflow-hidden rounded-[14px] border border-sand-200 bg-white">
            <div className="grid grid-cols-[minmax(0,1fr)_12rem_8.5rem] items-center border-b border-sand-200 px-6 py-4">
              <h3 className="text-[16px] font-semibold">{b.title}</h3><span className="text-right text-[11.5px] font-semibold tracking-[.08em] text-ink-3 uppercase">{opening}</span><span />
            </div>
            {b.rows.map((r) => (
              <div key={r.id} className="grid grid-cols-[minmax(0,1fr)_12rem_8.5rem] items-center border-b border-sand-100 px-6 py-3.5 text-[15px]">
                {editable ? <Link href={`${base}&add=1&edit=${r.id}`} scroll={false} className="text-navy-700 hover:underline">{d.accounts.find((a) => a.id === r.id)?.label}</Link> : <span>{d.accounts.find((a) => a.id === r.id)?.label}</span>}
                <span className="text-right tabular-nums">{r.cents === null ? <span className="text-danger">Not entered</span> : money(r.cents)}</span><span />
              </div>
            ))}
            <div className="grid grid-cols-[minmax(0,1fr)_12rem_8.5rem] items-center border-t-2 border-ink px-6 py-3 text-[15px] font-semibold"><span>Total</span><span className="text-right tabular-nums">{money(b.total)}</span><span /></div>
            {(d.t2Entered || d.firstYear) && <>
              <div className="grid grid-cols-[minmax(0,1fr)_12rem_8.5rem] items-center px-6 py-2 text-[15px] text-ink-2"><span>Last year&rsquo;s T2 · GIFI {b.gifi}</span><span className="text-right tabular-nums">{money(b.t2)}</span><span /></div>
              <div className={`grid grid-cols-[minmax(0,1fr)_12rem_8.5rem] items-center px-6 pt-2 pb-4 text-[15px] font-semibold ${b.state === "rounding" ? "text-success" : b.state === "add" ? "text-warning" : "text-danger"}`}>
                <span>Difference</span><span className="text-right tabular-nums">{money(b.difference)}</span>
                <span className="pl-6 text-[13.5px] font-normal">{b.state === "rounding" ? (b.difference ? "✓ rounding" : "✓") : b.state === "add" ? "to add" : "too much"}</span>
              </div>
            </>}
          </section>
        ))}
      </div>
    );
  } else if (sub === "3.2") {
    const ys = d.yearStart, ye = d.yearEnd;
    body = (
      <section aria-label="Bank feeds" className="overflow-hidden rounded-[14px] border border-sand-200 bg-white">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_11rem] items-center border-b border-sand-200 px-6 py-3 text-[11.5px] font-semibold tracking-[.08em] text-ink-3 uppercase">
          <span>Account</span><span>{MON[+ys.slice(5, 7) - 1]} {ys.slice(0, 4)} to {MON[+ye.slice(5, 7) - 1]} {ye.slice(0, 4)}</span><span>Status</span></div>
        {d.accounts.map((a) => (
          <Link key={a.id} href={`${base}&view=${a.id}`} scroll={false} className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_11rem] items-center border-b border-sand-100 px-6 py-4 text-[15px] last:border-b-0 hover:bg-sand-50">
            <span>{a.label}</span>
            <span className="flex gap-1.5" aria-label={`Months: ${a.feed.word}`}>{a.months.map((m, i) => (
              <i key={i} title={`${span(m.from, m.to)}: ${m.state === "in" ? "covered" : m.state === "missing" ? "missing" : "nothing uploaded"}`}
                className={`grid h-7 w-7 place-items-center rounded-[5px] text-[11px] font-bold not-italic ${m.state === "in" ? "bg-success-soft text-success" : m.state === "missing" ? "bg-danger-soft text-danger" : "bg-sand-100 text-ink-3"}`}>{m.label}</i>))}</span>
            <span><Pill tone={a.feed.tone}>{a.feed.word}</Pill></span>
          </Link>
        ))}
        {!d.accounts.length && <p className="px-6 py-5 text-[14px] text-ink-3">Add the accounts in 3.1 first.</p>}
      </section>
    );
  } else {
    body = tab ? reconcile(d, tab, base, here, opening, closingDay, Math.max(1, Number(str(sp.page) ?? "1") || 1), editable) : <p className="text-[14.5px] text-ink-3">Add the accounts in 3.1 first.</p>;
  }

  return (
    <>
      {body}
      {win}
      {editable && sub !== "3.1" && !str(sp.upload) && <AutoImport fileId={fileId} locked={!!lock} items={d.pending.map((u) => ({ id: u.id, account: u.account!, file: u.file_name }))} />}
    </>
  );
}

// What the upload window lists for one account.
function uploadSummary(d: Awaited<ReturnType<typeof loadBanking>>, a: BankingAccount): UploadSummary {
  const mine = d.uploads.filter((u) => (u.account === a.id || u.target_account === a.id) && u.state.status !== "imported" && u.state.status !== "skipped");
  return {
    lines: a.lines.length, yearLabel: `${date(d.yearStart)} to ${date(d.yearEnd)}`, outside: a.statements.reduce((n, s) => n + s.outside_lines, 0),
    closing: a.band.closing, bank: a.band.bank, matches: a.band.difference === null ? null : a.band.difference === 0 && (!a.band.start?.show || a.band.start.explained),
    startOff: a.band.start?.show && !a.band.start.explained ? a.band.start.opening - a.band.start.bank : null,
    missing: a.statements.length ? a.gaps.map((g) => span(g.from, g.to)) : [],
    toFix: a.toFix.map((u) => ({ id: u.id, label: u.period_start && u.period_end ? span(u.period_start, u.period_end) : u.file_name })),
    reading: mine.filter((u) => u.state.status === "reading").length,
    refused: mine.filter((u) => ["wrong_account", "no_account", "already", "copy", "outside"].includes(u.state.status))
      .map((u) => ({ id: u.id, file: u.file_name, why: u.state.status === "already" || u.state.status === "copy" ? "It is already in." : u.state.status === "outside" ? "It is outside the year." : u.state.reason })),
    pending: d.pending.filter((u) => u.account === a.id).map((u) => ({ id: u.id, file: u.file_name })),
  };
}

// 3.3: the tabs, the band, the start band, the year's lines.
function reconcile(d: Awaited<ReturnType<typeof loadBanking>>, a: BankingAccount, base: string, here: string, opening: string, closingDay: string, page: number, editable: boolean) {
  const b = a.band;
  const missing = a.statements.length ? a.gaps.length : 0;
  const word = (x: BankingAccount) => (x.toFix.length ? `${x.toFix.length} to fix` : !x.statements.length ? "Not uploaded" : x.gaps.length ? `${x.gaps.length} missing` : null);
  const ok = (x: BankingAccount) => x.band.difference === 0 && (!x.band.start?.show || x.band.start.explained) && !word(x);
  const cap = "mt-1 block text-[11.5px] font-semibold tracking-[.06em] text-ink-3 uppercase";
  const num = "block text-[26px] leading-none font-semibold tabular-nums";
  const op = <span className="self-center px-1 text-[22px] text-ink-3">{"+"}</span>;
  const inWord = typeLabel(a.kind, "in").toUpperCase(), outWord = typeLabel(a.kind, "out").toUpperCase();
  const lines = a.lines;
  const pages = Math.max(1, Math.ceil(lines.length / PAGE)), p = Math.min(page, pages);
  // The balance in the books after each line (a line that cleared a start-of-year item posts nothing).
  let run = a.books ?? 0;
  const withBal = lines.map((l) => { if (!l.outstanding) run += l.cents; return { ...l, bal: run }; });
  const shown = withBal.slice((p - 1) * PAGE, p * PAGE);
  const fix = a.toFix[0];
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2.5" role="tablist">
        {d.accounts.map((x) => (
          <Link key={x.id} href={`${base}&account=${x.id}`} scroll={false} role="tab" aria-selected={x.id === a.id}
            className={`rounded-[10px] border bg-white px-4 py-2.5 text-[15px] ${x.id === a.id ? "border-2 border-navy-700 px-[15px] py-[9px] font-semibold" : "border-sand-300 hover:border-navy-300"}`}>
            {x.label}{ok(x) ? <span className="ml-1.5 text-success">✓</span> : word(x) ? <span className="text-danger"> · {word(x)}</span> : null}
          </Link>
        ))}
      </div>
      <section aria-label="Reconcile" className="flex flex-wrap items-start gap-x-5 gap-y-3 rounded-[14px] border border-sand-200 bg-white px-7 py-5">
        <span><span className={num}>{b.opening === null ? "—" : money(b.opening)}</span><span className={cap}>{opening}</span></span>{op}
        <span><span className={num}>{money(b.inCents)}</span><span className={cap}>{b.inCount} {inWord}</span></span><span className="self-center px-1 text-[22px] text-ink-3">−</span>
        <span><span className={num}>{money(b.outCents)}</span><span className={cap}>{b.outCount} {outWord}</span></span><span className="self-center px-1 text-[22px] text-ink-3">=</span>
        <span><span className={num}>{b.closing === null ? "—" : money(b.closing)}</span><span className={cap}>CLOSING · {closingDay}</span></span>
        <span className="flex-1" />
        <span><span className={num}>{b.bank === null ? "—" : money(b.bank)}</span><span className={cap}>BANK · {closingDay}</span></span>
        <span className="flex items-start gap-3">
          {b.difference === 0 ? <CheckCircle2 className="h-9 w-9 fill-success text-white" aria-hidden /> : b.difference !== null ? <XCircle className="h-9 w-9 fill-danger text-white" aria-hidden /> : null}
          <span><span className={`${num} ${b.difference === null ? "text-ink-3" : b.difference === 0 ? "" : "text-danger"}`}>{b.difference === null ? "—" : money(b.difference)}</span><span className={cap}>DIFFERENCE</span></span>
        </span>
        {fix ? <Link href={`${base}&account=${a.id}&fix=${fix.id}`} scroll={false} className="btn h-10 self-center">Fix it</Link>
          : b.difference !== null && b.difference !== 0 ? <Link href={`${here}&find=${a.id}`} scroll={false} className="btn h-10 self-center">Find it</Link>
          : missing ? <Link href={base.replace(/paper=\w+/, "paper=feeds")} scroll={false} className="btn-secondary h-10 self-center">Go to 3.2</Link> : null}
      </section>
      {b.start?.show && (
        <section aria-label="Start of the year" className="flex flex-wrap items-start gap-x-8 gap-y-3 rounded-[14px] border border-sand-200 bg-white px-7 py-4">
          <span><span className="block text-[20px] font-semibold tabular-nums">{money(b.start.bank)}</span><span className={cap}>BANK · {opening.replace("OPENING · ", "")}</span></span>
          <span><span className="block text-[20px] font-semibold tabular-nums">{money(b.start.opening)}</span><span className={cap}>{opening}</span></span>
          <span><span className={`block text-[20px] font-semibold tabular-nums ${b.start.explained ? "text-success" : "text-danger"}`}>{money(b.start.opening - b.start.bank)}{b.start.explained ? " ✓" : ""}</span><span className={cap}>DIFFERENCE</span></span>
          <span className="flex-1" />
          <Link href={`${here}&explain=${a.id}&edge=start`} scroll={false} className={`${b.start.explained ? "btn-secondary" : "btn"} h-10 self-center`}>Explain</Link>
        </section>
      )}
      <section aria-label="Transactions" className="overflow-hidden rounded-[14px] border border-sand-200 bg-white">
        <table className="w-full text-[14.5px]">
          <thead><tr className="border-b border-sand-200 text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">
            <th className="px-6 py-3 text-left">Date</th><th className="px-3 py-3 text-left">Description</th><th className="px-3 py-3 text-right">{typeLabel(a.kind, "in")}</th><th className="px-3 py-3 text-right">{typeLabel(a.kind, "out")}</th><th className="px-6 py-3 text-right">Balance</th><th className="w-10" /></tr></thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} className={`border-b border-sand-100 ${l.outstanding ? "text-ink-3" : ""}`}>
                <td className="px-6 py-3 whitespace-nowrap">{date(l.date)}{l.acctDate !== l.date && <span className="block text-[12px] text-ink-3">Posted {date(l.acctDate)}</span>}</td>
                <td className="px-3 py-3">{l.description}{l.memo && <span className="block text-[12.5px] text-ink-3">Memo: {l.memo}</span>}</td>
                <td className="px-3 py-3 text-right tabular-nums">{l.cents > 0 ? money(l.cents) : ""}</td><td className="px-3 py-3 text-right tabular-nums">{l.cents < 0 ? money(-l.cents) : ""}</td>
                <td className="px-6 py-3 text-right tabular-nums">{money(l.bal)}</td>
                <td className="pr-3 text-right">{editable && <Link href={`${base}&account=${a.id}&page=${p}&line=${l.id}`} scroll={false} aria-label={`Date and memo for ${l.description}`} className="text-[12.5px] text-navy-700 underline">Edit</Link>}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="px-6 py-5 text-ink-3">No transactions yet.</td></tr>}
          </tbody>
        </table>
        <div className="flex flex-wrap items-center gap-5 px-6 py-3.5 text-[14px]">
          <span className="text-ink-3">{lines.length ? `${(p - 1) * PAGE + 1} to ${Math.min(p * PAGE, lines.length)} of ${lines.length}` : ""}</span><span className="flex-1" />
          <Link href={`${base}&account=${a.id}&page=${p}&view=${a.id}`} scroll={false} className="text-navy-700 underline">View statements</Link>
          {p > 1 && <Link href={`${base}&account=${a.id}&page=${p - 1}`} scroll={false} className="text-navy-700 underline">Previous page</Link>}
          {p < pages && <Link href={`${base}&account=${a.id}&page=${p + 1}`} scroll={false} className="text-navy-700 underline">Next page</Link>}
        </div>
      </section>
    </div>
  );
}

// The outstanding items window (round 22): the bank against the opening at the start of the year; each item can
// name the line that cleared it in the year, which then posts nothing.
function explainWindow(d: Awaited<ReturnType<typeof loadBanking>>, a: BankingAccount, fileId: string, here: string, editable: boolean) {
  const b = a.band.start;
  const items = d.outstanding.filter((i) => i.account_id === a.id && i.edge === "start");
  const back = `${here}&explain=${a.id}&edge=start`;
  const left = b ? b.left : 0;
  const word = a.kind === "card" ? { in: "Charge not yet posted", out: "Payment not yet posted" } : { in: "Deposit not yet credited", out: "Cheque or payment not yet cleared" };
  const row = (l: string, v: string, bold = false) => <tr className="border-b border-sand-100"><td className={`py-2 ${bold ? "font-semibold" : ""}`}>{l}</td><td className={`py-2 text-right tabular-nums ${bold ? "font-semibold" : ""}`}>{v}</td><td className="w-20" /></tr>;
  return (
    <Win title="Explain" sub={`${a.label} · ${formatDate(d.dayBefore)}`} closeHref={here} width={760} footer={<>
      <span className={`text-[13.5px] font-semibold ${Math.abs(left) < 100 ? "text-success" : "text-danger"}`}>{Math.abs(left) < 100 ? "Difference left: 0.00." : `Difference left: ${money(Math.abs(left))}. It must reach 0.00.`}</span>
      <span className="flex-1" /><Link href={here} scroll={false} className="btn h-9">Close</Link></>}>
      <table className="w-full text-[13.5px]"><tbody>
        {row("Bank on the day before the year", b ? money(b.bank) : "—")}
        {row("Opening (3.1)", b ? money(b.opening) : "—")}
        {row("Difference", b ? money(Math.abs(b.opening - b.bank)) : "—", true)}
      </tbody></table>
      <div className="grid gap-1"><b className="text-[14px]">Outstanding items</b>
        {items.length ? (
          <table className="w-full text-[13.5px]"><tbody>
            {items.map((i) => (
              <tr key={i.id} className="border-b border-sand-100">
                <td className="py-2">{date(i.item_date)} · {i.description}<span className="ml-1 text-[12px] text-ink-3">({i.dir === "out" ? word.out : word.in}{i.cleared_line ? "; its line in the year posts nothing" : ""})</span></td>
                <td className="py-2 text-right tabular-nums">{money(i.dir === "out" ? -i.amount : i.amount)}</td>
                <td className="w-20 text-right">{editable && <form action={removeOutstanding}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={a.id} />
                  <input type="hidden" name="item" value={i.id} /><input type="hidden" name="back" value={back} /><button type="submit" className="text-[12.5px] text-danger underline">Remove</button></form>}</td>
              </tr>
            ))}
          </tbody></table>
        ) : <p className="text-[13px] text-ink-3">None added yet.</p>}
      </div>
      {editable && (
        <details className="rounded-[10px] border border-sand-200 bg-sand-50/60 px-4 py-3" open={Math.abs(left) >= 100}>
          <summary className="cursor-pointer text-[13.5px] font-semibold text-navy-700">+ Add item</summary>
          <form action={addOutstanding} className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
            <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={a.id} /><input type="hidden" name="edge" value="start" /><input type="hidden" name="back" value={back} />
            <label className="grid gap-1 text-[12.5px] text-ink-2">Date<input type="date" name="date" required className="input h-9" /></label>
            <label className="grid gap-1 text-[12.5px] text-ink-2">Kind<select name="dir" className="input h-9"><option value="out">{word.out}</option><option value="in">{word.in}</option></select></label>
            <label className="grid gap-1 text-[12.5px] text-ink-2 sm:col-span-2">Description<input name="description" required maxLength={200} placeholder="For example: Cheque #204" className="input h-9" /></label>
            <label className="grid gap-1 text-[12.5px] text-ink-2">Amount<input name="amount" required inputMode="decimal" placeholder="0.00" className="input h-9 text-right" /></label>
            <label className="grid gap-1 text-[12.5px] text-ink-2">Cleared in the year by
              <select name="cleared_line" className="input h-9"><option value="">Not cleared yet</option>{a.early.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
            <div className="sm:col-span-2"><button type="submit" className="btn h-9">Add item</button></div>
          </form>
        </details>
      )}
    </Win>
  );
}
