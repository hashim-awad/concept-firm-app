import { SettingsShell, type SP } from "../settings-shell";
import { StandardEntriesView } from "../closebook/standard-entries/view";

// Round 17: Standard entries, opened from the gear (was Settings, Closebook, Standard entries).
export default async function StandardEntriesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await StandardEntriesView(await searchParams);
  return <SettingsShell title="Standard entries" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
