// Round 17 (Hashim, Nov 15, 2026): Closebook in the left menu opens on My files; All files and Review
// notes are tabs on that page. Each tab keeps its own address.
import Link from "next/link";

const TABS: [string, string][] = [["/closebook", "My files"], ["/closebook/files", "All files"], ["/closebook/notes", "Review notes"]];

export function CloseTabs({ active }: { active: string }) {
  return (
    <nav aria-label="Closebook" className="-mt-2 mb-6 flex gap-1 border-b border-sand-200">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={href === active ? "page" : undefined}
          className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold ${href === active ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>{label}</Link>
      ))}
    </nav>
  );
}
