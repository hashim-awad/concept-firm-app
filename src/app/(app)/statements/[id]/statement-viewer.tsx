"use client";
// Round 20 (Hashim, Nov 15, 2026; mocks 02 and 03): the statement on the left of the verify screen, with
// page navigation and zoom (QuickBooks Online "Verify details"). PDFs are drawn with pdf.js; photos are
// shown as images. Clicking a line in the table finds it on its page: pdf.js reads the page's text, and
// the row holding the line's amount (and, when it can, its description) is outlined. For photos, or when
// the text is not found, the viewer just goes to the line's page.
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

export type Focus = { n: number; page: number; amountCents: number; description: string };
type Box = { left: number; top: number; width: number; height: number };
type Item = { str: string; x: number; y: number; w: number; h: number };

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;
// pdf.js parses in a module worker. Turbopack bundles the worker from the package through `new URL`.
function pdfjs(): Promise<PdfJs> {
  lib ??= import("pdfjs-dist").then((m) => {
    if (!m.GlobalWorkerOptions.workerPort) {
      m.GlobalWorkerOptions.workerPort = new Worker(new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url), { type: "module" });
    }
    return m;
  });
  return lib;
}

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const amountTexts = (c: number) => {
  const t = (c / 100).toFixed(2);
  return [(c / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), t];
};
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

export function StatementViewer({ url, mediaType, pages: pagesIn, focus }: { url: string; mediaType: string; pages: number | null; focus: Focus | null }) {
  const isPdf = mediaType === "application/pdf" || /\.pdf($|\?)/i.test(url.split("?")[0]);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [box, setBox] = useState<Box | null>(null);
  const [notFound, setNotFound] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const pages = doc?.numPages ?? pagesIn ?? 1;

  // Load the PDF once.
  useEffect(() => {
    if (!isPdf) return;
    let gone = false, task: ReturnType<PdfJs["getDocument"]> | null = null;
    pdfjs().then((m) => { if (gone) return null; task = m.getDocument({ url }); return task.promise; }).then((d) => {
      if (d && !gone) setDoc(d);
    }).catch(() => { if (!gone) setError("The statement could not be shown. The lines on the right are still there to check."); });
    return () => { gone = true; task?.destroy(); };
  }, [url, isPdf]);

  // The page fits the panel's width at 100%.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // A line was clicked: go to its page.
  const [seenFocus, setSeenFocus] = useState(focus);
  if (seenFocus !== focus) {
    setSeenFocus(focus);
    if (!focus) { setBox(null); setNotFound(false); } else setPage(Math.min(Math.max(1, focus.page || 1), pages));
  }

  // Draw the page, then outline the clicked line on it.
  useEffect(() => {
    if (!doc || !canvas.current || !width) return;
    let task: ReturnType<PDFPageProxy["render"]> | null = null, gone = false;
    (async () => {
      const m = await pdfjs();
      const p = await doc.getPage(page);
      if (gone) return;
      const base = p.getViewport({ scale: 1 });
      const vp = p.getViewport({ scale: (width / base.width) * zoom });
      const dpr = window.devicePixelRatio || 1;
      const c = canvas.current!;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${Math.floor(vp.width)}px`; c.style.height = `${Math.floor(vp.height)}px`;
      task = p.render({ canvas: c, viewport: vp, transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0] });
      try { await task.promise; } catch { return; }
      if (gone) return;
      if (!focus || (focus.page || 1) !== page) { setBox(null); setNotFound(false); return; }
      const tc = await p.getTextContent();
      const items: Item[] = [];
      for (const it of tc.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const t = m.Util.transform(vp.transform, it.transform);
        const h = Math.hypot(t[2], t[3]);
        items.push({ str: it.str, x: t[4], y: t[5] - h, w: it.width * vp.scale, h });
      }
      const found = findLine(items, focus);
      if (gone) return;
      setBox(found); setNotFound(!found);
      if (found) wrap.current?.scrollTo({ top: Math.max(0, found.top - 120), behavior: "smooth" });
    })();
    return () => { gone = true; task?.cancel(); };
  }, [doc, page, zoom, width, focus]);

  const zi = ZOOMS.indexOf(zoom);
  return (
    <div className="grid min-w-0 gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-ink-2">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-sand-100 disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
        <span className="tabular-nums">Page {page} of {pages}</span>
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-sand-100 disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
        <span className="flex-1" />
        <button type="button" aria-label="Zoom out" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[zi - 1])} className="grid h-7 w-7 place-items-center rounded-md border border-sand-300 bg-white hover:bg-sand-50 disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
        <span className="w-10 text-center tabular-nums">{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1])} className="grid h-7 w-7 place-items-center rounded-md border border-sand-300 bg-white hover:bg-sand-50 disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
        <span className="text-ink-3">{notFound && focus ? `Page ${focus.page}: the line is not marked on the page` : "Click a line to find it on the page"}</span>
      </div>
      <div ref={wrap} className="relative max-h-[calc(100vh-210px)] min-h-[420px] overflow-auto rounded-md border border-sand-200 bg-sand-100">
        {error ? <p className="p-4 text-sm text-danger">{error}</p> : isPdf ? (
          <div className="relative w-fit">
            <canvas ref={canvas} className="block bg-white" aria-label={`Statement page ${page}`} />
            {!doc && <p className="absolute top-3 left-3 text-sm text-ink-3">Loading the statement…</p>}
            {box && <span aria-hidden data-outline className="pointer-events-none absolute rounded-sm border-2 border-[#e8b100] bg-[#fff3b0]/30"
              style={{ left: box.left, top: box.top, width: box.width, height: box.height }} />}
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a signed storage link, shown as uploaded
          <img src={url} alt="The statement as uploaded" style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="block bg-white" />
        )}
      </div>
    </div>
  );
}

// The row on the page that holds the line: the text items with its amount, preferring one that has the
// description's first words on the same row. The outline spans every item on that row.
function findLine(items: Item[], f: Focus): Box | null {
  const amounts = amountTexts(f.amountCents);
  const words = norm(f.description).split(" ").filter((w) => w.length > 1).slice(0, 3).join(" ");
  const sameRow = (a: Item, b: Item) => Math.abs((a.y + a.h / 2) - (b.y + b.h / 2)) < Math.max(a.h, b.h) * 0.6;
  // The amount as a whole number on its own ("37.60" must not match "1,237.60").
  const res = amounts.map((t) => new RegExp(`(^|[^\\d,.])${t.replace(/[.,]/g, "\\$&")}($|[^\\d])`));
  const hasAmount = (it: Item) => res.some((re) => re.test(it.str.replace(/\s/g, "")));
  const hasWords = (it: Item) => !!words && norm(it.str).includes(words.slice(0, Math.min(words.length, 14)));
  const amountItems = items.filter(hasAmount);
  const descItems = items.filter(hasWords);
  let anchor = amountItems.find((a) => descItems.some((d) => sameRow(a, d))) ?? null;
  if (!anchor && descItems.length === 1) anchor = descItems[0];
  if (!anchor && amountItems.length === 1) anchor = amountItems[0];
  if (!anchor) return null;
  const row = items.filter((it) => sameRow(it, anchor!));
  const left = Math.min(...row.map((r) => r.x)), right = Math.max(...row.map((r) => r.x + r.w));
  const top = Math.min(...row.map((r) => r.y)), bottom = Math.max(...row.map((r) => r.y + r.h));
  return { left: left - 4, top: top - 3, width: right - left + 8, height: bottom - top + 6 };
}
