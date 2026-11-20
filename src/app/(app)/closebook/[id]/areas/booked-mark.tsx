"use client";
// Piece R2 (D12c; Hashim, Nov 19, 2026): on a trial balance file, an entry can be marked "Booked in QuickBooks" once it is in the
// client's books. While any entry is marked, a new trial balance is refused (it would count the entry twice), and the entry
// cannot change until it is unmarked. History records each mark.
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/save-state";
import { markBookedInline } from "../../actions";

// Piece E1: an entry is booked once its step is reviewed (AJE and RJE: step 5; TJE: step 8); until then the reason shows.
export function BookedMark({ fileId, entry, booked, when, by, editable, waitStep = 0 }: { fileId: string; entry: string; booked: boolean; when: string; by: string; editable: boolean; waitStep?: number }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const run = (to: boolean) => start(async () => { const err = await markBookedInline(fileId, entry, to); if (err) notify(err, "error"); else { notify(to ? "Marked Booked in QuickBooks." : "No longer marked Booked in QuickBooks."); router.refresh(); } });
  if (booked) return (
    <span className="flex items-center gap-1.5 rounded bg-navy-50 px-1.5 py-0.5 text-[11px] font-semibold text-navy-700" data-booked>Booked in QuickBooks{by ? ` by ${by}` : ""}{when ? `, ${when}` : ""}
      {editable && <button type="button" disabled={pending} onClick={() => run(false)} className="font-normal text-navy-700 underline">Unmark</button>}</span>
  );
  if (editable && waitStep) return <span className="text-[11.5px] text-ink-3" data-book-after>Book it in QuickBooks after step {waitStep} is reviewed</span>;
  return editable ? <button type="button" disabled={pending} onClick={() => run(true)} className="btn-secondary btn-compact" data-mark-booked>Mark booked in QuickBooks</button> : null;
}
