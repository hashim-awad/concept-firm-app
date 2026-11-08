import { requireAccess, canView } from "@/lib/access";
import { ToastProvider } from "@/components/ds/overlays";
import { signOut } from "../login/actions";
import { AppSidebar } from "./app-sidebar";

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
            staff: canView(access, "staff_accounts"),
            settings: canView(access, "settings"),
          }}
        />
        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-9">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </ToastProvider>
  );
}
