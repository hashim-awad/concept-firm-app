// Round 15: the Notes tab, as CaseWare Cloud's Issues page. One card per review note: who, when, status,
// a link to what it is on (the step, the account, the bank line or the entry), and Reply, Mark fixed and
// Clear on the card. Filters by status, step and person in the left panel. A step's own notes also stay
// in its Issues panel.
import type { ReviewNote } from "@/lib/closebook/review-server";
import type { Step } from "@/lib/closebook/steps";
import { NoteCard } from "../review-notes";
import { PageTitle, PanelHead, PanelLink } from "../shell/shell";

const STATUS: [ReviewNote["status"], string][] = [["open", "Open"], ["fixed", "Fixed"], ["cleared", "Cleared"]];

export function notesArea({ fileId, notes, steps, names, canReview, canFix, editable, sp }: {
  fileId: string; notes: ReviewNote[]; steps: Step[]; names: Map<string, string>; canReview: boolean; canFix: boolean; editable: boolean;
  sp: { status?: string; step?: string; who?: string };
}) {
  const base = `/closebook/${fileId}`;
  const q = (o: Record<string, string | undefined>) => `${base}?area=notes${Object.entries({ status: sp.status, nstep: sp.step, who: sp.who, ...o }).filter(([, v]) => v).map(([k, v]) => `&${k}=${encodeURIComponent(v!)}`).join("")}`;
  const people = [...new Set(notes.map((n) => n.created_by).filter(Boolean) as string[])];
  const left = (
    <>
      <PanelHead>Status</PanelHead>
      <PanelLink href={q({ status: undefined })} on={!sp.status} count={notes.length}>All</PanelLink>
      {STATUS.map(([k, l]) => <PanelLink key={k} href={q({ status: k })} on={sp.status === k} count={notes.filter((n) => n.status === k).length}>{l}</PanelLink>)}
      <PanelHead>Step</PanelHead>
      {steps.filter((s) => notes.some((n) => n.step === s.key)).map((s) => <PanelLink key={s.key} href={q({ nstep: sp.step === s.key ? undefined : s.key })} on={sp.step === s.key} count={notes.filter((n) => n.step === s.key).length}>{s.n} {s.name}</PanelLink>)}
      <PanelHead>Person</PanelHead>
      {people.map((p) => <PanelLink key={p} href={q({ who: sp.who === p ? undefined : p })} on={sp.who === p} count={notes.filter((n) => n.created_by === p).length}>{names.get(p) ?? "Staff"}</PanelLink>)}
    </>
  );
  const shown = notes.filter((n) => (!sp.status || n.status === sp.status) && (!sp.step || n.step === sp.step) && (!sp.who || n.created_by === sp.who))
    .sort((a, b) => (a.status === "cleared" ? 1 : 0) - (b.status === "cleared" ? 1 : 0) || b.created_at.localeCompare(a.created_at));
  const stepOf = new Map(steps.map((s) => [s.key, s]));
  const link = (n: ReviewNote) => {
    const s = stepOf.get(n.step as Step["key"]);
    const where = n.target_type === "entry" ? `${base}?area=entries&entry=${n.target_id}#entry-${n.target_id}` : `${base}?step=${n.step}#note-${n.id}`;
    return { href: where, label: `${s ? `Step ${s.n}, ${s.name}` : n.step}${n.target_label ? ` · ${n.target_label}` : ""}` };
  };
  const back = q({});
  const content = (
    <>
      <PageTitle>Review notes <span className="ml-1 font-normal tracking-normal text-ink-3">{shown.length}</span></PageTitle>
      {!shown.length && <p className="rounded-[var(--radius-ds)] border border-sand-200 bg-white px-4 py-3 text-[12.5px] text-ink-3">No review notes.</p>}
      <ul className="grid max-w-4xl gap-2.5">{shown.map((n) => <NoteCard key={n.id} fileId={fileId} n={n} names={names} canReview={canReview} canFix={canFix} editable={editable} back={back} itemLink={link(n)} />)}</ul>
    </>
  );
  return { left, content };
}
