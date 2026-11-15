import { SettingsShell } from "../settings-shell";
import { TaxdomeImportView } from "./view";

// Import TaxDome export (decision 43). Round 17: opened from the gear's Tools; the TaxDome account link
// moved to Connections.
export default async function TaxdomeImportPage({ searchParams }: PageProps<"/admin/taxdome-import">) {
  const view = await TaxdomeImportView(await searchParams);
  return <SettingsShell title="Import TaxDome export" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
