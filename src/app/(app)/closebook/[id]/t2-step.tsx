// Step 8, T2 tie-out (round 10, Hashim, Nov 27, 2026). Benchmarks: QuickBooks Online's GIFI export for
// the file, ProFile for the import, CaseWare for the tie-out working paper (each check with its figures
// and its result; each difference to the cent, cleared only by the reviewer with a reason).
import { formatDate } from "@/lib/dates";
import { fmt, KIND_LABEL, TREATMENT, type Treatment } from "@/lib/closebook/t2";
import type { gifiFor } from "@/lib/closebook/gifi-server";
import { acceptT2Difference, saveT2Tieout, setBookAmortization, setReviewTreatment } from "../t2-actions";
import { ExportButton } from "./export-button";
import { FilePick } from "./file-pick";

type G = NonNullable<Awaited<ReturnType<typeof gifiFor>>>;
const chip = (ok: boolean, yes = "Pass", no = "Fail") =>
  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ok ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>{ok ? yes : no}</span>;
const when = (at: string) => `${formatDate(at)} ${new Date(at).toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit", timeZone: "America/Toronto" })}`;
const amt = (n: number | null | undefined) => (n === null || n === undefined ? "–" : fmt(n));

export function T2Step({ fileId, g, staff, editable, isOwner }: { fileId: string; g: G; staff: Map<string, string>; editable: boolean; isOwner: boolean }) {
  const hidden = <input type="hidden" name="file_id" value={fileId} />;
  const anyOpen = g.tieItems.some((t) => t.open);
  return (
    <div className="grid gap-4">
      {g.stale && (
        <p role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm font-medium text-danger">
          The trial balance changed after the final export. Export again and import it into ProFile.</p>
      )}

      {/* 2. The checks, CaseWare style: each with its figures and its result. */}
      <section aria-label="Checks before export" className="card grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Checks before every export</h2>
          <span className="text-xs text-ink-3">Business Number: {g.bn ?? <span className="font-semibold text-danger">none on the client record</span>}</span>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          {g.checks.map((c, i) => (
            <div key={c.key} className={`overflow-x-auto rounded-lg border ${c.ok ? "border-sand-200" : "border-danger/40"}`}>
              <div className="flex items-start justify-between gap-2 border-b border-sand-200 bg-sand-50 px-3 py-1.5">
                <p className="text-sm font-medium"><span className="mr-1 text-ink-3">{i + 1}.</span>{c.title}</p>{chip(c.ok)}
              </div>
              <table className="w-full text-sm"><tbody>
                {c.rows.map((r, j) => (
                  <tr key={j} className={r.total ? "border-t border-ink font-semibold" : ""}>
                    <td className="px-3 py-0.5">{r.label}</td><td className="w-36 px-3 py-0.5 text-right tabular-nums">{r.text ?? amt(r.amount)}</td></tr>
                ))}
              </tbody></table>
              <p className={`px-3 py-1.5 text-xs font-medium ${c.ok ? "text-success" : "text-danger"}`}>{c.result}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 1 and 3. The two exports, kept with who and when. */}
      <section aria-label="GIFI exports" className="card grid gap-3">
        <h2 className="font-semibold">GIFI file for ProFile</h2>
        {g.refused.length ? (
          <div role="alert" className="rounded-lg border border-danger/40 bg-danger/5 px-4 py-3 text-sm">
            <p className="font-semibold text-danger">Export refused</p>
            <ul className="ml-4 list-disc text-danger">{g.refused.map((r) => <li key={r}>{r}</li>)}</ul>
          </div>
        ) : editable ? (
          <div className="flex flex-wrap items-center gap-3">
            <ExportButton href={`/closebook/${fileId}/gifi?kind=before_tax`} label="Export before tax entries" primary={false} />
            <ExportButton href={`/closebook/${fileId}/gifi?kind=final`} label="Export final" />
            <span className="text-xs text-ink-2">Before tax entries: for preparing the T2 in ProFile, to get CCA and income tax; it always leaves the tax entries (TJE) out. Final: every entry, after the tax entries are booked.
              {g.tjes === 0 && <b className="ml-1 text-warning">No tax entry (TJE) is booked yet.</b>}</span>
          </div>
        ) : null}
        {g.exports.length > 0 && (
          <table className="table table-compact">
            <thead><tr><th>Export</th><th>File</th><th>By</th><th>When</th><th>Status</th><th /></tr></thead>
            <tbody>{g.exports.map((e) => (
              <tr key={e.id}><td className="whitespace-nowrap">{KIND_LABEL[e.kind] === "final" ? "Final" : "Before tax entries"}</td><td>{e.file_name}</td>
                <td>{e.created_by ? staff.get(e.created_by) ?? "" : ""}</td><td className="whitespace-nowrap">{when(e.created_at)}</td>
                <td>{e.kind === "final" ? (e.id === g.final?.id ? (g.stale ? chip(false, "", "Stale") : chip(true, "Current")) : <span className="text-xs text-ink-3">Replaced</span>) : null}</td>
                <td><a href={`/closebook/${fileId}/gifi?export=${e.id}`} className="text-sm text-navy-700 underline">Download</a></td></tr>
            ))}</tbody>
          </table>
        )}
        <details>
          <summary className="cursor-pointer text-sm text-navy-700 underline">What the file holds ({g.codes.length} GIFI codes)</summary>
          <table className="table table-compact mt-2 max-w-2xl"><thead><tr><th>GIFI</th><th>Line</th><th className="text-right">Amount</th></tr></thead>
            <tbody>{g.codes.map(([c, v]) => <tr key={c}><td className="tabular-nums">{c}</td><td>{g.names.get(c) ?? ""}</td><td className="text-right tabular-nums">{v.toFixed(2)}</td></tr>)}</tbody></table>
          <p className="mt-1 text-xs text-ink-3">As QuickBooks Online writes it: a header line, then one line per GIFI code with a balance. Signs follow GIFI: contra lines and a deficit are negative. No total lines.</p>
        </details>
      </section>

      {/* 4. Tax workpaper: Schedule 1 items from the tax codes. */}
      <section aria-label="Tax workpaper" className="card grid gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Tax workpaper: Schedule 1 items <span className="ml-1 text-sm font-normal text-ink-3">Working paper: not for the client</span></h2>
          <span className="flex gap-3 text-sm"><a href={`/closebook/${fileId}/tax-workpaper?format=xlsx`} className="text-navy-700 underline">Excel</a>
            <a href={`/closebook/${fileId}/tax-workpaper?format=pdf`} className="text-navy-700 underline">PDF</a></span>
        </div>
        {g.workpaper.length === 0 ? <p className="text-sm text-ink-2">No account has a tax code with a Schedule 1 effect.</p> : g.workpaper.map((s) => (
          <div key={s.code} className="overflow-x-auto rounded-lg border border-sand-200">
            <p className="border-b border-sand-200 bg-sand-50 px-3 py-1.5 text-sm"><b>{s.code}</b> {s.name}<span className="ml-2 text-xs text-ink-3">{s.rule}</span></p>
            <table className="w-full text-sm"><thead><tr className="text-left text-xs text-ink-3"><th className="px-3 py-1">Account</th><th className="px-3 py-1">GIFI</th><th className="px-3 py-1 text-right">Amount</th><th className="px-3 py-1">Schedule 1</th><th className="px-3 py-1 text-right">Effect</th></tr></thead>
              <tbody>{s.accounts.map((a, i) => (
                <tr key={i}><td className="px-3 py-0.5">{a.label}</td><td className="px-3 py-0.5 tabular-nums">{a.gifi}</td><td className="px-3 py-0.5 text-right tabular-nums">{fmt(a.amount)}</td>
                  <td className="px-3 py-0.5">{a.note}{a.code === "REVIEW" && isOwner && editable && (
                    <form action={setReviewTreatment} className="mt-1 flex items-center gap-2">{hidden}<input type="hidden" name="line" value={a.line_no} />
                      <select name="treatment" defaultValue={g.treatments.get(a.line_no) ?? ""} aria-label={`${a.label}: treatment`} className="input input-compact pr-8" style={{ width: "13rem" }}>
                        <option value="">Not set</option>{(Object.keys(TREATMENT) as Treatment[]).map((t) => <option key={t} value={t}>{TREATMENT[t]}</option>)}</select>
                      <button type="submit" className="btn-secondary btn-compact">Save for this client</button></form>)}</td>
                  <td className="px-3 py-0.5 text-right tabular-nums">{a.effect === null ? <span className="text-danger">To set</span> : a.effect === 0 ? "–" : `${a.effect > 0 ? "+" : "−"} ${fmt(Math.abs(a.effect))}`}</td></tr>
              ))}
                <tr className="border-t border-ink font-semibold"><td className="px-3 py-0.5">Total</td><td /><td className="px-3 py-0.5 text-right tabular-nums">{fmt(s.total)}</td><td />
                  <td className="px-3 py-0.5 text-right tabular-nums">{s.effect === 0 ? "–" : `${s.effect > 0 ? "+" : "−"} ${fmt(Math.abs(s.effect))}`}</td></tr></tbody></table>
          </div>
        ))}
        {g.workpaper.length > 0 && (() => {
          const net = Math.round(g.workpaper.reduce((n, w) => n + w.effect, 0) * 100) / 100;
          return <p className="flex justify-between rounded-lg border border-ink/60 px-3 py-1.5 text-sm font-semibold"><span>Net Schedule 1 adjustment (+ adds to net income for tax)</span>
            <span className="tabular-nums">{net === 0 ? "–" : `${net > 0 ? "+" : "−"} ${fmt(Math.abs(net))}`}</span></p>;
        })()}
        <p className="text-xs text-ink-2">+ adds to net income for tax, − deducts from it. The preparer enters these in ProFile. CCA is claimed on Schedule 8.</p>
        {isOwner && editable && (
          <form action={setBookAmortization} className="flex flex-wrap items-center gap-3 border-t border-sand-200 pt-2 text-sm">{hidden}
            <input type="hidden" name="on" value={g.bookAmortization ? "0" : "1"} />
            <span>Amortization for this client: <b>{g.bookAmortization ? "book amortization (CCA is not compared)" : "CCA (the tie-out compares CCA with the amortization booked)"}</b></span>
            <button type="submit" className="btn-secondary btn-compact">{g.bookAmortization ? "Use CCA" : "Set book amortization"}</button>
          </form>
        )}
      </section>

      {/* 5. Tie-out to ProFile. */}
      <section aria-label="Tie-out to ProFile" className="card grid gap-3">
        <h2 className="font-semibold">Tie-out to ProFile <span className="ml-1 text-sm font-normal text-ink-3">After the final export is imported and the T2 prepared</span></h2>
        {!g.final ? <p className="text-sm text-ink-2">Export the final GIFI file first, import it into ProFile and prepare the T2.</p> : (<>
          <table className="table table-compact">
            <thead><tr><th>Figure</th><th className="text-right">Closebook (final export)</th><th className="text-right">ProFile</th><th className="text-right">Difference (Closebook less ProFile)</th><th>Status</th></tr></thead>
            <tbody>{g.tieItems.map((t) => (
              <tr key={t.key}><td>{t.label}</td><td className="text-right tabular-nums">{fmt(t.closebook)}</td><td className="text-right tabular-nums">{amt(t.profile)}</td>
                <td className={`text-right font-semibold tabular-nums ${t.open ? "text-danger" : ""}`}>{amt(t.diff)}</td>
                <td>{!t.compared ? <span className="text-xs text-ink-2">Not compared: book amortization</span>
                  : t.diff === null ? <span className="text-xs text-ink-3">To enter</span>
                  : t.diff === 0 ? chip(true, "Ties")
                  : t.rounding ? <span className="rounded bg-navy-100 px-2 py-0.5 text-xs font-semibold text-navy-800">Rounding</span>
                  : !t.open && t.accepted ? <span className="rounded bg-success-soft px-2 py-0.5 text-xs font-semibold text-success">Accepted by {staff.get(t.accepted.by) ?? "the reviewer"}: {t.accepted.reason}</span>
                  : <span className="grid gap-1"><span className="rounded bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">Blocks the preparer&rsquo;s sign-off</span>
                      {t.accepted && <span className="text-xs text-ink-2">Accepted at {fmt(t.accepted.diff)}; the difference changed.</span>}
                      {isOwner && editable && !g.stale && (
                        <form action={acceptT2Difference} className="flex flex-wrap items-center gap-2">{hidden}<input type="hidden" name="item" value={t.key} />
                          <input name="reason" required minLength={3} maxLength={300} placeholder="Why it is accepted" aria-label={`${t.label}: reason`} className="input input-compact" style={{ width: "16rem" }} />
                          <button type="submit" className="btn-secondary btn-compact">Accept</button></form>)}</span>}</td></tr>
            ))}</tbody>
          </table>
          <p className="text-xs text-ink-2">ProFile rounds each GIFI line to whole dollars. A difference of {fmt(g.roundingAllowed)} or less shows as rounding and does not block (Settings, Closebook, Thresholds).</p>
          {anyOpen && <p className="text-sm text-danger">A larger difference blocks the preparer&rsquo;s sign-off. Only the reviewer can accept one, with a reason.</p>}
          {editable && !g.stale && (
            <form action={saveT2Tieout} className="flex flex-wrap items-end gap-3 border-t border-sand-200 pt-3">{hidden}
              {([["ni", "Net income (9999)"], ["assets", "Total assets (2599)"], ["cca", "Total CCA, Schedule 8"], ["tax", "Total income tax, federal plus provincial"]] as const).map(([k, label]) => {
                const t = g.tieItems.find((x) => x.key === k);
                return <label key={k} className="grid gap-1 text-sm">{label}<input name={k} required inputMode="decimal" defaultValue={t?.profile === null || t?.profile === undefined ? "" : t.profile.toLocaleString("en-CA", { minimumFractionDigits: 2 })}
                  className="input input-compact text-right tabular-nums" style={{ width: "11rem" }} /></label>;
              })}
              <FilePick id="t2-pdf" name="t2_pdf" label="T2 from ProFile" add={g.tie?.t2_pdf ? "Replace the T2 PDF" : "Attach the T2 PDF"} accept=".pdf"
                hint={g.tie?.t2_pdf ? `Attached: ${g.tie.t2_pdf.split("/").pop()!.replace(/^\d+-/, "")}` : "Required."} />
              <button type="submit" className="btn-secondary">Save the ProFile figures</button>
            </form>
          )}
          {g.tie?.entered_by && <p className="text-xs text-ink-3">Entered by {staff.get(g.tie.entered_by) ?? ""}, {when(g.tie.entered_at)}</p>}
        </>)}
      </section>
    </div>
  );
}
