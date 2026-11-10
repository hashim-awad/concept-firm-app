"use client";
// Copies the quote email so staff can paste it into Outlook with the buttons working: as formatted
// text (HTML) where the browser allows it, and as plain text everywhere.
import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyButton({ html, text, label }: { html?: string; text: string; label: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      if (html && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      setDone(false);
    }
  };
  return (
    <button type="button" onClick={copy} className="btn-secondary inline-flex items-center gap-1.5">
      {done ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}{done ? "Copied" : label}
    </button>
  );
}
