// Every page under /admin opens from the gear menu in the top bar (round 17). The Settings side list
// went with it: each page has a back link, and pages that merge older pages have tabs.
export default function SettingsLayout({ children }: LayoutProps<"/admin">) {
  return <div className="min-w-0">{children}</div>;
}
