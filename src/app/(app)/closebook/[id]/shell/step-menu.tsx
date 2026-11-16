"use client";
// Round 21 (Hashim; QuickBooks Online's "Clear"): the step's "..." menu in its title row. "Clear this
// step" empties everything the preparer typed in the step, after a confirmation. Not on a signed step (the
// sign-off is removed first) and never on a locked file; the database checks both again.
import { useRef } from "react";
import { MoreHorizontal } from "lucide-react";
import { confirmAction, discardAll } from "@/components/save-state";
import { clearStep } from "../../round21-actions";
import { Popover } from "./ui";

export type StepMenuProps = { fileId: string; step: string; n: number; back: string;
  // ok: can clear; signed: remove the sign-off first; nothing: the step has no typed answers (imports, the review list).
  clear: "ok" | "signed" | "nothing" };

export function StepMenu({ fileId, step, n, back, clear }: StepMenuProps) {
  const form = useRef<HTMLFormElement>(null);
  const go = async () => {
    const ok = await confirmAction({ title: `Clear step ${n}?`, body: `Clear everything typed in step ${n}? This can't be undone.`, confirm: "Clear step", danger: true });
    if (!ok) return;
    discardAll();
    form.current?.requestSubmit();
  };
  return (
    <Popover align="right" width="w-64" label="More" button={<span className="grid h-[30px] w-[30px] place-items-center rounded-md text-ink-2 hover:bg-sand-100"><MoreHorizontal className="h-[17px] w-[17px]" aria-hidden /></span>}>
      <form ref={form} action={clearStep} data-no-guard>
        <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="step" value={step} /><input type="hidden" name="back" value={back} />
      </form>
      <button type="button" disabled={clear !== "ok"} onClick={(e) => { e.currentTarget.closest("details")?.removeAttribute("open"); go(); }}
        className="block w-full rounded px-2 py-1.5 text-left text-[13px] text-danger hover:bg-danger-soft disabled:cursor-not-allowed disabled:text-ink-3 disabled:hover:bg-transparent">Clear this step</button>
      {clear === "signed" && <p className="px-2 pt-1 text-xs text-ink-3">This step is signed. Take back the sign-off first.</p>}
      {clear === "nothing" && <p className="px-2 pt-1 text-xs text-ink-3">Nothing is typed on this step. Imports and uploads are removed where they are listed.</p>}
    </Popover>
  );
}
