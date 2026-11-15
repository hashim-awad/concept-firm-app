import { requireAccess, canView, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ds/overlays";
import { signOut } from "../login/actions";
import { AppSidebar } from "./app-sidebar";
import { MainArea } from "./main-area";
import { TopBar, type NewItem } from "./top-bar";
import { gearMenu } from "./admin/settings-menu";
import { draftsByTab } from "@/lib/studio/template-status";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();
  // Menu badges: quotes and engagement letters sent and waiting for the client's signature.
  const supabase = await createClient();
  const seeDocs = canView(access, "documents");
  const pricing = canView(access, "pricing");
  const { count: leadsNew } = canView(access, "leads") ? await supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new") : { count: 0 };
  // Engagement letters' badge: every letter waiting for a signature (quotes, proposals, new letters).
  const { data: lettersAwaiting } = seeDocs || canView(access, "leads") ? await supabase.rpc("letters_waiting_count") : { data: 0 };
  // The gear's count: templates waiting for an owner's approval (owners only).
  const drafts = access.is_owner && canView(access, "engagement_terms") ? await draftsByTab(supabase) : { letters: 0, schedules: 0, emails: 0, closebook: 0 };
  // The badge is the sum of the counts the gear menu shows, so the two always agree.
  const gear = gearMenu(access, drafts);
  const draftTotal = gear.flatMap((c) => c.items).reduce((n, i) => n + (i.count ?? 0), 0);
  // "+ New" (QuickBooks Online's Create): each item only for people who can do it.
  const newItems = ([
    canEdit(access, "leads") && { key: "lead", label: "New lead by phone", href: "/leads/phone" },
    canEdit(access, "documents") && pricing && { key: "proposal", label: "New proposal", href: "/quotes/proposal" },
    canEdit(access, "documents") && pricing && { key: "letter", label: "New letter", href: "/engagement-letters/new" },
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
    </ToastProvider>
  );
}
