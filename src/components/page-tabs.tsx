import Link from "next/link";

// Tabs under a page header: each tab is a link, the current one underlined in Concept green.
export function PageTabs({ tabs, current, label }: { tabs: { href: string; label: string; key: string }[]; current: string; label: string }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-1 border-b border-sand-200" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} aria-current={current === t.key ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${current === t.key ? "border-lime-500 text-navy-800" : "border-transparent text-ink-2 hover:text-ink"}`}>{t.label}</Link>
      ))}
    </nav>
  );
}
