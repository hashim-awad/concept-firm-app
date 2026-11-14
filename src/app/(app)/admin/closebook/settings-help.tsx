// Round 15: Settings > Closebook pages keep their explanations in a help panel ("?"), as the file screens do.
import type { ReactNode } from "react";
import { HelpCircle } from "lucide-react";
import { Drawer } from "../../closebook/[id]/shell/ui";

export function SettingsHelp({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Drawer top="top-0" label="Help" title={`Help · ${title}`} button={<span className="grid h-9 w-9 place-items-center rounded-md border border-sand-300 bg-white text-ink-2 hover:bg-sand-100"><HelpCircle className="h-[18px] w-[18px]" aria-hidden /></span>}>
      <div className="grid gap-3 leading-relaxed text-ink-2 [&_h4]:text-[11px] [&_h4]:font-bold [&_h4]:tracking-[.08em] [&_h4]:text-ink-3 [&_h4]:uppercase">{children}</div>
    </Drawer>
  );
}

// A field's explanation, listed in the help panel under the field's label.
export const fieldHelp = (fields: { label: string; hint: string }[]) => fields.map((x) => <div key={x.label}><h4>{x.label}</h4><p>{x.hint}</p></div>);
