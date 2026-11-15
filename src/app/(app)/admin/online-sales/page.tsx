import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { SettingsShell, type SP, type View } from "../settings-shell";
import { openTabs } from "../settings-menu";
import { StartPageView } from "../settings/start-page/view";
import { ScreeningView } from "../screening/view";
import { BookingLinkView } from "../settings/booking-link/view";
import { LeadAssignmentView } from "../settings/lead-assignment/view";

// Round 17: Online sales, with tabs from four older pages (start page, screening questions, booking link,
// lead assignment).
export default async function OnlineSalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requireAccess();
  const sp = await searchParams;
  const tabs = openTabs(access, "/admin/online-sales");
  if (!tabs.length) redirect("/?error=no-access");
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const view: View = tab.key === "screening" ? await ScreeningView(sp) : tab.key === "booking" ? await BookingLinkView(sp)
    : tab.key === "assignment" ? await LeadAssignmentView(sp) : await StartPageView(sp);
  return <SettingsShell title="Online sales" help={view.help} actions={view.actions} tabs={tabs} active={tab.key} href="/admin/online-sales">{view.body}</SettingsShell>;
}
