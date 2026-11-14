"use client";
// Round 8: "Add a review note" on one item (an account, an entry or a bank line), for the reviewer.
// A small form that opens in place; the note then lists on the item's step with the item's name.
import { useState } from "react";
import { addNote } from "../actions";

export function NoteOnItem({ fileId, step, targetType, targetId, back, label = "Review note" }: {
  fileId: string; step: string; targetType: "account" | "entry" | "bank_line"; targetId: string; back: string; label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="text-xs text-navy-700 underline">{label}</button>;
  return (
    <form action={addNote} className="grid w-full min-w-[16rem] gap-1.5">
      <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="step" value={step} />
      <input type="hidden" name="target_type" value={targetType} /><input type="hidden" name="target_id" value={targetId} /><input type="hidden" name="back" value={back} />
      <label htmlFor={`n-${targetId}`} className="text-xs font-semibold">Review note</label>
      <textarea id={`n-${targetId}`} name="body" rows={2} maxLength={2000} className="input" autoFocus placeholder="What the preparer should look at or fix" />
      <span className="flex gap-2"><button type="submit" className="btn-secondary btn-compact">Add review note</button>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-2 underline">Cancel</button></span>
    </form>
  );
}
