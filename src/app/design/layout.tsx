import "@fontsource-variable/plus-jakarta-sans";
import { requireAccess } from "@/lib/access";
import { ToastProvider } from "@/components/ds/overlays";

export const metadata = { title: "Design system · Concept Firm App" };

export default async function DesignLayout({ children }: LayoutProps<"/design">) {
  await requireAccess();
  return (
    <ToastProvider>
      <div className="ds min-h-screen bg-paper">{children}</div>
    </ToastProvider>
  );
}
