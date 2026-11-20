// Round 8 (Hashim, Nov 24, 2026): the review notes on a step, as in CaseWare Working Papers. Each note
// shows who, when and the text, then the replies. The preparer replies and marks it fixed; only the
// reviewer clears it, or reopens it with a reply. Cleared notes fold away but stay on the file.
import { formatDateTime } from "@/lib/dates";
import type { ReviewNote } from "@/lib/closebook/review-server";
import { NoteActions } from "./note-actions";

// Fixed status colours (round 15): notes red, Signed green, Open grey; a fixed note waits for the reviewer.
const WORD: Record<ReviewNote["status"], [string, string]> = {
  open: ["Open", "bg-danger-soft text-danger"], fixed: ["Fixed: to clear", "bg-navy-100 text-navy-800"], cleared: ["Cleared", "bg-sand-100 text-ink-2"],
};
const TARGET: Record<ReviewNote["target_type"], string> = { step: "The step", account: "Account", entry: "Entry", bank_line: "Bank line" };

// canFix: the file's preparer marks a note fixed (someone who prepares the file and holds Review too).
export function ReviewNotes({ fileId, notes, names, canReview, canFix, editable, back, title = "Review notes" }: {
  fileId: string; notes: ReviewNote[]; names: Map<string, string>; canReview: boolean; canFix: boolean; editable: boolean; back: string; title?: string;
}) {
  if (!notes.length) return null;
  const open = notes.filter((n) => n.status !== "cleared"), cleared = notes.filter((n) => n.status === "cleared");
  const one = (n: ReviewNote) => <NoteCard key={n.id} fileId={fileId} n={n} names={names} canReview={canReview} canFix={canFix} editable={editable} back={back} />;
  return (
    <section aria-label={title} className="grid gap-2">
      <h3 className="flex items-center gap-2 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">{title}
        {open.length > 0 && <span className="rounded-full bg-danger px-1.5 text-[10px] font-bold text-white">{open.length} open</span>}</h3>
      {open.length > 0 && <ul className="grid gap-2">{open.map(one)}</ul>}
      {cleared.length > 0 && (
        <details><summary className="cursor-pointer text-sm text-ink-2">{cleared.length} cleared note{cleared.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 grid gap-2">{cleared.map(one)}</ul></details>
      )}
    </section>
  );
}

// One note (round 15b, CaseWare Cloud's issues): a white card; the status chip carries the colour. Who,
// when, the item it is on, the text and the replies; Reply, Mark fixed (the preparer), Clear (the
// reviewer) as small actions. Shared by a step's Issues panel and the Notes tab.
export function NoteCard({ fileId, n, names, canReview, canFix, editable, back, itemLink }: {
  fileId: string; n: ReviewNote; names: Map<string, string>; canReview: boolean; canFix: boolean; editable: boolean; back: string; itemLink?: { href: string; label: string };
}) {
  const name = (id: string | null) => (id ? names.get(id) ?? "" : "");
  return (
    <li id={`note-${n.id}`} className="grid gap-1.5 rounded-[var(--radius-ds)] border border-sand-200 bg-white px-3.5 py-3">
      <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${WORD[n.status][1]}`}>{WORD[n.status][0]}</span>
        <span className="font-semibold text-ink">{name(n.created_by)}</span><span>{formatDateTime(n.created_at)}</span>
        <span>·</span>{itemLink ? <a href={itemLink.href} className="text-navy-700 hover:underline">{itemLink.label}</a>
          : <span>{TARGET[n.target_type]}{n.target_label ? `: ${n.target_label}` : ""}</span>}
      </p>
      <p className="text-[13px] leading-relaxed whitespace-pre-line">{n.body}</p>
      {n.replies.length > 0 && <ul className="grid gap-1.5 border-l-2 border-sand-200 pl-3">{n.replies.map((r) => (
        <li key={r.id} className="text-[12.5px]"><span className="font-semibold">{name(r.created_by)}</span> <span className="text-ink-3">{formatDateTime(r.created_at)}</span><span className="block whitespace-pre-line">{r.body}</span></li>
      ))}</ul>}
      {n.status === "cleared" && <p className="text-[12px] text-ink-3">Cleared by {name(n.cleared_by)}, {formatDateTime(n.cleared_at)}</p>}
      {n.status !== "cleared" && editable && <NoteActions fileId={fileId} noteId={n.id} status={n.status} back={back} canFix={canFix} canClear={canReview && !canFix} />}
    </li>
  );
}
