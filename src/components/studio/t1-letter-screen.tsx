"use client";
// Personal Tax Letter (T1) screen. Same fields, ids and rules as Studio's T1 screen (EL v3.31).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { NameCheck } from "./name-check";
import { useEffect, useState } from "react";
import { T1Letter, type StudioClientRow } from "@/lib/studio/controllers";
import { t1Screen, type Check } from "@/lib/studio/screen";
import { ChecksPanel, Hint, Labelled, ModeSwitch, Panel, Paper, PROVINCES, Row, SelectIn, Stepper, StudioLayout, TextIn, Tick, makeEngine, useController, type ScreenEnv } from "./kit";
import { DocumentActions, type DocumentHandlers } from "./document-actions";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export function T1LetterScreen({ env, clients, isOwner, handlers, initial, startClientId, today }: {
  env: ScreenEnv; clients: StudioClientRow[]; isOwner: boolean; handlers?: DocumentHandlers;
  initial?: { f: Record<string, any>; clientId?: string; documentId?: string }; today?: string; startClientId?: string;
}) {
  const [box] = useState(() => makeEngine(env));
  const [ctl, act] = useController(() => { const c = new T1Letter(box.e, today); if (initial) Object.assign(c.f, initial.f); else if (startClientId) c.applyClient(clients.find((x) => x.url === startClientId) ?? null); return c; });
  const [clientId, setClientId] = useState(initial?.clientId ?? startClientId ?? "");
  const e = ctl.e, f = ctl.f;
  const client = clients.find((c) => c.url === clientId) ?? null;
  const out = ctl.output();
  const s = out.s;
  const standalone = s.card === "standalone";
  const scr = standalone
    ? { checks: [{ lvl: "ok", msg: "Master wording. Sent from TaxDome; nothing to issue here." }] as Check[], ok: false, message: "Standalone T1 letters are sent from TaxDome.", showSaveClient: false }
    : t1Screen(e, s, { client, loaded: env.loaded, isOwner, acks: ctl.acks });
  const html = standalone ? out.masterHtml : e.t1Html(s);

  useEffect(() => {
    if (!handlers) (window as any).__studioScreen = () => { const o = ctl.output(); const st = o.s; return JSON.parse(JSON.stringify({ s: st, checks: st.card === "standalone" ? [] : t1Screen(e, st, { client: null, loaded: env.loaded, isOwner, acks: ctl.acks }).checks, blocks: o.blocks, pdf: st.card === "standalone" ? null : e.pdfDoc(st, o.blocks, env.images.LH), fileName: o.fileName, html: st.card === "standalone" ? o.masterHtml : e.t1Html(st) })); };
  });

  const str = (k: string) => String(f[k] ?? "");
  const txt = (k: string, extra?: object) => <TextIn id={"t1_" + k} value={str(k)} onValue={(v) => act((c) => c.set(k, v))} {...extra} />;
  const REL = e.T1_REL as string[];

  const steps = [
    { label: "Type", body: (
      <Panel title="Letter type">
        <div className="grid gap-2.5 sm:grid-cols-2">
          {([["company", "Company client", "Owner of a monthly or year-end client. Fee included in the company’s letter."], ["standalone", "Standalone T1", "Sent from TaxDome. View the approved master wording."]] as const).map(([k, title, sub]) => (
            <button key={k} type="button" data-card={k} onClick={() => act((c) => c.set("card", k))} aria-pressed={s.card === k}
              className={cx("t1card rounded-xl border bg-surface p-3 text-left", s.card === k ? "border-navy-700 ring-2 ring-navy-700/20" : "border-sand-300 hover:border-ink-3")}>
              <span className="block font-semibold">{title}</span>
              <span className="block text-[13px] text-ink-3">{sub}</span>
            </button>
          ))}
        </div>
      </Panel>
    ) },
    { label: "Client", body: (
      <Panel title="Client">
        <Labelled id="t1_client" label="Client record">
          <SelectIn id="t1_client" value={clientId} onValue={(id) => { setClientId(id); act((c) => c.applyClient(clients.find((x) => x.url === id) ?? null)); }}>
            <option value="">New individual (type details below)</option>
            {clients.map((c) => <option key={c.url} value={c.url}>{c["Legal name"]}{c["Name verified"] === "__YES__" ? "" : "  (name not verified)"}</option>)}
          </SelectIn>
        </Labelled>
        <NameCheck client={client} enabled={!!handlers} person />
      </Panel>
    ) },
    { label: "People", body: (
      <Panel title="People">
        {[0, 1, 2, 3].map((i) => (
          <Row key={i}>
            <Labelled id={"t1_name" + i} label={i ? "Person " + (i + 1) + " (optional)" : "Primary taxpayer"}>
              {txt("name" + i, i === 0 ? { onBlur: () => act((c) => c.name0Blur()) } : undefined)}
            </Labelled>
            <Labelled id={"t1_rel" + i} label="Relationship">
              <SelectIn id={"t1_rel" + i} value={str("rel" + i)} onValue={(v) => act((c) => c.set("rel" + i, v))}>{REL.map((r) => <option key={r} value={r}>{r}</option>)}</SelectIn>
            </Labelled>
          </Row>
        ))}
        <Tick id="t1_spouseBlank" checked={!!f.spouseBlank} onValue={(v) => act((c) => c.set("spouseBlank", v))}>Add the spouse without a name (they write it when signing)</Tick>
        <Hint>Everyone listed signs the letter.</Hint>
      </Panel>
    ) },
    { label: "Letter", body: (
      <Panel title="Letter">
        <Row>
          <Labelled id="t1_letterDate" label="Letter date">
            <input id="t1_letterDate" type="date" value={str("letterDate")} onChange={(ev) => act((c) => c.set("letterDate", ev.target.value))} className="h-10 w-full rounded-lg border border-sand-300 bg-surface px-3 text-[15px]" />
          </Labelled>
          <Labelled id="t1_taxYear" label="Tax year">{txt("taxYear", { inputMode: "numeric" })}</Labelled>
        </Row>
        <Labelled id="t1_salutation" label="Salutation (Dear ...)">{txt("salutation")}</Labelled>
        <Labelled id="t1_addr1" label="Street address">{txt("addr1")}</Labelled>
        <Labelled id="t1_addr2" label="Address line 2 (optional)">{txt("addr2")}</Labelled>
        <Row>
          <Labelled id="t1_city" label="City">{txt("city")}</Labelled>
          <Labelled id="t1_postal" label="Postal code">{txt("postal")}</Labelled>
        </Row>
        <Labelled id="t1_province" label="Province of residence">
          <SelectIn id="t1_province" value={str("province")} onValue={(v) => act((c) => c.set("province", v))}>{PROVINCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectIn>
        </Labelled>
      </Panel>
    ) },
    { label: "Fees", body: (
      <Panel title="Fees">
        <div className={standalone ? "hidden" : "grid gap-1"}>
          <Labelled id="t1_corp" label="Company whose engagement letter includes these returns">{txt("corp")}</Labelled>
          <Hint>The letter shows the T1 fee as Included.</Hint>
        </div>
        <div className={standalone ? "grid gap-2" : "hidden"}>
          <Hint>Standalone T1 letters are sent from TaxDome, not issued here. The letter preview shows the approved master wording. To update TaxDome after a wording change, copy the text below into the template.</Hint>
          <textarea id="t1_tdText" readOnly value={standalone ? out.masterText : ""} className="h-56 w-full rounded-lg border border-sand-300 bg-sand-50 p-2 text-xs" />
        </div>
      </Panel>
    ) },
  ];

  return (
    <StudioLayout
      form={<Stepper steps={steps} lastNote="Last step. Review the letter, then download." />}
      controls={
          <Panel>
            <ChecksPanel id="t1_checks" list={scr.checks} />
            {scr.checks.filter((x) => x.key).map((x) => (
              <Tick key={x.key} checked={!!ctl.acks[x.key!]} onValue={(on) => act((c) => { c.acks[x.key!] = on; })} data-t1ack={x.key}>Registration position confirmed in writing (required for Final)</Tick>
            ))}
            <ModeSwitch name="t1mode" mode={ctl.mode} onMode={(m) => act((c) => c.setMode(m))} />
            <Tick id="t1_reviewed" checked={!!f.reviewed} onValue={(v) => act((c) => c.set("reviewed", v))} hidden={ctl.mode !== "final"}>I am Hashim Awad and I have reviewed this letter.</Tick>
            <DocumentActions wordingId={env.wording?.id} kind="t1_letter" handlers={standalone ? undefined : handlers} disabledNote={standalone ? scr.message : undefined}
              ok={scr.ok} message={scr.message} mode={ctl.mode} showSaveClient={scr.showSaveClient}
              snapshot={() => ({ f: { ...ctl.f }, mode: ctl.mode, acks: { ...ctl.acks } })}
              clientId={clientId} initialDocumentId={initial?.documentId} onClientSaved={(id) => setClientId(id)} />
          </Panel>
      }
      preview={<Paper id="t1_paper" html={html} draft={!standalone && ctl.mode !== "final"} />}
    />
  );
}
