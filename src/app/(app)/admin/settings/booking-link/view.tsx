import { Notice } from "@/components/ui";
import type { SP, View } from "../../settings-shell";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveBookingLink } from "../actions";

export async function BookingLinkView(sp: SP): Promise<View> {
  const { editable, byKey } = await loadSettings();
  const booking = String(byKey.get("booking_link") ?? "");
  return {
    help: <><p>The &ldquo;Choose a time&rdquo; button when a company lead needs a short call (monthly bookkeeping, paper receipts, or a complex situation).</p><p>{readOnlyNote(editable)}</p></>,
    body: <>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        {!booking && <p className="mb-4 text-sm text-warning">Not set yet.</p>}
        <form action={saveBookingLink} className="flex flex-wrap gap-2">
          <input name="url" defaultValue={booking} placeholder="https://…" disabled={!editable} aria-label="Booking link" className="input min-w-[20rem] flex-1" />
          {editable && <button type="submit" className="btn-secondary">Save link</button>}
        </form>
      </section>
    </>,
  };
}
