"use client";
// Download (which also files the PDF in the document vault as a new version) and Save client.
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, UserPlus } from "lucide-react";
import { Button } from "@/components/ds/primitives";

export type DocKind = "corporate_letter" | "t1_letter" | "proposal";
export type SaveResult = { ok: true; documentId: string; versionId: string; version: number; fileName: string; note?: string } | { ok: false; error: string };
export type ClientResult = { ok: true; clientId: string } | { ok: false; error: string };
export type DocumentHandlers = {
  saveDocument: (input: { kind: DocKind; snapshot: unknown; clientId: string; documentId: string }) => Promise<SaveResult>;
  saveClient: (input: { kind: DocKind; snapshot: unknown }) => Promise<ClientResult>;
};

export function DocumentActions({ kind, handlers, ok, message, mode, showSaveClient, snapshot, clientId, initialDocumentId, onClientSaved, disabledNote }: {
  kind: DocKind; handlers?: DocumentHandlers; ok: boolean; message: string; mode: "draft" | "final"; showSaveClient: boolean;
  snapshot: () => unknown; clientId: string; initialDocumentId?: string; onClientSaved: (id: string) => void; disabledNote?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "pdf" | "client">("");
  const [status, setStatus] = useState("");
  const [documentId, setDocumentId] = useState(initialDocumentId ?? "");

  async function download() {
    if (!handlers) return;
    setBusy("pdf"); setStatus("Building PDF...");
    try {
      const r = await handlers.saveDocument({ kind, snapshot: snapshot(), clientId, documentId });
      if (!r.ok) { setStatus(r.error); return; }
      setDocumentId(r.documentId);
      const a = document.createElement("a"); a.href = `/documents/file/${r.versionId}?download=1`; a.download = r.fileName;
      document.body.appendChild(a); a.click(); a.remove();
      setStatus(`Saved: ${r.fileName} (version ${r.version} in the vault).${r.note ? " " + r.note : ""}`);
      router.refresh();
    } catch {
      setStatus("Could not build the PDF. Try again.");
    } finally { setBusy(""); }
  }

  async function saveClient() {
    if (!handlers) return;
    setBusy("client"); setStatus("Saving client...");
    try {
      const r = await handlers.saveClient({ kind, snapshot: snapshot() });
      if (!r.ok) { setStatus(r.error); return; }
      onClientSaved(r.clientId);
      setStatus(kind === "t1_letter"
        ? "Client saved. Confirm the name against ID or CRA records under Clients, Edit, then issue the Final letter."
        : "Client saved. Go to Clients, click Edit, and confirm the legal name against the registry. Then issue the Final letter.");
      router.refresh();
    } catch {
      setStatus("Could not save the client. Try again.");
    } finally { setBusy(""); }
  }

  const note = !handlers ? (disabledNote ?? "Test page: saving is off.") : status || message;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <Button id="dl" type="button" onClick={download} disabled={!ok || !handlers} loading={busy === "pdf"}>
        <Download className="h-4 w-4" aria-hidden />{mode === "final" ? "Issue and download PDF" : "Download PDF"}
      </Button>
      {showSaveClient && (
        <Button id="recBtn" type="button" variant="secondary" onClick={saveClient} disabled={!handlers} loading={busy === "client"}>
          <UserPlus className="h-4 w-4" aria-hidden />Save client
        </Button>
      )}
      <span id="status" role="status" className="text-[13px] text-ink-2">{note}</span>
    </div>
  );
}
