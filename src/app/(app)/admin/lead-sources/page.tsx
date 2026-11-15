import { SettingsShell, type SP } from "../settings-shell";
import { LeadSourcesView } from "../settings/lead-sources/view";

// Round 17: Lead sources, moved from /admin/settings/lead-sources.
export default async function LeadSourcesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await LeadSourcesView(await searchParams);
  return <SettingsShell title="Lead sources" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
