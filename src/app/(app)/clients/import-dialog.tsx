"use client";
import { useEffect, useId, useRef } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { InfoTip } from "@/components/ds/info-tip";
import { TaxdomeImport } from "../admin/taxdome-import/taxdome-form";

// Round 18 (benchmark: QuickBooks Online, Import customers from the customer list): Import from TaxDome
// opens in place on Clients (?import=1). Closing it drops ?import from the address; an import refreshes the list.
export function ImportDialog({ summary, help, closeHref }: { summary: string; help: string; closeHref: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); }, []);
  return (
    <dialog ref={ref} aria-labelledby={titleId} onClose={() => router.replace(closeHref, { scroll: false })}
      className="m-auto max-h-[92vh] w-[min(94vw,60rem)] overflow-y-auto rounded-2xl border border-sand-200 bg-surface p-0 text-ink shadow-[var(--shadow-raised)] backdrop:bg-navy-950/40 backdrop:backdrop-blur-[2px]">
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 id={titleId} className="flex items-center text-lg font-semibold">Import from TaxDome<InfoTip label="About the import">{help}</InfoTip></h2>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="rounded p-0.5 text-ink-3 hover:text-ink"><X className="h-5 w-5" aria-hidden /></button>
        </div>
        <TaxdomeImport summary={summary} onImported={() => router.refresh()} />
      </div>
    </dialog>
  );
}
