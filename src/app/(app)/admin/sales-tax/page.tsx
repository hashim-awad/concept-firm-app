import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { SettingsShell, type SP, type View } from "../settings-shell";
import { openTabs } from "../settings-menu";
import { TaxRatesView } from "../tax-rates/view";
import { QuickMethodView } from "../closebook/gst/view";

// Round 17: Sales tax rates, with tabs from two older pages (GST/HST rates, and the quick method part of
// Closebook GST/HST).
export default async function SalesTaxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requireAccess();
  const sp = await searchParams;
  const tabs = openTabs(access, "/admin/sales-tax");
  if (!tabs.length) redirect("/?error=no-access");
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const view: View = tab.key === "quick" ? await QuickMethodView(sp) : await TaxRatesView(sp);
  return <SettingsShell title="Sales tax rates" help={view.help} actions={view.actions} tabs={tabs} active={tab.key} href="/admin/sales-tax">{view.body}</SettingsShell>;
}
