import { SettingsShell, type SP } from "../settings-shell";
import { VendorRulesView } from "../closebook/vendor-rules/view";

// Round 17: Vendor rules, opened from the gear (was Settings, Closebook, Vendor rules).
export default async function VendorRulesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await VendorRulesView(await searchParams);
  return <SettingsShell title="Vendor rules" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
