"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, User } from "lucide-react";

type Hit = { id: string; legal_name: string; kind: string; status: string };

// Global search (Ctrl+K or Cmd+K): type part of a client's name, press Enter to open their page.
export function useClientSearch(enabled: boolean) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
  return { open, setOpen };
}

export function ClientSearchDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [sel, setSel] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); setQ(""); setSel(0); }
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/client-search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        const j = (await r.json()) as { results: Hit[] };
        setHits(j.results ?? []); setSel(0);
      } catch { /* aborted or offline */ } finally { setLoading(false); }
    }, 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q, open]);

  const go = useCallback((h?: Hit) => { if (!h) return; onClose(); router.push(`/clients/${h.id}`); }, [onClose, router]);

  return (
    <dialog ref={ref} onClose={onClose} aria-label="Find a client"
      className="mx-auto mt-[12vh] w-[min(92vw,34rem)] rounded-2xl border border-sand-200 bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]">
      <div className="flex items-center gap-2 border-b border-sand-200 px-4">
        <Search className="h-4.5 w-4.5 text-ink-3" aria-hidden />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a client by name"
          aria-label="Client name" role="combobox" aria-expanded={hits.length > 0} aria-controls="client-search-list"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            if (e.key === "Enter") { e.preventDefault(); go(hits[sel]); }
          }}
          className="h-12 flex-1 border-0 bg-transparent text-[15px] shadow-none outline-none focus:ring-0 focus:outline-none focus-visible:outline-none" />
        <kbd className="rounded bg-sand-100 px-1.5 text-[11px] text-ink-3">Esc</kbd>
      </div>
      <ul id="client-search-list" role="listbox" className="max-h-80 overflow-y-auto p-2">
        {hits.map((h, i) => (
          <li key={h.id} role="option" aria-selected={i === sel}>
            <button type="button" onMouseEnter={() => setSel(i)} onClick={() => go(h)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm ${i === sel ? "bg-navy-50 text-navy-900" : "hover:bg-sand-50"}`}>
              {h.kind === "individual" ? <User className="h-4 w-4 text-ink-3" aria-hidden /> : <Building2 className="h-4 w-4 text-ink-3" aria-hidden />}
              <span className="flex-1 truncate">{h.legal_name}</span>
              <span className="text-xs text-ink-3">{h.kind === "individual" ? "Individual" : "Corporation"}{h.status === "inactive" ? " · inactive" : ""}</span>
            </button>
          </li>
        ))}
        {!loading && hits.length === 0 && <li className="px-3 py-6 text-center text-sm text-ink-3">{q ? "No client matches that name." : "No clients yet."}</li>}
      </ul>
    </dialog>
  );
}
