// Closebook step 3 on a bank-statement file (round 22, Hashim, Nov 16, 2026): the main page and the window the
// address names. Windows: add=1 (Add account; edit=<id> to change one), upload=<account|all> (the upload
// window; check=<statement> the check stage, done=1 the done stage), undo=<statement> (Undo import),
// csv=<account> (the CSV upload, as before).
import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStatement } from "@/lib/statements/server";
import { loadStep3, money, type Step3 } from "@/lib/closebook/step3-server";
import { formatDate } from "@/lib/dates";
import { longDate, type AccountType } from "@/lib/closebook/step3";
import { Step3Main, TodoButtons } from "./main";
import { ConversionRecord } from "../conversion-record";
import { AddAccountWindow, Win } from "./windows";
import { UploadWindow, type Target } from "./upload-window";
import { CheckStage, type CheckDetail } from "./check-stage";
import { SidePanel } from "../side-panel";
import { BankUploadForm } from "../bank-upload-form";
import { addOutstanding, removeOutstanding, setCoverage, undoImport } from "../../step3-actions";

type Sp = Record<string, string | string[] | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function Step3Page({ supabase, file, names, sp, editable, signed, error, dups }: {
  supabase: SupabaseClient; file: { id: string; year_start: string; year_end: string; opening_source: string | null; first_year: boolean | null };
  names: Map<string, string>; sp: Sp; editable: boolean; signed: boolean; problems: string[]; error: string | null;
  dups: { txn_date: string; description: string; amount: number; times: number; accounts: string }[];
}) {
  const fileId = file.id;
  const d = await loadStep3(supabase, file, names, signed);
  const account = str(sp.account) ?? null;
  const selected = d.accounts.some((a) => a.id === account) ? account : null;
  const pageHref = `/closebook/${fileId}?step=records${selected ? `&account=${selected}` : ""}`;
  let win: React.ReactNode = null;

  // ---------- Add or edit an account
  if (editable && str(sp.add) === "1") {
    const e = d.accounts.find((a) => a.id === str(sp.edit)) ?? null;
    const then = str(sp.then) && decodeURIComponent(str(sp.then)!).startsWith(`/closebook/${fileId}?`) ? decodeURIComponent(str(sp.then)!) : "";
    const t2: Record<string, number> = {};
    for (const t of d.ties) t2[t.gifi] = t.t2;
    const { data: ob } = await supabase.from("cb_opening_balances").select("code, amount").eq("file_id", fileId);
    for (const o of (ob ?? []) as { code: string; amount: number }[]) t2[o.code] = Math.round(Number(o.amount) * 100);
    win = <AddAccountWindow c={{ fileId, closeHref: then.includes("__new__") ? `${pageHref}&upload=all` : then || pageHref, then, dayBefore: formatDate(d.dayBefore), chartNumbers: d.chartNumbers, taken: d.taken, t2, t2Entered: d.t2Entered,
      others: d.accounts.map((a) => ({ id: a.id, gifi: a.gifi, books: a.books })),
      edit: e ? { id: e.id, number: e.number, type: (e.accountType ?? (e.kind === "bank" ? "chequing" : "card")) as AccountType, bank: e.bank, last4: e.last4 ?? "", books: e.books, longTerm: e.longTerm, hasStatements: e.statements.length > 0 } : null,
      prefill: { type: str(sp.type), last4: str(sp.last4), bank: str(sp.bank) } }} />;
  }

  const href = (q = "") => `${pageHref}${q}`;
  // ---------- The whole to-do list ("Show all" on the Next bar), each item with its own button
  if (str(sp.todo) === "1" && !win) {
    win = (
      <Win title="Everything to do in step 3" sub={`${d.todo.length} item${d.todo.length === 1 ? "" : "s"}, in order`} closeHref={pageHref} width={860}>
        <ol className="grid gap-0 divide-y divide-sand-100 rounded-[10px] border border-sand-200">
          {d.todo.map((t, i) => (
            <li key={t.key} className="flex flex-wrap items-center gap-3 px-4 py-3 text-[13.5px]">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-navy-50 text-[12px] font-bold text-navy-700">{i + 1}</span>
              <span className="min-w-0 flex-1">{t.text}</span>
              {editable && <TodoButtons fileId={fileId} t={t} href={href} />}
            </li>
          ))}
        </ol>
        <p className="text-[12.5px] text-ink-3">&ldquo;Sign as preparer&rdquo; turns on when this list is empty.</p>
      </Win>
    );
  }

  // ---------- Conversion record of one statement (point 5)
  const conv = str(sp.conv);
  if (conv && !win) {
    const st = d.accounts.flatMap((a) => a.statements).find((x) => x.id === conv);
    if (st) win = (
      <Win title="Conversion record" sub={`${st.file_name} · ${formatDate(st.period_start)} to ${formatDate(st.period_end)}`} closeHref={pageHref} width={720}>
        <ConversionRecord s={st.conversion} open imported={{ by: st.who, at: st.uploaded_at, lines: st.lines, outside: st.outside_lines }} />
      </Win>
    );
  }

  // ---------- Record why statements are missing (point 6)
  const why = str(sp.why);
  if (why && editable && !win) {
    const a = d.accounts.find((x) => x.id === why);
    if (a) win = (
      <Win title="Record why" sub={a.label} closeHref={pageHref} width={600} footer={<>
        {(a.opened || a.closed || a.note) && <form action={setCoverage}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={a.id} /><input type="hidden" name="clear" value="1" />
          <input type="hidden" name="back" value={pageHref} /><button type="submit" className="btn-secondary">Clear the reason</button></form>}
        <span className="flex-1" /><Link href={pageHref} scroll={false} className="btn-secondary">Cancel</Link>
        <button type="submit" form="why" className="btn h-9">Save</button></>}>
        <p className="text-[13.5px] text-ink-2">Months with no statement are not asked for when you record why. Use one or more:</p>
        <form id="why" action={setCoverage} className="grid gap-3">
          <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={a.id} /><input type="hidden" name="back" value={pageHref} />
          <label className="grid gap-1 text-[13px]"><span className="font-semibold text-ink-2">Opened in the year, on</span>
            <input type="date" name="opened" defaultValue={a.opened ?? ""} min={d.yearStart} max={d.yearEnd} className="input h-9 w-[12rem]" /></label>
          <label className="grid gap-1 text-[13px]"><span className="font-semibold text-ink-2">Closed in the year, on</span>
            <input type="date" name="closed" defaultValue={a.closed ?? ""} min={d.yearStart} max={d.yearEnd} className="input h-9 w-[12rem]" /></label>
          <label className="grid gap-1 text-[13px]"><span className="font-semibold text-ink-2">No statements (say why)</span>
            <input name="note" defaultValue={a.note} maxLength={300} placeholder="For example: card cancelled before the year; the bank issued no statements" className="input h-9" /></label>
        </form>
        <p className="text-[12.5px] text-ink-3">Recorded with your name and the date.</p>
      </Win>
    );
  }

  // ---------- Explain a year-edge difference with outstanding items (point 7)
  const explain = str(sp.explain), side = str(sp.edge) === "end" ? "end" : "start";
  if (explain && !win) {
    const a = d.accounts.find((x) => x.id === explain);
    if (a) {
      const e = side === "start" ? a.start : a.end;
      const day = side === "start" ? d.dayBefore : d.yearEnd;
      const items = d.outstanding.filter((i) => i.account_id === a.id && i.edge === side);
      const back = `${pageHref}&explain=${a.id}&edge=${side}`;
      const left = (e.difference ?? 0) - e.items;
      const word = a.kind === "card" ? { in: "Charge not yet posted", out: "Payment not yet posted" } : { in: "Deposit not yet credited", out: "Cheque or payment not yet cleared" };
      const row = (l: string, v: React.ReactNode, b = false) => <tr className="border-b border-sand-100"><td className={`py-2 ${b ? "font-semibold" : ""}`}>{l}</td><td className={`py-2 text-right tabular-nums ${b ? "font-semibold" : ""}`}>{v}</td><td className="w-20" /></tr>;
      win = (
        <Win title="Explain the difference" sub={`${a.label} · ${formatDate(day)}`} closeHref={pageHref} width={760} footer={<>
          <span className={`text-[13.5px] font-semibold ${left === 0 ? "text-success" : "text-danger"}`}>{left === 0 ? "Explained: the difference left is 0.00." : `Difference left: ${money(Math.abs(left))}. It must reach 0.00.`}</span>
          <span className="flex-1" /><Link href={pageHref} scroll={false} className="btn h-9">Close</Link></>}>
          <table className="w-full text-[13.5px]"><tbody>
            {row("Bank balance, from the statements", e.statements === null ? "Not in yet" : money(e.statements))}
            {row("Books balance", e.books === null ? "Not entered" : money(e.books))}
            {row("Difference", money(Math.abs(e.difference ?? 0)), true)}
          </tbody></table>
          <div className="grid gap-1">
            <b className="text-[14px]">Outstanding items</b>
            {items.length ? (
              <table className="w-full text-[13.5px]"><tbody>
                {items.map((i) => (
                  <tr key={i.id} className="border-b border-sand-100">
                    <td className="py-2">{longDate(i.item_date)} · {i.description}<span className="ml-1 text-[12px] text-ink-3">({i.dir === "out" ? word.out : word.in}{i.cleared_line ? "; cleared in the year by a line that now posts nothing" : ""})</span></td>
                    <td className="py-2 text-right tabular-nums">{money(i.dir === "out" ? -i.amount : i.amount)}</td>
                    <td className="w-20 text-right">{editable && <form action={removeOutstanding}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={a.id} />
                      <input type="hidden" name="item" value={i.id} /><input type="hidden" name="back" value={back} /><button type="submit" className="text-[12.5px] text-danger underline">Remove</button></form>}</td>
                  </tr>
                ))}
              </tbody></table>
            ) : <p className="text-[13px] text-ink-3">None added yet.</p>}
          </div>
          {editable && (
            <details className="rounded-[10px] border border-sand-200 bg-sand-50/60 px-4 py-3" open={left !== 0}>
              <summary className="cursor-pointer text-[13.5px] font-semibold text-navy-700">+ Add item</summary>
              <form action={addOutstanding} className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
                <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={a.id} /><input type="hidden" name="edge" value={side} /><input type="hidden" name="back" value={back} />
                <label className="grid gap-1 text-[12.5px] text-ink-2">Date<input type="date" name="date" required className="input h-9" /></label>
                <label className="grid gap-1 text-[12.5px] text-ink-2">Kind<select name="dir" className="input h-9"><option value="out">{word.out}</option><option value="in">{word.in}</option></select></label>
                <label className="grid gap-1 text-[12.5px] text-ink-2 sm:col-span-2">Description<input name="description" required maxLength={200} placeholder="For example: Cheque #204" className="input h-9" /></label>
                <label className="grid gap-1 text-[12.5px] text-ink-2">Amount<input name="amount" required inputMode="decimal" placeholder="0.00" className="input h-9 text-right" /></label>
                {side === "start" ? (
                  <label className="grid gap-1 text-[12.5px] text-ink-2">Cleared in the year by (optional: that line then posts nothing, as the books already hold it)
                    <select name="cleared_line" className="input h-9"><option value="">Not cleared yet, or choose the line</option>{a.early.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
                ) : <span />}
                <div className="sm:col-span-2"><button type="submit" className="btn h-9">Add item</button></div>
              </form>
            </details>
          )}
        </Win>
      );
    }
  }

  // ---------- The upload window, its check stage and done stage
  const up = str(sp.upload);
  if (up && !win) {
    const acc = d.accounts.find((a) => a.id === up) ?? null;
    const target: Target = acc ? { id: acc.id, label: acc.label, kind: acc.kind, last4: acc.last4 } : null;
    const href = `/closebook/${fileId}?step=records${acc ? `&account=${acc.id}` : ""}&upload=${acc?.id ?? "all"}`;
    const closeHref = acc ? `/closebook/${fileId}?step=records&account=${acc.id}` : pageHref;
    const checkId = str(sp.check);
    if (checkId) win = await checkWindow(d, fileId, checkId, acc, target, href, closeHref, editable);
    if (!win) win = <UploadWindow fileId={fileId} target={target} uploads={d.uploads} href={href} closeHref={closeHref} editable={editable} done={str(sp.done) === "1"}
      accounts={d.accounts.map((x) => ({ id: x.id, label: x.label }))} addHref={`/closebook/${fileId}?step=records&add=1&then=${encodeURIComponent(`/closebook/${fileId}?step=records&account=__new__&upload=__new__`)}`}
      csvHref={acc && editable ? `/closebook/${fileId}?step=records&account=${acc.id}&csv=${acc.id}` : null} />;
  }

  // ---------- Undo import (point 5): coded and matched lines first
  const undo = str(sp.undo);
  if (undo && editable && !win) {
    const st = d.accounts.flatMap((a) => a.statements).find((x) => x.id === undo);
    if (st) {
      const acc = d.accounts.find((a) => a.id === st.account_id)!;
      const [{ data: ls }, { data: tr }, { data: ch }] = await Promise.all([
        supabase.from("cb_bank_lines").select("id, txn_date, description, amount, status, chart_account, source").eq("statement_id", st.id).order("txn_date"),
        supabase.from("cb_bank_transfers").select("out_line, in_line").eq("file_id", fileId),
        supabase.from("cb_chart_accounts").select("number, name"),
      ]);
      const chartName = new Map(((ch ?? []) as { number: string; name: string }[]).map((c) => [c.number, c.name]));
      const inTr = new Set(((tr ?? []) as { out_line: string; in_line: string }[]).flatMap((t) => [t.out_line, t.in_line]));
      const lines = (ls ?? []) as { id: string; txn_date: string; description: string; amount: number; status: string; chart_account: string | null; source: string }[];
      const touched = lines.filter((l) => l.status !== "new" || inTr.has(l.id));
      win = (
        <Win title="Undo import?" sub={`${acc.label} · ${formatDate(st.period_start)} to ${formatDate(st.period_end)}`} closeHref={pageHref} width={720} footer={<>
          <span className="flex-1" /><Link href={pageHref} scroll={false} className="btn-secondary">Cancel</Link>
          <form action={undoImport}><input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="account" value={acc.id} /><input type="hidden" name="statement" value={st.id} />
            <button type="submit" className="btn-danger h-9">Undo import</button></form></>}>
          {touched.length ? (
            <div className="grid gap-2">
              <p className="rounded-[10px] border border-warning/40 bg-warning-soft px-3.5 py-2.5 text-[13.5px] text-[#5c4400]"><b>{touched.length} of its {lines.length} lines {touched.length === 1 ? "has" : "have"} work on {touched.length === 1 ? "it" : "them"}.</b> Undo removes the lines with their codes in step 4{touched.some((l) => inTr.has(l.id)) ? ", their transfer matches" : ""}{touched.some((l) => l.source === "outstanding") ? " and the link to an outstanding item" : ""}.</p>
              <div className="max-h-72 overflow-auto rounded-[10px] border border-sand-200"><table className="table table-compact">
                <thead><tr><th>Date</th><th>Description</th><th className="text-right">Amount</th><th>Work on it</th></tr></thead>
                <tbody>{touched.map((l) => <tr key={l.id}><td className="whitespace-nowrap">{longDate(l.txn_date)}</td><td>{l.description}</td><td className="text-right tabular-nums">{money(Math.round(Number(l.amount) * 100))}</td>
                  <td className="text-[12.5px]">{inTr.has(l.id) ? "Matched as a transfer" : l.source === "outstanding" ? "Clears an outstanding item" : l.chart_account ? `Coded to ${l.chart_account} ${chartName.get(l.chart_account) ?? ""}` : l.status === "ask_client" ? "On the client's question list" : l.status === "reviewer" ? "With the reviewer" : "Coded"}</td></tr>)}</tbody>
              </table></div>
            </div>
          ) : <p className="text-[13.5px]">None of its {lines.length} lines is coded or matched yet.</p>}
          <p className="text-[13.5px] text-ink-2">The statement goes back to the upload list to check. The account stays.</p>
        </Win>
      );
    }
  }

  // ---------- The CSV upload (as before), in the side panel
  const csv = str(sp.csv);
  if (csv && editable && !win) {
    const acc = d.accounts.find((a) => a.id === csv);
    if (acc) {
      const last = acc.statements[acc.statements.length - 1];
      win = (
        <SidePanel title={`Upload a CSV: ${acc.label}`} closeHref={`/closebook/${fileId}?step=records&account=${acc.id}&upload=${acc.id}`}>
          {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}
          <p className="text-sm text-ink-2">Template: Date, Description, Amount. <a href="/templates/Concept-bank-upload-template.csv" download className="text-navy-700 underline">Download the template</a></p>
          <BankUploadForm fileId={fileId} account={{ id: acc.id, name: acc.label, kind: acc.kind }} nextOpening={last ? last.closing / 100 : null} />
        </SidePanel>
      );
    }
  }

  return <>
    {dups.length > 0 && (
      <p role="alert" className="mb-3 rounded-[10px] border border-danger/30 bg-danger-soft px-4 py-2.5 text-[13.5px] text-danger"><b>{dups.reduce((n, x) => n + x.times - 1, 0)} lines are in this file twice</b> (same date, description and amount): {dups.slice(0, 3).map((x) => `${x.txn_date} ${x.description} ${Number(x.amount).toFixed(2)} on ${x.accounts}`).join("; ")}{dups.length > 3 ? "; and more" : ""}. They go to the reviewer.</p>
    )}
    <Step3Main fileId={fileId} d={d} selected={selected} editable={editable} />
    {win}
  </>;
}

async function checkWindow(d: Step3, fileId: string, id: string, acc: Step3["accounts"][number] | null, target: Target, href: string, closeHref: string, editable: boolean) {
  const st = await getStatement(id);
  if (!st || st.row.file_id !== fileId || !st.data) return null;
  const u = d.uploads.find((x) => x.id === id);
  const state = u?.state ?? { status: "ready" as const, match: null, other: null, reason: "" };
  // "Statement 2 of 3": the statements to check in this window, in its order.
  const list = d.uploads.filter((x) => (acc ? x.account === acc.id || x.target_account === acc.id : true) && ["ready", "needs_look", "no_digits", "wrong_account", "no_account", "outside"].includes(x.state.status))
    .sort((a, b) => (a.period_start ?? "").localeCompare(b.period_start ?? "") || a.file_name.localeCompare(b.file_name));
  const at = list.findIndex((x) => x.id === id);
  const toCheck = list.filter((x) => x.state.status !== "outside");
  const nextId = toCheck.filter((x) => x.id !== id).find((x) => list.indexOf(x) > at)?.id ?? toCheck.find((x) => x.id !== id)?.id ?? null;
  const books = acc?.books ?? null;
  const detail: CheckDetail = { id, row: st.row, data: st.data, fileUrl: st.fileUrl, state, n: at + 1, total: list.length, next: nextId,
    books, endBooks: acc?.endBooks ?? null, readOnly: !editable || !["ready", "needs_look"].includes(st.row.status) };
  const f = st.data.accounts[0];
  const addHref = `/closebook/${fileId}?step=records&add=1&type=${f?.kind === "card" ? "card" : "chequing"}&last4=${f?.last4 ?? ""}&then=${encodeURIComponent(`${href}&check=${id}`)}`;
  return <CheckStage fileId={fileId} d={detail} target={target} yearStart={d.yearStart} yearEnd={d.yearEnd} dayBefore={d.dayBefore} href={href} closeHref={closeHref} addHref={addHref} />;
}
