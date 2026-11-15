"use client";
import { useState, useTransition } from "react";
import { Alert, Button } from "@/components/ds/primitives";
import { readAccounts, yearEndChange, type Account, type Flag, type Planned } from "@/lib/taxdome/accounts";
import { applyTaxdome, previewTaxdome } from "./actions";

const MD = (md: string) => { if (!md) return ""; const [m, d] = md.split("-").map(Number); return new Date(Date.UTC(2001, m - 1, d)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }); };

type Kind = "new" | "updated" | "unchanged" | "skipped";
const KINDS: { key: Kind; label: string }[] = [{ key: "new", label: "New" }, { key: "updated", label: "Updated" }, { key: "unchanged", label: "Unchanged" }, { key: "skipped", label: "Not imported" }];
const kindOf = (p: Planned): Kind => p.action === "insert" ? "new" : p.changes.length ? "updated" : "unchanged";
const STEPS = ["Upload", "Preview", "Import"];

// Round 18 (benchmark: QuickBooks Online, Import customers): opened as a dialog on Clients, in three steps.
// Reads the TaxDome Accounts CSV in the browser (UTF-8) and keeps only the needed columns.
// summary: what the last import did. onImported: runs after a successful import (the list refreshes).
export function TaxdomeImport({ summary, onImported }: { summary?: string; onImported?: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [readFlags, setReadFlags] = useState<Flag[]>([]);
  const [preview, setPreview] = useState<{ planned: Planned[]; flags: Flag[]; candidates: { id: string; legal_name: string }[] } | null>(null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [yearEnds, setYearEnds] = useState<string[]>([]);
  const [show, setShow] = useState<Kind | "all">("all");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [checked, setChecked] = useState(false);
  const [pending, start] = useTransition();
  const step = done ? 2 : preview ? 1 : 0;

  function reset() { setError(""); setDone(""); setPreview(null); setChecked(false); setLinks({}); setYearEnds([]); setShow("all"); setAccounts([]); setReadFlags([]); }

  async function onFile(file: File | undefined) {
    reset();
    if (!file) return;
    const text = new TextDecoder("utf-8").decode(await file.arrayBuffer());
    const r = readAccounts(text);
    if (r.missingColumns.length) { setError(`This is not the TaxDome Accounts export, or columns are missing: ${r.missingColumns.join(", ")}.`); return; }
    setAccounts(r.accounts); setReadFlags(r.flags);
    start(async () => {
      const p = await previewTaxdome(r.accounts);
      if (!p.ok) { setError(p.error); return; }
      setPreview({ planned: p.planned, flags: p.flags, candidates: p.candidates });
    });
  }

  // The owner ties a new account to an existing Studio client: the preview is worked out again.
  function link(taxdomeId: string, clientId: string) {
    const next = { ...links };
    if (clientId) next[taxdomeId] = clientId; else delete next[taxdomeId];
    setLinks(next); setChecked(false);
    start(async () => {
      const p = await previewTaxdome(accounts, next);
      if (!p.ok) { setError(p.error); return; }
      setPreview({ planned: p.planned, flags: p.flags, candidates: p.candidates });
    });
  }

  const tickYearEnd = (id: string, on: boolean) => setYearEnds((all) => on ? [...all.filter((x) => x !== id), id] : all.filter((x) => x !== id));

  function save() {
    if (!preview) return;
    setError("");
    start(async () => {
      const r = await applyTaxdome(accounts, preview.planned.length, links, yearEnds);
      if (r.ok) { setDone(r.message); setPreview(null); setAccounts([]); onImported?.(); } else setError(r.message);
    });
  }

  const planned = preview?.planned ?? [];
  const flags = [...readFlags, ...(preview?.flags ?? [])].sort((a, b) => a.row - b.row);
  const count: Record<Kind, number> = { new: 0, updated: 0, unchanged: 0, skipped: flags.length };
  for (const p of planned) count[kindOf(p)]++;
  const toCheck = planned.filter((p) => p.action === "update" && (p.matchedBy === "legal name" || !p.account.bn));
  const fyeChanges = planned.filter((p) => yearEndChange(p));
  const rows: ({ kind: Kind; row: number; p?: Planned; f?: Flag })[] = [
    ...planned.map((p) => ({ kind: kindOf(p), row: p.account.row, p })),
    ...flags.map((f) => ({ kind: "skipped" as const, row: f.row, f })),
  ].filter((r) => show === "all" || r.kind === show).sort((a, b) => a.row - b.row);

  const details = (p: Planned) => {
    const fye = yearEndChange(p);
    return (
      <>
        {p.action === "insert" ? (
          <span className="block">{[p.account.bn && `BN ${p.account.bn}`, p.account.fye && `Year-end ${MD(p.account.fye)}`, p.account.province ? `Province ${p.account.province}` : "Province Other (none in TaxDome)", p.account.tags.length && `Tags ${p.account.tags.join(", ")}`].filter(Boolean).join(" · ")}</span>
        ) : (
          <span className="block text-ink-3">Matched by {p.matchedBy}{p.matchedBy === "chosen by you" && <button type="button" onClick={() => link(p.account.taxdomeId, "")} className="ml-2 text-navy-700 underline">Undo</button>}</span>
        )}
        {p.changes.filter((c) => !(fye && c.field === "Year-end")).map((c, i) => <span key={i} className="block">{c.field}: {c.from || "(blank)"} → {c.to || "(blank)"}</span>)}
        {fye && (
          <label className="mt-1 flex items-start gap-2 rounded-md border border-warning/40 bg-warning-soft px-2 py-1.5 text-[#5C3D00]">
            <input type="checkbox" checked={yearEnds.includes(p.account.taxdomeId)} onChange={(e) => tickYearEnd(p.account.taxdomeId, e.target.checked)} className="mt-0.5 h-4 w-4 flex-none accent-navy-700" />
            <span>Year end changes from {MD(fye.from)} to {MD(fye.to)}: check deadlines and Closebook files</span>
          </label>
        )}
        {p.notes.length > 0 && <span className="block text-warning">{p.notes.join(" ")}</span>}
        {p.action === "insert" && (preview?.candidates.length ?? 0) > 0 && (
          <select aria-label={`Same as existing Studio client, row ${p.account.row}`} value="" onChange={(e) => link(p.account.taxdomeId, e.target.value)} className="input mt-1 w-auto text-sm" disabled={pending}>
            <option value="">A new client</option>
            {preview!.candidates.map((c) => <option key={c.id} value={c.id}>Same as {c.legal_name}</option>)}
          </select>
        )}
      </>
    );
  };

  return (
    <div className="grid gap-4">
      <ol className="flex flex-wrap items-center gap-2 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className="flex items-center gap-2">
            {i > 0 && <span className="h-px w-6 bg-sand-300" aria-hidden />}
            <span className={`grid h-6 w-6 place-items-center rounded-full text-xs font-bold ${i === step ? "bg-navy-700 text-white" : i < step ? "bg-success-soft text-success" : "bg-sand-100 text-ink-3"}`}>{i + 1}</span>
            <span className={i === step ? "font-semibold text-ink" : "text-ink-3"}>{s}</span>
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section className="grid gap-2">
          {summary && <p className="text-sm text-ink-2">{summary}</p>}
          <label htmlFor="tdfile" className="label">TaxDome Accounts export (CSV)</label>
          <input id="tdfile" type="file" accept=".csv,text/csv" disabled={pending} onChange={(e) => onFile(e.target.files?.[0])} className="block text-sm file:mr-3 file:rounded-md file:border file:border-sand-200 file:bg-surface file:px-3 file:py-1.5 file:text-sm" />
          <p className="text-xs text-muted">The file is read in your browser. Only these columns are used: id, Account Name, Account Type, Tags, CRA BN, Fiscal Year-End and Company State / Province. Nothing else in the file, such as SIN, notes, contacts or addresses, is read or stored.</p>
        </section>
      )}
      {pending && <p className="text-sm text-muted">{preview ? "Working…" : "Checking…"}</p>}
      {error && <Alert tone="danger">{error}</Alert>}

      {preview && (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Show">
            {KINDS.map((k) => (
              <button key={k.key} type="button" aria-pressed={show === k.key} onClick={() => setShow(show === k.key ? "all" : k.key)}
                className={`min-w-[7rem] rounded-lg border px-3 py-2 text-left ${show === k.key ? "border-navy-700 bg-navy-50" : "border-sand-200 bg-surface hover:bg-sand-50"}`}>
                <span className="block text-xl font-semibold">{count[k.key]}</span>
                <span className="block text-xs text-ink-2">{k.label}</span>
              </button>
            ))}
          </div>
          <p className="text-sm text-ink-2">Nothing is saved until you press Import.{show !== "all" && <> Showing {KINDS.find((k) => k.key === show)!.label.toLowerCase()} only. <button type="button" onClick={() => setShow("all")} className="text-navy-700 underline">Show all</button></>}</p>
          {toCheck.length > 0 && <Alert tone="warning">{toCheck.length} matched account{toCheck.length === 1 ? " has" : "s have"} no Business Number or matched by name only. Check them below.</Alert>}
          {fyeChanges.length > 0 && <Alert tone="warning">{fyeChanges.length} year-end change{fyeChanges.length === 1 ? "" : "s"}. Tick each one to apply it. If you leave it unticked, the client keeps the old year-end and the other changes still apply.</Alert>}
          <div className="max-h-[50vh] overflow-auto rounded-lg border border-sand-200">
            {rows.length === 0 ? <p className="p-4 text-sm text-muted">None.</p> : (
              <table className="table">
                <thead><tr><th>Row</th><th>TaxDome account</th><th>Result</th><th>Details</th></tr></thead>
                <tbody>{rows.map((r, i) => (
                  <tr key={r.p ? r.p.account.taxdomeId : `f${i}`}>
                    <td>{r.row}</td>
                    <td className="font-medium">{r.p ? r.p.account.legalName : r.f!.name}</td>
                    <td className="whitespace-nowrap">{KINDS.find((k) => k.key === r.kind)!.label}</td>
                    <td className="text-xs">{r.p ? details(r.p) : r.f!.reason}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="h-4 w-4 accent-navy-700" />I checked the matches, new clients and accounts not imported.</label>
            <span className="flex-1" />
            <Button variant="secondary" disabled={pending} onClick={reset}>Choose another file</Button>
            <Button disabled={!checked || pending || planned.length === 0} onClick={save}>Import</Button>
          </div>
        </>
      )}

      {done && (
        <>
          <Alert tone="success">{done}</Alert>
          <div><Button variant="secondary" onClick={reset}>Import another file</Button></div>
        </>
      )}
    </div>
  );
}
