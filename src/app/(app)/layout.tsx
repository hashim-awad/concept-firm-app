import { requireAccess, canView, canEdit } from "@/lib/access";
import { ToastProvider } from "@/components/ds/overlays";
import { signOut } from "../login/actions";
import { AppSidebar } from "./app-sidebar";
import { MainArea } from "./main-area";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const access = await requireAccess();
  return (
    <ToastProvider>
      <div className="min-h-screen bg-paper md:flex">
        <AppSidebar
          signOut={signOut}
          access={{
            fullName: access.full_name,
            roleName: access.role_name,
            isOwner: access.is_owner,
            priceBook: canView(access, "price_book"),
            templates: canView(access, "engagement_terms"),
            documents: canView(access, "documents") || canView(access, "vault"),
            documentsEdit: canEdit(access, "documents"),
            clients: canView(access, "clients"),
            taxRates: canView(access, "tax_rates"),
            staff: canView(access, "staff_accounts"),
            settings: canView(access, "settings"),
          }}
        />
        <MainArea>{children}</MainArea>
      </div>
    </ToastProvider>
  );
}
