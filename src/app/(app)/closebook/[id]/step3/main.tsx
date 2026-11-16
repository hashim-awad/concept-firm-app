// Closebook step 3 main page (round 22, Hashim, Nov 16, 2026; mock screens 1 and 8). Benchmarks: QuickBooks
// Online Banking (one card per account; "Upload from file" opens a window) and CaseWare Cloud (each account
// under its GIFI line, tied to last year). A calm page: every task opens a window that closes back here, and
// the "Next:" line always names one action.
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Plus, Upload } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dates";
import { longDate, type Cell } from "@/lib/closebook/step3";
import { money, type S3Account, type Step3 } from "@/lib/closebook/step3-server";
import { signStep } from "../../actions";
import { addOutstanding, removeOutstanding, setCoverage, setNotOurs } from "../../step3-actions";
import { ConversionRecord } from "../conversion-record";

const CELL: Record<Cell["state"], string> = {
  in: "border-success/40 bg-success-soft text-success", part: "border-warning/50 bg-warning-soft text-warning", check: "border-danger/40 bg-danger-soft text-danger",
  missing: "border-dashed border-sand-300 bg-white text-ink-3", na: "border-sand-200 bg-sand-100 text-ink-3/60", wait: "border-warning/50 bg-warning-soft text-warning",
};
const TONE = { ok: "text-success", warn: "text-warning", bad: "text-danger", "": "text-ink-3" } as const;
const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;

export function Step3Main({ fileId, d, selected, editable, problems, signed, issues }: {
  fileId: string; d: Step3; selected: string | null; editable: boolean; problems: string[]; signed: boolean; issues?: React.ReactNode;
}) {
  const href = (q = "") => `/closebook/${fileId}?step=records${q}`;
  const acc = d.accounts.find((a) => a.id === selected) ?? null;
  const nextHref = d.next.action === "add" ? href("&add=1") : d.next.account && ["check", "upload", "gap"].includes(d.next.action) ? href(`&account=${d.next.account}&upload=${d.next.account}`)
    : d.next.account ? href(`&account=${d.next.account}`) : d.next.action === "check" ? href(`&upload=all`) : null;
  const nextLabel = { add: "Add account", books: "Enter the balance", check: "Check statements", upload: "Upload statements", gap: "Upload statements", tie: "", edge: "Show the account", failed: "Open the list", wrong: "Open the list", possible: "", sign: "", done: "" }[d.next.action];
  return (
    <div className="grid gap-4">
      {issues}
      {/* Point 1: one action */}
      <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-sand-200 border-l-4 border-l-navy-700 bg-white px-4 py-3">
        <ArrowRight className="h-4 w-4 text-navy-700" aria-hidden />
        <p className="text-[14px]"><b className="text-navy-900">Next:</b> {d.next.text}</p>
        <span className="flex-1" />
        {editable && nextHref && nextLabel && <Link href={(d.next.action === "failed" || d.next.action === "wrong") ? href("&upload=all") : nextHref} scroll={false} className="btn h-9">{nextLabel}</Link>}
        {editable && d.next.action === "sign" && <SignButton fileId={fileId} />}
      </div>

      {/* Point 18: a card the payments go to, not set up */}
      {d.possible.map((p) => (
        <div key={p.last4} className="flex flex-wrap items-center gap-3 rounded-[10px] border border-warning/40 bg-warning-soft px-4 py-2.5 text-[13.5px] text-[#5c4400]">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          <span><b>Possible account not set up: {p.label}.</b> {p.count} payment{p.count === 1 ? "" : "s"} from a bank account go{p.count === 1 ? "es" : ""} to it, for example {longDate(p.example.date)} &ldquo;{p.example.description}&rdquo; {money(p.example.cents)}.</span>
          <span className="flex-1" />
          {editable && <>
            <Link href={href(`&add=1&type=${/VISA|MC|AMEX/.test(p.label) ? "card" : "loc"}&last4=${p.last4}`)} scroll={false} className="btn h-8 px-3 text-[13px]">Add it</Link>
            <form action={setNotOurs}>{hidden("file_id", fileId)}{hidden("last4", p.last4)}{hidden("label", p.label)}<button type="submit" className="btn-secondary h-8 px-3 text-[13px]">Not ours</button></form>
          </>}
        </div>
      ))}

      {/* Point 2: one card per account */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {d.accounts.map((a) => <AccountCard key={a.id} a={a} on={a.id === selected} href={href} editable={editable} dayBefore={d.dayBefore} />)}
        {editable && (
          <Link href={href(`${selected ? `&account=${selected}` : ""}&add=1`)} scroll={false}
            className="grid min-h-[170px] place-items-center content-center gap-1 rounded-[12px] border border-dashed border-sand-300 bg-white p-4 text-center hover:border-navy-300">
            <Plus className="h-5 w-5 text-navy-700" aria-hidden /><span className="font-semibold text-navy-700">Add account</span>
            <span className="text-[12.5px] text-ink-3">Bank account, credit card, line of credit or loan</span>
          </Link>
        )}
      </div>

      {/* Point 4: the tie to step 2, per GIFI line */}
      {d.accounts.length > 0 && (
        <section aria-label="Ties to step 2" className="rounded-[12px] border border-sand-200 bg-white">
          <div className="flex flex-wrap items-baseline gap-2 px-4 pt-3 pb-1"><b className="text-[14px]">Ties to step 2</b>
            <span className="text-[12.5px] text-ink-3">Each GIFI line: the accounts&rsquo; balances in the books on {formatDate(d.dayBefore)} against last year&rsquo;s T2</span></div>
          {!d.t2Entered ? <p className="px-4 pb-3 text-[13px] text-ink-2">Enter last year&rsquo;s balances in step 2 to see the ties.</p>
            : d.ties.map((t) => (
              <div key={t.gifi} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-sand-100 px-4 py-2.5 text-[13.5px]">
                {t.ties ? <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Ties</span>
                  : <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Off by {money(Math.abs(t.books - t.t2))}</span>}
                <span className="min-w-[19rem]">{gifiWord(t.gifi)} ({t.numbers.join(", ")}) <b className="tabular-nums">{money(t.books)}</b></span>
                <span>T2 line {t.gifi} <b className="tabular-nums">{money(t.t2)}</b></span>
                <span className="flex-1" />
                {t.ties ? <span className="text-success">✓</span> : <span className="text-danger">Check the balance in the books for each account, or last year&rsquo;s {t.gifi} in step 2.</span>}
              </div>
            ))}
        </section>
      )}

      {/* Point 23: what the sign-off waits for */}
      {!signed && problems.length > 0 && (
        <p className="text-right text-[12.5px] text-ink-3">To sign: {toSign(d).join(", ") || problems[0].replace(/\.$/, "")}.</p>
      )}

      {acc && <AccountDetail fileId={fileId} a={acc} d={d} editable={editable} href={href} />}
    </div>
  );
}

// Point 23 in short words: what "Sign as preparer" waits for.
function toSign(d: Step3): string[] {
  const out: string[] = [];
  const n = (k: number, w: string) => `${k} ${w}${k === 1 ? "" : "s"}`;
  for (const a of d.accounts) {
    if (a.books === null) out.push(`enter the books balance for ${a.number}`);
    if (a.waiting) out.push(`check ${n(a.waiting, "statement")} on ${a.number}`);
    else if (!a.statements.length && a.missing.length) out.push(`upload ${a.number} or record why there are none`);
    else if (a.missing.length) out.push(`fill ${a.missing.length === 1 ? `the ${MONTHS[+a.missing[0].to.slice(5, 7) - 1]} ${a.missing[0].to.slice(0, 4)} gap` : `${n(a.missing.length, "gap")}`} on ${a.number}`);
    if (!a.start.explained) out.push(`explain the start-of-year difference on ${a.number}`);
    if (!a.end.explained) out.push(`explain the year-end difference on ${a.number}`);
  }
  const reading = d.uploads.filter((u) => u.state.status === "reading").length;
  if (reading) out.push(`wait for ${n(reading, "statement")} still reading`);
  for (const t of d.ties) if (!t.ties) out.push(`fix the ${t.gifi} difference`);
  return out;
}
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const gifiWord = (g: string) => ({ "1002": "Bank accounts", "2707": "Credit cards", "2701": "Lines of credit and loans", "3149": "Long-term lines of credit", "3143": "Bank loans", "2600": "Bank overdraft" }[g] ?? `GIFI ${g}`);

function SignButton({ fileId }: { fileId: string }) {
  return (
    <form action={signStep}>{hidden("file_id", fileId)}{hidden("step", "records")}{hidden("role", "prepared")}{hidden("back", `/closebook/${fileId}?step=records`)}
      <button type="submit" className="btn h-9">Sign as preparer</button></form>
  );
}

function AccountCard({ a, on, href, editable, dayBefore }: { a: S3Account; on: boolean; href: (q?: string) => string; editable: boolean; dayBefore: string }) {
  const pill = a.waiting ? ["bg-warning-soft text-warning", `${a.waiting} to check`] : !a.statements.length && !a.note && !a.opened && !a.closed ? ["bg-sand-100 text-ink-2", "None yet"]
    : a.missing.length || a.breaks.length ? ["bg-danger-soft text-danger", a.breaks.length && !a.missing.length ? "Check" : `${a.missing.length} gap${a.missing.length === 1 ? "" : "s"}`] : ["bg-success-soft text-success", "Complete"];
  const typeWord = a.accountType ? { chequing: "Bank account", savings: "Bank account", card: "Credit card", loc: "Line of credit", loan: "Loan" }[a.accountType] : a.kind === "bank" ? "Bank account" : "Card or line of credit";
  const cycle = a.cycleDay === 1 ? "calendar months" : `cycles on the ${ordinal(a.cycleDay)}`;
  return (
    <div className={`relative grid content-start gap-2 rounded-[12px] border bg-white p-4 ${on ? "border-2 border-navy-700 p-[15px]" : "border-sand-200 hover:border-navy-300"}`}>
      <Link href={href(`&account=${a.id}`)} scroll={false} className="absolute inset-0 rounded-[12px]" aria-label={`Show ${a.label}`} />
      <div className="flex items-start gap-2"><h3 className="text-[14.5px] font-semibold">{a.label}</h3><span className="flex-1" />
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${pill[0]}`}>{pill[1]}</span></div>
      <p className="text-[12px] text-ink-3">{typeWord} · GIFI {a.gifi}{a.statements.length ? ` · ${cycle}` : ""}</p>
      <p className="flex justify-between gap-2 text-[12.5px]"><span className="text-ink-3">Opening balance (books) {formatDate(dayBefore)}</span>
        <b className="tabular-nums">{a.books === null ? <span className="text-danger">Not entered</span> : money(a.books)}</b></p>
      {a.start.statements !== null && (
        <p className="flex justify-between gap-2 text-[12.5px]"><span className="text-ink-3">From the statements, {formatDate(dayBefore)}</span>
          <span className={`tabular-nums ${a.start.difference ? (a.start.explained ? "text-success" : "text-danger") : "text-success"}`}>{money(a.start.statements)}
            {a.start.difference ? ` · difference ${money(Math.abs(a.start.difference))}${a.start.explained ? " explained ✓" : ""}` : " ✓"}</span></p>
      )}
      <span className="flex gap-[3px]" aria-label={a.status.text}>
        {a.cells.map((c, i) => <i key={i} title={`${formatDate(c.from)} to ${formatDate(c.to)}: ${c.state === "in" ? "in" : c.state === "na" ? "not needed" : c.state === "check" ? "does not follow" : c.state === "part" ? "part" : c.state === "wait" ? "waiting to check" : "missing"}`}
          className={`grid h-5 flex-1 place-items-center rounded border text-[10px] font-bold not-italic ${CELL[c.state]}`}>{c.label}</i>)}
      </span>
      <div className="relative flex items-center gap-2">
        <span className={`text-[12.5px] ${TONE[a.status.tone]}`}>{a.status.tone === "ok" ? "✓ " : ""}{a.status.text}</span>
        <span className="flex-1" />
        {editable && <Link href={href(`&account=${a.id}&upload=${a.id}`)} scroll={false} className={`${a.waiting ? "btn" : "btn-secondary"} h-8 shrink-0 px-3 text-[13px]`}><Upload className="h-3.5 w-3.5" aria-hidden />Upload statements</Link>}
      </div>
    </div>
  );
}
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

// Point 5: the account's statements, with Undo import; the coverage reason; the outstanding items at each edge.
function AccountDetail({ fileId, a, d, editable, href }: { fileId: string; a: S3Account; d: Step3; editable: boolean; href: (q?: string) => string }) {
  const items = d.outstanding.filter((i) => i.account_id === a.id);
  const sts = a.statements;
  const breakBefore = new Set(a.breaks.map((b) => b.before.period_start));
  const word = a.kind === "card" ? { in: "Charge", out: "Payment" } : { in: "Deposit", out: "Cheque or payment" };
  const edgeRow = (k: "start" | "end") => {
    const e = k === "start" ? a.start : a.end;
    const day = k === "start" ? d.dayBefore : d.yearEnd;
    const list = items.filter((i) => i.edge === k);
    if (e.statements === null && !list.length) return null;
    return (
      <section key={k} aria-label={`Balance on ${longDate(day)}`} className="rounded-[12px] border border-sand-200 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center gap-2"><b className="text-[14px]">{a.label}: balance on {longDate(day)}</b><span className="flex-1" />
          {e.difference !== null && <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${e.explained ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{e.difference === 0 ? "Same" : e.explained ? "Explained" : "Not explained"}</span>}</div>
        <table className="mt-2 w-full text-[13.5px]"><tbody>
          <tr className="border-b border-sand-100"><td className="py-1.5">From the statements</td><td className="text-right tabular-nums">{e.statements === null ? "Not in yet" : money(e.statements)}</td><td className="w-24" /></tr>
          {list.map((i) => (
            <tr key={i.id} className="border-b border-sand-100"><td className="py-1.5">{i.dir === "out" ? "Less" : "Add"} {i.description}, {longDate(i.item_date)}{i.cleared_line ? <span className="ml-1 text-[12px] text-ink-3">(cleared by a line in the year, which posts nothing)</span> : ""}</td>
              <td className="text-right tabular-nums">{money(i.dir === "out" ? -i.amount : i.amount)}</td>
              <td className="text-right">{editable && <form action={removeOutstanding}>{hidden("file_id", fileId)}{hidden("account", a.id)}{hidden("item", i.id)}<button type="submit" className="text-[12.5px] text-danger underline">Remove</button></form>}</td></tr>
          ))}
          <tr><td className="py-1.5 font-semibold">Books, {longDate(day)}</td><td className="text-right font-semibold tabular-nums">{(k === "start" ? a.books : a.endBooks) === null ? "Not entered" : money((k === "start" ? a.books : a.endBooks)!)}</td><td /></tr>
        </tbody></table>
        {e.difference !== null && !e.explained && <p className="mt-1 text-[12.5px] text-danger">Difference {money(Math.abs((e.difference ?? 0) - e.items))} not explained. Add the outstanding items: cheques written but not yet cleared, deposits not yet credited{a.kind === "card" ? ", charges or payments not yet posted" : ""}.</p>}
        {editable && (
          <details className="mt-2" open={e.difference !== null && !e.explained}>
            <summary className="cursor-pointer text-[13px] text-navy-700">+ Add outstanding item</summary>
            <form action={addOutstanding} className="mt-2 grid items-end gap-2 sm:grid-cols-[9.5rem_12rem_1fr_8rem_auto]">
              {hidden("file_id", fileId)}{hidden("account", a.id)}{hidden("edge", k)}
              <label className="grid gap-1 text-[12px] text-ink-2">Date<input type="date" name="date" required className="input input-compact h-9" /></label>
              <label className="grid gap-1 text-[12px] text-ink-2">Kind<select name="dir" className="input input-compact h-9"><option value="out">{word.out}</option><option value="in">{word.in}</option></select></label>
              <label className="grid gap-1 text-[12px] text-ink-2">Description<input name="description" required maxLength={200} placeholder="For example: Cheque #204" className="input input-compact h-9" /></label>
              <label className="grid gap-1 text-[12px] text-ink-2">Amount<input name="amount" required inputMode="decimal" placeholder="0.00" className="input input-compact h-9 text-right" /></label>
              {k === "start" && <ClearedPick a={a} />}
              <button type="submit" className="btn h-9">Add</button>
            </form>
          </details>
        )}
      </section>
    );
  };
  return (
    <div className="grid gap-3">
      <section aria-label="Statements imported" className="overflow-hidden rounded-[12px] border border-sand-200 bg-white">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3"><b className="text-[14px]">{a.label}</b><span className="text-[12.5px] text-ink-3">statements imported</span><span className="flex-1" />
          {editable && <Link href={href(`&account=${a.id}&add=1&edit=${a.id}`)} scroll={false} className="btn-secondary h-8 px-3 text-[13px]">Edit account</Link>}
          {editable && <Link href={href(`&account=${a.id}&upload=${a.id}`)} scroll={false} className="btn-secondary h-8 px-3 text-[13px]"><Upload className="h-3.5 w-3.5" aria-hidden />Upload statements</Link>}</div>
        {!sts.length ? <p className="border-t border-sand-100 px-4 py-3 text-[13px] text-ink-3">No statements imported yet.</p> : (
          <table className="table table-compact">
            <thead><tr><th>Period</th><th>File</th><th className="text-right">Lines in the year</th><th className="text-right">Opening</th><th className="text-right">Closing</th><th>Imported</th><th /></tr></thead>
            <tbody>{sts.map((s) => {
              const gapRow = breakBefore.has(s.period_start) ? a.breaks.find((b) => b.before.period_start === s.period_start)! : null;
              return [gapRow && (
                <tr key={`g-${s.id}`} className="bg-danger-soft/70"><td colSpan={6} className="text-danger"><b>Statement missing.</b> {formatDate(gapRow.after.period_end)} closes at {money(gapRow.after.closing)} and {formatDate(gapRow.before.period_start)} opens at {money(gapRow.before.opening)}. Upload the statement between them.</td>
                  <td className="text-right">{editable && <Link href={href(`&account=${a.id}&upload=${a.id}`)} scroll={false} className="btn-secondary h-7 px-2 text-[12.5px]">Upload</Link>}</td></tr>),
              <tr key={s.id}>
                <td className="whitespace-nowrap">{formatDate(s.period_start)} to {formatDate(s.period_end)}</td>
                <td className="text-[13px]">{s.statement_import_id ? <Link href={href(`&account=${a.id}&upload=${a.id}&check=${s.statement_import_id}`)} scroll={false} className="text-navy-700 hover:underline">{s.file_name}</Link> : s.file_name}
                  {s.outside_lines > 0 && <div className="text-[12px] text-ink-3">{s.outside_lines} line{s.outside_lines === 1 ? "" : "s"} outside the year, not imported</div>}</td>
                <td className="text-right tabular-nums">{s.lines}</td><td className="text-right tabular-nums">{money(s.opening)}</td><td className="text-right tabular-nums">{money(s.closing)}</td>
                <td className="text-[12.5px] whitespace-nowrap text-ink-2">{s.who} · {formatDateTime(s.uploaded_at)}</td>
                <td className="text-right">{editable && <Link href={href(`&account=${a.id}&undo=${s.id}`)} scroll={false} className="text-[13px] text-navy-700 underline">Undo import</Link>}</td>
              </tr>,
              s.source === "pdf" && <tr key={`c-${s.id}`}><td colSpan={7} className="pt-0"><ConversionRecord s={s.conversion} /></td></tr>];
            })}</tbody>
          </table>
        )}
      </section>

      {/* Point 23: a reason for months with no statement */}
      {(a.missing.length > 0 || a.note || a.opened || a.closed) && (
        <section aria-label="Months with no statement" className="rounded-[12px] border border-sand-200 bg-white px-4 py-3 text-[13.5px]">
          <b className="text-[14px]">Months with no statement</b>
          {(a.note || a.opened || a.closed) ? (
            <p className="mt-1">Reason recorded: {[a.opened && `Opened ${longDate(a.opened)}`, a.closed && `Closed ${longDate(a.closed)}`, a.note].filter(Boolean).join(". ")}.
              <span className="text-ink-3"> {a.reasonBy}{a.reasonAt ? `, ${formatDate(a.reasonAt)}` : ""}</span></p>
          ) : <p className="mt-1 text-ink-2">{a.missing.length} {a.cycleDay === 1 ? "month" : "cycle"}{a.missing.length === 1 ? "" : "s"} with no statement. Upload them, or record why: the account opened or closed in the year, or there are no statements.</p>}
          {editable && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[13px] text-navy-700">{a.note || a.opened || a.closed ? "Change the reason" : "Record why"}</summary>
              <form action={setCoverage} className="mt-2 grid items-end gap-2 sm:grid-cols-[10rem_10rem_1fr_auto]">
                {hidden("file_id", fileId)}{hidden("account", a.id)}
                <label className="grid gap-1 text-[12px] text-ink-2">Opened on<input type="date" name="opened" defaultValue={a.opened ?? ""} min={d.yearStart} max={d.yearEnd} className="input input-compact h-9" /></label>
                <label className="grid gap-1 text-[12px] text-ink-2">Closed on<input type="date" name="closed" defaultValue={a.closed ?? ""} min={d.yearStart} max={d.yearEnd} className="input input-compact h-9" /></label>
                <label className="grid gap-1 text-[12px] text-ink-2">Note (with no dates, no statements are asked for)<input name="note" defaultValue={a.note} maxLength={300} placeholder="For example: card cancelled before the year" className="input input-compact h-9" /></label>
                <button type="submit" className="btn h-9">Save</button>
              </form>
            </details>
          )}
        </section>
      )}

      {/* Point 22: the year edges */}
      {edgeRow("start")}
      {edgeRow("end")}
    </div>
  );
}

// An outstanding item at the start can name the line in the year that cleared it: that line then posts nothing.
function ClearedPick({ a }: { a: S3Account }) {
  return (
    <label className="grid gap-1 text-[12px] text-ink-2 sm:col-span-5">Cleared in the year by (optional: that line then posts nothing, as the books already hold it)
      <select name="cleared_line" className="input input-compact h-9 max-w-xl"><option value="">Not cleared yet, or choose the line</option>
        {a.early.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select>
    </label>
  );
}
