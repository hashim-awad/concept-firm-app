"use client";
// Round 15b (CaseWare Cloud's issues): a note's actions as small text links, by role. The preparer sees
// Reply and Mark fixed; the reviewer sees Reply and Clear. The reply box opens only on Reply (or Mark
// fixed, which needs a reply saying what was done: the database's rule).
import { useState } from "react";
import { clearNote, replyNote } from "../actions";

export function NoteActions({ fileId, noteId, status, back, canFix, canClear }: {
  fileId: string; noteId: string; status: "open" | "fixed" | "cleared"; back: string; canFix: boolean; canClear: boolean;
}) {
  const [mode, setMode] = useState<"" | "reply" | "fix">("");
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const link = "text-[12.5px] font-semibold text-navy-700 hover:underline";
  if (!mode) return (
    <div className="flex flex-wrap items-center gap-4">
      <button type="button" className={link} onClick={() => setMode("reply")}>Reply</button>
      {canFix && status === "open" && <button type="button" className={link} onClick={() => setMode("fix")}>Mark fixed</button>}
      {canClear && <form action={clearNote}>{hidden("file_id", fileId)}{hidden("note", noteId)}{hidden("back", back)}<button type="submit" className={link}>Clear</button></form>}
    </div>
  );
  return (
    <form action={replyNote} className="grid gap-2">
      {hidden("file_id", fileId)}{hidden("note", noteId)}{hidden("back", back)}
      <textarea name="body" rows={3} maxLength={2000} autoFocus required aria-label="Reply" className="input text-[13px]" placeholder={mode === "fix" ? "What you did" : "Write a reply"} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" name="fixed" value={mode === "fix" ? "1" : "0"} className="btn btn-compact">{mode === "fix" ? "Mark fixed" : "Send reply"}</button>
        {canClear && status === "fixed" && mode === "reply" && <button type="submit" formAction={clearNote} name="reopen" value="1" className="btn-secondary btn-compact">Reopen with this reply</button>}
        <button type="button" className="btn-secondary btn-compact" onClick={() => setMode("")}>Cancel</button>
      </div>
    </form>
  );
}
