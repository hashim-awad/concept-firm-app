import { SettingsShell, type SP } from "../settings-shell";
import { RetentionView } from "../settings/retention/view";

// Round 17: Data retention, moved from /admin/settings/retention.
export default async function RetentionPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await RetentionView(await searchParams);
  return <SettingsShell title="Data retention" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
