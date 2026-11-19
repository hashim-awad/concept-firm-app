"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";
import { saveTaxdomeTypeTags } from "./actions";

const TYPES = ["PREC", "Holdco", "Operating co", "Professional corp"];
type Row = { key: number; tag: string; entity_type: string };

// Round 18: Connections › Type from TaxDome tags. A table of Tag → Type that an Admin edits and saves at once.
export function TypeTagsForm({ initial }: { initial: { tag: string; entity_type: string }[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map((r, i) => ({ key: i, ...r })));
  const [next, setNext] = useState(initial.length);
  const add = () => { setRows([...rows, { key: next, tag: "", entity_type: "PREC" }]); setNext(next + 1); };
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r));
  return (
    <form action={saveTaxdomeTypeTags}>
      <table className="table">
        <thead><tr><th>TaxDome tag</th><th>Type</th><th><span className="sr-only">Remove</span></th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={3} className="text-sm text-muted">No tags yet. Every company imported from TaxDome gets the type Other.</td></tr>}
          {rows.map((r, i) => (
            <tr key={r.key}>
              <td><input name="tag" value={r.tag} onChange={(e) => set(r.key, { tag: e.target.value })} maxLength={60} required className="input w-full" aria-label={`Tag ${i + 1}`} /></td>
              <td>
                <select name="entity_type" value={r.entity_type} onChange={(e) => set(r.key, { entity_type: e.target.value })} className="input w-auto" aria-label={`Type for tag ${i + 1}`}>
                  {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </td>
              <td className="text-right">
                <button type="button" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label={`Remove tag ${r.tag || i + 1}`} className="rounded p-1 text-ink-3 hover:bg-sand-100 hover:text-ink"><X className="h-4 w-4" aria-hidden /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={add} className="btn-secondary inline-flex items-center gap-1"><Plus className="h-4 w-4" aria-hidden />Add tag</button>
        <button type="submit" className="btn">Save tags</button>
      </div>
    </form>
  );
}
