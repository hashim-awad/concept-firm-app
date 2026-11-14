// Step 2 on a bank-statement file (round 11): last year's Schedule 125, as on last year's T2, for the
// prior-year column of the statement of earnings. Benchmark: ProFile's Schedule 125 (one amount per GIFI
// code, revenue and expenses both entered as positive amounts).
import { saveOpeningS125 } from "../statements-actions";

const money = (n: number) => n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BLANKS = 5;

export function OpeningS125({ fileId, rows, editable, needed }: { fileId: string; rows: { code: string; name: string; amount: number | null }[]; editable: boolean; needed: boolean }) {
  const total = (t: (c: string) => boolean) => rows.filter((r) => t(r.code)).reduce((n, r) => n + (r.amount ?? 0), 0);
  const rev = total((c) => c < "8300"), exp = total((c) => c >= "8300" && c < "9369");
  return (
    <form action={saveOpeningS125} className="card mt-4 grid gap-3" aria-label="Last year's Schedule 125">
      <input type="hidden" name="file_id" value={fileId} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Last year&apos;s Schedule 125 (income statement)</h2>
        {needed && <span className="rounded bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning">Enter last year&apos;s Schedule 125 in step 2</span>}
      </div>
      <p className="text-sm text-ink-2">From last year&apos;s T2. It gives the statement of earnings its prior-year column in step 9. Type each amount as a positive number, as on the schedule. Not needed in the company&apos;s first year.</p>
      <table className="table table-compact max-w-3xl">
        <thead><tr><th style={{ width: "6rem" }}>GIFI</th><th>Line</th><th className="text-right" style={{ width: "11rem" }}>Last year</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}><td><input type="hidden" name="s125_code" value={r.code} />{r.code}</td><td>{r.name}</td>
              <td><input className="input text-right tabular-nums" name={`s125_${r.code}`} defaultValue={r.amount === null ? "" : money(r.amount)} disabled={!editable} /></td></tr>
          ))}
          {editable && Array.from({ length: BLANKS }, (_, i) => (
            <tr key={`n${i}`}><td><input className="input" name={`s125_new_code_${i}`} placeholder="Code" inputMode="numeric" /></td><td className="text-xs text-ink-3">Another line</td>
              <td><input className="input text-right tabular-nums" name={`s125_new_amt_${i}`} /></td></tr>
          ))}
          <tr className="border-t border-ink font-semibold"><td /><td>Net income before taxes: revenue (8000 to 8299) less expenses (8300 to 9367)</td><td className="text-right tabular-nums">{money(rev - exp)}</td></tr>
        </tbody>
      </table>
      {editable && <div><button className="btn">Save last year&apos;s Schedule 125</button></div>}
    </form>
  );
}
