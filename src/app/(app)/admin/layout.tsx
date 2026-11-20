// Every page under /admin opens from the gear menu in the top bar (round 17). Piece UI1 (Nov 20, 2026): the
// pages also show the gear's list on the left, with Search settings, so people can move between them.
import { Suspense } from "react";
import { requireAccess, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { draftsByTab } from "@/lib/studio/template-status";
import { gearMenu } from "./settings-menu";
import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({ children }: LayoutProps<"/admin">) {
  const access = await requireAccess();
  const drafts = access.admin && canView(access, "engagement_terms") ? await draftsByTab(await createClient()) : { letters: 0, schedules: 0, emails: 0, closebook: 0 };
  return (
    <div className="-mx-4 -my-6 min-w-0 md:-mx-8 md:-my-8 lg:flex">
      <Suspense fallback={null}><SettingsNav gear={gearMenu(access, drafts)} /></Suspense>
      <div className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</div>
    </div>
  );
}
