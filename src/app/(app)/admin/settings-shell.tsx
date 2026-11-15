// Round 17 (Hashim, Nov 15, 2026): the frame of every page opened from the gear. Benchmark: QuickBooks
// Online's settings pages: a back link, the title with no paragraph under it (the explanation sits behind
// the "?"), and tabs where a page merges older pages. Only the tabs the person can open are shown.
import type { ReactNode } from "react";
import Link from "next/link";
import { HelpCircle } from "lucide-react";
import { Drawer } from "../closebook/[id]/shell/ui";
import { BackLink } from "./back-link";
import type { GearTab } from "./settings-menu";

export function PageHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span data-page-help className="inline-flex">
      <Drawer top="top-14" label="Help" title={`Help · ${title}`} button={<span className="grid h-8 w-8 place-items-center rounded-md text-ink-3 hover:bg-sand-100 hover:text-ink"><HelpCircle className="h-[19px] w-[19px]" aria-hidden /></span>}>
        <div className="grid gap-3 leading-relaxed text-ink-2 [&_h4]:text-[11px] [&_h4]:font-bold [&_h4]:tracking-[.08em] [&_h4]:text-ink-3 [&_h4]:uppercase">{children}</div>
      </Drawer>
    </span>
  );
}

// A field's explanation, listed in the help panel under the field's label.
export const fieldHelp = (fields: { label: string; hint: string }[]) => fields.map((x) => <div key={x.label}><h4>{x.label}</h4><p>{x.hint}</p></div>);

export type ShellTab = Pick<GearTab, "key" | "label"> & { count?: number };

export function SettingsShell({ title, help, actions, badge, tabs, active, href, children }: {
  title: string; help?: ReactNode; actions?: ReactNode; badge?: ReactNode; tabs?: ShellTab[]; active?: string; href?: string; children: ReactNode;
}) {
  return (
    <>
      <BackLink />
      <header className={`flex flex-wrap items-center gap-3 ${tabs ? "mb-0" : "mb-6"}`}>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {badge}
        {help && <PageHelp title={title}>{help}</PageHelp>}
        <span className="flex-1" />
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </header>
      {tabs && tabs.length > 0 && (
        <nav aria-label={title} className="mt-4 mb-6 flex gap-1 overflow-x-auto border-b border-sand-200">
          {tabs.map((t) => (
            <Link key={t.key} href={`${href}?tab=${t.key}`} aria-current={t.key === active ? "page" : undefined}
              className={`-mb-px border-b-2 px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap ${t.key === active ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>{t.label}{t.count ? <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 text-[11px] font-bold text-warning">{t.count}</span> : null}</Link>
          ))}
        </nav>
      )}
      {children}
    </>
  );
}

// A page or tab's content: its help panel text, its body, and any buttons beside the title.
export type SP = Record<string, string | string[] | undefined>;
export type View = { help: ReactNode; body: ReactNode; actions?: ReactNode };
