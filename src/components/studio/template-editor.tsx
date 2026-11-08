"use client";
// Template editor, in the style of proposal and letter apps: the template as a document on the
// left; click any text to change it on the right. Fill-ins show by name ([Company name]) and
// are filled in for each client. Changes stay unpublished until an owner publishes them.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MousePointerClick, PencilLine, Send } from "lucide-react";
import { Alert, Button } from "@/components/ds/primitives";
import { Paper } from "./kit";
import { saveWording, undoWording } from "@/app/(app)/admin/templates/actions";

export type EditPiece = { key: string; original: string; live: string; draft: string; fills: string[] };

export function TemplateEditor({ parts, pieces, canEdit }: {
  parts: { label: string; html: string }[]; pieces: EditPiece[]; canEdit: boolean;
}) {
  const router = useRouter();
  const by = new Map(pieces.map((p) => [p.key, p]));
  const [sel, setSel] = useState<string | null>(null);
  const [vals, setVals] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const box = useRef<HTMLTextAreaElement>(null);
  const piece = sel ? by.get(sel) : null;
  const changed = pieces.filter((p) => p.draft !== p.live).map((p) => p.key);

  const choose = (k: string, a: string[] = []) => { const p = by.get(k); if (!p) return; setSel(k); setText(p.draft); setMsg(null); setVals(a); };
  const insert = (name: string) => {
    const el = box.current; const tag = `[${name}]`;
    if (!el) { setText((t) => t + tag); return; }
    const a = el.selectionStart, b = el.selectionEnd;
    setText((t) => t.slice(0, a) + tag + t.slice(b));
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + tag.length, a + tag.length); });
  };
  const save = () => piece && start(async () => {
    const r = await saveWording(piece.key, text);
    setMsg(r.ok ? { ok: true, text: "Saved as an unpublished change. The document shows it now." } : { ok: false, text: r.error ?? "Could not save." });
    if (r.ok) router.refresh();
  });
  const undo = () => piece && start(async () => {
    const r = await undoWording(piece.key);
    if (r.ok) { setText(piece.live); setMsg({ ok: true, text: "Back to the published wording." }); router.refresh(); } else setMsg({ ok: false, text: r.error ?? "" });
  });

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="template-doc grid gap-6" onClick={(e) => {
        const el = (e.target as HTMLElement).closest("[data-w]");
        if (!el) return;
        let a: string[] = [];
        try { a = JSON.parse(decodeURIComponent(el.getAttribute("data-wa") ?? "%5B%5D")); } catch { /* no values */ }
        choose(el.getAttribute("data-w")!, a);
      }}>
        <style>{[
          sel ? `.template-doc [data-w="${sel}"]{background:rgba(134,188,40,.35)!important;outline:2px solid #86BC28}` : "",
          changed.length ? `${changed.map((k) => `.template-doc [data-w="${k}"]`).join(",")}{background:#FFF4CC}` : "",
        ].join("")}</style>
        {parts.map((p) => (
          <section key={p.label}>
            {parts.length > 1 && <h2 className="mb-2 text-sm font-semibold text-navy-800">{p.label}</h2>}
            <Paper id={`tpl-${p.label.length}-${p.html.length}`} html={p.html || "<p>Not shown in this sample.</p>"} draft={false} />
          </section>
        ))}
      </div>

      <aside className="lg:sticky lg:top-4">
        {!piece ? (
          <div className="card space-y-3 text-sm">
            <h2 className="text-base font-semibold">{canEdit ? "How to change this template" : "How to read this template"}</h2>
            <ol className="grid gap-3">
              <li className="flex gap-3"><MousePointerClick className="mt-0.5 h-5 w-5 shrink-0 text-navy-700" aria-hidden /><span><b>Click any text</b> in the document. Text you can change lights up when you point at it.</span></li>
              {canEdit && <li className="flex gap-3"><PencilLine className="mt-0.5 h-5 w-5 shrink-0 text-navy-700" aria-hidden /><span><b>Change it here and save.</b> Words in [square brackets], like [Company name], are filled in for each client. Keep them.</span></li>}
              {canEdit && <li className="flex gap-3"><Send className="mt-0.5 h-5 w-5 shrink-0 text-navy-700" aria-hidden /><span><b>Publish.</b> Saved changes show in <span className="rounded bg-[#FFF4CC] px-1">yellow</span> and are not used in letters until an owner publishes them.</span></li>}
            </ol>
            <p className="text-xs text-muted">The document uses made-up client details (Example Holdings Inc.). Names, dates and fees change for each client; the wording does not.</p>
          </div>
        ) : (
          <div className="card space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-base font-semibold">{canEdit ? "Change this text" : "This text"}</h2>
              {piece.draft !== piece.live && <span className="rounded bg-[#FFF4CC] px-2 py-0.5 text-xs font-medium text-[#5C3D00]">Not published yet</span>}
            </div>
            <textarea ref={box} value={text} onChange={(e) => setText(e.target.value)} readOnly={!canEdit} rows={Math.min(14, Math.max(4, Math.ceil(text.length / 48)))}
              className="input py-2 text-[15px] leading-6" aria-label="Wording" />
            {piece.fills.length > 0 && (
              <div className="text-xs">
                <p className="mb-1 text-muted">Filled in for each client{canEdit ? " (click to insert)" : ""}:</p>
                <ul className="grid gap-1">{piece.fills.map((f, i) => (
                  <li key={f} className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!canEdit} onClick={() => insert(f)} className="rounded-full border border-navy-200 bg-navy-50 px-2 py-0.5 font-medium text-navy-800 enabled:hover:bg-navy-100">[{f}]</button>
                    {vals[i] != null && <span className="text-ink-3">in this example: &ldquo;{vals[i].replace(/<[^>]*>/g, "").trim().slice(0, 70) || "blank"}&rdquo;</span>}
                  </li>
                ))}</ul>
              </div>
            )}
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" onClick={save} loading={pending} disabled={text === piece.draft}>Save change</Button>
                <Button type="button" variant="ghost" onClick={() => { setSel(null); setMsg(null); }}>Close</Button>
                {piece.draft !== piece.live && <button type="button" onClick={undo} className="text-sm text-navy-700 underline">Undo: back to published</button>}
              </div>
            )}
            {msg && <Alert tone={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
            {piece.live !== piece.original && <details className="text-xs text-muted"><summary className="cursor-pointer">Original Studio wording</summary><p className="mt-1 whitespace-pre-wrap">{piece.original}</p></details>}
          </div>
        )}
      </aside>
    </div>
  );
}
