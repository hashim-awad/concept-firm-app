"use client";
// Studio's client editor: same fields and checks. The registry check must be re-ticked after
// the legal name changes.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert, Button, Card } from "@/components/ds/primitives";
import { Hint, Labelled, Row, SelectIn, TextIn, Tick } from "@/components/studio/kit";
import { clientErrors, ENTITY_TYPES, THIRD_PARTY_BASIS, type ClientForm } from "@/lib/clients";
import { saveClientRecord } from "./actions";

export function ClientEditor({ id, initial, verifiedOn, editable }: { id: string | null; initial: ClientForm; verifiedOn: string; editable: boolean }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [reticked, setReticked] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  const set = <K extends keyof ClientForm>(k: K, v: ClientForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const errors = clientErrors(f, { wasVerified: initial.name_verified, oldName: initial.legal_name, retickedAfterChange: reticked });
  const person = f.kind === "individual";
  const txt = (k: keyof ClientForm, label: string) => (
    <Labelled id={"cl_" + k} label={label}><TextIn id={"cl_" + k} value={String(f[k])} onValue={(v) => set(k, v as never)} disabled={!editable} /></Labelled>
  );

  function save() {
    start(async () => {
      const r = await saveClientRecord(id, f, initial.name_verified, initial.legal_name, reticked);
      if (!r.ok) { setMsg(r.error); return; }
      setMsg("Saved.");
      router.push(`/clients/${r.id}?msg=saved`);
      router.refresh();
    });
  }

  return (
    <Card>
      <form className="grid gap-4" onSubmit={(ev) => { ev.preventDefault(); if (!errors.length) save(); }}>
        <p className="text-sm text-ink-2">Changes here update the client record. Next year&rsquo;s letters use them.</p>
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
            <SelectIn id="cl_status" value={f.status} onValue={(v) => set("status", v)} disabled={!editable}><option value="active">Active</option><option value="inactive">Inactive</option></SelectIn>
          </Labelled>
        </Row>
        {!person && (
          <>
            <Labelled id="cl_basis" label="Basis of accounting">
              <SelectIn id="cl_basis" value={f.basis} onValue={(v) => set("basis", v)} disabled={!editable}>
                <option value="standard">Concept standard</option><option value="cash">Cash basis</option><option value="custom">Custom</option>
              </SelectIn>
            </Labelled>
            <Hint>Concept standard = cash basis with selected accruals. Custom = contractually prescribed basis.</Hint>
            <Labelled id="cl_custom" label="Contractually prescribed basis: agreement and what it requires">
              <textarea id="cl_custom" value={f.custom_basis_wording} onChange={(e) => set("custom_basis_wording", e.target.value)} disabled={!editable} className="min-h-20 w-full rounded-lg border border-sand-300 bg-surface px-3 py-2 text-[15px]" />
            </Labelled>
            <Row>
              {txt("third_party_user", "Third-party user (blank if none)")}
              <Labelled id="cl_tpb" label="Third-party basis">
                <SelectIn id="cl_tpb" value={f.third_party_basis} onValue={(v) => set("third_party_basis", v)} disabled={!editable}>
                  <option value="">Not set</option>{THIRD_PARTY_BASIS.map((x) => <option key={x}>{x}</option>)}
                </SelectIn>
              </Labelled>
            </Row>
          </>
        )}
        <Tick id="cl_verified" checked={f.name_verified} disabled={!editable} onValue={(v) => { setReticked(true); set("name_verified", v); }}>
          {person ? "I checked the name against government ID or CRA records, letter for letter" : "I checked the legal name against the corporate registry, letter for letter"}
          {initial.name_verified && verifiedOn ? ` (verified ${verifiedOn})` : ""}
        </Tick>
        <Labelled id="cl_notes" label="Notes">
          <textarea id="cl_notes" value={f.notes} onChange={(e) => set("notes", e.target.value)} disabled={!editable} className="min-h-20 w-full rounded-lg border border-sand-300 bg-surface px-3 py-2 text-[15px]" />
        </Labelled>
        {errors.length > 0 && <Alert tone="danger">{errors.map((x) => <p key={x}>Fix: {x}</p>)}</Alert>}
        {msg && <p role="status" className="text-sm text-ink-2">{msg}</p>}
        {editable && <div><Button type="submit" disabled={errors.length > 0} loading={pending}>Save</Button></div>}
      </form>
    </Card>
  );
}
