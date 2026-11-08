"use client";
// Corporate Letter screen. Same fields, ids, defaults and rules as Studio's Corporate Letter
// (EL v3.31); the letter, checks and PDF come from Studio's own engine code.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from "react";
import { CorporateLetter, type StudioClientRow } from "@/lib/studio/controllers";
import { corporateScreen } from "@/lib/studio/screen";
import { Button } from "@/components/ds/primitives";
import {
  ChecksPanel, Hint, Labelled, ModeSwitch, Panel, Paper, PROVINCES, Row, SelectIn, Stepper, StudioLayout, TextIn, Tick,
  makeEngine, useController, type ScreenEnv,
} from "./kit";
import { DocumentActions, type DocumentHandlers } from "./document-actions";

const KINDS: [string, string][] = [["month", "Monthly"], ["quarter", "Quarterly"], ["year", "Each year end"], ["once", "One-time"]];

export function CorporateLetterScreen({ env, clients, isOwner, handlers, initial, today }: {
  env: ScreenEnv; clients: StudioClientRow[]; isOwner: boolean; handlers?: DocumentHandlers;
  initial?: { f: Record<string, any>; fees: any[]; clientId?: string; documentId?: string }; today?: string;
}) {
  const [box] = useState(() => makeEngine(env));
  const [ctl, act] = useController(() => {
    const c = new CorporateLetter(box.e, today);
    if (initial) c.load(initial.f, initial.fees);
    return c;
  });
  const [clientId, setClientId] = useState(initial?.clientId ?? "");
  const [pkg, setPkg] = useState("");
  const [addSel, setAddSel] = useState("0");
  const e = ctl.e, f = ctl.f;
  const client = clients.find((c) => c.url === clientId) ?? null;

  const s = ctl.state();
  const T = e.TYPES[s.type];
  const scr = corporateScreen(e, s, { client, loaded: env.loaded, isOwner, acks: ctl.acks });
  e.render(s);
  const html = box.paper.innerHTML;

  // Payment hints (Studio refresh()).
  const PI = e.payInfo(s);
  const fi = e.firstInvoice(s);
  const payHint = PI.method === "pad" ? "The PAD covers every invoice in this letter, including year-end fees."
    : PI.method === "td" ? (PI.signInv ? "No link needed. Send this letter and the invoice together in TaxDome, so the client signs and pays in one step." : "No link needed. Send the invoice from TaxDome when the work is complete.")
    : PI.method === "tdlink" ? (PI.signInv ? "" : "No link needed now. Send the invoice from TaxDome when the work is complete.")
    : PI.signInv ? "Create the first invoice in QBO and paste its Plooto link below." : "No link needed now. Send the Plooto invoice when the work is complete.";
  const ploHint = PI.method === "tdlink" ? "Issue the invoice in TaxDome, then use Copy payment link. The link works only after the invoice is issued."
    : fi.total ? "Create the first invoice in QBO for " + e.money(fi.total) + " plus tax (" + [fi.m ? e.money(fi.m) + " first month" : "", fi.q ? e.money(fi.q) + " first quarter" : "", fi.o ? e.money(fi.o) + " one-time due on signing" : ""].filter((x: string) => x).join(" + ") + "), then paste its Plooto link here. The letter adds the link and a QR code."
    : "Paste the Plooto link from the client’s first invoice. The letter adds the link and a QR code.";
  const hasOnce = s.fees.some((x: any) => x.kind === "once" && e.feeVal(x.amt).k === "num" && !(x.tag === "catchup" && s.catchTBD));
  const hasYear = s.fees.some((x: any) => x.kind === "year" && e.feeVal(x.amt).k === "num");
  const billNote = s.yeOnly ? "Firm policy: year-end-only letters bill 50% when the letter is signed and 50% when the work is complete. Work starts once the deposit is paid."
    : !hasOnce && hasYear ? "Each year end fees are billed when the year-end work is complete. For a single year that will not repeat, set the frequency to One-time to choose when it is billed." : "";
  const packages: any[] = env.floorsOk ? e.pkgOptions() : [];

  // Test builds only: lets the screen parity test read what the screen holds.
  useEffect(() => {
    if (!handlers) (window as any).__studioScreen = () => { const st = ctl.state(); return JSON.parse(JSON.stringify({ s: st, checks: corporateScreen(e, st, { client: null, loaded: env.loaded, isOwner, acks: ctl.acks }).checks, blocks: e.build(st), pdf: e.pdfDoc(st, e.build(st), env.images.LH), fileName: e.fileName(st) })); };
  });

  const str = (k: string) => String(f[k] ?? "");
  const txt = (k: string, extra?: object) => <TextIn id={k} value={str(k)} onValue={(v) => act((c) => c.set(k, v))} {...extra} />;
  const date = (k: string, type = "date") => <input id={k} type={type} value={str(k)} onChange={(ev) => act((c) => c.set(k, ev.target.value))} className="h-10 w-full rounded-lg border border-sand-300 bg-surface px-3 text-[15px]" />;
  const tick = (k: string, label: string, hidden?: boolean) => <Tick id={k} checked={!!f[k]} onValue={(v) => act((c) => c.set(k, v))} hidden={hidden}>{label}</Tick>;

  const v = (k: string) => e.trim(str(k));
  const clientStep = (
    <Panel title="Client details">
      <Labelled id="clientSel" label="Client record">
        <SelectIn id="clientSel" value={clientId} onValue={(id) => { setClientId(id); act((c) => c.applyClient(clients.find((x) => x.url === id) ?? null)); }}>
          <option value="">New client (type details below)</option>
          {clients.map((c) => <option key={c.url} value={c.url}>{c["Legal name"]}{c["Name verified"] === "__YES__" ? "" : "  (name not verified)"}</option>)}
        </SelectIn>
      </Labelled>
      <Labelled id="company" label="Company legal name (exactly as on the registry)">{txt("company")}</Labelled>
      <Row>
        <Labelled id="signer" label="Signing officer">{txt("signer", { onBlur: () => act((c) => c.signerBlur()) })}</Labelled>
        <Labelled id="signerTitle" label="Title">{txt("signerTitle")}</Labelled>
      </Row>
      <Labelled id="salutation" label="Salutation (Dear ...)">{txt("salutation")}</Labelled>
      <Labelled id="addr1" label="Street address">{txt("addr1")}</Labelled>
      <Labelled id="addr2" label="Address line 2 (optional)">{txt("addr2")}</Labelled>
      <Row>
        <Labelled id="city" label="City">{txt("city")}</Labelled>
        <Labelled id="postal" label="Postal code">{txt("postal")}</Labelled>
      </Row>
      <Labelled id="province" label="Province">
        <SelectIn id="province" value={str("province")} onValue={(x) => act((c) => c.set("province", x))}>{PROVINCES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectIn>
      </Labelled>
    </Panel>
  );

  const servicesStep = (
    <Panel title="Engagement">
      {packages.length > 0 && (
        <div className="flex gap-2">
          <SelectIn id="pkgSel" aria-label="Package" value={pkg} onValue={setPkg}>
            <option value="">Choose a package</option>
            {packages.map((r) => { const m = e.pbNum(r["Monthly fee"]), y = e.pbNum(r["Year-end fee"]); return <option key={r.url} value={r.url}>{e.unesc(r["Offer"])}{m ? " · " + e.money(m) + "/month" : ""}{y ? " · " + e.money(y) + " year end" : ""}</option>; })}
          </SelectIn>
          <Button id="pkgApply" type="button" variant="secondary" onClick={() => { const r = packages.find((x) => x.url === pkg); if (r) act((c) => c.applyPackage(r)); }}>Apply</Button>
        </div>
      )}
      <Row>
        <Labelled id="letterDate" label="Letter date">{date("letterDate")}</Labelled>
        <Labelled id="ye" label="Year end">{date("ye")}</Labelled>
      </Row>
      {tick("firstYear", "First year (short or long period)")}
      <Labelled id="periodStart" label="Period start (incorporation date)" hidden={!f.firstYear}>{date("periodStart")}</Labelled>
      <Labelled id="revOf" label="Replaces our letter dated (only for a revised letter)">{date("revOf")}</Labelled>
      <Hint>Leave blank for a new letter. Revise letter in Document History fills this in.</Hint>
      <p className="text-[13px] text-ink-3">Services (tick everything this client is buying)</p>
      {(e.SVC_UI as [string, string][]).map(([k, label]) => (
        <div key={k} className="grid gap-2">
          {tick("svc_" + k, label)}
          {k === "catchup" && (
            <div className={s.svc.catchup ? "ml-6 grid gap-2" : "hidden"}>
              {tick("catchTBD", "Not known yet: charge per month not completed")}
              <Row>
                <Labelled id="catchFrom" label="Catch-up from" hidden={!!s.catchTBD}>{date("catchFrom")}</Labelled>
                <Labelled id="catchTo" label={s.catchTBD ? "Books should be complete up to" : "Catch-up to"}>{date("catchTo")}</Labelled>
              </Row>
            </div>
          )}
          {k === "payroll" && (
            <div className={s.svc.payroll ? "ml-6" : "hidden"}>
              <Labelled id="payrollMode" label="Payroll scope">
                <SelectIn id="payrollMode" value={str("payrollMode")} onValue={(x) => act((c) => c.set("payrollMode", x))}>
                  <option value="full">We run payroll (pay, remittances, T4s, ROEs)</option>
                  <option value="advisory">Client runs payroll; we support</option>
                </SelectIn>
              </Labelled>
            </div>
          )}
          {k === "books" && <div className={s.svc.books ? "ml-6" : "hidden"}>{tick("pnl", "Include a monthly profit and loss report")}</div>}
          {k === "coord" && <div className={s.svc.coord ? "ml-6" : "hidden"}><Labelled id="extAcct" label="External accountant (optional)">{txt("extAcct")}</Labelled></div>}
          {k === "t1" && (
            <div className={s.svc.t1 ? "ml-6 grid gap-1" : "hidden"}>
              <Labelled id="t1Owner" label="Name(s) as they should read, e.g. Jordan Sample and their spouse">{txt("t1Owner")}</Labelled>
              <Hint>Issue the owner&rsquo;s Personal Tax Letter (T1) too, with its fee set to Included.</Hint>
            </div>
          )}
        </div>
      ))}
      <div className={T.comp ? "mt-2 grid gap-3 border-t border-sand-200 pt-3" : "hidden"}>
        <h4 className="text-[13.5px] font-semibold text-navy-800">Compilation details</h4>
        <Labelled id="basis" label="Basis of accounting">
          <SelectIn id="basis" value={str("basis")} onValue={(x) => act((c) => c.set("basis", x))}>
            <option value="standard">Cash basis with selected accruals (matches FS Note 1)</option>
            <option value="cash">Cash basis</option>
            <option value="custom">Contractually prescribed basis</option>
          </SelectIn>
        </Labelled>
        <Labelled id="basisCustom" label="Agreement that sets the basis, and what it requires" hidden={s.basis !== "custom"}>
          <textarea id="basisCustom" value={str("basisCustom")} onChange={(ev) => act((c) => c.set("basisCustom", ev.target.value))} placeholder="e.g. the loan agreement with RBC Royal Bank dated March 1, 2026, which requires the cash basis with accrued interest" className="min-h-20 w-full rounded-lg border border-sand-300 bg-surface px-3 py-2 text-[15px]" />
        </Labelled>
      </div>
    </Panel>
  );

  const feesStep = (
    <Panel title="Fees">
      <div id="feeTable" className="grid gap-2">
        {ctl.fees.length ? (
          <div className="hidden grid-cols-[2.2fr_1.2fr_1fr_28px] gap-1.5 text-[11.5px] text-ink-3 sm:grid"><span>Service</span><span>Frequency</span><span>Amount</span><span /></div>
        ) : <p className="text-sm text-ink-3">No fee lines yet.</p>}
        {ctl.fees.map((fee, i) => (
          <div key={i} className="grid gap-1">
            <div className="grid grid-cols-[2.2fr_1.2fr_1fr_28px] items-center gap-1.5">
              <TextIn id={"fs_" + i} aria-label="Service" value={fee.svc} onValue={(x) => act((c) => c.setFee(i, "svc", x))} />
              <SelectIn id={"fk_" + i} aria-label="Frequency" value={fee.kind} onValue={(x) => act((c) => c.setFee(i, "kind", x))}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</SelectIn>
              <TextIn id={"fa_" + i} aria-label="Amount" placeholder="$ or Included" value={fee.amt} onValue={(x) => act((c) => c.setFee(i, "amt", x))} />
              <button type="button" data-del={i} title="Remove line" aria-label="Remove line" onClick={() => act((c) => c.removeFee(i))} className="text-lg text-ink-3 hover:text-danger">&times;</button>
            </div>
            <TextIn id={"fd_" + i} aria-label="Detail" placeholder="Detail line (optional)" value={fee.detail} onValue={(x) => act((c) => c.setFee(i, "detail", x))} className="!h-8 text-[13px]" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_auto] items-end gap-2">
        <Labelled id="feeAddSel" label="Add a line">
          <SelectIn id="feeAddSel" value={addSel} onValue={setAddSel}>{(e.FEE_PRESETS as [string][]).map((x, i) => <option key={i} value={String(i)}>{x[0]}</option>)}</SelectIn>
        </Labelled>
        <Button id="feeAddBtn" type="button" variant="secondary" onClick={() => act((c) => c.addFee(Number(addSel)))}>Add line</Button>
      </div>
      <Labelled id="billOnce" label="One-time fees are billed" hidden={!hasOnce}>
        <SelectIn id="billOnce" value={str("billOnce")} disabled={!!s.yeOnly} onValue={(x) => act((c) => c.set("billOnce", x))}>
          <option value="sign">When the letter is signed</option>
          <option value="split">50% on signing, 50% on completion</option>
          <option value="complete">When the work is complete</option>
        </SelectIn>
      </Labelled>
      {billNote && <Hint id="billNote">{billNote}</Hint>}
      <Labelled id="startMonth" label="Monthly billing starts" hidden={!s.fees.some((x: any) => x.kind === "month" || x.kind === "quarter")}>{date("startMonth", "month")}</Labelled>
      <Hint>Amount: a dollar figure, or the word Included. The tax label (HST or GST) follows the client&rsquo;s province.</Hint>
    </Panel>
  );

  const paymentStep = (
    <Panel title="Payment">
      <Labelled id="payMethod" label="Payment method">
        <SelectIn id="payMethod" value={str("payMethod")} onValue={(x) => act((c) => c.set("payMethod", x))}>
          <option value="">{"Set from the fee table (" + e.PAY_LABEL[PI.auto] + ")"}</option>
          {Object.entries(e.PAY_LABEL as Record<string, string>).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </SelectIn>
      </Labelled>
      {payHint && <Hint id="payHint">{payHint}</Hint>}
      <div className={PI.needLink ? "grid gap-1" : "hidden"}>
        <Labelled id="ploLink" label={PI.method === "tdlink" ? "TaxDome payment link" : "Plooto payment link (from the first invoice)"}>{txt("ploLink", { placeholder: "https://..." })}</Labelled>
        <Hint id="ploHint">{ploHint}</Hint>
      </div>
    </Panel>
  );

  const steps = [
    { label: "Client", done: !!(v("company") && v("signer") && v("salutation") && v("addr1") && v("city") && v("postal")), body: clientStep },
    { label: "Services", done: !!(e.parseD(v("ye")) && (e.SVC_UI as [string][]).some(([k]) => f["svc_" + k])), body: servicesStep },
    { label: "Fees", done: ctl.fees.some((x) => e.feeVal(x.amt).k === "num"), body: feesStep },
    { label: "Payment", done: !PI.needLink || /^https:\/\//.test(v("ploLink")), body: paymentStep },
  ];

  return (
    <StudioLayout
      form={<Stepper steps={steps} lastNote="Last step. Review the letter, then download." />}
      side={
        <div className="grid gap-4">
          <Panel className="xl:sticky xl:top-4 xl:z-10">
            <ChecksPanel id="checks" list={scr.checks} />
            {scr.checks.filter((x) => x.key).map((x) => (
              <Tick key={x.key} checked={!!ctl.acks[x.key!]} onValue={(on) => act((c) => { c.acks[x.key!] = on; })} data-ack={x.key}>Registration position confirmed in writing (required for Final)</Tick>
            ))}
            <ModeSwitch name="mode" mode={ctl.mode} onMode={(m) => act((c) => c.setMode(m))} />
            {tick("reviewed", "I am Hashim Awad and I have reviewed this letter.", ctl.mode !== "final")}
            <DocumentActions kind="corporate_letter" handlers={handlers} ok={scr.ok} message={scr.message} mode={ctl.mode}
              showSaveClient={scr.showSaveClient}
              snapshot={() => ({ f: { ...ctl.f }, fees: ctl.fees.map((x) => ({ ...x })), mode: ctl.mode, acks: { ...ctl.acks } })}
              clientId={clientId} initialDocumentId={initial?.documentId} onClientSaved={(id) => setClientId(id)} />
          </Panel>
          <Paper id="paper" html={html} draft={ctl.mode !== "final"} />
        </div>
      }
    />
  );
}
