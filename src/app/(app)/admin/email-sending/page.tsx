import { SettingsShell, type SP } from "../settings-shell";
import { SigningEmailView } from "../settings/signing-email/view";

// Round 17: Email sending, the old Signing emails page. Admins only (the view checks).
export default async function EmailSendingPage({ searchParams }: { searchParams: Promise<SP> }) {
  const view = await SigningEmailView(await searchParams);
  return <SettingsShell title="Email sending" help={view.help} actions={view.actions}>{view.body}</SettingsShell>;
}
