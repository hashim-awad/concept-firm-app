// Step 9, Statements (round 11): the year-end package as Appendix C, from Closebook's figures. Benchmarks:
// CaseWare (the fields a compilation needs, each empty one shown "To fill" and blocking the preparer's
// sign-off; the package stopped by a failed tie-out, named), Appendix C for the documents.
import { formatDate, todayToronto } from "@/lib/dates";
import { longDate } from "@/lib/closebook/fs-model";
import type { PackageData } from "@/lib/closebook/fs-server";
import { saveFsFields, sendMal } from "../statements-actions";
import { CopyButton } from "@/app/(app)/leads/[id]/quote/copy-button";

const TO_FILL = <span className="ml-2 inline-block whitespace-nowrap rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">To fill</span>;
const label = (text: string, empty: boolean) => <span className="label flex items-center">{text}{empty && TO_FILL}</span>;
// Round 15: one card per section, small capitals headings (CaseWare Cloud).
const CARD = "overflow-hidden rounded-[10px] border border-sand-200 bg-white";
const HEAD = "flex flex-wrap items-center gap-2 border-b border-sand-200 px-3.5 py-2.5";
const H = "text-[11.5px] font-bold tracking-[.08em] text-navy-900 uppercase";
const when = (at: string) => `${formatDate(at)} ${new Date(at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}`;

export function StatementsStep({ fileId, pk, editable, isOwner, siteUrl }: { fileId: string; pk: PackageData; editable: boolean; isOwner: boolean; siteUrl: string }) {
  const f = pk.fields;
  const doc = (d: string, fmt = "pdf") => `/closebook/${fileId}/package?doc=${d}&format=${fmt}`;
  const mal = pk.mal;
  const out = !!mal.mal_quote_id && !pk.signed;
  const lock = !editable;
  const link = mal.mal_token ? `${siteUrl}/q/${mal.mal_token}` : "";
  // Management cannot confirm statements for a year that has not ended (the database refuses it too).
  const ye = pk.data.file.year_end;
  const dayAfter = new Date(Date.parse(`${ye}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const notYet = todayToronto() < dayAfter;
  return (
    <div className="grid gap-3.5">
      {pk.blocked.length > 0 && <ul role="alert" className="text-[12.5px] text-danger">{pk.blocked.map((b) => <li key={b}>Stopped: {b}</li>)}</ul>}
      {mal.mal_withdrawn_at && !mal.mal_quote_id && (
        <p role="alert" className="text-[12.5px] text-warning"><b>MAL withdrawn</b> {when(mal.mal_withdrawn_at)}: {mal.mal_withdrawn_why}. Sign step 9 again before a new MAL.</p>
      )}

      {/* The documents: draft until the signing officer signs the MAL. */}
      <section aria-label="Documents" className={CARD}>
        <div className={HEAD}>
          <h3 className={H}>Documents</h3>
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${pk.signed ? "bg-success-soft text-success" : "bg-sand-100 text-ink-2"}`}>
            {pk.signed ? `Final, ${pk.ctx.reportDate}` : "Draft"}</span>
          <span className="text-[12.5px] text-ink-3">{pk.m.hasPrior ? "With last year" : "First year"}</span>
        </div>
        <table className="table table-compact">
          <thead><tr><th>Document</th><th>Signed by</th><th /></tr></thead>
          <tbody>
            {([["fs", "Financial statements: cover, compilation report, balance sheet, statement of earnings and retained earnings, notes", "Hashim Awad, CPA (report)"],
              ["mal", "Management Responsibility Acknowledgement (MAL)", "The signing officer"],
              ["letter", "Minute book letter", "Hashim Awad, CPA"]] as const).map(([d, name, by]) => (
              <tr key={d}><td>{name}</td><td className="whitespace-nowrap text-ink-2">{by}</td>
                <td className="whitespace-nowrap text-right">{pk.blocked.length ? <span className="text-xs text-ink-3">Stopped</span> : <>
                  <a href={doc(d)} target="_blank" className="text-sm text-navy-700 underline">PDF</a>
                  {isOwner && <a href={doc(d, "docx")} className="ml-3 text-sm text-navy-700 underline">Word (reviewer)</a>}</>}</td></tr>
            ))}
          </tbody>
        </table>
        {pk.byHand.length > 0 && <ul className="border-t border-sand-200 px-3.5 py-2 text-[12.5px] text-warning">{pk.byHand.map((b) => <li key={b}>{b}</li>)}</ul>}
      </section>

      {/* The fields: saved per client and rolled forward; per file for the first year and dividends. */}
      <form action={saveFsFields} className={CARD} aria-label="Step 9 fields">
        <input type="hidden" name="file_id" value={fileId} />
        <div className={HEAD}><h3 className={H}>Package fields</h3></div>
        <fieldset disabled={lock} className="grid gap-4 px-3.5 py-3">
          <div className="grid gap-3 md:grid-cols-3">
            <label>{label("Signing officer name", !f.officer_name)}<input className="input" name="officer_name" defaultValue={f.officer_name} /></label>
            <label>{label("Position", !f.officer_position)}<input className="input" name="officer_position" defaultValue={f.officer_position} placeholder="For example President" /></label>
            <label>{label("Email (for the MAL)", !f.officer_email)}<input className="input" type="email" name="officer_email" defaultValue={f.officer_email} /></label>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label>{label("First year of the company", f.first_year === null)}
              <select className="input" name="first_year" defaultValue={f.first_year === null ? "" : f.first_year ? "yes" : "no"}>
                <option value="">Choose</option><option value="yes">Yes: no prior-year column</option><option value="no">No: show last year</option>
              </select>
              {f.first_year === null && <span className="mt-1 block text-xs text-ink-3">Suggested: {pk.firstYearSuggested ? "Yes" : "No"}</span>}
            </label>
            <label>{label("Audit waiver", false)}
              <select className="input" name="audit_waiver" defaultValue={f.audit_waiver ? "yes" : "no"}><option value="yes">Yes</option><option value="no">No</option></select>
            </label>
          </div>
          {pk.needsShTerms && (
            <label>{label("Shareholder loan terms (the note)", !f.sh_terms)}
              <textarea className="input min-h-16" name="sh_terms" defaultValue={f.sh_terms} placeholder="For example: The amount is non-interest bearing, unsecured, and has no set terms of repayment." />
            </label>
          )}
          {!pk.needsShTerms && <input type="hidden" name="sh_terms" value={f.sh_terms} />}
          {pk.relatedCodes.length > 0 && (
            <div className="grid gap-2">
              <p className="font-medium">Related parties</p>
              {pk.relatedCodes.map((r) => (
                <label key={r.code} className="grid gap-1 md:grid-cols-[22rem_1fr] md:items-center">
                  {label(`${r.code} ${r.name}`, !f.related[r.code])}<input className="input" name={`related_${r.code}`} defaultValue={f.related[r.code] ?? ""} placeholder="Name of the related party" />
                </label>
              ))}
            </div>
          )}
          {pk.divLines.length > 0 && (
            <div className="grid gap-2">
              <p className="font-medium">Dividends</p>
              <table className="table table-compact">
                <thead><tr><th>Line</th><th className="text-right">Amount</th><th>Eligible</th><th>Share class</th><th>Declared</th><th>Paid</th></tr></thead>
                <tbody>{pk.divLines.map((d) => {
                  const v = f.dividends.find((x) => x.line === d.line);
                  return (
                    <tr key={d.line}>
                      <td><input type="hidden" name="div_line" value={d.line} />{d.line} {d.name}</td>
                      <td className="text-right tabular-nums">${d.amount.toLocaleString("en-US")}</td>
                      <td>{d.eligible === null ? (
                        <select className="input" style={{ width: "7rem" }} name={`div_eligible_${d.line}`} defaultValue={v?.eligible ? "yes" : "no"}><option value="no">No</option><option value="yes">Yes</option></select>
                      ) : <span className="text-sm">{d.eligible ? "Yes" : "No"} <span className="text-xs text-ink-3">({d.line})</span></span>}</td>
                      <td className="whitespace-nowrap"><input className="input inline-block" style={{ width: "12rem" }} name={`div_cls_${d.line}`} defaultValue={v?.cls ?? ""} placeholder="Class A common" />{!v?.cls && TO_FILL}</td>
                      <td className="whitespace-nowrap"><input className="input inline-block" style={{ width: "10rem" }} type="date" name={`div_declared_${d.line}`} defaultValue={v?.declared ?? ""} />{!v?.declared && TO_FILL}</td>
                      <td className="whitespace-nowrap"><input className="input inline-block" style={{ width: "10rem" }} type="date" name={`div_paid_${d.line}`} defaultValue={v?.paid ?? ""} />{!v?.paid && TO_FILL}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {editable && <div><button className="btn btn-compact">Save fields</button></div>}
        </fieldset>
      </form>

      {/* The MAL, through the signing engine used for quotes. */}
      <section aria-label="MAL signing" className={CARD}>
        <div className={HEAD}><h3 className={H}>MAL signing</h3></div>
        <div className="px-3.5 py-3">
        {pk.signed ? (
          <div className="grid gap-2 text-sm">
            <p><span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Signed</span> by {mal.mal_signed_name}{mal.mal_signed_title ? `, ${mal.mal_signed_title}` : ""}, {when(mal.mal_signed_at!)}</p>
            <p><a href={doc("signed")} target="_blank" className="text-navy-700 underline">Signed MAL with its signing record (PDF)</a></p>
          </div>
        ) : out ? (
          <div className="grid gap-2 text-sm">
            <p><span className="rounded bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-700">{mal.mal_status === "viewed" ? "Viewed" : "Sent"}</span> to {f.officer_name} ({mal.mal_email}), {when(mal.mal_sent_at!)}</p>
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly className="input" style={{ width: "34rem", maxWidth: "100%" }} value={link} aria-label="Signing link" />
              <CopyButton text={link} label="Copy signing link" />
            </div>
          </div>
        ) : !pk.reviewed ? (
          <p className="text-[12.5px] text-ink-3">After the reviewer signs step 9.</p>
        ) : editable ? (
          <form action={sendMal} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="file_id" value={fileId} />
            <button className="btn btn-compact" disabled={pk.blocked.length > 0 || notYet}>Send the MAL for signing</button>
            {notYet && <span role="alert" className="text-[12.5px] text-danger">Not yet: from {longDate(dayAfter)}.</span>}
            {!notYet && <span className="text-xs text-ink-3">To {f.officer_name || "the signing officer"} ({f.officer_email || "no email"})</span>}
          </form>
        ) : null}
        </div>
      </section>
    </div>
  );
}
