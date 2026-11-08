import Link from "next/link";
import { requireAccess, canView } from "@/lib/access";
import { signOut } from "../login/actions";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();

  const adminLinks = [
    canView(access, "price_book") && { href: "/admin/price-book", label: "Price book" },
    canView(access, "price_book") && { href: "/admin/screening", label: "Screening questions" },
    canView(access, "staff_accounts") && { href: "/admin/staff", label: "Staff" },
    access.is_owner && { href: "/admin/roles", label: "Roles and permissions" },
    canView(access, "settings") && { href: "/admin/settings", label: "Settings" },
    access.is_owner && { href: "/admin/activity", label: "Activity log" },
  ].filter(Boolean) as { href: string; label: string }[];

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-border bg-surface md:min-h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="px-5 py-4">
          <Link href="/" className="block font-semibold">Concept Firm App</Link>
          <p className="mt-1 text-xs text-muted">{access.full_name} · {access.role_name}</p>
        </div>
        <nav className="flex flex-wrap gap-1 px-3 pb-3 md:block md:space-y-1">
          <NavLink href="/" label="Home" />
          <NavLink href="/design" label="Design (for approval)" />
          {adminLinks.length > 0 && (
            <p className="hidden px-2 pt-4 pb-1 text-xs font-medium uppercase tracking-wide text-muted md:block">Admin</p>
          )}
          {adminLinks.map((l) => (
            <NavLink key={l.href} href={l.href} label={l.label} />
          ))}
          <form action={signOut} className="md:pt-4">
            <button type="submit" className="rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-background hover:text-foreground md:w-full">
              Sign out
            </button>
          </form>
        </nav>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="block rounded-md px-2 py-1.5 text-sm hover:bg-background">
      {label}
    </Link>
  );
}
