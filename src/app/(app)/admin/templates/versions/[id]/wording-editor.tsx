"use client";
// Wording editor: click any wording in the sample documents (or search for it), edit it,
// save. Fill-ins such as {1} stay; the app puts names, dates and fees there.
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button } from "@/components/ds/primitives";
import { Paper, StudioLayout } from "@/components/studio/kit";
import { savePiece, undoPiece } from "../actions";

type Piece = { key: string; original: string; current: string; draft: string };
export type EditorProps = {
  versionId: string; label: string; currentLabel: string; editable: boolean;
  samples: { id: string; label: string; html: string }[]; pieces: Piece[];
};

export function WordingEditor({ versionId, label, currentLabel, editable, samples, pieces }: EditorProps) {
  const router = useRouter();
  const byKey = useMemo(() => new Map(pieces.map((p) => [p.key, p])), [pieces]);
  const [tab, setTab] = useState(samples[0]?.id ?? "");
  const [sel, setSel] = useState<string | null>(null);
  const [args, setArgs] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const piece = sel ? byKey.get(sel) : null;
  const changes = pieces.filter((p) => p.draft !== p.current);
  const found = q.trim().length >= 3 ? pieces.filter((p) => p.draft.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 25) : [];

  const choose = (k: string, a: string[] = []) => { const p = byKey.get(k); if (!p) return; setSel(k); setText(p.draft); setMsg(null); setArgs(a); };
  const save = () => sel && start(async () => {
    const r = await savePiece(versionId, sel, text);
    setMsg(r.ok ? { ok: true, text: "Saved in the draft." } : { ok: false, text: r.error ?? "Could not save." });
    if (r.ok) router.refresh();
  });
  const undo = (k: string) => start(async () => { const r = await undoPiece(versionId, k); if (r.ok) { if (k === sel) setText(byKey.get(k)!.current); router.refresh(); } else setMsg({ ok: false, text: r.error ?? "" }); });
  const sample = samples.find((s) => s.id === tab);

  const form = (
    <div className="flex min-h-0 flex-col gap-4 lg:h-full lg:overflow-y-auto lg:pr-1">
      <div>
        <label htmlFor="wq" className="label">Find wording</label>
        <input id="wq" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type at least 3 letters, or click wording in the preview" className="input" />
        {found.length > 0 && (
          <ul className="mt-2 grid max-h-56 gap-1 overflow-y-auto rounded-lg border border-sand-200 bg-surface p-1 text-sm">
            {found.map((p) => <li key={p.key}><button type="button" onClick={() => { choose(p.key); setQ(""); }} className="w-full rounded px-2 py-1 text-left hover:bg-sand-100">{p.draft.slice(0, 140)}</button></li>)}
          </ul>
        )}
      </div>
      {piece ? (
        <section className="card space-y-3">
          <p className="text-xs text-muted">Original wording (EL v3.31)</p>
          <p className="rounded bg-sand-50 p-2 text-sm whitespace-pre-wrap">{piece.original}</p>
          {piece.current !== piece.original && (<><p className="text-xs text-muted">In use now ({currentLabel})</p><p className="rounded bg-sand-50 p-2 text-sm whitespace-pre-wrap">{piece.current}</p></>)}
          <label htmlFor="wtext" className="label">{editable ? `Wording in ${label}` : `Wording in ${label}`}</label>
          <textarea id="wtext" value={text} onChange={(e) => setText(e.target.value)} readOnly={!editable} className="input min-h-32 py-2 text-[15px]" />
          {/\{\d+\}/.test(piece.original) && (
            <div className="rounded-lg bg-navy-50 p-2 text-xs text-navy-900">
              <p className="mb-1 font-medium">Fill-ins: keep each one once, where it makes sense. The app puts the client&rsquo;s details there.</p>
              <ul className="grid gap-0.5">{piece.original.match(/\{\d+\}/g)!.map((t, i) => (
                <li key={t}><code className="font-semibold">{t}</code>{args[i] != null ? <> = &ldquo;{args[i].replace(/<[^>]*>/g, "").slice(0, 80) || "(blank in this sample)"}&rdquo; in this sample</> : null}</li>
              ))}</ul>
            </div>
          )}
          {editable && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={save} loading={pending} disabled={text === piece.draft}>Save in draft</Button>
              {text !== piece.original && <Button type="button" variant="secondary" onClick={() => setText(piece.original)}>Use the original</Button>}
            </div>
          )}
          {msg && <Alert tone={msg.ok ? "success" : "danger"}>{msg.text}</Alert>}
        </section>
      ) : <p className="card text-sm text-muted">Click any wording in the preview to {editable ? "edit" : "see"} it. Wording you can edit is highlighted when you point at it.</p>}
      <section className="card space-y-2">
        <h2 className="font-semibold">Changes in {label} ({changes.length})</h2>
        {changes.length === 0 ? <p className="text-sm text-muted">No changes from {currentLabel} yet.</p> : (
          <ul className="grid gap-3 text-sm">{changes.map((p) => (
            <li key={p.key} className="rounded-lg border border-sand-200 p-2">
              <p className="text-xs text-muted">Was</p><p className="line-through decoration-danger/50">{p.current}</p>
              <p className="mt-1 text-xs text-muted">Now</p><p>{p.draft}</p>
              <div className="mt-1 flex gap-3"><button type="button" className="text-navy-700 underline" onClick={() => choose(p.key)}>Edit</button>
                {editable && <button type="button" className="text-navy-700 underline" onClick={() => undo(p.key)}>Undo</button>}</div>
            </li>
          ))}</ul>
        )}
      </section>
    </div>
  );

  const controls = (
    <div className="flex flex-wrap gap-2" role="tablist">
      {samples.map((s) => (
        <button key={s.id} type="button" role="tab" aria-selected={s.id === tab} onClick={() => setTab(s.id)}
          className={`rounded-full border px-3 py-1.5 text-[13px] font-medium ${s.id === tab ? "border-navy-700 bg-navy-700 text-white" : "border-sand-300 bg-surface text-ink-2"}`}>{s.label}</button>
      ))}
    </div>
  );

  return (
    <div className="wording-edit lg:flex lg:min-h-0 lg:flex-1 lg:flex-col" onClick={(e) => { const el = (e.target as HTMLElement).closest("[data-w]"); if (el) { let a: string[] = []; try { a = JSON.parse(decodeURIComponent(el.getAttribute("data-wa") ?? "%5B%5D")); } catch { /* none */ } choose(el.getAttribute("data-w")!, a); } }}>
      <style>{sel ? `.wording-edit [data-w="${sel}"]{background:rgba(134,188,40,.35);outline:1px solid #86BC28}` : ""}</style>
      <StudioLayout form={form} controls={controls} preview={sample ? <Paper key={sample.id} id={`ws-${sample.id}`} html={sample.html} draft={false} /> : null} />
    </div>
  );
}
