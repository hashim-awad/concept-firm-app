import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { SettingsShell, type SP, type View } from "../settings-shell";
import { openTabs } from "../settings-menu";
import { ThresholdsView } from "../closebook/thresholds/view";
import { PolicyView } from "../closebook/policy/view";
import { GstDueDatesView } from "../closebook/gst/view";

// Round 17: Closebook rules, with tabs from three older pages (thresholds, Note 1 policy, GST/HST due dates).
export default async function ClosebookRulesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requireAccess();
  const sp = await searchParams;
  const tabs = openTabs(access, "/admin/closebook-rules");
  if (!tabs.length) redirect("/?error=no-access");
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const view: View = tab.key === "policy" ? await PolicyView(sp) : tab.key === "due-dates" ? await GstDueDatesView(sp) : await ThresholdsView(sp);
  return <SettingsShell title="Closebook rules" help={view.help} actions={view.actions} tabs={tabs} active={tab.key} href="/admin/closebook-rules">{view.body}</SettingsShell>;
}
