import "server-only";
// Piece 3 (Hashim, Nov 18, 2026): saving an entry made from the Vehicle schedule. The window sends what was typed;
// the schedule is worked out again here from today's rates and books (when it was put in again), or the amounts
// already on the entry are kept (an edit of the entry itself). The accounts chosen on the lines are kept. Normal
// lines added to the entry go through the entry form's own rules. The database checks the schedule amounts again.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAccess } from "@/lib/access";
import { loadReference, type CbAccount, type CbEntry } from "./server";
import type { CbFileRow } from "./files";
import { loadReportData } from "./report-data";
import { planEntry, reasonFor, type FormHead, type FormLine, type RpcLine } from "./entry-form";
import type { EntryFormData } from "./entry-form-server";
import { loadVehicle, snapshotOf } from "./vehicle-server";
import { calcVehicle, inputChanges, readInputs, ITC_ACCOUNT } from "./vehicle-schedule";
import { formatAmount } from "./amount";

export type SchedForm = { head: FormHead; date: string; lines: (FormLine & { sched?: string; isTax?: boolean })[]; seq?: string; edit?: string; schedule?: { inputs: unknown } | null };

// An account picked in the entry form, as the database takes it.
const targetOf = (v: string): Partial<RpcLine> | null =>
  !v || v === "new" ? null : v.startsWith("chart:") ? { chart: v.slice(6) } : v.startsWith("line:") ? { line: v.slice(5) } : { account: v };

export async function scheduleSaveArgs(supabase: SupabaseClient, f: { file: CbFileRow; accounts: CbAccount[]; entries: CbEntry[]; client: { province?: string | null } | null },
  form: SchedForm, data: EntryFormData, paths: string[]): Promise<{ error: string } | { args: Record<string, unknown> }> {
  const entry = form.edit ? f.entries.find((e) => e.id === form.edit) : undefined;
  if (form.edit && entry?.origin !== "schedule") return { error: "Change this amount in its schedule: click the Schedule tag." };
  const access = await getAccess();
  const canItc = !!access && (access.is_owner || access.staff_id === f.file.reviewer_id);
  const ref = await loadReference(supabase);
  const rdata = await loadReportData(supabase, f.file, f.accounts, f.entries, ref.lines, ref.sheets);
  const province = f.client?.province ?? "ON";
  const vd = await loadVehicle(supabase, f.file, province, f.entries, f.accounts, rdata, entry?.id ?? null, canItc, data.opts);

  // The schedule's lines: worked out again, or the entry's own when the schedule was not put in again.
  type L = { part: string; amount: number; memo: string; tax_code?: string | null; is_tax?: boolean; dflt: string };
  let sched: L[] = [];
  let payload: Record<string, unknown> | null = null;
  if (form.schedule) {
    const inputs = readInputs(form.schedule.inputs);
    if (!canItc) inputs.itc = vd.stored?.itc_claim ?? true;   // only the reviewer or an owner changes it
    const r = calcVehicle(inputs, vd.ctx, vd.names);
    const hard = r.problems.find((p) => p.hard);
    if (hard || !r.ready) return { error: hard?.text ?? "Finish the schedule first." };
    sched = r.lines.map((l) => ({ part: l.part, amount: l.amount, memo: l.memo, tax_code: l.tax_code ?? null, is_tax: !!l.is_tax,
      dflt: l.account ?? (l.is_tax ? `chart:${ITC_ACCOUNT}` : vd.acct[l.number] ?? `chart:${l.number}`) }));
    const fmt = formatAmount(r.used === "allowance" ? r.allowance ?? 0 : r.actual ?? 0);
    payload = {
      kind: "vehicle", method: inputs.method, choice: inputs.choice, itc: inputs.itc, inputs, snapshot: snapshotOf(vd),
      result: { allowance: r.allowance, actual: r.actual, used: r.used, higher: r.higher, sharePct: r.sharePct, itc: r.itc, company: r.company, working: r.working, parts: r.parts, alreadyKm: r.alreadyKm },
      lines: r.lines.map((l) => ({ schedule_part: l.part, amount: l.amount / 100, is_tax: !!l.is_tax })),
      changes: vd.stored ? inputChanges(vd.stored.inputs, inputs, f.file.year_start, f.file.year_end) : [],
      summary: r.used === "allowance" ? `Per-km allowance ${fmt} used` : `Actual costs, ${r.sharePct}, ${fmt} used`,
    };
  } else {
    if (!entry) return { error: "Open the schedule and put it in the entry." };
    sched = entry.lines.filter((l) => l.schedule_part).map((l) => ({ part: l.schedule_part!, amount: Math.round(l.amount * 100), memo: l.memo, tax_code: l.tax_code ?? null,
      is_tax: !!l.is_tax, dflt: l.account_id }));
  }

  // Each schedule line on the account the preparer chose (a GST/HST line stays on 21500).
  const chosen = new Map(form.lines.filter((l) => l.sched).map((l) => [l.sched!, l]));
  const rpc: Record<string, unknown>[] = [];
  for (const l of sched) {
    const fl = chosen.get(l.part);
    const t = l.is_tax ? { chart: ITC_ACCOUNT } : targetOf(fl?.acct || l.dflt);
    if (!t) return { error: "Each line needs an account." };
    rpc.push({ ...t, amount: l.amount / 100, memo: (fl?.desc ?? l.memo).trim().slice(0, 200), ...(l.tax_code ? { tax_code: l.tax_code } : {}), ...(l.is_tax ? { is_tax: true } : {}), schedule_part: l.part });
  }
  // Normal lines added to the entry: the entry form's rules (they balance on their own).
  const normal = form.lines.filter((l) => !l.sched && (l.acct || l.dr.trim() || l.cr.trim()));
  if (normal.length) {
    const plan = planEntry({ ...form.head, reason: undefined }, normal, new Map(data.opts.map((o) => [o.value, o])), new Map(data.codes.map((c) => [c.code, c])), data.ctx,
      new Map(data.gifiLines.map(([no, , type]) => [no, type])));
    if (plan.problems.length) return { error: plan.problems[0] };
    rpc.push(...plan.rpc);
  }
  if (form.head.memo.trim().length < 3) return { error: "Add the description." };
  const seq = /^\d{1,3}$/.test(String(form.seq ?? "").trim()) ? Number(String(form.seq).trim()) : null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(form.date) ? form.date : null;
  return { args: {
    p_file: f.file.id, p_entry: entry?.id ?? null, p_kind: form.head.kind, p_reason: reasonFor({ ...form.head, reverse: false }, false), p_note: form.head.memo, p_reverse: false,
    p_lines: rpc, p_wp_ref: form.head.wpRef || "Vehicle schedule", p_date: date, p_attachments: [...(entry?.attachments ?? []), ...paths].slice(0, 10), p_seq: seq, p_schedule: payload,
  } };
}
