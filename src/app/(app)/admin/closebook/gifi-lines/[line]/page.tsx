import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { addSubLine, setLineLocked, updateMasterLine } from "../../actions";

type Line = { line_no: string; name: string; gifi_code: string; gifi_name: string; section: string; line_type: string; lead_sheet: string | null; statement_line: string | null;
  default_tax_code: string | null; mappable: boolean; pair_line: string | null; required_gifi: boolean; note: string; locked: boolean };
type Log = { id: number; action: string; changes: Record<string, unknown>; reason: string; changed_at: string; who: { full_name: string } | null };

// One GIFI line: change its name, statement line, default tax code, lead sheet or note (with a reason),
// or add a sub-line under it. GIFI code, section and type stay as CRA defines them.
export default async function GifiLinePage({ params, searchParams }: PageProps<"/admin/closebook/gifi-lines/[line]">) {
  await requireOwner();
  const { line } = await params;
  const sp = await searchParams;
  if (!/^\d{4}\.\d{2}$/.test(line)) notFound();
  const supabase = await createClient();
  const [{ data: l }, { data: taxes }, { data: sheets }, { data: log }, { count: subs }] = await Promise.all([
    supabase.from("cb_master_lines").select("line_no, name, gifi_code, gifi_name, section, line_type, lead_sheet, statement_line, default_tax_code, mappable, pair_line, required_gifi, note, locked").eq("line_no", line).maybeSingle(),
    supabase.from("cb_tax_codes").select("code, name").order("sort_order"),
    supabase.from("cb_lead_sheets").select("code, name").order("sort_order"),
    supabase.from("cb_master_line_log").select("id, action, changes, reason, changed_at, who:changed_by(full_name)").eq("line_no", line).order("changed_at", { ascending: false }),
    supabase.from("cb_master_lines").select("line_no", { count: "exact", head: true }).eq("gifi_code", line.slice(0, 4)).neq("line_no", line).eq("mappable", true),
  ]);
  if (!l) notFound();
  const m = l as Line;
  const taxList = (taxes ?? []) as { code: string; name: string }[];
  const sheetList = (sheets ?? []) as { code: string; name: string }[];
  const history = (log ?? []) as unknown as Log[];
  const field = (id: string, label: string, el: React.ReactNode, hint?: string) => (
    <div><label htmlFor={id} className="label">{label}</label>{el}{hint && <span className="text-xs text-muted">{hint}</span>}</div>
  );
  return (
    <>
      <Link href="/admin/closebook/gifi-lines" className="mb-3 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />All GIFI lines</Link>
      <PageHeader eyebrow="Settings › Closebook › GIFI lines · owners only" title={`${m.line_no} ${m.name}`}
        description={`GIFI ${m.gifi_code} ${m.gifi_name}. ${m.section}, ${m.line_type.toLowerCase()}.${m.pair_line ? ` An opposite balance moves to ${m.pair_line}.` : ""}${m.required_gifi ? " Required in every GIFI." : ""}`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={updateMasterLine} className="card grid content-start gap-4">
          <h2 className="font-semibold">Change this line</h2>
          <input type="hidden" name="line" value={m.line_no} />
          {field("name", "Name", <input id="name" name="name" defaultValue={m.name} required maxLength={200} className="input" />)}
          {m.mappable ? (
            <>
              {field("statement_line", "Statement line", <input id="statement_line" name="statement_line" defaultValue={m.statement_line ?? ""} required className="input" />, "The caption this line adds into on the financial statements.")}
              {field("tax_code", "Default tax code", <select id="tax_code" name="tax_code" defaultValue={m.default_tax_code ?? ""} className="input">{taxList.map((t) => <option key={t.code} value={t.code}>{t.code}: {t.name}</option>)}</select>, "New client accounts on this line take it. Only the reviewer changes it for a client.")}
              {field("lead_sheet", "Lead sheet", <select id="lead_sheet" name="lead_sheet" defaultValue={m.lead_sheet ?? ""} className="input">{sheetList.map((x) => <option key={x.code} value={x.code}>{x.code} {x.name}</option>)}</select>)}
            </>
          ) : (
            <>
              <p className="rounded-lg border border-sand-200 bg-sand-50 p-3 text-sm">A calculated total. Nobody maps to it; only its name and note can change.</p>
              <input type="hidden" name="statement_line" value={m.statement_line ?? ""} />
              <input type="hidden" name="tax_code" value={m.default_tax_code ?? ""} />
              <input type="hidden" name="lead_sheet" value={m.lead_sheet ?? ""} />
            </>
          )}
          {field("note", "Note", <textarea id="note" name="note" defaultValue={m.note} rows={2} className="input" />)}
          {field("reason", "Reason for the change *", <input id="reason" name="reason" required minLength={3} maxLength={500} className="input" />, "Kept with the change in the log below.")}
          <button type="submit" className="btn w-fit">Save the change</button>
        </form>

        {m.mappable && (
          <form action={addSubLine} className="card grid content-start gap-4">
            <h2 className="font-semibold">{m.line_no.endsWith(".00") ? `Add a sub-line under ${m.line_no}` : `Add another sub-line to GIFI ${m.gifi_code}`}</h2>
            <p className="text-sm text-ink-2">Same GIFI code ({m.gifi_code}) and lead sheet, with its own name and tax treatment. It takes the next number (.10, .20 and so on).</p>
            <input type="hidden" name="parent" value={m.line_no} />
            {field("sub_name", "Name *", <input id="sub_name" name="name" required minLength={2} maxLength={200} className="input" />)}
            {field("sub_statement", "Statement line", <input id="sub_statement" name="statement_line" placeholder={m.statement_line ?? ""} className="input" />, "Leave blank to use the main line's.")}
            {field("sub_tax", "Default tax code", <select id="sub_tax" name="tax_code" defaultValue={m.default_tax_code ?? ""} className="input">{taxList.map((t) => <option key={t.code} value={t.code}>{t.code}: {t.name}</option>)}</select>)}
            {field("sub_note", "Note", <textarea id="sub_note" name="note" rows={2} className="input" />)}
            {field("sub_reason", "Reason *", <input id="sub_reason" name="reason" required minLength={3} maxLength={500} className="input" />)}
            <button type="submit" className="btn-secondary w-fit">Add the sub-line</button>
          </form>
        )}
      </div>

      {m.mappable && m.line_no.endsWith(".00") && (subs ?? 0) > 0 && (
        <form action={setLineLocked} className="card mt-6 grid gap-4">
          <h2 className="flex items-center gap-2 font-semibold">{m.locked && <Lock className="h-4 w-4 text-ink-3" aria-hidden />}{m.locked ? "This line is locked" : "Lock this line"}</h2>
          <p className="text-sm text-ink-2">{m.locked
            ? "Staff see it with a lock and must pick one of its sub-lines. Nobody can match an account or post an entry to it."
            : "Locking makes staff pick one of its sub-lines. Lock a line when its sub-lines are the real choice. Leave it open when the main line is a normal answer too (meals at 50%, for example)."}</p>
          <input type="hidden" name="line" value={m.line_no} />
          <input type="hidden" name="locked" value={m.locked ? "false" : "true"} />
          {field("lock_reason", "Reason *", <input id="lock_reason" name="reason" required minLength={3} maxLength={500} className="input" />)}
          <button type="submit" className="btn-secondary w-fit">{m.locked ? "Unlock the line" : "Lock the line"}</button>
        </form>
      )}

      <section className="card mt-6">
        <h2 className="mb-3 font-semibold">Changes to this line</h2>
        {history.length === 0 ? <p className="text-sm text-muted">No changes since the approved list was loaded.</p> : (
          <ul className="grid gap-2 text-sm">{history.map((h) => (
            <li key={h.id} className="border-b border-sand-200 pb-2">
              <b>{formatDateTime(h.changed_at)}</b>, {h.who?.full_name ?? "Owner"}: {h.action === "add" ? "line added" : Object.entries(h.changes).map(([k, v]) => k === "locked" ? ((v as boolean[])[1] ? "locked" : "unlocked") : `${k.replace(/_/g, " ")} "${(v as string[])[0] ?? ""}" to "${(v as string[])[1] ?? ""}"`).join("; ")}. Reason: {h.reason}
            </li>
          ))}</ul>
        )}
      </section>
    </>
  );
}
