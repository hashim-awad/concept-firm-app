import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveBookingLink } from "../actions";

export default async function BookingLinkPage({ searchParams }: PageProps<"/admin/settings/booking-link">) {
  const { editable, byKey } = await loadSettings();
  const sp = await searchParams;
  const booking = String(byKey.get("booking_link") ?? "");
  return (
    <>
      <PageHeader title="Booking link" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <section className="card">
        <p className="mb-4 text-sm text-muted">The &ldquo;Choose a time&rdquo; button when a company lead needs a short call (monthly bookkeeping, paper receipts, or a complex situation).{!booking && <span className="text-warning"> Not set yet.</span>}</p>
        <form action={saveBookingLink} className="flex flex-wrap gap-2">
          <input name="url" defaultValue={booking} placeholder="https://…" disabled={!editable} aria-label="Booking link" className="input min-w-[20rem] flex-1" />
          {editable && <button type="submit" className="btn-secondary">Save link</button>}
        </form>
      </section>
    </>
  );
}
