"use client";
// Step 8: export a GIFI file. The route runs the checks, records the export and returns the file; the
// page then reloads so the export shows on the list. A refused export comes back as the step with the
// reason.
import { useRouter } from "next/navigation";
import { useState } from "react";

export function ExportButton({ href, label, primary = true }: { href: string; label: string; primary?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const res = await fetch(href, { cache: "no-store" });
      const cd = res.headers.get("content-disposition");
      if (!res.ok || !cd) { window.location.href = res.url; return; }
      const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? "GIFI.gfi";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      router.refresh();
    } finally { setBusy(false); }
  };
  return <button type="button" onClick={go} disabled={busy} className={primary ? "btn" : "btn-secondary"}>{busy ? "Exporting…" : label}</button>;
}
