import { PageHeader, Notice } from "@/components/ui";
import { requireAccess } from "@/lib/access";
import { messageFrom } from "@/lib/messages";
import { settingsMenu } from "../settings-menu";
import { LockIcon } from "../settings-nav";

// Settings home: every setting this person can open, by group. On a phone this is the menu.
export default async function SettingsHome({ searchParams }: PageProps<"/admin/settings">) {
  const access = await requireAccess();
  const sp = await searchParams;
  return (
    <>
      <PageHeader title="Settings" description="Firm setup, pricing, letters and connections. Choose a setting. A lock means only an owner can open or change it." />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <div className="grid gap-4 lg:grid-cols-2">
        {settingsMenu(access).map((g) => (
          <section key={g.label} className="card">
            <h2 className="mb-2 font-semibold">{g.label}</h2>
            <ul className="grid gap-1 text-sm">
              {g.items.map((i) => (
                <li key={i.label} className="flex items-center gap-2">
                  {i.soon ? <span className="text-ink-3">{i.label} <span className="rounded border border-sand-300 px-1 text-[10px] font-semibold">Soon</span></span>
                    : <a href={i.href} className="text-navy-700 hover:underline">{i.label}</a>}
                  <LockIcon item={i} />
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
