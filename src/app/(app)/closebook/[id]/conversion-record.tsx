// The conversion record of a statement read from a PDF or photo (round 20; kept as it was in round 22).
import Link from "next/link";
import { formatDateTime } from "@/lib/dates";
import type { Conversion } from "@/lib/closebook/bank-server";
import { bracketAmount } from "@/lib/closebook/amount";

// Round 20: the conversion record of a statement read from a PDF or photo (benchmark: QuickBooks Online keeps
// the PDF with the imported statement; we also keep who, when, model, pages, cost and the checks at import).
const MODEL_NAME: Record<string, string> = { "claude-sonnet-5-5": "Claude Sonnet 5.5", "claude-sonnet-5": "Claude Sonnet 5", fixture: "the test reader" };
const cents = (c: number) => bracketAmount(c);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export function ConversionRecord({ s }: { s: Conversion }) {
  if (s.source !== "pdf") return null;
  const k = s.check_result, e = s.edits;
  const model = s.model ? MODEL_NAME[s.model] ?? s.model : "the statement reader";
  const changes: string[] = [];
  if (e?.edited) changes.push(`${e.edited} edited`);
  if (e?.added) changes.push(`${e.added} added`);
  if (e?.deleted) changes.push(`${e.deleted} removed`);
  const summary = (ok: boolean | null) => (ok === null ? "no printed total" : ok ? "matches the statement" : "does not match the statement");
  return (
    <details className="text-xs text-ink-2">
      <summary className="cursor-pointer text-navy-700">Conversion record</summary>
      <ul className="mt-1 max-w-4xl list-disc space-y-0.5 whitespace-normal pl-5">
        <li>Read by {model}{s.converted_at ? ` on ${formatDateTime(s.converted_at)}` : ""}{s.conv ? `, uploaded by ${s.conv.full_name}` : ""}.</li>
        <li>{plural(s.pages ?? 0, "page", "pages")} · cost {s.cost_usd == null ? "not recorded" : `US$${s.cost_usd.toFixed(4)}`} (US-only processing){s.input_tokens != null ? ` · ${s.input_tokens.toLocaleString("en-CA")} tokens in, ${(s.output_tokens ?? 0).toLocaleString("en-CA")} out` : ""}</li>
        {k && <li>Checks at import: difference {cents(k.differenceCents)}; money in {summary(k.summaryOk.in)}; money out {summary(k.summaryOk.out)}; running balance {k.runningBreak ? "stopped matching on one line, kept after review" : "matched on every line"}{k.review ? `; ${plural(k.review, "line", "lines")} looked at in For review` : ""}.</li>}
        {k?.warnings?.length ? <li>Warnings shown: {k.warnings.join(" ")}</li> : null}
        <li>Changed before import: {changes.length ? changes.join(", ") : "nothing"}.</li>
        {s.statement_import_id && <li><Link href={`/statements/${s.statement_import_id}`} className="text-navy-700 underline">Open the PDF and the lines as imported</Link></li>}
      </ul>
    </details>
  );
}

