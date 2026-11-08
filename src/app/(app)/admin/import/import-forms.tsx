"use client";
import { useState, useTransition } from "react";
import { Alert, Button, fileInputClass } from "@/components/ds/primitives";
import { importCsv, type ImportState } from "./actions";

const LABEL: Record<string, string> = { rows: "Rows in the file", new: "New (not yet in the app)", saved: "Saved", not_saved: "Not saved (see problems)", already_in_app: "Already in the app (left as is)", not_imported: "Not imported (see problems)",
  problems: "Problems", with_price: "With a price", name_checked: "Name already checked in Studio", with_letter_data: "Corporate letters that can be regenerated" };

// One file at a time: choosing it runs the check straight away (nothing saved). The Import
// button then imports that same file. The file stays chosen until it is imported.
export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [check, setCheck] = useState<ImportState>(null);
  const [result, setResult] = useState<ImportState>(null);
  const [pending, start] = useTransition();
  const [inputKey, setInputKey] = useState(0);

  const send = (f: File, mode: "check" | "import") => {
    const fd = new FormData();
    fd.set("file", f); fd.set("mode", mode); if (mode === "import") fd.set("reviewed", "on");
    return importCsv(null, fd);
  };
  const choose = (f: File | null) => {
    setFile(f); setCheck(null); setResult(null);
    if (f) start(async () => setCheck(await send(f, "check")));
  };
  const runImport = () => {
    if (!file) return;
    start(async () => {
      const r = await send(file, "import");
      setResult(r);
      if (r?.ok) { setFile(null); setCheck(null); setInputKey((k) => k + 1); }
    });
  };
  const newRows = check?.ok ? check.counts.new : 0;

  return (
    <div className="card space-y-4">
      <div>
        <label htmlFor="file" className="label">1. Choose the CSV file exported from Notion</label>
        <input key={inputKey} id="file" type="file" accept=".csv,text/csv" className={fileInputClass} disabled={pending}
          onChange={(e) => choose(e.target.files?.[0] ?? null)} />
        <p className="mt-1 text-xs text-muted">The app checks it straight away. Nothing is saved until you press Import.</p>
      </div>
      {pending && !check && !result && <p role="status" className="text-sm text-ink-2">Checking the file...</p>}
      {check && <ResultBox state={check} />}
      {check?.ok && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="label mb-0">2.</span>
          <Button type="button" onClick={runImport} loading={pending} disabled={newRows === 0}>
            {newRows === 0 ? "Nothing new to import" : `Import ${newRows} new row${newRows === 1 ? "" : "s"}`}
          </Button>
          <Button type="button" variant="ghost" disabled={pending} onClick={() => { choose(null); setInputKey((k) => k + 1); }}>Choose another file</Button>
        </div>
      )}
      {result && <ResultBox state={result} />}
      {result?.ok && <p className="text-sm text-ink-2">Choose the next file above.</p>}
    </div>
  );
}

function ResultBox({ state }: { state: NonNullable<ImportState> }) {
  if (!state.ok) return <Alert tone="danger">{state.error}</Alert>;
  const c = state.counts, saved = c.saved ?? 0;
  const title = state.dryRun ? `Check of ${state.source}: nothing saved yet`
    : saved === 0 ? `Import of ${state.source}: nothing was saved`
    : saved < c.new || state.problems.length ? `Import of ${state.source}: ${saved} saved, ${c.new - saved} not saved`
    : `Import of ${state.source}: done, ${saved} saved`;
  const tone = !state.dryRun && saved === 0 && (c.new > 0 || state.problems.length) ? "danger" : state.problems.length ? "warning" : "success";
  if (c.rows === 0) return (
    <Alert tone="warning" title={`The ${state.source} file has column headings but no rows`}>
      Nothing to import. If the Studio database in Notion has rows, export it again and choose the new file. If it is empty, skip this file.
    </Alert>
  );
  const labels = state.dryRun ? { ...LABEL, new: "New (will be added when you import)" } : LABEL;
  return (
    <div className="space-y-3">
      <Alert tone={tone} title={title}>
        <ul className="mt-1 grid gap-0.5">{Object.entries(c).map(([k, v]) => <li key={k}>{labels[k] ?? k}: <b>{v}</b></li>)}</ul>
      </Alert>
      {state.problems.length > 0 && (
        <div className="max-h-72 overflow-y-auto rounded-lg border border-sand-200">
          <table className="table text-sm"><thead><tr><th>Row</th><th>Problem</th></tr></thead>
            <tbody>{state.problems.map((p, i) => <tr key={i}><td>{p.row || ""}</td><td>{p.msg}</td></tr>)}</tbody></table>
        </div>
      )}
    </div>
  );
}

export function ActionButton({ label, run, confirm }: { label: string; run: () => Promise<{ ok: boolean; message: string }>; confirm?: string }) {
  const [msg, setMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button type="button" loading={pending} onClick={() => { if (confirm && !window.confirm(confirm)) return; start(async () => setMsg(await run())); }}>{label}</Button>
      {msg && <Alert tone={msg.ok ? "success" : "warning"}>{msg.message}</Alert>}
    </div>
  );
}
