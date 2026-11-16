"use client";
// Round 18: the Financial statements form on the client page. The basis of accounting and the users of
// the statements (up to 5). Management always uses them, so it is not listed. Saved with
// saveClientStatements; the database checks the same rules again.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Button, Card, buttonClass } from "@/components/ds/primitives";
import { Hint, Labelled, SelectIn, TextIn } from "@/components/studio/kit";
import { THIRD_PARTY_BASIS } from "@/lib/clients";
import { saveClientStatements, type StatementUser } from "../actions";
import { DiscardButton, useUnsavedGuard } from "@/components/save-state";

const MAX = 5;

export function StatementsEditor({ id, basis, customWording, users, cancelHref }: { id: string; basis: string; customWording: string; users: StatementUser[]; cancelHref: string }) {
  const router = useRouter();
  const [b, setB] = useState(basis || "standard");
  const [wording, setWording] = useState(customWording);
  const [rows, setRows] = useState<StatementUser[]>(users);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const setRow = (i: number, patch: Partial<StatementUser>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  // Round 21 (QuickBooks Online's Save and close): "Save changes", Discard, and a question before leaving.
  const dirty = b !== (basis || "standard") || wording !== customWording || JSON.stringify(rows) !== JSON.stringify(users);
  const discard = () => { setB(basis || "standard"); setWording(customWording); setRows(users); setError(""); };
  useUnsavedGuard(dirty, { discard, save: (to) => { save(to); return false; } });
  function save(to?: string) {
    setError("");
    start(async () => {
      const r = await saveClientStatements(id, { basis: b, custom_basis_wording: wording, users: rows });
      if (!r.ok) { setError(r.error); return; }
      router.push(to ?? `/clients/${id}?msg=statements`);
      router.refresh();
    });
  }

  return (
    <Card>
      <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); save(); }}>
        <h2 className="font-semibold">Financial statements</h2>
        <Labelled id="fs_basis" label="Basis of accounting">
          <SelectIn id="fs_basis" value={b} onValue={setB}>
            <option value="standard">Concept standard (cash basis with selected accruals)</option>
            <option value="cash">Cash basis</option>
            <option value="custom">Custom</option>
          </SelectIn>
        </Labelled>
        {b === "custom" && (
          <Labelled id="fs_custom" label="Custom basis: the agreement and what it requires">
            <textarea id="fs_custom" value={wording} onChange={(e) => setWording(e.target.value)} className="min-h-24 w-full rounded-lg border border-sand-300 bg-surface px-3 py-2 text-[15px]" />
          </Labelled>
        )}

        <fieldset className="grid gap-3">
          <legend className="mb-1.5 text-sm font-medium text-ink">Users of the statements</legend>
          <Hint>Management always uses the statements. List anyone else who gets them, such as a lender. Up to {MAX}.</Hint>
          {rows.length === 0 && <p className="text-sm text-ink-3">No other users.</p>}
          {rows.map((u, i) => (
            <div key={i} className="grid gap-2 rounded-lg border border-sand-200 p-3 sm:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <Labelled id={`fs_kind_${i}`} label="Kind">
                <SelectIn id={`fs_kind_${i}`} value={u.kind} onValue={(v) => setRow(i, { kind: v === "lender" ? "lender" : "other" })}>
                  <option value="lender">A lender</option><option value="other">Other</option>
                </SelectIn>
              </Labelled>
              <Labelled id={`fs_name_${i}`} label="Name">
                <TextIn id={`fs_name_${i}`} value={u.name} maxLength={120} onValue={(v) => setRow(i, { name: v })} />
              </Labelled>
              <Labelled id={`fs_need_${i}`} label="Basis needed">
                <SelectIn id={`fs_need_${i}`} value={u.basis_needed} onValue={(v) => setRow(i, { basis_needed: v })}>
                  <option value="">Not set</option>{THIRD_PARTY_BASIS.map((x) => <option key={x}>{x}</option>)}
                </SelectIn>
              </Labelled>
              <button type="button" onClick={() => setRows((r) => r.filter((_, j) => j !== i))} className={buttonClass("ghost", "md")} aria-label={`Remove user ${i + 1}`}>Remove</button>
            </div>
          ))}
          {rows.length < MAX && (
            <div><button type="button" onClick={() => setRows((r) => [...r, { kind: "lender", name: "", basis_needed: "" }])} className={buttonClass("secondary", "sm")}>Add a user</button></div>
          )}
        </fieldset>

        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" loading={pending}>{dirty ? "Save changes" : "Save"}</Button>
          <DiscardButton dirty={dirty} onDiscard={discard} />
          <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>
        </div>
      </form>
    </Card>
  );
}
