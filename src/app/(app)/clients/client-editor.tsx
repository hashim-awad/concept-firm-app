"use client";
// Studio's client editor: same fields and checks. The registry check must be re-ticked after
// the legal name changes. Round 18: this is the "Client details" form on the client page; the basis of
// accounting and the users of the statements moved to the Financial statements form.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Alert, Button, Card, buttonClass } from "@/components/ds/primitives";
import { Labelled, Row, SelectIn, TextIn, Tick } from "@/components/studio/kit";
import { clientErrors, ENTITY_TYPES, type ClientForm } from "@/lib/clients";
import { saveClientRecord } from "./actions";
import { DiscardButton, useUnsavedGuard } from "@/components/save-state";

export function ClientEditor({ id, initial, verifiedOn, editable, taxdomeManaged = false, cancelHref }: { id: string | null; initial: ClientForm; verifiedOn: string; editable: boolean; taxdomeManaged?: boolean; cancelHref?: string }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [reticked, setReticked] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof ClientForm>(k: K, v: ClientForm[K]) => setF((x) => ({ ...x, [k]: v }));
  // An existing client's basis is checked by the Financial statements form, not here.
  const errors = clientErrors(id ? { ...f, basis: "standard" } : f, { wasVerified: initial.name_verified, oldName: initial.legal_name, retickedAfterChange: reticked });
  const person = f.kind === "individual";
  const txt = (k: keyof ClientForm, label: string) => (
    <Labelled id={"cl_" + k} label={label}><TextIn id={"cl_" + k} value={String(f[k])} onValue={(v) => set(k, v as never)} disabled={!editable || (taxdomeManaged && (k === "legal_name" || k === "year_end_md"))} /></Labelled>
  );

  // Round 21 (QuickBooks Online's Save and close): "Save changes" while something changed, Discard puts the
  // form back, and leaving with changes asks first. Saving goes back to the client page with the note.
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const discard = () => { setF(initial); setReticked(false); setMsg(""); };
  function save(to?: string) {
    start(async () => {
      const r = await saveClientRecord(id, f, initial.name_verified, initial.legal_name, reticked);
      if (!r.ok) { setMsg(r.error); return; }
      setMsg("Saved.");
      router.push(to ?? `/clients/${r.id}?msg=saved`);
      router.refresh();
    });
  }

  useUnsavedGuard(dirty && editable, { discard, save: (to) => { if (!errors.length) save(to); return false; } });

  return (
    <Card>
      <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); if (!errors.length) save(); }}>
        {id && <h2 className="font-semibold">Client details</h2>}
        <p className="text-sm text-ink-2">Changes here update the client record. Next year&rsquo;s letters use them.</p>
        {taxdomeManaged && <p className="text-xs text-muted">The legal name and year-end come from TaxDome. Change them in TaxDome, then import again.</p>}
        {!id && (
          <Labelled id="cl_kind" label="Client type">
            <SelectIn id="cl_kind" value={f.kind} onValue={(v) => set("kind", v as ClientForm["kind"])}>
              <option value="corporation">Corporation</option><option value="individual">Individual</option>
            </SelectIn>
          </Labelled>
        )}
        {txt("legal_name", person ? "Legal name (exactly as on government ID)" : "Legal name (exactly as on the registry)")}
        <Row>{txt("signing_officer", person ? "Signs as" : "Signing officer")}{txt("signer_title", "Signer title")}</Row>
        <Row>{txt("salutation", "Salutation")}{txt("email", "Email")}</Row>
        {txt("street_address", "Street address")}
        {txt("address_line2", "Address line 2")}
        <Row>{txt("city", "City")}{txt("postal_code", "Postal code")}</Row>
        <Row>
          <Labelled id="cl_province" label="Province">
            <SelectIn id="cl_province" value={f.province} onValue={(v) => set("province", v)} disabled={!editable}>
              {[["ON", "ON"], ["AB", "AB"], ["BC", "BC"], ["OTHER", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </SelectIn>
          </Labelled>
          {txt("year_end_md", "Year end (MM-DD)")}
        </Row>
        <Row>
          {!person ? (
            <Labelled id="cl_entity" label="Entity type">
              <SelectIn id="cl_entity" value={f.entity_type} onValue={(v) => set("entity_type", v)} disabled={!editable}>{ENTITY_TYPES.map((x) => <option key={x}>{x}</option>)}</SelectIn>
            </Labelled>
          ) : <span />}
          <Labelled id="cl_status" label="Status">
            <SelectIn id="cl_status" value={f.status} onValue={(v) => set("status", v)} disabled={!editable}><option value="active">Active</option><option value="waiting_taxdome">Waiting for TaxDome</option><option value="inactive">Inactive</option></SelectIn>
          </Labelled>
        </Row>
        <Tick id="cl_verified" checked={f.name_verified} disabled={!editable} onValue={(v) => { setReticked(true); set("name_verified", v); }}>
          {person ? "I checked the name against government ID or CRA records, letter for letter" : "I checked the legal name against the corporate registry, letter for letter"}
          {initial.name_verified && verifiedOn ? ` (verified ${verifiedOn})` : ""}
        </Tick>
        <Labelled id="cl_notes" label="Notes">
          <textarea id="cl_notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} disabled={!editable} className="min-h-20 w-full rounded-lg border border-sand-300 bg-surface px-3 py-2 text-[15px]" />
        </Labelled>
        {errors.length > 0 && <Alert tone="danger">{errors.map((x) => <p key={x}>Fix: {x}</p>)}</Alert>}
        {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
        {(editable || cancelHref) && (
          <div className="flex flex-wrap gap-2">
            {editable && <Button type="submit" disabled={errors.length > 0} loading={pending}>{dirty ? "Save changes" : "Save"}</Button>}
            {editable && <DiscardButton dirty={dirty} onDiscard={discard} />}
            {cancelHref && <Link href={cancelHref} className={buttonClass("secondary")}>Cancel</Link>}
          </div>
        )}
      </form>
    </Card>
  );
}
