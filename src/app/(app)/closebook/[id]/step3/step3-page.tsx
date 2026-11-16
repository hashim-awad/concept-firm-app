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
import { Step3Main } from "./main";
import { AddAccountWindow, Win } from "./windows";
import { UploadWindow, type Target } from "./upload-window";
import { CheckStage, type CheckDetail } from "./check-stage";
import { SidePanel } from "../side-panel";
import { BankUploadForm } from "../bank-upload-form";
import { undoImport } from "../../step3-actions";

type Sp = Record<string, string | string[] | undefined>;
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

export async function Step3Page({ supabase, file, names, sp, editable, signed, problems, error, dups }: {
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
    win = <AddAccountWindow c={{ fileId, closeHref: then || pageHref, then, dayBefore: formatDate(d.dayBefore), chartNumbers: d.chartNumbers, taken: d.taken, t2, t2Entered: d.t2Entered,
      others: d.accounts.map((a) => ({ id: a.id, gifi: a.gifi, books: a.books })),
      edit: e ? { id: e.id, number: e.number, type: (e.accountType ?? (e.kind === "bank" ? "chequing" : "card")) as AccountType, bank: e.bank, last4: e.last4 ?? "", books: e.books, longTerm: e.longTerm, hasStatements: e.statements.length > 0 } : null,
      prefill: { type: str(sp.type), last4: str(sp.last4), bank: str(sp.bank) } }} />;
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
    <Step3Main fileId={fileId} d={d} selected={selected} editable={editable} problems={problems} signed={signed} />
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
