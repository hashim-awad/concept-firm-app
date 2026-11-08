"use client";
// Proposal screen. Same fields, ids and rules as Studio's Proposal screen (EL v3.31).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState, type ReactNode } from "react";
import { Proposal, type StudioClientRow } from "@/lib/studio/controllers";
import { proposalScreen } from "@/lib/studio/screen";
import { Button } from "@/components/ds/primitives";
import { ChecksPanel, Hint, Labelled, ModeSwitch, Panel, Paper, PROVINCES, Row, SelectIn, Stepper, StudioLayout, TextIn, makeEngine, useController, type ScreenEnv } from "./kit";
import { DocumentActions, type DocumentHandlers } from "./document-actions";

export function ProposalScreen({ env, clients, isOwner, handlers, initial, today, recent }: {
  env: ScreenEnv; clients: StudioClientRow[]; isOwner: boolean; handlers?: DocumentHandlers;
  initial?: { f: Record<string, string>; opts: any[]; rec: number; clientId?: string; documentId?: string }; today?: string; recent?: ReactNode;
}) {
  const [box] = useState(() => makeEngine(env));
  const [ctl, act] = useController(() => {
    const c = new Proposal(box.e, today);
    if (initial) { Object.assign(c.f, initial.f); c.e.__set("POPTS", JSON.parse(JSON.stringify(initial.opts))); c.e.__set("pRec", initial.rec); }
    return c;
  });
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const e = ctl.e, f = ctl.f;
  const s = ctl.state();
  const scr = proposalScreen(e, s, { client: null, loaded: env.loaded, isOwner, acks: {} });
  const html = e.pHtml(s);

  useEffect(() => {
    if (!handlers) (window as any).__studioScreen = () => { const st = ctl.state(); return JSON.parse(JSON.stringify({ s: st, checks: proposalScreen(e, st, { client: null, loaded: env.loaded, isOwner, acks: {} }).checks, blocks: e.pBuild(st), pdf: e.pPdf(st), html: e.pHtml(st) })); };
  });

  const txt = (k: string, extra?: object) => <TextIn id={"p_" + k} value={f[k] ?? ""} onValue={(v) => act((c) => c.set(k, v))} {...extra} />;
  const seg = f.segment;
  const floorsFor = (env.floors as any[]).filter((x) => (seg === "Other" ? false : x["Segment"] === seg));
  const opts = ctl.opts, rec = ctl.rec;
  const v = (k: string) => e.trim(f[k] ?? "");

  const optionsBody = (
    <div id="p_opts" className="grid gap-4">
      {opts.map((o, i) => (
        <section key={i} className={"rounded-[var(--radius-ds)] border bg-surface p-4 shadow-[var(--shadow-card)] " + (i === rec && opts.length > 1 ? "border-lime-500 ring-1 ring-lime-500" : "border-sand-200")}>
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <Labelled id={"po_name" + i} label="Option name">
              <TextIn id={"po_name" + i} data-o={i} data-f="name" value={o.name} onValue={(x) => act((c) => c.setOption(i, "name", x))} />
            </Labelled>
            {opts.length > 1 && (
              <label className="mb-2.5 flex items-center gap-2 text-sm">
                <input type="radio" name="prec" value={i} checked={i === rec} onChange={() => act((c) => c.setRecommended(i))} className="h-4 w-4 accent-navy-700" /> Recommended
              </label>
            )}
          </div>
          {seg !== "Other" && (
            <div className="mt-3">
              <Labelled id={"po_offer" + i} label="Price book">
                <SelectIn id={"po_offer" + i} data-o={i} data-f="offer" value={o.offer} disabled={!env.floorsOk} onValue={(x) => act((c) => c.setOption(i, "offer", x))}>
                  <option value="">{env.floorsOk ? "Price book offer (for the floor check)" : "Price book (Hashim only)"}</option>
                  {floorsFor.map((r) => <option key={r["Offer"]} value={r["Offer"]}>{r["Offer"]}</option>)}
                </SelectIn>
              </Labelled>
            </div>
          )}
          <p className="mt-3 mb-1 text-[13px] text-ink-3">Services</p>
          <div className="grid gap-1.5">
            {(e.PSVC as [string, string][]).map(([k, label]) => (
              <label key={k} className="flex cursor-pointer items-start gap-2.5 text-sm">
                <input type="checkbox" data-o={i} data-s={k} checked={!!o.svc[k]} onChange={(ev) => act((c) => c.setService(i, k, ev.target.checked))} className="mt-0.5 h-4 w-4 rounded accent-navy-700" />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <p className="mt-3 mb-1 text-[13px] text-ink-3">Fees</p>
          <div className="grid gap-1.5">
            {o.lines.map((l: any, j: number) => (
              <div key={j} className="grid grid-cols-[2fr_1.2fr_1fr_auto] items-center gap-1.5">
                <TextIn data-o={i} data-l={j} data-f="svc" aria-label="Fee description" id={`pl_${i}_${j}_svc`} value={l.svc} onValue={(x) => act((c) => c.setLine(i, j, "svc", x))} />
                <SelectIn data-o={i} data-l={j} data-f="kind" aria-label="Fee type" value={l.kind} onValue={(x) => act((c) => c.setLine(i, j, "kind", x))}>
                  {(e.PKIND as [string, string][]).map(([k, lab]) => <option key={k} value={k}>{lab}</option>)}
                </SelectIn>
                <TextIn data-o={i} data-l={j} data-f="amt" aria-label="Amount" placeholder="Amount" id={`pl_${i}_${j}_amt`} value={l.amt} onValue={(x) => act((c) => c.setLine(i, j, "amt", x))} />
                <button type="button" data-ldel={`${i}:${j}`} onClick={() => act((c) => c.removeLine(i, j))} className="text-[13px] text-navy-700 underline">Remove</button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[13px]">
            <button type="button" data-ladd={i} onClick={() => act((c) => c.addLine(i))} className="text-navy-700 underline">Add fee line</button>
            <span className="text-ink-3">Annual value: <b className="text-ink">{e.money(e.pTotals(o).annual)}</b></span>
            {opts.length > 1 && <button type="button" data-odel={i} onClick={() => act((c) => c.removeOption(i))} className="text-navy-700 underline">Remove option</button>}
          </div>
        </section>
      ))}
      {opts.length < 3 && f.format === "options" && <Button id="p_addopt" type="button" variant="secondary" onClick={() => act((c) => c.addOption())}>Add an option</Button>}
    </div>
  );

  const steps = [
    { label: "Prospect", done: !!(v("name") && v("contact") && v("salutation")), body: (
      <Panel title="Prospect">
        <Labelled id="p_client" label="Client record (optional)">
          <SelectIn id="p_client" value={clientId} onValue={(id) => { setClientId(id); act((c) => c.applyClient(clients.find((x) => x.url === id) ?? null)); }}>
            <option value="">New prospect (type details below)</option>
            {clients.map((c) => <option key={c.url} value={c.url}>{c["Legal name"]}</option>)}
          </SelectIn>
        </Labelled>
        <Labelled id="p_name" label="Company or prospect name">{txt("name")}</Labelled>
        <Row>
          <Labelled id="p_contact" label="Contact name">{txt("contact", { onBlur: () => act((c) => c.contactBlur()) })}</Labelled>
          <Labelled id="p_salutation" label="Salutation (Dear ...)">{txt("salutation")}</Labelled>
        </Row>
        <Row>
          <Labelled id="p_province" label="Province">
            <SelectIn id="p_province" value={f.province} onValue={(x) => act((c) => c.set("province", x))}>{PROVINCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectIn>
          </Labelled>
          <Labelled id="p_segment" label="Client type">
            <SelectIn id="p_segment" value={f.segment} onValue={(x) => act((c) => c.set("segment", x))}>{["Team or brokerage", "Agent", "Other"].map((x) => <option key={x} value={x}>{x}</option>)}</SelectIn>
          </Labelled>
        </Row>
        <Labelled id="p_format" label="Proposal format">
          <SelectIn id="p_format" value={f.format} onValue={(x) => act((c) => c.set("format", x))}>
            <option value="single">Single price (one package)</option>
            <option value="options">Options (two or three packages)</option>
          </SelectIn>
        </Labelled>
        <Hint>Set automatically from client type: agents get a single price, teams get options. You can change it.</Hint>
        <Row>
          <Labelled id="p_date" label="Proposal date">
            <input id="p_date" type="date" value={f.date} onChange={(ev) => act((c) => c.set("date", ev.target.value))} className="h-10 w-full rounded-lg border border-sand-300 bg-surface px-3 text-[15px]" />
          </Labelled>
          <Labelled id="p_valid" label="Valid for (days)">{txt("valid", { inputMode: "numeric" })}</Labelled>
        </Row>
      </Panel>
    ) },
    { label: "What we heard", done: !!v("h0"), body: (
      <Panel title="What we heard">
        <Hint>Up to three lines from the discovery call: their situation and what they want fixed.</Hint>
        {["h0", "h1", "h2"].map((k, i) => <TextIn key={k} id={"p_" + k} aria-label={"What we heard, line " + (i + 1)} value={f[k] ?? ""} onValue={(x) => act((c) => c.set(k, x))} />)}
      </Panel>
    ) },
    { label: "Options", done: opts.length > 0 && opts.every((o) => o.lines.some((l: any) => e.feeVal(l.amt).k === "num")), body: optionsBody },
    { label: "Recent proposals", body: <Panel title="Recent proposals">{recent ?? <Hint>Saved proposals appear here.</Hint>}</Panel> },
  ];

  return (
    <StudioLayout
      form={<Stepper steps={steps} lastNote="Last step. Review the proposal, then download." />}
      side={
        <div className="grid gap-4">
          <Panel className="xl:sticky xl:top-4 xl:z-10">
            <ChecksPanel id="p_checks" list={scr.checks} />
            <ModeSwitch name="pmode" mode={ctl.mode} onMode={(m) => act((c) => c.setMode(m))} />
            <DocumentActions kind="proposal" handlers={handlers} ok={scr.ok} message={scr.message} mode={ctl.mode} showSaveClient={false}
              snapshot={() => ({ f: { ...ctl.f }, opts: JSON.parse(JSON.stringify(ctl.opts)), rec: ctl.rec, mode: ctl.mode })}
              clientId={clientId} initialDocumentId={initial?.documentId} onClientSaved={() => {}} />
          </Panel>
          <Paper id="p_paper" html={html} draft={ctl.mode !== "final"} />
        </div>
      }
    />
  );
}
