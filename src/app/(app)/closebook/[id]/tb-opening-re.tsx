"use client";
// Decision 1A (Hashim, Nov 19, 2026): step 2 on a trial balance file holds last year's closing retained earnings, typed exactly
// as printed on last year's T2 (line 3849; a deficit negative). Step 6 checks retained earnings at the start against it, and the
// Opening Balance Equity RJE needs it.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notify } from "@/components/save-state";
import { saveTbOpeningReInline } from "../actions";

// One amount format across the app: a deficit in brackets.
const fmt = (v: number | null) => {
  if (v === null) return "";
  const t = Math.abs(v).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `(${t})` : t;
};

export function TbOpeningRe({ fileId, stated, editable }: { fileId: string; stated: number | null; editable: boolean }) {
  const [text, setText] = useState(fmt(stated));
  const [pending, start] = useTransition();
  const router = useRouter();
  const save = () => {
    const t = text.trim().replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "-$1");
    const v = t === "" ? null : Number(t);
    if (v !== null && (!Number.isFinite(v) || Math.abs(v) >= 1e12)) { notify("Type the amount as printed on the T2, for example 125,400.00.", "error"); return; }
    start(async () => {
      const err = await saveTbOpeningReInline(fileId, v);
      if (err) notify(err, "error"); else { setText(fmt(v)); notify("Saved."); router.refresh(); }
    });
  };
  return (
    <section className="card grid gap-2" data-tb-opening-re>
      <label htmlFor="opening-re" className="font-semibold">Last year&apos;s closing retained earnings (T2 line 3849)</label>
      <span className="flex items-center gap-2">
        <input id="opening-re" inputMode="decimal" value={text} disabled={!editable || pending} onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text.trim() !== fmt(stated)) save(); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (text.trim() !== fmt(stated)) save(); } }} placeholder="As printed on last year&apos;s T2" style={{ width: "12rem" }} className="input input-compact text-right tabular-nums" />
      </span>
      <span className="text-xs text-ink-3">Type it as printed on last year&apos;s T2. A deficit goes in brackets or with a minus sign. Saved when you press Enter or leave the box. Step 6 checks retained earnings at the start against it.</span>
    </section>
  );
}
