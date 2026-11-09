import { requireAccess } from "@/lib/access";
import { settingsMenu } from "./settings-menu";
import { SettingsNav } from "./settings-nav";

// Every page under /admin is a Settings page: the Settings menu on the left, the page on the right.
export default async function SettingsLayout({ children }: LayoutProps<"/admin">) {
  const access = await requireAccess();
  return (
    <div className="md:flex md:items-start md:gap-8">
      <SettingsNav groups={settingsMenu(access)} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
