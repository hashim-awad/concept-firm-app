import { loadFirmContact } from "@/lib/firm-contact";

export async function Closed() {
  const c = await loadFirmContact();
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight">This page is not open yet</h1>
      <p className="mt-3 text-ink-2">To ask about our services, {c.phone ? <>call us at <a href={`tel:${c.phone}`} className="text-navy-700 underline">{c.phone}</a>{c.email ? " or " : ""}</> : null}{c.email ? <>email <a href={`mailto:${c.email}`} className="text-navy-700 underline">{c.email}</a></> : null}{!c.phone && !c.email ? "contact us" : ""}.</p>
    </div>
  );
}

export function PreviewNote() {
  return <p className="mb-6 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm">Preview for staff. The public cannot see this page until an Admin opens it in the gear menu, Online sales, Start page.</p>;
}
