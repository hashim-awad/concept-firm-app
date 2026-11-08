"use client";
// Shared parts of the Studio document screens: the controller hook, form controls that keep
// Studio's element ids (the screen parity test fills both pages with the same steps), the
// stepper, the checks panel and the paper preview.
import { useReducer, useState, type ComponentProps, type ReactNode } from "react";
import { Check as CheckIcon } from "lucide-react";
import { Button, inputClass } from "@/components/ds/primitives";
import { checkLabel, checksSummary, type Check } from "@/lib/studio/screen";
import { createStudioEngine } from "@/lib/studio/engine.generated";
import type { StudioEngine, StudioEnv } from "@/lib/studio/engine.generated";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export type ScreenEnv = {
  floors: Record<string, unknown>[];
  floorsOk: boolean;
  cat: Record<string, unknown>[];
  loaded: boolean;
  signer: { name: string; title: string };
  images: { LH: string; SIG: string; ILLUS: string };
};

// Studio's render() writes into a "paper" element; the app gives it a stand-in and reads the HTML.
export function makeEngine(env: ScreenEnv): { e: StudioEngine; paper: { innerHTML: string; classList: { toggle(): void } } } {
  const paper = { innerHTML: "", classList: { toggle() {} } };
  const e = createStudioEngine({
    DB: { floors: env.floors, floorsOk: env.floorsOk, loaded: env.loaded, cat: env.cat },
    LH: env.images.LH, SIG: env.images.SIG, ILLUS: env.images.ILLUS,
    SIGNER: env.signer.name, SIGNER_TITLE: env.signer.title,
    $: ((id: string) => (id === "paper" ? paper : null)) as unknown as StudioEnv["$"],
  } as StudioEnv);
  return { e, paper };
}

// Holds one controller for the life of the screen; act() changes it and redraws.
export function useController<T>(make: () => T): [T, (fn: (c: T) => void) => void] {
  const [ctl] = useState(make);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  return [ctl, (fn) => { fn(ctl); redraw(); }];
}

export function Panel({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[var(--radius-ds)] border border-sand-200 bg-surface p-4 shadow-[var(--shadow-card)] md:p-5", className)}>
      {title && <h3 className="mb-3 text-base font-semibold text-navy-800">{title}</h3>}
      <div className="grid gap-3">{children}</div>
    </section>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

export function Hint({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="text-[13px] leading-5 text-ink-3">{children}</p>;
}

export function Labelled({ id, label, children, hidden, labelId }: { id: string; label: string; children: ReactNode; hidden?: boolean; labelId?: string }) {
  return (
    <div className={hidden ? "hidden" : undefined}>
      <label htmlFor={id} id={labelId} className="mb-1.5 block text-sm font-medium text-ink">{label}</label>
      {children}
    </div>
  );
}

export function TextIn({ id, value, onValue, ...rest }: Omit<ComponentProps<"input">, "value" | "onChange"> & { id: string; value: string; onValue: (v: string) => void }) {
  return <input id={id} type="text" autoComplete="off" {...rest} value={value} onChange={(ev) => onValue(ev.target.value)} className={cx(inputClass(), rest.className)} />;
}

export function SelectIn({ id, value, onValue, children, ...rest }: Omit<ComponentProps<"select">, "value" | "onChange"> & { id?: string; value: string; onValue: (v: string) => void }) {
  return <select id={id} {...rest} value={value} onChange={(ev) => onValue(ev.target.value)} className={cx(inputClass(), "appearance-auto pr-8", rest.className)}>{children}</select>;
}

export function Tick({ id, checked, onValue, children, hidden, ...rest }: Omit<ComponentProps<"input">, "onChange" | "checked"> & { id?: string; checked: boolean; onValue: (v: boolean) => void; children: ReactNode; hidden?: boolean }) {
  return (
    <label className={cx("flex cursor-pointer items-start gap-2.5 text-sm", hidden && "hidden")}>
      <input id={id} type="checkbox" {...rest} checked={checked} onChange={(ev) => onValue(ev.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 rounded accent-navy-700" />
      <span>{children}</span>
    </label>
  );
}

export const PROVINCES: [string, string][] = [["ON", "Ontario"], ["AB", "Alberta"], ["BC", "British Columbia"], ["OTHER", "Other"]];

/* ---------- Stepper (Studio: makeStepper) ---------- */
export type Step = { label: string; done?: boolean; body: ReactNode };
export function Stepper({ steps, lastNote }: { steps: Step[]; lastNote: string }) {
  const [cur, setCur] = useState(0);
  return (
    <div>
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {steps.map((st, i) => (
          <button key={st.label} type="button" role="tab" aria-selected={i === cur} onClick={() => setCur(i)}
            className={cx("inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium",
              i === cur ? "border-navy-700 bg-navy-700 text-white" : st.done ? "border-lime-500 bg-surface text-navy-900" : "border-sand-300 bg-surface text-ink-2 hover:border-ink-3")}>
            <span className={cx("grid h-5 w-5 place-items-center rounded-full text-[11px]", i === cur ? "bg-white/20" : st.done ? "bg-lime-500 text-navy-900" : "bg-sand-100")}>
              {st.done && i !== cur ? <CheckIcon className="h-3 w-3" aria-hidden /> : i + 1}
            </span>
            {st.label}
          </button>
        ))}
      </div>
      {/* Every step stays in the page (hidden when not current), as in Studio. */}
      {steps.map((st, i) => (
        <div key={st.label} className={i === cur ? "grid gap-4" : "hidden"}>
          {st.body}
          <div className="flex items-center justify-between gap-3 border-t border-sand-200 pt-3">
            {i > 0 ? <Button type="button" variant="secondary" size="sm" onClick={() => setCur(i - 1)}>Back</Button> : <span />}
            <span className="text-[13px] text-ink-3">Step {i + 1} of {steps.length}</span>
            {i < steps.length - 1
              ? <Button type="button" size="sm" onClick={() => setCur(i + 1)}>Next: {steps[i + 1].label}</Button>
              : <span className="text-[13px] text-ink-3">{lastNote}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ---------- Checks (Studio: checks list with collapseChecks) ---------- */
export function ChecksPanel({ id, list }: { id: string; list: Check[] }) {
  const [open, setOpen] = useState(false);
  const sum = checksSummary(list);
  const tone = { err: "bg-danger-soft text-[#7A1A12]", warn: "bg-warning-soft text-[#5C3D00]", ok: "bg-success-soft text-[#14532F]" };
  const expandable = sum.tone !== "ok";
  return (
    <div>
      <button type="button" id={id + "_sum"} onClick={() => expandable && setOpen(!open)} aria-expanded={expandable ? open : undefined}
        className={cx("w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold", tone[sum.tone], !expandable && "cursor-default")}>
        {sum.text}{expandable && <span className="font-normal"> {open ? "▴ hide" : "▾ show"}</span>}
      </button>
      <ul id={id} className={cx("mt-2 grid gap-1.5", !(open && expandable) && "hidden")}>
        {list.map((x, i) => <li key={i} className={cx(x.lvl, "rounded-lg px-2.5 py-2 text-[12.5px] leading-snug", tone[x.lvl])}>{checkLabel(x)}</li>)}
      </ul>
    </div>
  );
}

export function ModeSwitch({ name, mode, onMode }: { name: string; mode: "draft" | "final"; onMode: (m: "draft" | "final") => void }) {
  return (
    <div className="flex flex-wrap gap-4 text-sm">
      {(["draft", "final"] as const).map((m) => (
        <label key={m} className="flex cursor-pointer items-center gap-2">
          <input type="radio" name={name} value={m} checked={mode === m} onChange={() => onMode(m)} className="h-4 w-4 accent-navy-700" />
          {m === "draft" ? "Draft for review" : "Final"}
        </label>
      ))}
    </div>
  );
}

/* ---------- Paper preview (Studio's own HTML) ---------- */
export function Paper({ id, html, draft }: { id: string; html: string; draft: boolean }) {
  return (
    <div className="studio-preview overflow-x-auto rounded-lg bg-sand-100 p-3">
      <div id={id} className={cx("paper", draft && "draft")} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// Layout: form on the left, checks and preview on the right (stacked on small screens).
export function StudioLayout({ form, side }: { form: ReactNode; side: ReactNode }) {
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <div className="min-w-0">{form}</div>
      <div className="min-w-0">{side}</div>
    </div>
  );
}
