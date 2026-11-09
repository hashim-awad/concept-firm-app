import { FIRM } from "@/components/ds/brand";

export function Closed() {
  return (
    <div className="text-center">
      <h1 className="text-2xl font-semibold tracking-tight">This page is not open yet</h1>
      <p className="mt-3 text-ink-2">To ask about our services, call us at <a href={`tel:${FIRM.phone}`} className="text-navy-700 underline">{FIRM.phone}</a> or email <a href={`mailto:${FIRM.email}`} className="text-navy-700 underline">{FIRM.email}</a>.</p>
    </div>
  );
}

export function PreviewNote() {
  return <p className="mb-6 rounded-lg border border-warning/30 bg-warning-soft px-4 py-2 text-sm">Preview for staff. The public cannot see this page until an owner opens it in Settings.</p>;
}
