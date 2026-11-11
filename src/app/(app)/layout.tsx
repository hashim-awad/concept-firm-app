import { requireAccess, canView, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ds/overlays";
import { signOut } from "../login/actions";
import { AppSidebar } from "./app-sidebar";
import { MainArea } from "./main-area";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();
  // Menu badges: quotes and engagement letters sent and waiting for the client's signature.
  const supabase = await createClient();
  const seeDocs = canView(access, "documents");
  const pricing = canView(access, "pricing");
  const { count: leadsNew } = canView(access, "leads") ? await supabase.from("leads").select("id", { count: "exact", head: true }).eq("status", "new") : { count: 0 };
  const { data: quotesWaiting } = canView(access, "leads") ? await supabase.rpc("quotes_waiting_count") : { data: 0 };
  const { count: lettersAwaiting } = seeDocs ? await supabase.from("engagements").select("id", { count: "exact", head: true }).eq("status", "EL sent") : { count: 0 };
  return (
    <ToastProvider>
      <div className="min-h-screen bg-paper md:flex">
        <AppSidebar
          signOut={signOut}
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
          counts={{ quotesAwaiting: (quotesWaiting as number | null) ?? 0, lettersAwaiting: lettersAwaiting ?? 0, leadsNew: leadsNew ?? 0 }}
        />
        <MainArea>{children}</MainArea>
      </div>
    </ToastProvider>
  );
}
