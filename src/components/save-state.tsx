"use client";
// Round 21 (Hashim, Nov 15, 2026): tell the user when something is saved and done, the same way on every
// form that saves. Benchmarks: Dext (a short note in the bottom-left corner after Publish) and QuickBooks
// Online (the Save button says what happened; leaving with changes asks first; Revert puts the form back).
//
//   useSaveState(initial)       { dirty, markDirty(), markSaved(at?), savedAt } for forms that keep their own state
//   <SaveButton dirty savedAt saving />  "Save" (never saved), "Save changes" (blue, while dirty), "Saved 2:14 PM" (grey)
//   <DiscardButton dirty onDiscard />    "Discard changes", shown only while dirty
//   useUnsavedGuard(dirty, opts)  leaving (a link, a step or tab, another form's submit, closing the tab) asks
//                                 "Save your changes?" with Save, Discard and Stay
//   notify(text, tone)            the note: a pill centred low on the screen (Hashim, Nov 17, 2026; benchmark Fathom). Green
//                                 with a check, gone after 3 seconds; red with an ✕, stays until closed. One at a time.
//                                 <NoteHost/> sits once in the app layout
//   <SaveForm action ...>         a server-action form with all of the above built in, for forms that post and redirect
//   <SaveFormButton/>, <SaveFormDiscard/>  its Save and Discard buttons
//   <UrlNote text/>               shows a page's ?msg= as the note and takes it out of the address
//   ask(), confirmAction()        the one dialog, for questions such as "Clear everything typed in step 2?"
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";

// "2:14 PM", in Toronto time like every other time on screen.
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" });
export const savedTime = (d: Date) => TIME.format(d);
export const saveLabel = (dirty: boolean, savedAt: Date | null, saving = false) =>
  saving ? "Saving…" : dirty ? "Save changes" : savedAt ? `Saved ${savedTime(savedAt)}` : "Save";

// A small store that React reads with useSyncExternalStore.
function store<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => { value = v; subs.forEach((f) => f()); },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}

// ---------------------------------------------------------------------------------------------------
// The note (round 27, Hashim, Nov 17, 2026; benchmark Fathom): one at a time, a new one replaces the old.
// ---------------------------------------------------------------------------------------------------
// Round 31 (step 4, QuickBooks Online's "Posted · Undo"): a note can carry one action, and stay longer.
type Note = { id: number; text: string; tone: "ok" | "error"; leaving?: boolean; action?: { label: string; run: () => void } };
export const NOTE_MS = 3000;
const notes = store<Note[]>([]);
const NO_NOTES: Note[] = [];
let lastNote = { text: "", at: 0 };
export function notify(text: string, tone: "ok" | "error" = "ok", opts: { action?: { label: string; run: () => void }; ms?: number } = {}) {
  if (typeof window === "undefined" || !text) return;
  // The same note twice in a moment (a page that renders twice): show it once.
  const now = Date.now();
  if (lastNote.text === text && now - lastNote.at < 1500) return;
  lastNote = { text, at: now };
  const id = now + Math.random();
  notes.set([{ id, text, tone, action: opts.action }]);
  if (tone === "error") return;                       // a refusal stays until closed
  const ms = opts.ms ?? NOTE_MS;
  setTimeout(() => notes.set(notes.get().map((n) => (n.id === id ? { ...n, leaving: true } : n))), ms - 300);
  setTimeout(() => notes.set(notes.get().filter((n) => n.id !== id)), ms);
}

// A page's ?msg= (a server action that redirects with a message) as the note; then the address is cleaned,
// so Back does not show it again.
export function UrlNote({ text }: { text?: string | null }) {
  const path = usePathname(), sp = useSearchParams();
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!text) return;
    if (shown.current !== text) { shown.current = text; notify(text); }
    if (!sp.has("msg")) return;
    const q = new URLSearchParams(sp.toString());
    q.delete("msg");
    window.history.replaceState(null, "", `${path}${q.toString() ? `?${q}` : ""}${window.location.hash}`);
  }, [text, path, sp]);
  return null;
}

// ---------------------------------------------------------------------------------------------------
// The dialog: one at a time, opened from anywhere.
// ---------------------------------------------------------------------------------------------------
type AskButton = { key: string; label: string; tone?: "primary" | "secondary" | "danger" };
type Ask = { title: string; body?: ReactNode; buttons: AskButton[]; cancelKey: string; resolve: (key: string) => void };
const asking = store<Ask | null>(null);
export function ask(o: { title: string; body?: ReactNode; buttons: AskButton[]; cancelKey?: string }): Promise<string> {
  const prev = asking.get();
  if (prev) prev.resolve(prev.cancelKey);
  return new Promise((resolve) => asking.set({ ...o, cancelKey: o.cancelKey ?? o.buttons[o.buttons.length - 1]!.key,
    resolve: (k) => { asking.set(null); resolve(k); } }));
}
export async function confirmAction(o: { title: string; body?: ReactNode; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  const k = await ask({ title: o.title, body: o.body, cancelKey: "no",
    buttons: [{ key: "no", label: o.cancel ?? "Cancel", tone: "secondary" }, { key: "yes", label: o.confirm, tone: o.danger ? "danger" : "primary" }] });
  return k === "yes";
}

// ---------------------------------------------------------------------------------------------------
// Unsaved changes.
// ---------------------------------------------------------------------------------------------------
type Guard = { dirty: boolean; form?: HTMLFormElement | null; save?: (next?: string) => Promise<boolean> | boolean | void; discard?: () => void };
const guards = new Map<string, Guard>();
const dirtyGuard = () => [...guards.values()].find((g) => g.dirty);
let bypass = false;

export function useUnsavedGuard(dirty: boolean, opts: { save?: (next?: string) => Promise<boolean> | boolean | void; discard?: () => void; form?: () => HTMLFormElement | null } = {}) {
  const id = useId();
  const latest = useRef(opts);
  useEffect(() => { latest.current = opts; });
  useEffect(() => {
    guards.set(id, { dirty, get form() { return latest.current.form?.() ?? null; },
      save: (next) => latest.current.save?.(next), discard: () => latest.current.discard?.() });
    return () => { guards.delete(id); };
  }, [id, dirty]);
}

// Puts back every form with unsaved changes (before an action that replaces what they show, e.g. Clear this step).
export function discardAll() {
  for (const g of guards.values()) if (g.dirty) { g.discard?.(); g.dirty = false; }
}

// "Save your changes?" Save, Discard or Stay. True when the page may go on to `next`.
export async function leaveOk(next?: string): Promise<boolean> {
  const g = dirtyGuard();
  if (!g) return true;
  const k = await ask({ title: "Save your changes?", body: "You changed this page and did not save it.", cancelKey: "stay",
    buttons: [{ key: "stay", label: "Stay", tone: "secondary" }, { key: "discard", label: "Discard", tone: "secondary" }, { key: "save", label: "Save", tone: "primary" }] });
  if (k === "discard") { g.discard?.(); g.dirty = false; return !dirtyGuard() || leaveOk(next); }
  if (k === "save") {
    if (!g.save) return false;
    const ok = await g.save(next);
    return ok === true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------
// The host: notes, the dialog, and the listeners that catch leaving. Mounted once in the app layout.
// ---------------------------------------------------------------------------------------------------
export function NoteHost() {
  const router = useRouter();
  const list = useSyncExternalStore(notes.subscribe, notes.get, () => NO_NOTES);
  const q = useSyncExternalStore(asking.subscribe, asking.get, () => null);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (q && !d.open) d.showModal();
    if (!q && d.open) d.close();
  }, [q]);

  useEffect(() => {
    // A link inside the app: ask first, then go there (or save first).
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !dirtyGuard()) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download") || a.closest("[data-no-guard]")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;   // another site: the browser's own question (beforeunload)
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;   // a #link on this page
      e.preventDefault();
      e.stopPropagation();
      const next = `${url.pathname}${url.search}${url.hash}`;
      void leaveOk(next).then((go) => { if (go) router.push(next); });
    };
    // Another form posts (sign-off, a note, "Same as last year"): its page reloads, so ask first.
    const onSubmit = (e: SubmitEvent) => {
      if (bypass || e.defaultPrevented) return;
      const g = dirtyGuard();
      const form = e.target as HTMLFormElement;
      if (!g || g.form === form || form.closest("[data-no-guard]") || form.method === "dialog") return;
      e.preventDefault();
      e.stopPropagation();
      const submitter = e.submitter as HTMLElement | null;
      void leaveOk().then((go) => {
        if (!go || !form.isConnected) return;
        bypass = true;
        try { form.requestSubmit(submitter && form.contains(submitter) ? submitter : undefined); } finally { bypass = false; }
      });
    };
    const onUnload = (e: BeforeUnloadEvent) => { if (dirtyGuard()) { e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("click", onClick, true);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, [router]);

  const btn = (t: AskButton["tone"]) => (t === "danger" ? "btn-danger" : t === "secondary" ? "btn-secondary" : "btn");
  return (
    <>
      {/* Centred left to right, about 10% above the bottom edge, above windows and dialogs. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[10vh] z-[90] flex justify-center px-4 print:hidden">
        {list.map((n) => (
          <div key={n.id} role={n.tone === "error" ? "alert" : "status"} data-note={n.tone}
            className={`pointer-events-auto flex min-h-11 max-w-[min(92vw,44rem)] items-center gap-2.5 rounded-full px-6 py-2 text-[16px] leading-snug font-bold text-white shadow-[0_12px_32px_rgba(15,35,80,.28)] transition-opacity duration-300 ${n.leaving ? "opacity-0" : "opacity-100"} ${n.tone === "error" ? "bg-danger" : "bg-success"}`}>
            <span>{n.text}</span>
            {n.action && <button type="button" onClick={() => { n.action!.run(); notes.set(notes.get().filter((x) => x.id !== n.id)); }}
              className="-my-1 rounded-full px-2 py-1 underline underline-offset-2 hover:bg-white/20">{n.action.label}</button>}
            {n.tone === "error"
              ? <button type="button" aria-label="Close" onClick={() => notes.set(notes.get().filter((x) => x.id !== n.id))} className="-mr-2 grid h-7 w-7 flex-none place-items-center rounded-full hover:bg-white/20"><X className="h-4 w-4" strokeWidth={3} /></button>
              : <Check className="h-5 w-5 flex-none" strokeWidth={3} aria-hidden />}
          </div>
        ))}
      </div>
      <dialog ref={ref} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); q?.resolve(q.cancelKey); }}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-sand-200 bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-navy-950/40">
        {q && (
          <div className="p-6">
            <h2 id={titleId} className="text-base font-semibold">{q.title}</h2>
            {q.body && <div className="mt-1.5 text-sm text-ink-2">{q.body}</div>}
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              {q.buttons.map((b) => <button key={b.key} type="button" autoFocus={b.key === q.cancelKey} onClick={() => q.resolve(b.key)} className={btn(b.tone)}>{b.label}</button>)}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// Save state for a form that keeps its own state.
// ---------------------------------------------------------------------------------------------------
export function useSaveState(initial: { dirty?: boolean; savedAt?: Date | string | null } = {}) {
  const [dirty, setDirty] = useState(!!initial.dirty);
  const [savedAt, setSavedAt] = useState<Date | null>(initial.savedAt ? new Date(initial.savedAt) : null);
  const markDirty = useCallback(() => setDirty(true), []);
  const markSaved = useCallback((at?: Date) => { setDirty(false); setSavedAt(at ?? new Date()); }, []);
  const markClean = useCallback(() => setDirty(false), []);
  return { dirty, savedAt, markDirty, markSaved, markClean, setDirty };
}

export function SaveButton({ dirty, savedAt, saving = false, className = "btn btn-compact", form, onClick, type = "submit", disabled }: {
  dirty: boolean; savedAt: Date | null; saving?: boolean; className?: string; form?: string; onClick?: () => void; type?: "submit" | "button"; disabled?: boolean;
}) {
  const clean = !dirty && !!savedAt;
  return (
    <button type={type} form={form} onClick={onClick} disabled={disabled || saving || clean} aria-live="polite" data-save-state={saving ? "saving" : dirty ? "dirty" : savedAt ? "saved" : "new"}
      className={`${className} ${clean ? "!cursor-default !border-sand-300 !bg-sand-100 !text-ink-3 !opacity-100 !shadow-none" : ""}`}>
      {saveLabel(dirty, savedAt, saving)}
    </button>
  );
}

export function DiscardButton({ dirty, onDiscard, className = "btn-secondary btn-compact" }: { dirty: boolean; onDiscard: () => void; className?: string }) {
  if (!dirty) return null;
  return <button type="button" onClick={onDiscard} className={className}>Discard changes</button>;
}

// ---------------------------------------------------------------------------------------------------
// A form that posts to a server action and redirects back (most of Studio). It knows when something
// changed, says "Saved 2:14 PM" after the save, asks before leaving, and puts the fields back on
// Discard. `signed`: the step is signed, so the first change asks first, because saving removes the
// sign-off.
// ---------------------------------------------------------------------------------------------------
// A save redirects back with ?msg=, a new address, so the page (and this form) mounts again: what was
// saved, and where to go next, waits here for the new form, by page and form name.
const justSaved = new Map<string, { next: string | null }>();

type FormCtx = { dirty: boolean; savedAt: Date | null; saving: boolean; discard: () => void };
const SaveFormCtx = createContext<FormCtx | null>(null);
export const useSaveForm = () => useContext(SaveFormCtx);

// dirty / onDiscard: a form that keeps its own state (controlled fields) says itself whether it differs
// from what is saved, and how to put it back. enterSubmits={false}: Enter in a field never submits.
export function SaveForm({ action, children, className, signed, savedAt: savedInitial, id, onDirty, dirty: controlled, onDiscard, enterSubmits = true, "aria-label": ariaLabel }: {
  action: (formData: FormData) => void | Promise<void>; children: ReactNode; className?: string; id?: string; "aria-label"?: string;
  signed?: string | null; savedAt?: Date | string | null; onDirty?: (dirty: boolean) => void;
  dirty?: boolean; onDiscard?: () => void; enterSubmits?: boolean;
}) {
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const sp = useSearchParams();
  const key = `${usePathname()}|${id ?? ariaLabel ?? ""}`;
  // Mounted again after its own save: "Saved 2:14 PM" (unless the save was refused with ?error=).
  const [restored] = useState(() => (justSaved.has(key) && !sp.has("error") ? new Date() : null));
  const st = useSaveState({ savedAt: restored ?? savedInitial });
  const { setDirty, markSaved } = st;
  const dirty = controlled ?? st.dirty;
  const [saving, setSaving] = useState(false);
  const ack = useRef(false);
  const next = useRef<string | null>(null);
  useEffect(() => {
    const j = justSaved.get(key);
    if (!j) return;
    justSaved.delete(key);
    // Saved from "Save your changes?": go on to where the user was going.
    // After the page's own effects (which take ?msg= out of the address), or the push is lost.
    if (restored && j.next) { const to = j.next; setTimeout(() => router.push(to), 0); }
  }, [key, restored, router]);
  const touched = useRef(false);
  useEffect(() => { touched.current = dirty; }, [dirty]);
  const discard = useCallback(() => { ref.current?.reset(); onDiscard?.(); setDirty(false); touched.current = false; ack.current = false; }, [setDirty, onDiscard]);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useUnsavedGuard(dirty, {
    form: () => ref.current,
    discard,
    save: (to) => { next.current = to ?? null; ref.current?.requestSubmit(); return false; },
  });
  const changed = async () => {
    if (touched.current) return;
    touched.current = true;
    setDirty(true);
    if (signed && !ack.current) {
      const ok = await confirmAction({ title: "This step is signed", body: `${signed} Changing it removes the sign-off.`, confirm: "Change it", cancel: "Keep it signed" });
      if (ok) ack.current = true; else discard();
    }
  };
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    // Enter in a text box after "Saved": nothing to save.
    if (!dirty && st.savedAt) { e.preventDefault(); return; }
    justSaved.set(key, { next: next.current });
    setSaving(true);
  };
  // The save finished: the action redirected back. An ?error= means it was refused; anything else saved it.
  const done = useCallback((ok: boolean) => {
    justSaved.delete(key);
    setSaving(false);
    if (!ok) return;
    markSaved(new Date());
    // An action that saves without redirecting (no ?msg=): the note still says so.
    if (!new URLSearchParams(window.location.search).has("msg")) notify("Saved");
    ack.current = false;
    const to = next.current;
    next.current = null;
    if (to) router.push(to);
  }, [markSaved, router, key]);
  return (
    <SaveFormCtx.Provider value={{ dirty, savedAt: st.savedAt, saving, discard }}>
      <form ref={ref} id={id} action={action} className={className} aria-label={ariaLabel} onInput={changed} onChange={changed} onSubmit={onSubmit} onReset={() => setDirty(false)}
        onKeyDown={enterSubmits ? undefined : (e) => { if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault(); }}>
        {children}
        <Pending onDone={done} failed={sp.has("error")} active={saving} />
      </form>
    </SaveFormCtx.Provider>
  );
}

// Watches the form's own submit: when it stops pending, the save is done.
function Pending({ onDone, failed, active }: { onDone: (ok: boolean) => void; failed: boolean; active: boolean }) {
  const { pending } = useFormStatus();
  const was = useRef(false);
  useEffect(() => {
    if (pending) { was.current = true; return; }
    if (was.current && active) { was.current = false; onDone(!failed); }
  }, [pending, failed, active, onDone]);
  return null;
}

export function SaveFormButton({ className = "btn btn-compact" }: { className?: string }) {
  const c = useSaveForm();
  if (!c) return <button type="submit" className={className}>Save</button>;
  return <SaveButton dirty={c.dirty} savedAt={c.savedAt} saving={c.saving} className={className} />;
}

export function SaveFormDiscard({ className }: { className?: string }) {
  const c = useSaveForm();
  if (!c) return null;
  return <DiscardButton dirty={c.dirty} onDiscard={c.discard} className={className} />;
}
