import { SettingsShell, type SP } from "../settings-shell";
import { ConnectionsView } from "../taxdome-import/view";

// Round 17: Connections, opened from the gear. For now, the link to a TaxDome account (was a card on
// Import from TaxDome).
export default async function ConnectionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await ConnectionsView(await searchParams);
  return <SettingsShell title="Connections" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
