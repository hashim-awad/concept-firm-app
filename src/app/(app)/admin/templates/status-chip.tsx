// Round 17: a template's status: Draft, or approved with who and when (from the approval records).
import { formatDate } from "@/lib/dates";
import type { TemplateStatus } from "@/lib/studio/template-catalog";

export function StatusChip({ s }: { s: TemplateStatus }) {
  if (s.draft) return <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-warning">Draft</span>;
  const who = [s.by, s.on ? formatDate(s.on) : ""].filter(Boolean).join(", ");
  return <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap text-success">{s.word}{who ? ` · ${who}` : ""}</span>;
}
