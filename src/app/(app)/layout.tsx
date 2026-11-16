import { requireAccess, canView, canEdit, letterTypes } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ds/overlays";
import { NoteHost } from "@/components/save-state";
import { signOut } from "../login/actions";
import { AppSidebar } from "./app-sidebar";
import { MainArea } from "./main-area";
import { TopBar, type NewItem } from "./top-bar";
import { gearMenu } from "./admin/settings-menu";
import { draftsByTab } from "@/lib/studio/template-status";
import { Suspense } from "react";
import { NavProgress } from "@/components/nav-progress";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();
  // Menu badges: quotes and engagement letters sent and waiting for the client's signature.
  const supabase = await createClient();
  const seeDocs = canView(access, "documents");
  const pricing = canView(access, "pricing");
  // The Engagements badge (its Letters tab): every letter waiting for a signature (quotes, monthly quotes, new letters).
  // The gear's count: templates waiting for an owner's approval (owners only). The three counts load together.
  const [{ count: leadsNew }, { data: lettersAwaiting }, drafts] = await Promise.all([
    canView(access, "leads") ? supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new") : Promise.resolve({ count: 0 }),
    seeDocs || canView(access, "leads") ? supabase.rpc("letters_waiting_count") : Promise.resolve({ data: 0 }),
    access.is_owner && canView(access, "engagement_terms") ? draftsByTab(supabase) : Promise.resolve({ letters: 0, schedules: 0, emails: 0, closebook: 0 }),
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
      <div className="min-h-screen bg-paper md:flex">
        <AppSidebar
          access={{
            fullName: access.full_name,
            roleName: access.role_name,
            isOwner: access.is_owner,
            leads: canView(access, "leads"),
            clients: canView(access, "clients"),
            documents: seeDocs,
            documentsEdit: canEdit(access, "documents"),
            vault: canView(access, "vault"),
            pricing,
            screening: canView(access, "price_book"),
            templates: canView(access, "engagement_terms"),
            taxRates: canView(access, "tax_rates"),
            staff: canView(access, "staff_accounts"),
            settings: canView(access, "settings"),
            closebook: canView(access, "closebook"),
          }}
          counts={{ quotesAwaiting: 0, lettersAwaiting: (lettersAwaiting as number | null) ?? 0, leadsNew: leadsNew ?? 0 }}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar name={access.full_name} role={access.role_name} initials={initials} clients={canView(access, "clients")} newItems={newItems}
            gear={gear} drafts={draftTotal} signOut={signOut} />
          <MainArea>{children}</MainArea>
        </div>
      </div>
      {/* Round 21: the "Saved" note (bottom-left, Dext) and the "Save your changes?" question, for every page. */}
      <NoteHost />
      {/* A bar across the top while the next page loads, so every click shows at once. */}
      <Suspense fallback={null}><NavProgress /></Suspense>
    </ToastProvider>
  );
}
