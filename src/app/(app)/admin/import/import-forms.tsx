"use client";
import { useActionState, useState, useTransition } from "react";
import { Alert, Button } from "@/components/ds/primitives";
import { importCsv, type ImportState } from "./actions";

const LABEL: Record<string, string> = { rows: "Rows in the file", new: "New (not yet in the app)", saved: "Saved", not_saved: "Not saved (see problems)", already_in_app: "Already in the app (left as is)", not_imported: "Not imported (see problems)",
  problems: "Problems", with_price: "With a price", name_checked: "Name already checked in Studio", with_letter_data: "Corporate letters that can be regenerated" };

export function ImportForm() {
  const [state, action, pending] = useActionState<ImportState, FormData>(importCsv, null);
  const [mode, setMode] = useState("check");
  return (
    <form action={action} className="card space-y-4">
      <div>
        <label htmlFor="file" className="label">CSV file exported from Notion</label>
        <input id="file" name="file" type="file" accept=".csv,text/csv" required className="text-sm" />
        <p className="mt-1 text-xs text-muted">The app recognises which Studio database the file is from by its columns.</p>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="reviewed" className="h-4 w-4 accent-navy-700" /> I ran the check on this file and reviewed the counts and problems</label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="mode" value="check" variant="secondary" onClick={() => setMode("check")} loading={pending && mode === "check"}>Check (nothing is saved)</Button>
        <Button type="submit" name="mode" value="import" onClick={() => setMode("import")} loading={pending && mode === "import"}>Import</Button>
      </div>
      {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}
      {state && state.ok && (
        <div className="space-y-3">
          {(() => {
            const c = state.counts, saved = c.saved ?? 0;
            const title = state.dryRun ? `Check of ${state.source}: nothing was saved`
              : saved === 0 ? `Import of ${state.source}: nothing was saved`
              : saved < c.new || state.problems.length ? `Import of ${state.source}: ${saved} saved, ${c.new - saved} not saved`
              : `Import of ${state.source}: done, ${saved} saved`;
            const tone = !state.dryRun && saved === 0 && (c.new > 0 || state.problems.length) ? "danger" : state.problems.length ? "warning" : "success";
            return (
              <Alert tone={tone} title={title}>
                <ul className="mt-1 grid gap-0.5">{Object.entries(c).map(([k, v]) => <li key={k}>{LABEL[k] ?? k}: <b>{v}</b></li>)}</ul>
              </Alert>
            );
          })()}
          {state.problems.length > 0 && (
            <div className="max-h-72 overflow-y-auto rounded-lg border border-sand-200">
              <table className="table text-sm"><thead><tr><th>Row</th><th>Problem</th></tr></thead>
                <tbody>{state.problems.map((p, i) => <tr key={i}><td>{p.row || ""}</td><td>{p.msg}</td></tr>)}</tbody></table>
            </div>
          )}
        </div>
      )}
    </form>
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
