"use client";
// One file, chosen like step 5's "Add attachment" (round 3 item 11, after QuickBooks Online): a dashed box
// with a link-style button and the chosen file's name with a remove button. No browser "Choose File /
// No file chosen" (round 7 item 4). The file rides on the form's own input, so server actions read it
// as before; the action itself refuses a form sent with no file.
import { useRef, useState } from "react";

export function FilePick({ id, name, label, add, accept, hint }: { id: string; name: string; label: string; add: string; accept: string; hint: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const clear = () => { if (input.current) input.current.value = ""; setFile(null); };
  return (
    <div className="grid content-start gap-1 text-sm font-medium">
      <span id={`${id}-label`}>{label}</span>
      <input ref={input} id={id} type="file" name={name} accept={accept} className="sr-only" aria-labelledby={`${id}-label`}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <div className="flex min-w-[16rem] flex-col gap-1.5 rounded-lg border border-dashed border-sand-300 p-2.5">
        {file ? (
          <span className="flex items-center justify-between gap-2 rounded bg-sand-50 px-2 py-1 text-sm font-normal">
            <span className="truncate">{file.name}</span>
            <button type="button" aria-label={`Remove ${file.name}`} onClick={clear} className="text-ink-3 hover:text-danger">×</button>
          </span>
        ) : (
          <button type="button" onClick={() => input.current?.click()} className="w-fit text-sm font-medium text-navy-700 underline">{add}</button>
        )}
        <span className="text-xs font-normal text-ink-3">{hint}</span>
      </div>
    </div>
  );
}
