import Link from "next/link";

const TABS = [["/admin/price-book", "Catalogue"], ["/admin/price-book/packages", "Packages and floors"]] as const;

export function PriceBookTabs({ current }: { current: string }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-1 border-b border-sand-200" aria-label="Price book sections">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={current === href ? "page" : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${current === href ? "border-lime-500 text-navy-800" : "border-transparent text-ink-2 hover:text-ink"}`}>{label}</Link>
      ))}
    </nav>
  );
}
