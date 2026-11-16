// Closebook step 3 main page (round 22, Hashim, Nov 16, 2026; corrected the same day). Benchmarks: QuickBooks
// Online Banking (one card per account; "Upload from file" opens a window) and CaseWare Cloud (each account
// under its GIFI line, tied to last year). The page only shows; every task opens in a window over it:
// - one "Upload statements" button, top right;
// - the Next bar is the only to-do list: its first item, with its button, and "Show all" for the rest;
// - account cards show status only (one word), with a "..." menu; clicking a card selects it;
// - ties to step 2, one compact line per GIFI line;
// - the selected account's statements, one row each with a "..." menu; a missing period is a red row.
import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Info, MoreHorizontal, Plus, Upload } from "lucide-react";
import { formatDate } from "@/lib/dates";
import { longDate, type Cell, type Gap, type Todo } from "@/lib/closebook/step3";
import { money, type S3Account, type Step3 } from "@/lib/closebook/step3-server";
import { signStep } from "../../actions";
import { removeBankAccount, setNotOurs } from "../../step3-actions";

// The month strip: four states, one meaning each (round 22 fixes). The key is behind the card's "i".
const CELL: Record<Cell["state"], string> = {
  in: "border-success/40 bg-success-soft text-success", missing: "border-danger/40 bg-danger-soft text-danger",
  wait: "border-warning/50 bg-warning-soft text-warning", na: "border-sand-200 bg-sand-100 text-ink-3/60",
};
const CELL_WORD: Record<Cell["state"], string> = { in: "covered", missing: "missing", wait: "waiting to check", na: "outside the year" };
// "Oct 2 to Nov 3, 2025"; the year shows once when both dates are in it.
export const span = (a: string, b: string) => (a === b ? formatDate(a) : a.slice(0, 4) === b.slice(0, 4) ? `${formatDate(a).replace(/, \d{4}$/, "")} to ${formatDate(b)}` : `${formatDate(a)} to ${formatDate(b)}`);
const PILL = { ok: "bg-success-soft text-success", warn: "bg-warning-soft text-warning", bad: "bg-danger-soft text-danger", "": "bg-sand-100 text-ink-2" } as const;
const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;

// A small "..." menu (details/summary: no script needed). Items are links or forms.
export function Menu({ label, children, align = "right" }: { label: string; children: React.ReactNode; align?: "right" | "left" }) {
  return (
    <details className="group relative z-10 open:z-40">
      <summary aria-label={label} className="grid h-8 w-8 cursor-pointer list-none place-items-center rounded-md text-ink-2 hover:bg-sand-100 [&::-webkit-details-marker]:hidden"><MoreHorizontal className="h-4 w-4" /></summary>
      <div className={`absolute top-9 ${align === "right" ? "right-0" : "left-0"} grid min-w-[13rem] rounded-[10px] border border-sand-300 bg-white p-1 text-[13.5px] shadow-lg`}>{children}</div>
    </details>
  );
}
const itemCls = "block rounded px-3 py-2 text-left hover:bg-sand-50";

export function Step3Main({ fileId, d, selected, editable }: { fileId: string; d: Step3; selected: string | null; editable: boolean }) {
  const href = (q = "") => `/closebook/${fileId}?step=records${selected ? `&account=${selected}` : ""}${q}`;
  const acc = d.accounts.find((a) => a.id === selected) ?? null;
  const first = d.todo[0];
  const uploadHref = href(`&upload=${d.accounts.length === 1 ? d.accounts[0].id : "all"}`);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-[17px] font-semibold">Bank and card accounts</h2>
        <span className="flex-1" />
        {editable && <Link href={uploadHref} scroll={false} className="btn h-9"><Upload className="h-4 w-4" aria-hidden />Upload statements</Link>}
      </div>

      {/* The only to-do list on the page: the next action, and "Show all". */}
      {first && (
        <div className="flex flex-wrap items-center gap-3 rounded-[10px] border border-sand-200 border-l-4 border-l-navy-700 bg-white px-4 py-3">
          <ArrowRight className="h-4 w-4 shrink-0 text-navy-700" aria-hidden />
          <p className="min-w-0 flex-1 text-[14px]"><b className="text-navy-900">Next:</b> {first.text}</p>
          {editable && <TodoButtons fileId={fileId} t={first} href={href} />}
          {d.todo.length > 1 && <Link href={href("&todo=1")} scroll={false} className="text-[13.5px] font-semibold whitespace-nowrap text-navy-700 underline">Show all ({d.todo.length})</Link>}
        </div>
      )}

      {/* Point 3: status only. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {d.accounts.map((a) => <AccountCard key={a.id} fileId={fileId} a={a} on={a.id === selected} editable={editable} dayBefore={d.dayBefore} />)}
        {editable && (
          <Link href={href("&add=1")} scroll={false}
            className="grid min-h-[150px] place-items-center content-center gap-1 rounded-[12px] border border-dashed border-sand-300 bg-white p-4 text-center hover:border-navy-300">
            <Plus className="h-5 w-5 text-navy-700" aria-hidden /><span className="font-semibold text-navy-700">Add account</span>
            <span className="text-[12.5px] text-ink-3">Bank account, credit card, line of credit or loan</span>
          </Link>
        )}
      </div>

      {/* Point 4: one compact line per GIFI line. */}
      {d.accounts.length > 0 && d.t2Entered && (
        <section aria-label="Ties to step 2" className="rounded-[12px] border border-sand-200 bg-white">
          <div className="flex flex-wrap items-baseline gap-2 px-4 pt-3 pb-1"><b className="text-[14px]">Ties to step 2</b>
            <span className="text-[12.5px] text-ink-3">Balances in the books on {formatDate(d.dayBefore)} against last year&rsquo;s T2</span></div>
          {d.ties.map((t) => (
            <div key={t.gifi} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-sand-100 px-4 py-2.5 text-[13.5px]">
              {t.ties ? <span className="inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-xs font-semibold text-success"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden />Ties{t.rounding ? ` (rounding ${money(Math.abs(t.rounding))})` : ""}</span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger"><AlertTriangle className="h-3.5 w-3.5" aria-hidden />Off by {money(Math.abs(t.books - t.t2))}</span>}
              <span className="min-w-[19rem]">{gifiWord(t.gifi)} ({t.numbers.join(", ")}) <b className="tabular-nums">{money(t.books)}</b></span>
              <span>T2 line {t.gifi} <b className="tabular-nums">{money(t.t2)}</b></span>
            </div>
          ))}
        </section>
      )}

      {acc && <AccountDetail fileId={fileId} a={acc} d={d} editable={editable} href={href} />}
    </div>
  );
}

const gifiWord = (g: string) => ({ "1002": "Bank accounts", "2707": "Credit cards", "2701": "Lines of credit and loans", "3149": "Long-term lines of credit", "3143": "Bank loans", "2600": "Bank overdraft" }[g] ?? `GIFI ${g}`);

// Each to-do item's own buttons (the Next bar shows the first item's; "Show all" lists every item's).
export function TodoButtons({ fileId, t, href }: { fileId: string; t: Todo; href: (q?: string) => string }) {
  const a = t.account ?? null;
  const L = (label: string, to: string, primary = true) => <Link key={label} href={to} scroll={false} className={`${primary ? "btn" : "btn-secondary"} h-8 px-3 text-[13px] whitespace-nowrap`}>{label}</Link>;
  switch (t.kind) {
    case "add": return L("Add account", href("&add=1"));
    case "books": return L("Edit account", href(`&add=1&edit=${a}`));
    case "check": return L("Check statements", href(`&upload=${a ?? "all"}`));
    case "wrong": case "failed": return L("Open the list", href("&upload=all"));
    case "none": case "gap": return <span className="inline-flex gap-2">{L("Upload", href(`&upload=${a}`))}{L("Record why", href(`&why=${a}`), false)}</span>;
    case "tie": return L("Open step 2", `/closebook/${fileId}?step=opening`, false);
    case "edge": return L("Explain", href(`&explain=${a}&edge=${t.edge}`));
    case "possible": return (
      <span className="inline-flex gap-2">
        {L("Add it", href(`&add=1&type=${/VISA|MC|AMEX/.test(t.possible!.label) ? "card" : "loc"}&last4=${t.possible!.last4}`))}
        <form action={setNotOurs}>{hidden("file_id", fileId)}{hidden("last4", t.possible!.last4)}{hidden("label", t.possible!.label)}
          <button type="submit" className="btn-secondary h-8 px-3 text-[13px]">Not ours</button></form>
      </span>);
    case "sign": return (
      <form action={signStep}>{hidden("file_id", fileId)}{hidden("step", "records")}{hidden("role", "prepared")}{hidden("back", `/closebook/${fileId}?step=records`)}
        <button type="submit" className="btn h-8 px-3 text-[13px]">Sign as preparer</button></form>);
    case "done": return L("Go to step 4", `/closebook/${fileId}?step=code`);
    default: return null;
  }
}

function AccountCard({ fileId, a, on, editable, dayBefore }: { fileId: string; a: S3Account; on: boolean; editable: boolean; dayBefore: string }) {
  const base = `/closebook/${fileId}?step=records&account=${a.id}`;
  return (
    <div className={`relative grid content-start gap-2 rounded-[12px] border bg-white p-4 ${on ? "border-2 border-navy-700 p-[15px]" : "border-sand-200 hover:border-navy-300"}`}>
      <Link href={base} scroll={false} className="absolute inset-0 rounded-[12px]" aria-label={`Show ${a.label}`} />
      <div className="flex items-start gap-2">
        <h3 className="text-[14.5px] font-semibold">{a.label}</h3><span className="flex-1" />
        <span className={`relative rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap ${PILL[a.card.tone]}`}>{a.card.word}</span>
        <details className="group relative z-10 open:z-40">
          <summary aria-label={`What the colours mean for ${a.label}`} className="grid h-8 w-6 cursor-pointer list-none place-items-center rounded-md text-ink-3 hover:bg-sand-100 [&::-webkit-details-marker]:hidden"><Info className="h-4 w-4" /></summary>
          <div className="absolute top-9 right-0 grid w-56 gap-1.5 rounded-[10px] border border-sand-300 bg-white p-3 text-[12.5px] shadow-lg">
            <b className="text-[13px]">Months on the card</b>
            {(["in", "missing", "wait", "na"] as const).map((k) => <span key={k} className="flex items-center gap-2"><i className={`h-3.5 w-5 rounded border not-italic ${CELL[k]}`} />{CELL_WORD[k][0].toUpperCase() + CELL_WORD[k].slice(1)}</span>)}
          </div>
        </details>
        {editable && (
          <Menu label={`More for ${a.label}`}>
            <Link href={`${base}&add=1&edit=${a.id}`} scroll={false} className={itemCls}>Edit account</Link>
            <Link href={`${base}&why=${a.id}`} scroll={false} className={itemCls}>Record why statements are missing</Link>
            {!a.statements.length && <form action={removeBankAccount}>{hidden("file_id", fileId)}{hidden("account", a.id)}<button type="submit" className={`${itemCls} w-full text-danger`}>Remove account</button></form>}
          </Menu>
        )}
      </div>
      <p className="text-[12px] text-ink-3">GIFI {a.gifi}</p>
      <p className="flex justify-between gap-2 text-[12.5px]"><span className="text-ink-3">Opening balance (books) {formatDate(dayBefore)}</span>
        <b className="tabular-nums">{a.books === null ? <span className="text-danger">Not entered</span> : money(a.books)}</b></p>
      <span className="flex gap-[3px]" aria-label={a.card.word}>
        {a.cells.map((c, i) => <i key={i} title={`${span(c.from, c.to)}: ${CELL_WORD[c.state]}`}
          className={`grid h-5 flex-1 place-items-center rounded border text-[10px] font-bold not-italic ${CELL[c.state]}`}>{c.label}</i>)}
      </span>
    </div>
  );
}

// A gap row (round 22 fixes): what is missing, then the statement just before it and the one just after.
const gapTitle = (g: Gap, any: boolean) => g.waiting ? `${span(g.from, g.to)}: uploaded, waiting to check (${g.waiting.file_name}).`
  : g.kind === "break" ? `${formatDate(g.from)}: the statement does not follow the one before.` : `${span(g.from, g.to)}: ${any ? "missing" : "no statements"}.`;
const gapNeighbours = (g: Gap) => {
  const before = g.after ? `${span(g.after.period_start, g.after.period_end)} closes at ${money(g.after.closing)}` : "";
  const after = g.before ? `${formatDate(g.before.period_start)} opens at ${money(g.before.opening)}` : "";
  return before && after ? ` ${before} and ${after}.` : before ? ` ${before}; no statement after it.` : after ? ` ${after}; no statement before it.` : "";
};

// Point 5 and 6: one row per statement, a "..." menu each; a missing period is a red row.
function AccountDetail({ fileId, a, d, editable, href }: { fileId: string; a: S3Account; d: Step3; editable: boolean; href: (q?: string) => string }) {
  const reason = [a.opened && `Opened ${longDate(a.opened)}`, a.closed && `Closed ${longDate(a.closed)}`, a.note].filter(Boolean).join(". ");
  type Row = { at: string; node: React.ReactNode };
  const rows: Row[] = a.statements.map((s) => ({ at: s.period_start, node: (
    <tr key={s.id}>
      <td className="whitespace-nowrap">{formatDate(s.period_start)} to {formatDate(s.period_end)}</td>
      <td className="text-[13px]">{s.file_name}</td>
      <td className="text-right tabular-nums">{s.lines}</td><td className="text-right tabular-nums">{money(s.opening)}</td><td className="text-right tabular-nums">{money(s.closing)}</td>
      <td className="w-12 text-right"><Menu label={`More for ${s.file_name}`}>
        <Link href={href(`&conv=${s.id}`)} scroll={false} className={itemCls}>Conversion record</Link>
        {s.attachment_path && <a href={`/closebook/${fileId}/statement-pdf?s=${s.id}`} className={itemCls}>Download PDF</a>}
        {editable && <Link href={href(`&undo=${s.id}`)} scroll={false} className={`${itemCls} text-danger`}>Undo import</Link>}
      </Menu></td>
    </tr>) }));
  for (const g of a.gaps) rows.push({ at: g.from, node: (
    <tr key={`g-${g.kind}-${g.from}`} className={g.waiting ? "bg-warning-soft/70" : "bg-danger-soft/70"}>
      <td colSpan={5} className={g.waiting ? "text-warning" : "text-danger"}><b>{gapTitle(g, a.statements.length > 0)}</b>{gapNeighbours(g)}</td>
      <td className="text-right whitespace-nowrap">{editable && <span className="inline-flex items-center gap-1">
        {g.waiting ? <Link href={href(`&upload=${a.id}&check=${g.waiting.id}`)} scroll={false} className="btn h-7 px-2.5 text-[12.5px]">Check</Link>
          : <Link href={href(`&upload=${a.id}`)} scroll={false} className="btn-secondary h-7 px-2.5 text-[12.5px]">Upload</Link>}
        <Menu label="More for the missing period"><Link href={href(`&why=${a.id}`)} scroll={false} className={itemCls}>Record why</Link></Menu></span>}</td>
    </tr>) });
  rows.sort((x, y) => x.at.localeCompare(y.at));
  const edgeLine = (k: "start" | "end") => {
    const e = k === "start" ? a.start : a.end;
    if (e.statements === null) return null;
    const day = k === "start" ? d.dayBefore : d.yearEnd;
    const left = (e.difference ?? 0) - e.items;
    return (
      <div key={k} className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-sand-100 px-4 py-2.5 text-[13.5px]">
        <span className="font-medium">Balance on {formatDate(day)}</span>
        <span>Statements <b className="tabular-nums">{money(e.statements)}</b></span>
        <span>Books <b className="tabular-nums">{e.books === null ? "Not entered" : money(e.books)}</b></span>
        <span className={e.explained ? "text-success" : "text-danger"}>{!e.difference ? "Same ✓" : e.explained ? `Difference ${money(Math.abs(e.difference))} explained ✓` : `Difference ${money(Math.abs(left))} not explained`}</span>
        <span className="flex-1" />
        {(e.difference || e.items) ? <Link href={href(`&explain=${a.id}&edge=${k}`)} scroll={false} className={`${e.explained ? "btn-secondary" : "btn"} h-8 px-3 text-[13px]`}>{e.explained ? "View" : "Explain"}</Link> : null}
      </div>
    );
  };
  return (
    <section aria-label="Statements imported" className="overflow-hidden rounded-[12px] border border-sand-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3"><b className="text-[14px]">{a.label}</b><span className="text-[12.5px] text-ink-3">statements imported</span>
        {reason && <span className="text-[12.5px] text-ink-2">· Reason recorded: {reason}</span>}</div>
      {rows.length ? (
        <table className="table table-compact">
          <thead><tr><th>Period</th><th>File</th><th className="text-right">Lines in the year</th><th className="text-right">Opening</th><th className="text-right">Closing</th><th /></tr></thead>
          <tbody>{rows.map((r) => r.node)}</tbody>
        </table>
      ) : <p className="border-t border-sand-100 px-4 py-3 text-[13px] text-ink-3">{reason ? "No statements needed." : "No statements imported yet."}</p>}
      {edgeLine("start")}
      {edgeLine("end")}
    </section>
  );
}
