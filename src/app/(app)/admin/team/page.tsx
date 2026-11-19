import { redirect } from "next/navigation";
import { Notice } from "@/components/ui";
import { PageTabs } from "@/components/page-tabs";
import { requireAccess, canView } from "@/lib/access";
import { messageFrom } from "@/lib/messages";
import { SettingsShell } from "../settings-shell";
import { PeopleSection } from "./people";
import { RolesSection } from "./roles";

// Team and roles: people (staff accounts) and the roles that set what each person can see and do.
export default async function TeamPage({ searchParams }: PageProps<"/admin/team">) {
  const access = await requireAccess();
  const sp = await searchParams;
  const people = canView(access, "staff_accounts");
  if (!people && !access.admin) redirect("/?error=no-permission");
  const tab = sp.tab === "roles" && access.admin ? "roles" : people ? "people" : "roles";
  return (
    <SettingsShell title="Team and roles" help={<p>Who can sign in, and what each role can see and change.</p>}>
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <PageTabs label="Team and roles" current={tab} tabs={[
        ...(people ? [{ key: "people", href: "/admin/team?tab=people", label: "People" }] : []),
        ...(access.admin ? [{ key: "roles", href: "/admin/team?tab=roles", label: "Roles and permissions" }] : []),
      ]} />
      {tab === "people" ? <PeopleSection access={access} /> : <RolesSection />}
    </SettingsShell>
  );
}
