"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { Button } from "./primitives";

/* ---------- Confirmation dialog (native <dialog>: focus trap and Esc built in) ---------- */
export function ConfirmDialog({ trigger, title, body, confirmLabel, tone = "primary", onConfirm }: {
  trigger: (open: () => void) => ReactNode; title: string; body: ReactNode; confirmLabel: string;
  tone?: "primary" | "danger"; onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [isOpen, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (isOpen && !d.open) d.showModal();
    if (!isOpen && d.open) d.close();
  }, [isOpen]);
  return (
    <>
      {trigger(() => setOpen(true))}
      <dialog ref={ref} aria-labelledby={titleId} onClose={() => setOpen(false)}
        className="m-auto w-[min(92vw,28rem)] rounded-2xl border border-sand-200 bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]">
        <div className="p-6">
          <div className="mb-3 flex items-start gap-3">
            <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full ${tone === "danger" ? "bg-danger-soft text-danger" : "bg-navy-50 text-navy-700"}`}>
              {tone === "danger" ? <AlertTriangle className="h-4.5 w-4.5" aria-hidden /> : <Info className="h-4.5 w-4.5" aria-hidden />}
            </span>
            <div>
              <h2 id={titleId} className="text-base font-semibold">{title}</h2>
              <div className="mt-1 text-sm text-ink-2">{body}</div>
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={tone === "danger" ? "danger" : "primary"} onClick={() => { setOpen(false); onConfirm(); }}>{confirmLabel}</Button>
          </div>
        </div>
      </dialog>
    </>
  );
}

/* ---------- Form dialog: a button that opens a form in a window (native <dialog>) ---------- */
export function FormDialog({ label, title, children }: { label: string; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <Button onClick={() => ref.current?.showModal()}>{label}</Button>
      <dialog ref={ref} aria-labelledby={titleId}
        className="m-auto max-h-[90vh] w-[min(92vw,44rem)] overflow-y-auto rounded-2xl border border-sand-200 bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]">
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-0.5 text-ink-3 hover:text-ink"><X className="h-4.5 w-4.5" /></button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}

/* ---------- Toasts ---------- */
type Toast = { id: number; tone: "success" | "error" | "info"; text: string };
const ToastCtx = createContext<(t: Omit<Toast, "id">) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((all) => [...all, { ...t, id }]);
    setTimeout(() => setToasts((all) => all.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => <ToastItem key={t.id} toast={t} onClose={() => setToasts((all) => all.filter((x) => x.id !== t.id))} />)}
      </div>
    </ToastCtx.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const [shown, setShown] = useState(false);
  useEffect(() => { const r = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(r); }, []);
  const Icon = toast.tone === "success" ? CheckCircle2 : toast.tone === "error" ? AlertTriangle : Info;
  const colour = toast.tone === "success" ? "text-success" : toast.tone === "error" ? "text-danger" : "text-navy-700";
  return (
    <div role={toast.tone === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-sand-200 bg-surface px-4 py-3 text-sm shadow-[var(--shadow-raised)] transition-all duration-200 ${shown ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}>
      <Icon className={`mt-0.5 h-4.5 w-4.5 shrink-0 ${colour}`} aria-hidden />
      <p className="flex-1">{toast.text}</p>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="rounded p-0.5 text-ink-3 hover:text-ink"><X className="h-4 w-4" /></button>
    </div>
  );
}
