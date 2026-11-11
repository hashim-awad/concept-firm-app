"use client";
// Proposal screen. Same fields, ids and rules as Studio's Proposal screen (EL v3.31).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { LETTER_FIELDS, letterProblems, letterValue, lk, needs, packedOptions, type LetterKey, type ProposalInputs } from "@/lib/proposal/letter";
import { Proposal, type StudioClientRow } from "@/lib/studio/controllers";
import { proposalScreen } from "@/lib/studio/screen";
import { Button } from "@/components/ds/primitives";
import { ChecksPanel, Hint, Labelled, ModeSwitch, Panel, Paper, PROVINCES, Row, SelectIn, Stepper, StudioLayout, TextIn, makeEngine, useController, type ScreenEnv } from "./kit";
import { DocumentActions, type DocumentHandlers } from "./document-actions";

// live: the builder in Quotes (front office batch, section 5). The proposal saves itself as a Draft
// quote, the Letter details step completes each option's engagement letter, and an owner sends it
// for online signing. Without it (the screen parity page) the screen is Studio's, unchanged.
export type ProposalLive = {
  quoteId?: string; leadId?: string;
  save: (input: { quoteId: string | null; clientId: string | null; leadId: string | null; title: string; data: ProposalInputs }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  send: (quoteId: string) => Promise<{ ok: true; href: string } | { ok: false; error: string; problems?: string[] }>;
  remove: (quoteId: string) => Promise<{ ok: boolean; error?: string }>;
};

export function ProposalScreen({ env, clients, isOwner, handlers, initial, startClientId, approvedTax, today, recent, prefill, live }: {
  env: ScreenEnv; clients: StudioClientRow[]; isOwner: boolean; handlers?: DocumentHandlers;
  initial?: { f: Record<string, string>; opts: any[]; rec: number; clientId?: string; documentId?: string }; today?: string; startClientId?: string; approvedTax?: Record<string, string>; recent?: ReactNode;
  prefill?: { f: Record<string, string>; offer: string }; live?: ProposalLive;
}) {
  const [box] = useState(() => makeEngine(env, live ? { P_LINES: true } : {}));
  const [ctl, act] = useController(() => {
    const c = new Proposal(box.e, today, { live: !!live });
    if (initial) { Object.assign(c.f, initial.f); c.e.__set("POPTS", JSON.parse(JSON.stringify(initial.opts))); c.e.__set("pRec", initial.rec); }
    else if (startClientId) c.applyClient(clients.find((x) => x.url === startClientId) ?? null);
    else if (prefill) {
      // The client type first: it sets the format (agents one price, teams options).
      if (prefill.f.segment) c.set("segment", prefill.f.segment);
      for (const [k, v] of Object.entries(prefill.f)) if (k !== "segment") c.set(k, v);
      if (prefill.offer && live) c.applyOffer(0, (env.floors as any[]).find((r) => r["Offer"] === prefill.offer));
      else if (prefill.offer) c.setOption(0, "offer", prefill.offer);
    }
    // In Quotes, a proposal is dated the day it is sent and is valid 21 days (section 3).
    if (live) { c.f.date = today ?? c.f.date; c.f.valid = "21"; }
    return c;
  });
  const [clientId, setClientId] = useState(initial?.clientId ?? startClientId ?? "");
  const e = ctl.e, f = ctl.f;
  const s = ctl.state();
  const scr = proposalScreen(e, s, { client: null, loaded: env.loaded, isOwner, acks: {} });
  const html = e.pHtml(s);

  // ---- Quotes: save as a Draft, Letter details, Send for signing ----
  const router = useRouter();
  const [lbox] = useState(() => makeEngine(env));
  const [quoteId, setQuoteId] = useState(live?.quoteId ?? "");
  const [saveNote, setSaveNote] = useState(live?.quoteId ? "Saved as a draft." : "");
  const [sendNote, setSendNote] = useState<{ error: string; problems?: string[] } | null>(null);
  const [sending, setSending] = useState(false);
  const snap = JSON.stringify({ f, opts: ctl.opts, rec: ctl.rec, clientId });
  const first = useRef(snap);
  const saving = useRef<Promise<unknown> | null>(null);
  useEffect(() => {
    if (!live || snap === first.current) return;
    const t = setTimeout(() => {
      setSaveNote("Saving...");
      const run = async () => {
        const r = await live.save({ quoteId: quoteId || null, clientId: clientId || null, leadId: live.leadId ?? null, title: e.trim(f.name ?? ""), data: { f: { ...ctl.f }, opts: JSON.parse(JSON.stringify(ctl.opts)), rec: ctl.rec } });
        if (r.ok) {
          if (!quoteId) { setQuoteId(r.id); window.history.replaceState(null, "", `/quotes/proposal?quote=${r.id}`); }
          setSaveNote("Saved as a draft.");
        } else setSaveNote(`Not saved: ${r.error}`);
      };
      saving.current = (saving.current ?? Promise.resolve()).then(run, run);
    }, 900);
    return () => clearTimeout(t);
  }, [snap]); // eslint-disable-line react-hooks/exhaustive-deps
  const packed = live ? packedOptions(e, s) : [];
  const need = needs(packed);
  const problems = live ? letterProblems(lbox.e, { f, opts: ctl.opts, rec: ctl.rec }, e, s, f.date) : [];
  const letterOk = problems.every((p) => p.errors.length === 0);
  async function send() {
    if (!live || !quoteId) return;
    setSending(true); setSendNote(null);
    await saving.current;
    const r = await live.send(quoteId);
    setSending(false);
    if (r.ok) router.push(r.href); else setSendNote({ error: r.error, problems: r.problems });
  }
  async function removeDraft() {
    if (!live || !quoteId || !window.confirm("Delete this draft proposal?")) return;
    const r = await live.remove(quoteId);
    if (r.ok) router.push("/quotes?msg=Draft%20deleted."); else setSaveNote(r.error ?? "Could not delete.");
  }
  const lv = (k: LetterKey) => f[lk(k)] ?? "";
  const lset = (k: LetterKey, v: string) => act((c) => { c.f[lk(k)] = v; });
  const ltxt = (k: LetterKey, extra?: object) => <TextIn id={"pl_" + k} value={lv(k)} placeholder={letterValue({ ...f, [lk(k)]: "" }, k)} onValue={(x) => lset(k, x)} {...extra} />;
  const ldate = (k: LetterKey, type = "date") => (
    <input id={"pl_" + k} type={type} value={lv(k)} onChange={(ev) => lset(k, ev.target.value)} className="h-10 w-full rounded-lg border border-sand-300 bg-surface px-3 text-[15px]" />
  );
  const label = (k: LetterKey) => LETTER_FIELDS.find(([x]) => x === k)![1];
  const letterStep = { label: "Letter details", done: letterOk, body: (
    <Panel title="Letter details">
      <Hint>The option the client picks becomes their engagement letter. The letter needs these details. Blank name fields use the Prospect step.</Hint>
      <Labelled id="pl_company" label={label("company")}>{ltxt("company")}</Labelled>
      <Row>
        <Labelled id="pl_signer" label={label("signer")}>{ltxt("signer")}</Labelled>
        <Labelled id="pl_signerTitle" label={label("signerTitle")}>{ltxt("signerTitle", { placeholder: "Director" })}</Labelled>
      </Row>
      <Row>
        <Labelled id="pl_salutation" label={label("salutation")}>{ltxt("salutation")}</Labelled>
        <Labelled id="pl_email" label={label("email")}>{ltxt("email", { type: "email", inputMode: "email" })}</Labelled>
      </Row>
      <Labelled id="pl_addr1" label={label("addr1")}>{ltxt("addr1")}</Labelled>
      <Labelled id="pl_addr2" label={label("addr2")}>{ltxt("addr2")}</Labelled>
      <Row>
        <Labelled id="pl_city" label={label("city")}>{ltxt("city")}</Labelled>
        <Labelled id="pl_postal" label={label("postal")}>{ltxt("postal")}</Labelled>
      </Row>
      <Row>
        <Labelled id="pl_ye" label={label("ye")}>{ldate("ye")}</Labelled>
        <Labelled id="pl_startMonth" label={label("startMonth")}>{ldate("startMonth", "month")}</Labelled>
      </Row>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={lv("firstYear") === "1"} onChange={(ev) => lset("firstYear", ev.target.checked ? "1" : "")} className="h-4 w-4 accent-navy-700" /> {label("firstYear")} (the company&rsquo;s first year with Concept)
      </label>
      {lv("firstYear") === "1" && <Labelled id="pl_periodStart" label={label("periodStart")}>{ldate("periodStart")}</Labelled>}
      {need.catchup && <Row><Labelled id="pl_catchFrom" label={label("catchFrom")}>{ldate("catchFrom")}</Labelled><Labelled id="pl_catchTo" label={label("catchTo")}>{ldate("catchTo")}</Labelled></Row>}
      {need.t1 && <Labelled id="pl_t1Owner" label={label("t1Owner")}>{ltxt("t1Owner")}</Labelled>}
      {problems.map((p) => p.errors.length > 0 && (
        <div key={p.option} className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-[#5C3D00]">
          <p className="font-semibold">{p.option}: the letter still needs</p>
          <ul className="ml-4 list-disc">{p.errors.map((m) => <li key={m}>{m}</li>)}</ul>
        </div>
      ))}
      {letterOk && <p className="text-[13px] text-success">Every option&rsquo;s letter is complete.</p>}
    </Panel>
  ) };

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
              <Labelled id={"po_offer" + i} label={live ? "Package" : "Price book"}>
                <SelectIn id={"po_offer" + i} data-o={i} data-f="offer" value={o.offer} disabled={!env.floorsOk} onValue={(x) => act((c) => (live ? c.applyOffer(i, floorsFor.find((r) => r["Offer"] === x) ?? (x ? { Offer: x } : undefined)) : c.setOption(i, "offer", x)))}>
                  <option value="">{!env.floorsOk ? "Price book (Hashim only)" : live ? "Choose a package: fills its services and prices" : "Price book offer (for the floor check)"}</option>
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
          <div className="@container grid gap-1.5">
            {o.lines.map((l: any, j: number) => (
              <div key={j} className="grid grid-cols-[1.3fr_1fr_auto] items-center gap-1.5 @lg:grid-cols-[2fr_1.2fr_1fr_auto]">
                <TextIn className="col-span-3 @lg:col-span-1" data-o={i} data-l={j} data-f="svc" aria-label="Fee description" id={`pl_${i}_${j}_svc`} value={l.svc} onValue={(x) => act((c) => c.setLine(i, j, "svc", x))} />
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
          <SelectIn id="p_client" value={clientId} onValue={(id) => { setClientId(id); act((c) => {
            const row = clients.find((x) => x.url === id) ?? null;
            c.applyClient(row);
            // Quotes: the client record also fills the Letter details.
            if (live && row) {
              const md = row["Year end (month-day)"];
              Object.assign(c.f, { [lk("company")]: row["Legal name"] ?? "", [lk("signer")]: row["Signing officer"] ?? "", [lk("signerTitle")]: row["Signer title"] ?? "",
                [lk("salutation")]: row["Salutation"] ?? "", [lk("email")]: row["Email"] ?? "", [lk("addr1")]: row["Street address"] ?? "", [lk("addr2")]: row["Address line 2"] ?? "",
                [lk("city")]: row["City"] ?? "", [lk("postal")]: row["Postal code"] ?? "", [lk("ye")]: (md && c.e.lastYE(md, c.f.date)) || "" });
            }
          }); }}>
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
        {live ? <Hint>Dated the day it is sent. Valid for 21 days.</Hint> : <Row>
          <Labelled id="p_date" label="Proposal date">
            <input id="p_date" type="date" value={f.date} onChange={(ev) => act((c) => c.set("date", ev.target.value))} className="h-10 w-full rounded-lg border border-sand-300 bg-surface px-3 text-[15px]" />
          </Labelled>
          <Labelled id="p_valid" label="Valid for (days)">{txt("valid", { inputMode: "numeric" })}</Labelled>
        </Row>}
      </Panel>
    ) },
    { label: "What we heard", done: !!v("h0"), body: (
      <Panel title="What we heard">
        <Hint>Up to three lines from the discovery call: their situation and what they want fixed.</Hint>
        {["h0", "h1", "h2"].map((k, i) => <TextIn key={k} id={"p_" + k} aria-label={"What we heard, line " + (i + 1)} value={f[k] ?? ""} onValue={(x) => act((c) => c.set(k, x))} />)}
      </Panel>
    ) },
    { label: "Options", done: opts.length > 0 && opts.every((o) => o.lines.some((l: any) => e.feeVal(l.amt).k === "num")), body: optionsBody },
    live ? letterStep : { label: "Recent proposals", body: <Panel title="Recent proposals">{recent ?? <Hint>Saved proposals appear here.</Hint>}</Panel> },
  ];

  return (
    <StudioLayout
      form={<Stepper steps={steps} lastNote={live ? "Last step. Check the proposal, then send it for signing." : "Last step. Review the proposal, then download."} />}
      controls={
          <Panel>
            {approvedTax && !approvedTax[f.province] && (
              <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-[#5C3D00]">
                No approved GST/HST rate for {f.province === "OTHER" ? "this province" : f.province}. A Final proposal needs one: an owner approves rates under GST/HST rates. Drafts are fine.
              </p>
            )}
            {approvedTax?.[f.province] && <p className="text-[13px] text-ink-3">Tax on this proposal: {approvedTax[f.province]} (approved rate).</p>}
            <ChecksPanel id="p_checks" list={scr.checks} />
            {live ? (
              <div className="grid gap-3">
                <p className="text-[13px] text-ink-3" role="status">{saveNote || "Not saved yet: it saves as a draft once you start."}</p>
                {isOwner ? (
                  <Button type="button" disabled={!quoteId || !scr.ok || !letterOk || sending} onClick={send}>{sending ? "Sending..." : "Send for signing"}</Button>
                ) : <p className="text-[13px] text-ink-3">Hashim sends proposals. It waits in Quotes as a draft.</p>}
                {(!scr.ok || !letterOk) && <p className="text-[13px] text-ink-3">To send: fix the items above{letterOk ? "" : " and complete Letter details"}.</p>}
                {sendNote && (
                  <div role="alert" className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-[13px] text-danger">
                    <p>{sendNote.error}</p>
                    {sendNote.problems && <ul className="ml-4 list-disc">{sendNote.problems.map((m) => <li key={m}>{m}</li>)}</ul>}
                  </div>
                )}
                <DocumentActions wordingId={env.wording?.id} kind="proposal" handlers={handlers} ok={scr.ok} message={scr.message} mode="draft" showSaveClient={false}
                  snapshot={() => ({ f: { ...ctl.f }, opts: JSON.parse(JSON.stringify(ctl.opts)), rec: ctl.rec, mode: "draft" })}
                  clientId={clientId} initialDocumentId={initial?.documentId} onClientSaved={() => {}} />
                {quoteId && <button type="button" onClick={removeDraft} className="w-fit text-[13px] text-danger underline">Delete this draft</button>}
              </div>
            ) : <>
            <ModeSwitch name="pmode" mode={ctl.mode} onMode={(m) => act((c) => c.setMode(m))} />
            <DocumentActions wordingId={env.wording?.id} kind="proposal" handlers={handlers} ok={scr.ok} message={scr.message} mode={ctl.mode} showSaveClient={false}
              snapshot={() => ({ f: { ...ctl.f }, opts: JSON.parse(JSON.stringify(ctl.opts)), rec: ctl.rec, mode: ctl.mode })}
              clientId={clientId} initialDocumentId={initial?.documentId} onClientSaved={() => {}} />
            </>}
          </Panel>
      }
      preview={<Paper id="p_paper" html={html} draft={ctl.mode !== "final"} />}
    />
  );
}
