// Round 8 (Hashim, Nov 24, 2026): the review notes on a step, as in CaseWare Working Papers. Each note
// shows who, when and the text, then the replies. The preparer replies and marks it fixed; only the
// reviewer clears it, or reopens it with a reply. Cleared notes fold away but stay on the file.
import { formatDateTime } from "@/lib/dates";
import type { ReviewNote } from "@/lib/closebook/review-server";
import { clearNote, replyNote } from "../actions";

const WORD: Record<ReviewNote["status"], [string, string]> = {
  open: ["Open", "bg-danger-soft text-danger ring-[#F3C4BE]"], fixed: ["Fixed: for the reviewer to clear", "bg-navy-100 text-navy-800 ring-navy-200"],
  cleared: ["Cleared", "bg-success-soft text-success ring-[#BFE0CC]"],
};
const TARGET: Record<ReviewNote["target_type"], string> = { step: "The step", account: "Account", entry: "Entry", bank_line: "Bank line" };

// canFix: the file's preparer marks a note fixed (an owner who prepares the file too, as Hashim does).
export function ReviewNotes({ fileId, notes, names, isOwner, canFix, editable, back, title = "Review notes" }: {
  fileId: string; notes: ReviewNote[]; names: Map<string, string>; isOwner: boolean; canFix: boolean; editable: boolean; back: string; title?: string;
}) {
  if (!notes.length) return null;
  const open = notes.filter((n) => n.status !== "cleared"), cleared = notes.filter((n) => n.status === "cleared");
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const name = (id: string | null) => (id ? names.get(id) ?? "" : "");
  const one = (n: ReviewNote) => (
    <li key={n.id} id={`note-${n.id}`} className={`grid gap-2 rounded-lg border p-3 ${n.status === "open" ? "border-danger/40 bg-danger/5" : "border-sand-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-3"><span className="font-semibold text-ink-2">{TARGET[n.target_type]}{n.target_label ? `: ${n.target_label}` : ""}</span> · {name(n.created_by)}, {formatDateTime(n.created_at)}</p>
        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${WORD[n.status][1]}`}>{WORD[n.status][0]}</span>
      </div>
      <p className="text-sm whitespace-pre-line">{n.body}</p>
      {n.replies.length > 0 && <ul className="grid gap-1.5 border-l-2 border-sand-200 pl-3">{n.replies.map((r) => (
        <li key={r.id} className="text-sm"><span className="text-xs text-ink-3">{name(r.created_by)}, {formatDateTime(r.created_at)}</span><span className="block whitespace-pre-line">{r.body}</span></li>
      ))}</ul>}
      {n.status === "cleared" && <p className="text-xs text-ink-3">Cleared by {name(n.cleared_by)}, {formatDateTime(n.cleared_at)}</p>}
      {n.status !== "cleared" && editable && (
        <div className="grid gap-2">
          <form action={replyNote} className="grid gap-1.5">
            {hidden("file_id", fileId)}{hidden("note", n.id)}{hidden("back", back)}
            <label htmlFor={`reply-${n.id}`} className="sr-only">Reply</label>
            <textarea id={`reply-${n.id}`} name="body" rows={2} maxLength={2000} className="input" placeholder={isOwner ? "Reply, or say what is still needed to reopen it" : "Reply: what you did"} />
            <div className="flex flex-wrap gap-2">
              <button type="submit" name="fixed" value="0" className="btn-secondary btn-compact">Reply</button>
              {n.status === "open" && canFix && <button type="submit" name="fixed" value="1" className="btn btn-compact">Reply and mark fixed</button>}
              {isOwner && n.status === "fixed" && <button type="submit" formAction={clearNote} name="reopen" value="1" className="btn-secondary btn-compact">Reopen with this reply</button>}
            </div>
          </form>
          {isOwner && <form action={clearNote}>{hidden("file_id", fileId)}{hidden("note", n.id)}{hidden("back", back)}
            <button type="submit" className="text-sm text-navy-700 underline">Clear the note</button></form>}
        </div>
      )}
    </li>
  );
  return (
    <section aria-label={title} className="card mb-4 grid gap-3">
      <h2 className="flex items-center gap-2 font-semibold">{title}
        {open.length > 0 && <span className="rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-white">{open.length} open</span>}</h2>
      {open.length > 0 && <ul className="grid gap-2">{open.map(one)}</ul>}
      {cleared.length > 0 && (
        <details><summary className="cursor-pointer text-sm text-ink-2">{cleared.length} cleared note{cleared.length === 1 ? "" : "s"}</summary>
          <ul className="mt-2 grid gap-2">{cleared.map(one)}</ul></details>
      )}
    </section>
  );
}
