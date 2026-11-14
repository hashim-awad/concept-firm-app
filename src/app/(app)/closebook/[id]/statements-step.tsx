// Step 9, Statements (round 11): the year-end package as Appendix C, from Closebook's figures. Benchmarks:
// CaseWare (the fields a compilation needs, each empty one shown "To fill" and blocking the preparer's
// sign-off; the package stopped by a failed tie-out, named), Appendix C for the documents.
import { formatDate } from "@/lib/dates";
import type { PackageData } from "@/lib/closebook/fs-server";
import { saveFsFields, sendMal } from "../statements-actions";
import { CopyButton } from "@/app/(app)/leads/[id]/quote/copy-button";

const TO_FILL = <span className="ml-2 rounded bg-warning/15 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-warning">To fill</span>;
const label = (text: string, empty: boolean) => <span className="label flex items-center">{text}{empty && TO_FILL}</span>;
const when = (at: string) => `${formatDate(at)} ${new Date(at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}`;

export function StatementsStep({ fileId, pk, editable, isOwner, siteUrl }: { fileId: string; pk: PackageData; editable: boolean; isOwner: boolean; siteUrl: string }) {
  const f = pk.fields;
  const doc = (d: string, fmt = "pdf") => `/closebook/${fileId}/package?doc=${d}&format=${fmt}`;
  const mal = pk.mal;
  const out = !!mal.mal_quote_id && !pk.signed;
  const lock = !editable;
  const link = mal.mal_token ? `${siteUrl}/q/${mal.mal_token}` : "";
  return (
    <div className="grid gap-4">
      {pk.blocked.length > 0 && (
        <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
          <p className="font-semibold text-danger">The package is stopped</p>
          <ul className="ml-4 list-disc text-danger">{pk.blocked.map((b) => <li key={b}>{b}</li>)}</ul>
        </div>
      )}
      {mal.mal_withdrawn_at && !mal.mal_quote_id && (
        <p role="alert" className="rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
          <b>The MAL was withdrawn</b> on {when(mal.mal_withdrawn_at)}: {mal.mal_withdrawn_why}. The package is a draft again, and step 9 must be signed again before a new MAL is sent.</p>
      )}

      {/* The documents: draft until the signing officer signs the MAL. */}
      <section aria-label="Documents" className="card grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Year-end package</h2>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${pk.signed ? "bg-success-soft text-success" : "bg-sand-100 text-ink-2"}`}>
            {pk.signed ? `Final, dated ${pk.ctx.reportDate}` : "Draft for review: stamped, dated [Date of signing]"}</span>
        </div>
        <p className="text-sm text-ink-2">{pk.m.period}. {pk.m.hasPrior ? "With last year's column, from step 2." : "No prior-year column: first year."}</p>
        <table className="table table-compact max-w-3xl">
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
        {pk.byHand.length > 0 && (
          <div className="rounded-lg border border-sand-200 bg-sand-50 px-3 py-2 text-sm">
            <p className="font-medium">For the reviewer</p>
            <ul className="ml-4 list-disc">{pk.byHand.map((b) => <li key={b}>{b}</li>)}</ul>
          </div>
        )}
      </section>

      {/* The fields: saved per client and rolled forward; per file for the first year and dividends. */}
      <form action={saveFsFields} className="card grid gap-4" aria-label="Step 9 fields">
        <input type="hidden" name="file_id" value={fileId} />
        <h2 className="font-semibold">Fields for the package</h2>
        <fieldset disabled={lock} className="grid gap-4">
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
              {f.first_year === null && <span className="mt-1 block text-xs text-ink-3">Suggested: {pk.firstYearSuggested ? "Yes (no last-year figures in step 2)" : "No"}</span>}
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
                <thead><tr><th>Line</th><th className="text-right">Amount (from the trial balance)</th><th>Eligible</th><th>Share class</th><th>Declared</th><th>Paid</th></tr></thead>
                <tbody>{pk.divLines.map((d) => {
                  const v = f.dividends.find((x) => x.line === d.line);
                  return (
                    <tr key={d.line}>
                      <td><input type="hidden" name="div_line" value={d.line} />{d.line} {d.name}</td>
                      <td className="text-right tabular-nums">${d.amount.toLocaleString("en-US")}</td>
                      <td>{d.eligible === null ? (
                        <select className="input" style={{ width: "7rem" }} name={`div_eligible_${d.line}`} defaultValue={v?.eligible ? "yes" : "no"}><option value="no">No</option><option value="yes">Yes</option></select>
                      ) : <span className="text-sm">{d.eligible ? "Yes" : "No"} <span className="text-xs text-ink-3">({d.line})</span></span>}</td>
                      <td><input className="input" style={{ width: "12rem" }} name={`div_cls_${d.line}`} defaultValue={v?.cls ?? ""} placeholder="Class A common" />{!v?.cls && TO_FILL}</td>
                      <td><input className="input" style={{ width: "10rem" }} type="date" name={`div_declared_${d.line}`} defaultValue={v?.declared ?? ""} />{!v?.declared && TO_FILL}</td>
                      <td><input className="input" style={{ width: "10rem" }} type="date" name={`div_paid_${d.line}`} defaultValue={v?.paid ?? ""} />{!v?.paid && TO_FILL}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {editable && <div><button className="btn">Save fields</button>
            <span className="ml-3 text-xs text-ink-2">A change after step 9 is signed reopens it{out ? " and withdraws the MAL" : ""}.</span></div>}
        </fieldset>
      </form>

      {/* The MAL, through the signing engine used for quotes. */}
      <section aria-label="MAL signing" className="card grid gap-3">
        <h2 className="font-semibold">MAL signing</h2>
        {pk.signed ? (
          <div className="grid gap-2 text-sm">
            <p><span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Signed</span> by {mal.mal_signed_name}{mal.mal_signed_title ? `, ${mal.mal_signed_title}` : ""}, {when(mal.mal_signed_at!)}</p>
            <p>The report, the MAL and the minute book letter are dated {pk.ctx.reportDate}. The PDFs carry no stamp.</p>
            <p><a href={doc("signed")} target="_blank" className="text-navy-700 underline">Signed MAL with its signing record (PDF)</a></p>
          </div>
        ) : out ? (
          <div className="grid gap-2 text-sm">
            <p><span className="rounded bg-navy-50 px-2 py-0.5 text-xs font-semibold text-navy-700">{mal.mal_status === "viewed" ? "Viewed" : "Sent"}</span> to {f.officer_name} ({mal.mal_email}) on {when(mal.mal_sent_at!)}. Waiting for the signature.</p>
            <div className="flex flex-wrap items-center gap-2">
              <input readOnly className="input" style={{ width: "34rem", maxWidth: "100%" }} value={link} aria-label="Signing link" />
              <CopyButton text={link} label="Copy signing link" />
            </div>
            <p className="text-xs text-ink-3">Send this link to the signing officer. The client email comes with step 10.</p>
          </div>
        ) : !pk.reviewed ? (
          <p className="text-sm text-ink-2">The MAL can be sent once the reviewer signs step 9. Nothing goes to the client before that.</p>
        ) : editable ? (
          <form action={sendMal} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="file_id" value={fileId} />
            <button className="btn" disabled={pk.blocked.length > 0}>Send the MAL for signing</button>
            <span className="text-xs text-ink-2">To {f.officer_name || "the signing officer"} ({f.officer_email || "no email"}). When it is signed, the package takes that date.</span>
          </form>
        ) : null}
      </section>
    </div>
  );
}
