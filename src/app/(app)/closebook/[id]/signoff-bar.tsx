// Round 8 (Hashim, Nov 24, 2026): a step's sign-offs, as in CaseWare Working Papers: "Prepared by" and
// "Reviewed by", each with name and date, at the top of the step. The preparer signs when nothing is
// open; the reviewer (an owner) signs after the preparer. The database checks every rule again.
import { formatDate } from "@/lib/dates";
import type { StepStatus } from "@/lib/closebook/review-server";
import { addNote, signStep, unsignStep } from "../actions";


export function SignoffBar({ fileId, step, st, names, me, isOwner, editable, back, preparerElsewhere }: {
  fileId: string; step: string; st: StepStatus | undefined; names: Map<string, string>; me: string; isOwner: boolean; editable: boolean; back: string;
  // Step 2 on a bank-statement file: the schedule below has its own "Sign as preparer" (it knows unsaved changes).
  preparerElsewhere?: boolean;
}) {
  const who = (id: string | null, at: string | null) => (id ? `${names.get(id) ?? ""}, ${formatDate(at)}` : "");
  const review = step === "review";
  const prepared = !!st?.prepared_at, reviewed = !!st?.reviewed_at;
  const same = prepared && reviewed && st?.prepared_by === st?.reviewed_by;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const form = (role: "prepared" | "reviewed", label: string, primary = true) => (
    <form action={signStep}>{hidden("file_id", fileId)}{hidden("step", step)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className={primary ? "btn btn-compact" : "btn-secondary btn-compact"}>{label}</button></form>
  );
  const undo = (role: "prepared" | "reviewed") => (
    <form action={unsignStep}>{hidden("file_id", fileId)}{hidden("step", step)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="text-xs text-navy-700 underline">Take back my sign-off</button></form>
  );
  const problems = st?.problems ?? [], waiting = st?.waiting ?? [];
  return (
    <section aria-label="Sign-offs" className="card mb-4 grid gap-3 py-3">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
        {!review && (
          <div className="min-w-[14rem]">
            <p className="text-xs font-semibold tracking-wide text-muted uppercase">Prepared by</p>
            {prepared ? <p className="text-sm"><span className="font-medium">{who(st!.prepared_by, st!.prepared_at)}</span></p>
              : <p className="text-sm text-ink-3">Not signed</p>}
            <div className="mt-1 flex flex-wrap items-center gap-3">
              {!prepared && editable && (preparerElsewhere ? <span className="text-xs text-ink-2">Sign with the schedule below.</span> : form("prepared", "Sign as preparer"))}
              {prepared && !reviewed && editable && st?.prepared_by === me && undo("prepared")}
            </div>
          </div>
        )}
        <div className="min-w-[14rem]">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">Reviewed by</p>
          {reviewed ? <p className="text-sm"><span className="font-medium">{who(st!.reviewed_by, st!.reviewed_at)}</span></p>
            : <p className="text-sm text-ink-3">{review || prepared ? "Not signed" : "After the preparer"}</p>}
          <div className="mt-1 flex flex-wrap items-center gap-3">
            {!reviewed && editable && (isOwner
              ? (review || prepared) && form("reviewed", review ? "Sign step 6 as reviewer" : "Sign as reviewer", review)
              : <span className="inline-flex items-center gap-2"><button type="button" disabled className="btn-secondary btn-compact" aria-describedby={`rv-${step}`}>Sign as reviewer</button>
                  <span id={`rv-${step}`} className="text-xs text-ink-3">Only the reviewer signs here. Reviewers are owners.</span></span>)}
            {reviewed && editable && isOwner && undo("reviewed")}
          </div>
        </div>
        {same && <p className="self-center rounded bg-sand-100 px-2 py-1 text-xs text-ink-2">Prepared and reviewed by the same person.</p>}
      </div>
      {(problems.length > 0 || waiting.length > 0) && !reviewed && (
        <div className="grid gap-1 border-t border-sand-200 pt-2 text-sm sm:grid-cols-2">
          {problems.length > 0 && <div><p className="font-medium">{review ? "Before step 6 can be signed" : "Open on this step"}</p>
            <ul className="list-disc pl-5 text-ink-2">{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
          {waiting.length > 0 && <div><p className="font-medium">Waiting for the reviewer{st?.holds_preparer && !prepared ? <span className="font-normal text-ink-2">: the preparer signs after these are decided</span> : null}</p>
            <ul className="list-disc pl-5 text-ink-2">{waiting.map((p) => <li key={p}>{p}</li>)}</ul></div>}
        </div>
      )}
      {isOwner && editable && (
        <details className="border-t border-sand-200 pt-2">
          <summary className="cursor-pointer text-sm text-navy-700 underline">Add a review note on this step</summary>
          <form action={addNote} className="mt-2 grid max-w-2xl gap-2">
            {hidden("file_id", fileId)}{hidden("step", step)}{hidden("target_type", "step")}{hidden("back", back)}
            <label htmlFor={`note-${step}`} className="sr-only">Review note</label>
            <textarea id={`note-${step}`} name="body" rows={2} maxLength={2000} className="input" placeholder="What the preparer should look at or fix" />
            <button type="submit" className="btn-secondary btn-compact justify-self-start">Add review note</button>
          </form>
        </details>
      )}
    </section>
  );
}
