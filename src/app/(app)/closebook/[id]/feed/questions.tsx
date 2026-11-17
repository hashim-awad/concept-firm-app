"use client";
// Round 32 (Hashim, Nov 18, 2026): asking the client from step 4. Benchmark: TaxDome's "Ask client" (screens 01 to 03, 08, 09):
// saved questions with 🗑, a 400-character box, "Add to saved questions", Send; the icon shows the state, hover shows the thread.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Clock, MessageCircle, MessageCirclePlus, Paperclip, Star, Trash2 } from "lucide-react";
import type { FeedQ } from "@/lib/closebook/feed-server";
import { formatDate } from "@/lib/dates";
import { Modal } from "./windows";

export type Saved = { id: string; body: string };
const MAX = 400;

// The 💬 states: "+" (none), grey clock (not sent), amber clock (waiting), orange bubble (answered).
export function QIcon({ id, status, thread, onOpen, disabled }: { id: string; status: string; thread: FeedQ[]; onOpen: (el: HTMLElement) => void; disabled?: boolean }) {
  const [hover, setHover] = useState<DOMRect | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  const has = thread.length > 0;
  const label = status === "answered" ? "Client answered" : status === "waiting" ? "Waiting for client" : status === "not_sent" ? "Asked, not sent" : "Ask the client";
  const icon = status === "answered" ? <MessageCircle className="h-4 w-4 fill-[#fde3cf] text-[#e8590c]" />
    : status === "waiting" ? <Clock className="h-4 w-4 text-[#c27c0e]" />
    : status === "not_sent" ? <Clock className="h-4 w-4 text-ink-3" />
    : has ? <MessageCircle className="h-4 w-4 text-ink-3" /> : <MessageCirclePlus className="h-4 w-4" />;
  return (
    <>
      <button type="button" id={`q-${id}`} data-q-icon={status || "none"} aria-label={label} disabled={disabled && !has}
        onClick={(e) => { setHover(null); onOpen(e.currentTarget); }}
        onMouseEnter={(e) => { if (!has) return; const r = e.currentTarget.getBoundingClientRect(); t.current = setTimeout(() => setHover(r), 250); }}
        onMouseLeave={() => { if (t.current) clearTimeout(t.current); setHover(null); }}
        className={`grid h-7 w-7 place-items-center rounded hover:bg-sand-100 ${has ? "" : "text-ink-3 hover:text-navy-700"}`}>{icon}</button>
      {hover && <Floating rect={hover} width={360}><div data-q-hover><ThreadView thread={thread} status={status} /></div></Floating>}
    </>
  );
}

// A box beside the icon, above it when there is no room below.
function Floating({ rect, width, children, onClose }: { rect: DOMRect; width: number; children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)), top: rect.bottom + 4 });
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    if (rect.bottom + 4 + h > window.innerHeight - 8) setPos((p) => ({ ...p, top: Math.max(8, rect.top - 4 - h) }));
  }, [rect]);
  useEffect(() => {
    if (!onClose) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const id = setTimeout(() => document.addEventListener("mousedown", close), 0);
    window.addEventListener("keydown", k);
    return () => { clearTimeout(id); document.removeEventListener("mousedown", close); window.removeEventListener("keydown", k); };
  }, [onClose]);
  return <div ref={ref} style={{ position: "fixed", left: pos.left, top: pos.top, width }} role={onClose ? "dialog" : "tooltip"}
    className="z-[75] grid gap-3 rounded-[10px] border border-sand-200 bg-white p-3.5 text-[13.5px] shadow-[0_12px_32px_rgba(15,35,80,.22)]">{children}</div>;
}

// The thread, read only: Q and A in order, the latest open question in bold.
export function ThreadView({ thread, status }: { thread: FeedQ[]; status: string }) {
  const lastQ = [...thread].reverse().find((e) => e.kind === "q");
  return (
    <div className="grid gap-2" data-q-thread>
      {status === "answered" && <p className="text-[12px] font-semibold text-[#e8590c]">Answer received</p>}
      {status === "waiting" && <p className="text-[12px] font-semibold text-[#c27c0e]">Waiting for client</p>}
      {status === "not_sent" && <p className="text-[12px] font-semibold text-ink-3">Asked, not sent</p>}
      {thread.map((e, i) => (
        <div key={i} className="grid grid-cols-[1.4rem_1fr] gap-x-1">
          <span className="font-semibold text-ink-3">{e.kind === "q" ? "Q:" : "A:"}</span>
          <div>
            <p className={`whitespace-pre-wrap ${e === lastQ && status !== "answered" ? "font-semibold" : ""}`}>{e.body || (e.files.length ? "(file attached)" : "")}</p>
            <p className="text-[11.5px] text-ink-3">{e.by}{e.by ? " · " : ""}{formatDate(e.at.slice(0, 10))}</p>
            {e.files.length > 0 && <p className="mt-0.5 flex items-center gap-1 text-[12px] text-ink-2"><Paperclip className="h-3.5 w-3.5" />{e.files.length} file{e.files.length === 1 ? "" : "s"} attached: {e.files.join(", ")}</p>}
          </div>
        </div>
      ))}
    </div>
  );
}

// Saved questions, the box with its counter, "☆ Add to saved questions" and Send.
export function Composer({ saved, onSend, onSave, onRemove, sendLabel = "Send" }: {
  saved: Saved[] | null; onSend: (text: string) => Promise<boolean>; onSave: (text: string) => Promise<void>; onRemove: (id: string) => Promise<void>; sendLabel?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const t = text.trim();
  const isSaved = !!saved?.some((s) => s.body.trim().toLowerCase() === t.toLowerCase());
  return (
    <div className="grid gap-2" data-q-composer>
      <ul className="grid max-h-44 gap-0.5 overflow-y-auto" aria-label="Saved questions">
        {saved === null && <li className="px-2 py-1 text-ink-3">Loading saved questions…</li>}
        {saved?.map((s) => (
          <li key={s.id} className={`group flex items-start gap-2 rounded-[6px] px-2 py-1.5 hover:bg-sand-50 ${t === s.body ? "bg-sand-100" : ""}`}>
            <button type="button" className="flex-1 text-left" onClick={() => setText(s.body)}>{s.body}</button>
            <button type="button" aria-label={`Remove saved question: ${s.body}`} title="Remove from saved questions" onClick={() => onRemove(s.id)} className="text-ink-3 hover:text-danger">
              <Trash2 className="h-4 w-4" /></button>
          </li>))}
      </ul>
      <textarea aria-label="Question" value={text} maxLength={MAX} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Type your question" autoFocus
        className="w-full resize-y rounded-[8px] border border-sand-300 px-2.5 py-2 text-[13.5px] outline-none focus:border-navy-600" />
      <p className="-mt-1 text-right text-[11.5px] text-ink-3 tabular-nums" data-q-count>{text.length}/{MAX}</p>
      <div className="flex items-center justify-end gap-3">
        <button type="button" disabled={!t || isSaved} onClick={() => onSave(t)} className="inline-flex items-center gap-1 text-[13px] text-ink-2 hover:text-navy-700 disabled:cursor-default disabled:text-ink-3">
          <Star className={`h-4 w-4 ${isSaved ? "fill-[#f2b705] text-[#f2b705]" : ""}`} />{isSaved ? "Saved" : "Add to saved questions"}</button>
        <button type="button" className="btn btn-compact" disabled={t.length < 3 || busy} onClick={async () => { setBusy(true); const ok = await onSend(t); setBusy(false); if (ok) setText(""); }}>{sendLabel}</button>
      </div>
    </div>
  );
}

// The popover on one line: the thread, then the composer (Pending lines only).
export function QuestionPop({ anchor, line, thread, status, canAsk, saved, onClose, onSend, onSave, onRemove }: {
  anchor: HTMLElement; line: { date: string; description: string; amount: string }; thread: FeedQ[]; status: string; canAsk: boolean; saved: Saved[] | null;
  onClose: () => void; onSend: (t: string) => Promise<boolean>; onSave: (t: string) => Promise<void>; onRemove: (id: string) => Promise<void>;
}) {
  const [rect] = useState(() => anchor.getBoundingClientRect());
  return (
    <Floating rect={rect} width={400} onClose={onClose}>
      <div data-q-pop>
        <p className="text-[12px] text-ink-3">{formatDate(line.date)} · {line.amount}</p>
        <p className="truncate font-semibold" title={line.description}>{line.description}</p>
      </div>
      {thread.length > 0 && <div className="max-h-56 overflow-y-auto rounded-[8px] bg-sand-50 px-3 py-2"><ThreadView thread={thread} status={status} /></div>}
      {canAsk ? <Composer saved={saved} onSend={onSend} onSave={onSave} onRemove={onRemove} sendLabel={thread.some((e) => e.kind === "q") ? "Send follow-up" : "Send"} />
        : <p className="text-[12.5px] text-ink-3">This line is posted or excluded, so its questions are closed.</p>}
    </Floating>
  );
}

// The black bar's Ask client: one question on every ticked line.
export function AskManyWindow({ n, saved, onClose, onSend, onSave, onRemove }: {
  n: number; saved: Saved[] | null; onClose: () => void; onSend: (t: string) => Promise<boolean>; onSave: (t: string) => Promise<void>; onRemove: (id: string) => Promise<void>;
}) {
  return (
    <Modal title="Ask client" onClose={onClose} width={520} foot={<button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>}>
      <p className="text-ink-2">The same question goes on {n === 1 ? "the ticked line" : `each of the ${n} ticked lines`}. Asking posts nothing. The client sees it when you use Notify client.</p>
      <Composer saved={saved} onSend={async (t) => { const ok = await onSend(t); if (ok) onClose(); return ok; }} onSave={onSave} onRemove={onRemove} />
    </Modal>
  );
}
