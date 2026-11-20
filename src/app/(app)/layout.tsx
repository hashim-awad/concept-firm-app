import "@fontsource/alexandria/latin-400.css";
import "@fontsource/alexandria/latin-500.css";
import "@fontsource/alexandria/latin-600.css";
import "@fontsource/alexandria/latin-700.css";
import { STUDIO_ICONS } from "@/components/ds/brand";
import { requireAccess, canView, canEdit, letterTypes } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ds/overlays";
import { NoteHost } from "@/components/save-state";
import { signOut } from "../login/actions";
import { MainArea } from "./main-area";
import { SkipLinks } from "./skip-links";
import { TopBar, type NewItem } from "./top-bar";
import { gearMenu } from "./admin/settings-menu";
import { draftsByTab } from "@/lib/studio/template-status";
import { Suspense } from "react";
import { NavProgress } from "@/components/nav-progress";

// Round 37: staff screens show the C Studio tab icon (client pages keep the Concept icon).
export const metadata = { icons: STUDIO_ICONS };

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();
  // Top bar counts (UI1, Q8). Sales: website leads still New (phone leads are entered by staff, so they are not counted).
  // Engagements: engagement letters waiting for the client's signature (studio letters and outside letters).
  // Quotes: quotes sent and waiting, still valid; shown beside Quotes in the Sales menu. letter_list() checks rights itself.
  const supabase = await createClient();
  const seeDocs = canView(access, "documents");
  const seeLeads = canView(access, "leads");
  const pricing = canView(access, "pricing");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Toronto" });
  const letters = () =>
    supabase.rpc("letter_list", {}, { count: "exact", head: true }).in("status", ["sent", "viewed"]).in("kind", ["letter", "engagement"])
      .or(`source.eq.outside,valid_until.gte.${today}`);
  const zero = Promise.resolve({ count: 0 });
  // The gear's count: templates waiting for an owner's approval (Admins only). The counts load together.
  const [{ count: leadsNew }, { count: lettersWaiting }, { count: quotesWaiting }, drafts, { count: bellUnread }] = await Promise.all([
    seeLeads ? supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new").not("source", "ilike", "phone%") : zero,
    seeDocs || seeLeads ? letters() : zero,
    // The same list My day counts (quote_list, all three kinds including monthly quotes), so the two always agree.
    seeLeads ? supabase.rpc("quote_list", {}, { count: "exact", head: true }).in("status", ["sent", "viewed"]).or(`valid_until.gte.${today},valid_until.is.null`) : zero,
    access.admin && canView(access, "engagement_terms") ? draftsByTab(supabase) : Promise.resolve({ letters: 0, schedules: 0, emails: 0, closebook: 0 }),
    // Round 32: the bell (a client answered questions). Each person sees only their own notices.
    supabase.from("staff_notices").select("id", { count: "exact", head: true }).is("read_at", null),
  ]);
  // The badge is the sum of the counts the gear menu shows, so the two always agree.
  const gear = gearMenu(access, drafts);
  const draftTotal = gear.flatMap((c) => c.items).reduce((n, i) => n + (i.count ?? 0), 0);
  // "+ New" (QuickBooks Online's Create): each item only for people who can do it.
  const newItems = ([
    canEdit(access, "leads") && { key: "lead", label: "New lead by phone", href: "/leads/phone" },
    // Round 19 (Hashim): one word for offers. "New quote" groups the three kinds. T1 and year-end quotes
    // start as a phone lead with the right questions open; the monthly quote opens its builder.
    canEdit(access, "leads") && { key: "quote_t1", group: "New quote", label: "T1 quote", href: "/leads/phone?form=personal" },
    canEdit(access, "leads") && { key: "quote_corporate", group: "New quote", label: "Year-end quote", href: "/leads/phone?form=company" },
    canEdit(access, "documents") && pricing && { key: "proposal", group: "New quote", label: "Monthly quote", href: "/quotes/proposal" },
    // Round 19: only for the letter types ticked on the person's role, opening a type they may prepare.
    canEdit(access, "documents") && pricing && letterTypes(access).length > 0 && { key: "letter", label: "New letter", href: `/engagement-letters/new?type=${letterTypes(access)[0]}` },
    canEdit(access, "clients") && { key: "client", label: "Add client", href: "/clients/new" },
    canEdit(access, "closebook") && { key: "file", label: "New Closebook file", href: "/closebook/new" },
  ] as (NewItem | false)[]).filter(Boolean) as NewItem[];
  const initials = access.full_name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  return (
    <ToastProvider>
      {/* UI1: data-ui1 turns on the C3 theme for staff screens only (client pages keep theirs). */}
      <div data-ui1 className="flex min-h-screen flex-col bg-paper">
        <SkipLinks />
        <TopBar name={access.full_name} role={access.role_name} initials={initials} clients={canView(access, "clients")} newItems={newItems}
          gear={gear} drafts={draftTotal} bell={bellUnread ?? 0} signOut={signOut}
          nav={{ leads: seeLeads, clients: canView(access, "clients"), closebook: canView(access, "closebook"), engagements: seeDocs || seeLeads, documents: seeDocs || canView(access, "vault") }}
          counts={{ leadsNew: leadsNew ?? 0, lettersWaiting: lettersWaiting ?? 0, quotesWaiting: quotesWaiting ?? 0 }} />
        <MainArea>{children}</MainArea>
      </div>
      {/* Round 21: the "Saved" note (bottom-left, Dext) and the "Save your changes?" question, for every page. */}
      <NoteHost />
      {/* A bar across the top while the next page loads, so every click shows at once. */}
      <Suspense fallback={null}><NavProgress /></Suspense>
    </ToastProvider>
  );
}
