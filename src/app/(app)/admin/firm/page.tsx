import { redirect } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { SettingsShell, type SP, type View } from "../settings-shell";
import { openTabs } from "../settings-menu";
import { BusinessHoursView } from "../settings/business-hours/view";
import { SignersView } from "../settings/signers/view";
import { SignatureView } from "../settings/signature/view";
import { ContactView } from "../settings/contact/view";

// Round 17: Firm details, with tabs from three older pages (business hours, signers, signature).
export default async function FirmPage({ searchParams }: { searchParams: Promise<SP> }) {
  const access = await requireAccess();
  const sp = await searchParams;
  const tabs = openTabs(access, "/admin/firm");
  if (!tabs.length) redirect("/?error=no-access");
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];
  const view: View = tab.key === "contact" ? await ContactView(sp) : tab.key === "signers" ? await SignersView(sp) : tab.key === "signature" ? await SignatureView(sp) : await BusinessHoursView(sp);
  return <SettingsShell title="Firm details" help={view.help} actions={view.actions} tabs={tabs} active={tab.key} href="/admin/firm">{view.body}</SettingsShell>;
}
