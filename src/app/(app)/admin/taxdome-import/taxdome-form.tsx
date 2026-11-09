"use client";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ds/primitives";
import { readAccounts, type Account, type Flag, type Planned } from "@/lib/taxdome/accounts";
import { applyTaxdome, previewTaxdome } from "./actions";

const MD = (md: string) => { if (!md) return ""; const [m, d] = md.split("-").map(Number); return new Date(Date.UTC(2001, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

// Reads the TaxDome Accounts CSV in the browser (UTF-8) and keeps only the needed columns.
export function TaxdomeImport() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [readFlags, setReadFlags] = useState<Flag[]>([]);
  const [preview, setPreview] = useState<{ planned: Planned[]; flags: Flag[] } | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();

  async function onFile(file: File | undefined) {
    setError(""); setDone(""); setPreview(null); setChecked(false);
    if (!file) return;
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    const r = readAccounts(text);
    if (r.missingColumns.length) { setError(`This is not the TaxDome Accounts export, or columns are missing: ${r.missingColumns.join(", ")}.`); return; }
    setAccounts(r.accounts); setReadFlags(r.flags);
    start(async () => {
      const p = await previewTaxdome(r.accounts);
      if (!p.ok) { setError(p.error); return; }
      setPreview({ planned: p.planned, flags: p.flags });
    });
  }

  function save() {
    if (!preview) return;
    start(async () => {
      const r = await applyTaxdome(accounts, preview.planned.length);
      if (r.ok) { setDone(r.message); setPreview(null); setAccounts([]); } else setError(r.message);
    });
  }

  const inserts = preview?.planned.filter((p) => p.action === "insert") ?? [];
  const updates = preview?.planned.filter((p) => p.action === "update") ?? [];
  const toCheck = updates.filter((p) => p.matchedBy === "legal name" || !p.account.bn);
  const flags = [...readFlags, ...(preview?.flags ?? [])].sort((a, b) => a.row - b.row);
  const notes = (p: Planned) => p.notes.length ? <span className="block text-xs text-warning">{p.notes.join(" ")}</span> : null;

  return (
    <div className="grid gap-5">
      <section className="card">
        <label htmlFor="tdfile" className="label">TaxDome Accounts export (CSV)</label>
        <input id="tdfile" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm file:mr-3 file:rounded-md file:border file:border-sand-200 file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
        <p className="mt-2 text-xs text-muted">The file is read in your browser. Only these columns are used: id, Account Name, Account Type, Tags, CRA BN, Fiscal Year-End and Company State / Province. Nothing else in the file, such as SIN, notes, contacts or addresses, is read or stored.</p>
      </section>
      {pending && <p className="text-sm text-muted">Checking…</p>}
      {error && <Alert tone="danger">{error}</Alert>}
      {done && <Alert tone="success">{done}</Alert>}
      {preview && (
        <>
          <p className="text-sm">Found <b>{preview.planned.length + preview.flags.length}</b> T2 company accounts: <b>{inserts.length}</b> new, <b>{updates.length}</b> matched, <b>{flags.length}</b> flagged. Nothing is saved until you press Save.</p>
          {toCheck.length > 0 && <Alert tone="warning">{toCheck.length} matched account{toCheck.length === 1 ? "" : "s"} have no Business Number or matched by name only. Check them below.</Alert>}
          <section className="card overflow-x-auto p-0">
            <h2 className="px-5 pt-4 pb-2 font-semibold">Matched to existing clients ({updates.length})</h2>
            {updates.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">None.</p> : (
              <table className="table"><thead><tr><th>Row</th><th>TaxDome account</th><th>Matched by</th><th>Changes</th></tr></thead>
                <tbody>{updates.map((p) => (
                  <tr key={p.account.taxdomeId}><td>{p.account.row}</td><td className="font-medium">{p.account.legalName}{notes(p)}</td><td>{p.matchedBy}</td>
                    <td className="text-xs">{p.changes.length === 0 ? <span className="text-muted">No change</span> : p.changes.map((c, i) => <span key={i} className="block">{c.field}: {c.from || "(blank)"} → {c.to || "(blank)"}</span>)}</td></tr>
                ))}</tbody></table>)}
          </section>
          <section className="card overflow-x-auto p-0">
            <h2 className="px-5 pt-4 pb-2 font-semibold">New clients ({inserts.length})</h2>
            {inserts.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">None.</p> : (
              <table className="table"><thead><tr><th>Row</th><th>Legal name</th><th>Business Number</th><th>Year-end</th><th>Province</th><th>Tags</th></tr></thead>
                <tbody>{inserts.map((p) => (
                  <tr key={p.account.taxdomeId}><td>{p.account.row}</td><td className="font-medium">{p.account.legalName}{notes(p)}</td><td>{p.account.bn}</td><td>{MD(p.account.fye)}</td><td>{p.account.province || "Other (none in TaxDome)"}</td><td className="text-xs">{p.account.tags.join(", ")}</td></tr>
                ))}</tbody></table>)}
          </section>
          <section className="card overflow-x-auto p-0">
            <h2 className="px-5 pt-4 pb-2 font-semibold">Flagged, not imported ({flags.length})</h2>
            {flags.length === 0 ? <p className="px-5 pb-4 text-sm text-muted">None.</p> : (
              <table className="table"><thead><tr><th>Row</th><th>Account</th><th>Why</th></tr></thead>
                <tbody>{flags.map((f, i) => <tr key={i}><td>{f.row}</td><td className="font-medium">{f.name}</td><td className="text-sm">{f.reason}</td></tr>)}</tbody></table>)}
          </section>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-navy-700" />I checked the matches, new clients and flags.</label>
            <Button disabled={!checked || pending || preview.planned.length === 0} onClick={save}>Save</Button>
          </div>
        </>
      )}
    </div>
  );
}
