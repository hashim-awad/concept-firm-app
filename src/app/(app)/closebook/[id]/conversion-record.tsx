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
// Round 22 correction: it opens in a window from the statement's "..." menu (open), with who imported it and when.
export function ConversionRecord({ s, open = false, imported }: { s: Conversion; open?: boolean; imported?: { by: string; at: string; lines: number; outside: number } }) {
  const head = imported ? <li>Imported by {imported.by || "a staff member"} on {formatDateTime(imported.at)}: {plural(imported.lines, "line", "lines")} in the year{imported.outside ? `, ${imported.outside} outside the year not imported` : ""}.</li> : null;
  if (s.source !== "pdf") return open ? <ul className="grid list-disc gap-1 pl-5 text-[13.5px]">{head}<li>Uploaded from a CSV file in Concept&rsquo;s bank upload template. Nothing was read by the statement reader.</li></ul> : null;
  const k = s.check_result, e = s.edits;
  const model = s.model ? MODEL_NAME[s.model] ?? s.model : "the statement reader";
  const changes: string[] = [];
  if (e?.edited) changes.push(`${e.edited} edited`);
  if (e?.added) changes.push(`${e.added} added`);
  if (e?.deleted) changes.push(`${e.deleted} removed`);
  const summary = (ok: boolean | null) => (ok === null ? "no printed total" : ok ? "matches the statement" : "does not match the statement");
  const list = (cls: string) => (
      <ul className={cls}>
        {head}
        <li>Read by {model}{s.converted_at ? ` on ${formatDateTime(s.converted_at)}` : ""}{s.conv ? `, uploaded by ${s.conv.full_name}` : ""}.</li>
        <li>{plural(s.pages ?? 0, "page", "pages")} · cost {s.cost_usd == null ? "not recorded" : `US$${s.cost_usd.toFixed(4)}`} (US-only processing){s.input_tokens != null ? ` · ${s.input_tokens.toLocaleString("en-CA")} tokens in, ${(s.output_tokens ?? 0).toLocaleString("en-CA")} out` : ""}</li>
        {k && <li>Checks at import: difference {cents(k.differenceCents)}; money in {summary(k.summaryOk.in)}; money out {summary(k.summaryOk.out)}; running balance {k.runningBreak ? "stopped matching on one line, kept after review" : "matched on every line"}{k.review ? `; ${plural(k.review, "line", "lines")} looked at in For review` : ""}.</li>}
        {k?.warnings?.length ? <li>Warnings shown: {k.warnings.join(" ")}</li> : null}
        <li>Changed before import: {changes.length ? changes.join(", ") : "nothing"}.</li>
        {s.statement_import_id && <li><Link href={`/statements/${s.statement_import_id}`} className="text-navy-700 underline">Open the PDF and the lines as imported</Link></li>}
      </ul>);
  if (open) return list("grid list-disc gap-1 pl-5 text-[13.5px]");
  return (
    <details className="text-xs text-ink-2">
      <summary className="cursor-pointer text-navy-700">Conversion record</summary>
      {list("mt-1 max-w-4xl list-disc space-y-0.5 whitespace-normal pl-5")}
    </details>
  );
}

