"use client";
// Round 15b fix 1 (Hashim): one checklist answer. The note box opens only when No is picked on that
// question; a note already saved shows as plain text with an Edit link. The saved note always goes back
// with the form, so saving the checklist never drops it.
import { useState } from "react";

export function ChecklistAnswer({ qkey, n, answer, note, options, editable }: {
  qkey: string; n: number; answer: string; note: string; options: readonly ("yes" | "no" | "na")[]; editable: boolean;
}) {
  const [picked, setPicked] = useState(answer);
  const [editing, setEditing] = useState(false);
  const open = editable && (picked === "no" || editing);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {options.map((a) => (
          <label key={a} className="inline-flex items-center gap-1.5">
            <input type="radio" name={`a_${qkey}`} value={a} defaultChecked={answer === a} disabled={!editable} onChange={() => setPicked(a)} className="h-4 w-4" />
            {a === "yes" ? "Yes" : a === "no" ? "No" : "Not applicable"}</label>
        ))}
      </div>
      {open ? (
        <label className="md:col-span-2"><span className="sr-only">Note for question {n}</span>
          <input name={`n_${qkey}`} defaultValue={note} maxLength={1000} autoFocus={editing} className="input input-compact w-full" placeholder="Why No" /></label>
      ) : note ? (
        <p className="text-[12.5px] text-ink-2 md:col-span-2"><input type="hidden" name={`n_${qkey}`} value={note} />{note}
          {editable && <button type="button" onClick={() => setEditing(true)} className="ml-2 font-semibold text-navy-700 hover:underline">Edit</button>}</p>
      ) : null}
    </>
  );
}
