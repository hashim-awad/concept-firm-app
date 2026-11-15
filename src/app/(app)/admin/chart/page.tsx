import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { SettingsShell, type SP, type View } from "../settings-shell";
import { openTabs } from "../settings-menu";
import { GifiLinesView } from "../closebook/gifi-lines/view";
import { TaxCodesView } from "../closebook/tax-codes/view";
import { LeadSheetsView } from "../closebook/lead-sheets/view";

// Round 17: Chart and GIFI, with tabs from three older pages (GIFI lines, tax codes, lead sheets).
export default async function ChartPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requireAccess();
  const sp = await searchParams;
  const tabs = openTabs(access, "/admin/chart");
  if (!tabs.length) redirect("/?error=no-access");
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const view: View = tab.key === "tax-codes" ? await TaxCodesView(sp) : tab.key === "lead-sheets" ? await LeadSheetsView(sp) : await GifiLinesView(sp);
  return <SettingsShell title="Chart and GIFI" help={view.help} actions={view.actions} tabs={tabs} active={tab.key} href="/admin/chart">{view.body}</SettingsShell>;
}
