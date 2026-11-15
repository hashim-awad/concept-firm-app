"use client";
// Step 2's first question (Hashim, Nov 15, 2026, item 7), worded as on the T2 (line 070, as ProFile asks
// it): "Is this the first year of filing after incorporation?" Yes: no opening balances, the step is one
// confirmation. No: the schedule shows. Never both. Saved by cb_set_first_year (round 16).
import { useRef } from "react";
import { confirmAction } from "@/components/save-state";
import { InfoTip } from "@/components/ds/info-tip";
import { setFirstYear } from "../round16-actions";

export function FirstYearQuestion({ fileId, back, answer, earlier, hasData, editable }: {
  fileId: string; back: string; answer: "yes" | "no" | null;
  // An earlier Closebook file for this client: not its first year, so only No.
  earlier: boolean; hasData: boolean; editable: boolean;
}) {
  const form = useRef<HTMLFormElement>(null);
  const choose = async (yes: boolean) => {
    if ((answer === "yes") === yes && answer !== null) return;
    if (yes && hasData && !(await confirmAction({ title: "First year of filing?", body: "Yes removes the opening balances entered in this step: a first year has none.", confirm: "Yes, remove them", cancel: "Keep them", danger: true }))) return;
    const b = form.current?.querySelector<HTMLButtonElement>(`button[value="${yes ? "1" : "0"}"]`);
    form.current?.requestSubmit(b ?? undefined);
  };
  const seg = (yes: boolean) => {
    const on = answer === (yes ? "yes" : "no");
    return (
      <button type="submit" name="on" value={yes ? "1" : "0"} aria-pressed={on} disabled={!editable || (yes && earlier)}
        onClick={(e) => { e.preventDefault(); void choose(yes); }}
        className={`px-4 py-1.5 text-sm ${on ? "bg-navy-700 font-semibold text-white" : "text-ink-2 hover:bg-sand-50 disabled:hover:bg-transparent"} ${yes ? "" : "border-l border-sand-300"} disabled:cursor-not-allowed`}>
        {yes ? "Yes" : "No"}</button>
    );
  };
  return (
    <section aria-label="First year of filing" className="form-col mb-3.5 grid gap-3">
      <form ref={form} action={setFirstYear} className="card flex flex-wrap items-center gap-3">
        <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={back} />
        <span className="text-sm font-semibold">Is this the first year of filing after incorporation?</span>
        <InfoTip>As on the T2, line 070. Yes: the company has no prior T2, so there are no opening balances. No: enter last year&rsquo;s balances from the prior T2 or the CRA assessment.</InfoTip>
        <span role="group" aria-label="First year of filing after incorporation" className="inline-flex overflow-hidden rounded-md border border-sand-300">{seg(true)}{seg(false)}</span>
        {earlier && <span className="text-xs text-ink-3">There is an earlier Closebook file for this client, so this is not its first year.</span>}
      </form>
      {answer === "yes" && (
        <div className="card text-sm">
          <p className="font-semibold">First year of filing: no opening balances.</p>
          <p className="mt-1 text-ink-2">Last year&rsquo;s columns stay empty and the statements have no prior-year column. Nothing else to enter on this step: sign it as preparer, and the reviewer confirms it by signing step 2.</p>
        </div>
      )}
      {answer === null && <p className="text-sm text-ink-2">Answer the question to go on with this step.</p>}
    </section>
  );
}
