// Step 10, "Deliver and lock" (round 12). Benchmark: CaseWare's completion and lockdown (the checklist,
// the documents, the sign-offs, then one lock an owner can lift with a reason); the client email and its
// documents follow Appendix C. Nothing is sent from Closebook.
import { formatDate } from "@/lib/dates";
import type { CloseData } from "@/lib/closebook/close-server";
import { lockFile, recordDelivery, reopenFile, saveCloseFields, saveFilingRecord } from "../close-actions";
import { saveGstFiling } from "../gst-actions";
import { CopyButton } from "@/app/(app)/leads/[id]/quote/copy-button";
import { Checklist, type ChecklistRow } from "./review-step";

const TO_FILL = <span className="ml-2 inline-block whitespace-nowrap rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">To fill</span>;
const label = (text: string, empty: boolean) => <span className="label flex items-center">{text}{empty && TO_FILL}</span>;
const when = (at: string) => `${formatDate(at)} ${new Date(at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}`;
const money = (v: number | null) => (v === null ? "" : Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const kind = (v: number | null) => (v === null ? "" : v > 0 ? "owing" : v < 0 ? "refund" : "nil");
const INST_ROWS = 12;

// Round 15: one card per section, small capitals headings (CaseWare Cloud).
const CARD = "overflow-hidden rounded-[10px] border border-sand-200 bg-white";
const HEAD = "flex flex-wrap items-center gap-2 border-b border-sand-200 px-3.5 py-2.5";
const H = "text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase";

export function CloseStep({ fileId, d, checklist, checklistTrial, editable, isOwner, names }: {
  fileId: string; d: CloseData; checklist: ChecklistRow[]; checklistTrial: boolean; editable: boolean; isOwner: boolean; names: Map<string, string>;
}) {
  const c = d.close, s = d.status, locked = d.locked, open = !!s.mal_signed_at;
  const can = editable && !locked;
  const delivered = !!c.delivered_at;
  const fieldsLocked = !can || delivered;
  const sel = (name: string, value: string, opts: [string, string][], width = "10rem") => (
    <select className="input" name={name} defaultValue={value} style={{ width }}><option value="">Choose</option>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>);
  const taxSum = c.fed_tax !== null && c.prov_tax !== null ? c.fed_tax + c.prov_tax : null;
  return (
    <div className="grid gap-3.5">
      {locked && (
        <p role="status" className="text-[12.5px] text-navy-800"><b>Locked</b> {c.locked_at ? when(c.locked_at) : ""}, {names.get(c.locked_by ?? "") ?? ""}</p>
      )}

      {/* 7. The completion checklist: open once the MAL is signed; 10 and 11 filled by Closebook. */}
      {open ? (
        <Checklist fileId={fileId} checklist={checklist} problems={s.lock.filter((x) => x.startsWith("Checklist: ")).map((x) => x.slice(11))} editable={can}
          back={`/closebook/${fileId}?step=lock`} trial={checklistTrial} auto={[10, 11]} />
      ) : (
        <section aria-label="Completion checklist" className={CARD}>
          <div className={HEAD}><h3 className={H}>Completion checklist</h3><span className="text-[12.5px] text-ink-3">Opens when the MAL is signed</span></div>
        </section>
      )}

      {/* 8. The email's figures, typed from ProFile. */}
      <form action={saveCloseFields} className={CARD} aria-label="Email figures">
        <input type="hidden" name="file_id" value={fileId} />
        <div className={HEAD}><h3 className={H}>Email figures</h3><span className="text-[12.5px] text-ink-3">From ProFile{delivered && " · as sent"}</span></div>
        <fieldset disabled={fieldsLocked} className="grid gap-4 px-3.5 py-3">
          <div className="grid gap-3">
            <p className="font-medium">A. Corporate tax</p>
            <div className="flex flex-wrap items-end gap-3">
              <label>{label("Balance", c.tax_balance === null)}{sel("tax_kind", kind(c.tax_balance), [["owing", "Owing"], ["refund", "Refund"], ["nil", "Nil"]])}</label>
              <label><span className="label">Amount</span><input className="input text-right tabular-nums" style={{ width: "9rem" }} name="tax_amount" defaultValue={money(c.tax_balance)} /></label>
              <label>{label("Due date", !c.tax_due)}<input className="input" style={{ width: "10rem" }} type="date" name="tax_due" defaultValue={c.tax_due ?? ""} /></label>
              <label>{label("Filed", !c.filed_on)}<input className="input" style={{ width: "10rem" }} type="date" name="filed_on" defaultValue={c.filed_on ?? ""} /></label>
              <label>{label("NOA issued", c.noa_issued === null)}{sel("noa_issued", c.noa_issued === null ? "" : c.noa_issued ? "yes" : "no", [["yes", "Yes"], ["no", "No"]], "7rem")}</label>
              <label><span className="label">NOA penalty</span><input className="input text-right tabular-nums" style={{ width: "8rem" }} name="noa_penalty" defaultValue={c.noa_penalty ? money(c.noa_penalty) : ""} /></label>
              <label><span className="label">NOA interest</span><input className="input text-right tabular-nums" style={{ width: "8rem" }} name="noa_interest" defaultValue={c.noa_interest ? money(c.noa_interest) : ""} /></label>
            </div>
          </div>
          {d.gst.fromReturn ? (
            <div className="grid gap-1">
              <p className="font-medium">B. GST/HST <span className="text-xs font-normal text-ink-3">From step 8</span></p>
              {(() => { const r = d.gst.returns.at(-1); if (!r) return <p className="text-sm text-danger">Prepare the GST/HST return in step 8 first.</p>;
                const v = Number(r.lines["113"]) / 100;
                return <p className="text-sm">{r.label}: {v > 0 ? "owing" : v < 0 ? "refund" : "nil"} {money(v)} · due {formatDate(r.due_on)} · {d.pk.data.file.setup && String((d.pk.data.file.setup as Record<string, unknown>).gst_rt ?? "RT0001").replace(/^RT/, "RT ")}</p>; })()}
            </div>
          ) : (
          <div className="grid gap-3">
              <p className="font-medium">B. GST/HST <span className="text-xs font-normal text-ink-3">If filed with this package</span></p>
              <div className="flex flex-wrap items-end gap-3">
                <label><span className="label">Return filed</span>{sel("hst_filed", c.hst_filed ? "yes" : "no", [["no", "No"], ["yes", "Yes"]], "7rem")}</label>
                <label><span className="label">Balance</span>{sel("hst_kind", kind(c.hst_balance), [["owing", "Owing"], ["refund", "Refund"], ["nil", "Nil"]])}</label>
                <label><span className="label">Amount</span><input className="input text-right tabular-nums" style={{ width: "9rem" }} name="hst_amount" defaultValue={money(c.hst_balance)} /></label>
                <label><span className="label">Due date</span><input className="input" style={{ width: "10rem" }} type="date" name="hst_due" defaultValue={c.hst_due ?? ""} /></label>
                <label><span className="label">RT account</span><input className="input" style={{ width: "7rem" }} name="hst_rt" defaultValue={c.hst_rt} /></label>
              </div>
            </div>
          )}
          <div className="grid gap-3">
            <p className="font-medium">C. Instalments</p>
            <div className="flex flex-wrap items-end gap-3">
              <label>{label("Federal tax, year filed", c.fed_tax === null)}<input className="input text-right tabular-nums" style={{ width: "10rem" }} name="fed_tax" defaultValue={money(c.fed_tax)} /></label>
              <label>{label("Provincial tax, year filed", c.prov_tax === null)}<input className="input text-right tabular-nums" style={{ width: "10rem" }} name="prov_tax" defaultValue={money(c.prov_tax)} /></label>
              <label><span className="label">Federal tax, year before</span><input className="input text-right tabular-nums" style={{ width: "10rem" }} name="fed_tax_prior" defaultValue={money(c.fed_tax_prior)} /></label>
              <label><span className="label">Provincial tax, year before</span><input className="input text-right tabular-nums" style={{ width: "10rem" }} name="prov_tax_prior" defaultValue={money(c.prov_tax_prior)} /></label>
            </div>
            {taxSum !== null && d.step8Tax !== null && Math.abs(taxSum - d.step8Tax) > 0.005 && (
              <p className="text-[12.5px] text-danger">Federal plus provincial ({money(taxSum)}) is not step 8&rsquo;s income tax ({money(d.step8Tax)}).</p>)}
            <details open={c.instalments.length > 0}>
              <summary className="cursor-pointer text-[12.5px] text-navy-700 underline">Instalment schedule ({c.instalments.length} {c.instalments.length === 1 ? "date" : "dates"})</summary>
              <div className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: INST_ROWS }, (_, i) => (
                  <div key={i} className="flex items-center gap-2"><span className="w-5 text-right text-xs text-ink-3">{i + 1}</span>
                    <input className="input input-compact" style={{ width: "10rem" }} type="date" name={`inst_date_${i}`} defaultValue={c.instalments[i]?.date ?? ""} aria-label={`Instalment ${i + 1} due date`} />
                    <input className="input input-compact text-right tabular-nums" style={{ width: "7rem" }} name={`inst_amount_${i}`} defaultValue={c.instalments[i] ? money(c.instalments[i].amount) : ""} aria-label={`Instalment ${i + 1} amount`} /></div>
                ))}
              </div>
            </details>
          </div>
          {!fieldsLocked && <div><button className="btn btn-compact">Save figures</button></div>}
        </fieldset>
      </form>

      {/* The email: Appendix C's, with copy buttons and the .html for Outlook. */}
      <section aria-label="Client email" className={CARD}>
        <div className={HEAD}>
          <h3 className={H}>Client email</h3>
          {d.email && (delivered ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">As sent</span>
            : d.reviewed ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Final: reviewer signed step 10</span>
            : <span className="rounded bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger">DRAFT FOR REVIEW</span>)}
        </div>
        <div className="grid gap-3 px-3.5 py-3">
        {!d.email ? <p className="text-[12.5px] text-ink-3">Fill the figures first.</p> : (<>
          {d.email.review.length > 0 && <ul className="ml-4 list-disc text-sm text-warning">{d.email.review.map((r) => <li key={r}>For the reviewer: {r}</li>)}</ul>}
          <div className="flex flex-wrap items-center gap-2">
            <span className="label m-0">Subject</span>
            <input readOnly className="input" style={{ width: "40rem", maxWidth: "100%" }} value={d.email.subject} aria-label="Email subject" />
            <CopyButton text={d.email.subject} label="Copy subject" />
          </div>
          <pre aria-label="Email body" className="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-sand-200 bg-white p-4 font-sans text-sm leading-relaxed">{d.email.text}</pre>
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton html={d.email.html} text={d.email.text} label="Copy body" />
            <a className="text-sm text-navy-700 underline" href={`/closebook/${fileId}/close?doc=html`}>Download .html for Outlook</a>
            <a className="text-sm text-navy-700 underline" href={`/closebook/${fileId}/close?doc=txt`}>Download .txt</a>
          </div>
        </>)}
        </div>
      </section>

      {/* 9. The documents for TaxDome. */}
      <section aria-label="Documents for TaxDome" className={CARD}>
        <div className={HEAD}><h3 className={H}>Documents for TaxDome</h3></div>
        <div className="grid gap-3 px-3.5 py-3">
        <ul className="ml-4 list-disc text-sm">{d.docs.map((x) => <li key={x}><code className="text-[13px]">{x}</code></li>)}</ul>
        {!d.pk.signed ? <p className="text-[12.5px] text-ink-3">Final once the MAL is signed.</p> : (
          <div className="flex flex-wrap items-center gap-3">
            <a className="btn-secondary" href={`/closebook/${fileId}/close?doc=zip`}>Download {d.zipName}</a>
            {delivered && <span className="text-xs text-ink-3">As delivered</span>}
          </div>)}
        {delivered ? (
          <p className="text-sm"><span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Done</span> Uploaded to TaxDome and email sent: {names.get(c.delivered_by ?? "") ?? ""}, {when(c.delivered_at!)}</p>
        ) : can && d.pk.signed ? (
          <form action={recordDelivery} className="flex flex-wrap items-center gap-3 border-t border-sand-200 pt-3">
            <input type="hidden" name="file_id" value={fileId} />
            <label className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="confirm" value="yes" className="h-4 w-4" disabled={!d.reviewed} /> Uploaded to TaxDome and email sent</label>
            <button className="btn-secondary btn-compact" disabled={!d.reviewed}>Record</button>
            {!d.reviewed && <span className="text-xs text-ink-3">After the reviewer signs step 10.</span>}
          </form>
        ) : null}
        </div>
      </section>

      {/* 10. Filing record. */}
      <form action={saveFilingRecord} className={CARD} aria-label="Filing record">
        <input type="hidden" name="file_id" value={fileId} />
        <div className={HEAD}><h3 className={H}>Filing record</h3></div>
        <fieldset disabled={!can} className="flex flex-wrap items-end gap-3 px-3.5 py-3">
          <label><span className="label">T183CORP signed</span><input className="input" style={{ width: "10rem" }} type="date" name="t183" defaultValue={c.t183_signed_on ?? ""} /></label>
          <label><span className="label">EFILE confirmation number</span><input className="input" style={{ width: "14rem" }} name="efile" defaultValue={c.efile_number} /></label>
          {can && <button className="btn-secondary">Save</button>}
        </fieldset>
      </form>

      {/* Round 13: each GST/HST return's filing date and CRA confirmation number (the lock needs them). */}
      {d.gst.fromReturn && d.gst.returns.length > 0 && (
        <section aria-label="GST/HST filing record" className={CARD}>
          <div className={HEAD}><h3 className={H}>GST/HST filing record</h3></div>
          {d.gst.returns.map((r) => (
            <form key={r.period_no} action={saveGstFiling} className="flex flex-wrap items-end gap-3 border-t border-sand-100 px-3.5 py-2">
              <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="period" value={r.period_no} />
              <span className="w-72 text-sm">{r.label}<span className="block text-xs text-ink-3">Due {formatDate(r.due_on)}</span></span>
              <fieldset disabled={!can} className="flex flex-wrap items-end gap-3">
                <label><span className="label">Filed</span><input className="input" style={{ width: "10rem" }} type="date" name="filed" defaultValue={r.filed_on ?? ""} /></label>
                <label><span className="label">CRA confirmation number</span><input className="input" style={{ width: "14rem" }} name="confirmation" defaultValue={r.confirmation} /></label>
                {can && <button className="btn-secondary btn-compact">Save</button>}
              </fieldset>
              {r.filed_on && r.confirmation ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Recorded</span> : <span className="rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">To fill</span>}
            </form>
          ))}
        </section>
      )}

      {/* 11. Lock. */}
      <section aria-label="Lock" className={CARD}>
        <div className={HEAD}><h3 className={H}>Lock</h3></div>
        <div className="grid gap-3 px-3.5 py-3">
        {locked ? (
          isOwner ? (
            <form action={reopenFile} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="file_id" value={fileId} />
              <input name="why" required minLength={5} maxLength={300} placeholder="Why the file is reopened" aria-label="Reason to reopen" className="input" style={{ width: "28rem", maxWidth: "100%" }} />
              <button className="btn-secondary">Reopen the file</button>
            </form>
          ) : <p className="text-[12.5px] text-ink-3">Owners reopen.</p>
        ) : (<>
          {s.lock.length > 0 ? (
            <ul role="alert" className="text-[12.5px] text-danger">{s.lock.map((x) => <li key={x}>Not yet: {x}</li>)}</ul>
          ) : <p className="text-[12.5px] text-success">Ready to lock.</p>}
          {isOwner && editable && (
            <form action={lockFile} className="flex flex-wrap items-center gap-3">
              <input type="hidden" name="file_id" value={fileId} />
              <button className="btn btn-compact">Lock the file</button>
            </form>
          )}
        </>)}
        </div>
      </section>
    </div>
  );
}
