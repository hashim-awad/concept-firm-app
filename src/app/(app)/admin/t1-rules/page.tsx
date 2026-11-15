import { SettingsShell, type SP } from "../settings-shell";
import { T1RulesView } from "../settings/t1-rules/view";

// Round 17: T1 rule values, moved from /admin/settings/t1-rules.
export default async function T1RulesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await T1RulesView(await searchParams);
  return <SettingsShell title="T1 rule values" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
