// Piece UI1 (front office item 9): one placeholder for an empty table cell. Sighted readers see a dash; screen readers
// hear the label ("None" unless the column needs another word), never "dash".
export function EmptyCell({ label = "None" }: { label?: string }) {
  // relative: the hidden label stays inside a table that scrolls sideways (it would widen the page otherwise).
  return <span className="relative"><span aria-hidden className="text-ink-3">–</span><span className="sr-only">{label}</span></span>;
}
