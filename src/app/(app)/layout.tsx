import { requireAccess, canView, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { ToastProvider } from "@/components/ds/overlays";
import { signOut } from "../login/actions";
import { AppSidebar } from "./app-sidebar";
import { MainArea } from "./main-area";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();
  // Menu badges: proposals and engagement letters sent and waiting for the client's signature.
  const supabase = await createClient();
  const seeDocs = canView(access, "documents");
  const [{ count: proposalsAwaiting }, { count: lettersAwaiting }] = seeDocs ? await Promise.all([
    supabase.from("proposals").select("id", { count: "exact", head: true }).eq("status", "Sent"),
    supabase.from("engagements").select("id", { count: "exact", head: true }).eq("status", "EL sent"),
  ]) : [{ count: 0 }, { count: 0 }];
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
            priceBook: canView(access, "price_book"),
            templates: canView(access, "engagement_terms"),
            taxRates: canView(access, "tax_rates"),
            staff: canView(access, "staff_accounts"),
            settings: canView(access, "settings"),
          }}
          counts={{ proposalsAwaiting: proposalsAwaiting ?? 0, lettersAwaiting: lettersAwaiting ?? 0 }}
        />
        <MainArea>{children}</MainArea>
      </div>
    </ToastProvider>
  );
}
