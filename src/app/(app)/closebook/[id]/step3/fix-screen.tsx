"use client";
// Step 3 "Fix a misread line" (round 23, Hashim, Nov 16, 2026; image 5). One sentence says which line and by how
// much; the line is outlined on the statement and highlighted in the list; its amount is the only field. Import
// turns on when the difference is 0.00. Benchmark: QuickBooks Online "Verify details".
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { confirmAction, notify } from "@/components/save-state";
import { AmountInput } from "@/components/amount";
import { tidyAmount } from "@/lib/closebook/amount";
import { checkAccount } from "@/lib/statements/checks";
import { typeLabel, type ReadResult } from "@/lib/statements/types";
import { amt, type Misread } from "@/lib/closebook/banking";
import { StatementViewer } from "../../../statements/[id]/statement-viewer";
import { parseMoney } from "../../../statements/format";
import { discardStatement, saveStatementEdits } from "../../../statements/actions";
import { importChecked } from "../../step3-actions";
import { Menu } from "./banking-ui";

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (iso: string) => `${MON[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

export function FixScreen({ id, title, data, accKey, miss, fileUrl, mediaType, pages, backHref, target, editable }: {
  id: string; title: string; data: ReadResult; accKey: string; miss: Misread | null; fileUrl: string; mediaType: string; pages: number | null;
  backHref: string; target: string | null; editable: boolean;
}) {
  const router = useRouter();
  const acc0 = data.accounts.find((a) => a.key === accKey) ?? data.accounts[0];
  const line0 = acc0.lines.find((l) => l.id === miss?.lineId) ?? null;
  const [value, setValue] = useState(line0 ? tidyAmount((line0.amountCents / 100).toFixed(2)) : "");
  const [busy, setBusy] = useState(false);
  // The statement with the amount as typed.
  const acc = useMemo(() => {
    const c = parseMoney(value);
    if (!line0 || c === null) return acc0;
    return { ...acc0, lines: acc0.lines.map((l) => (l.id === line0.id ? { ...l, amountCents: Math.abs(c), source: "edited" as const } : l)) };
  }, [acc0, line0, value]);
  const diff = checkAccount(acc).differenceCents;
  const focus = line0 ? { n: acc0.lines.indexOf(line0) + 1, page: line0.page, amountCents: miss?.printed ?? line0.amountCents, description: line0.description } : null;

  const doImport = async () => {
    setBusy(true);
    try {
      const saved = await saveStatementEdits(id, { ...data, accounts: data.accounts.map((a) => (a.key === acc.key ? acc : a)) });
      if (!saved.ok) { notify(saved.error, "error"); return; }
      const r = await importChecked(id, target, true);
      if (!r.ok) { notify(r.error, "error"); return; }
      notify("Imported.");
      router.push(backHref); router.refresh();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-navy-950/45 px-4 py-6" role="dialog" aria-modal="true" aria-label="Fix a misread line">
      <div className="flex h-[min(92vh,940px)] w-full max-w-[1500px] flex-col overflow-hidden rounded-[16px] bg-white shadow-[0_24px_60px_rgba(11,26,58,.35)]">
        <div className="flex items-center gap-4 border-b border-sand-200 px-6 py-4">
          <Link href={backHref} scroll={false} className="inline-flex items-center gap-1 text-[14px] font-semibold text-navy-700"><ArrowLeft className="h-4 w-4" />Back</Link>
          <h2 className="text-[19px] font-semibold">{title}</h2><span className="flex-1" />
          {editable && <Menu label="More for this statement">
            <button type="button" className="block w-full rounded px-3 py-2 text-left text-danger hover:bg-sand-50"
              onClick={async () => { if (await confirmAction({ title: "Delete this statement?", body: "The file and what was read are deleted. Nothing from it is in the books.", confirm: "Delete", danger: true })) { await discardStatement(id); router.push(backHref); router.refresh(); } }}>
              Delete statement</button>
          </Menu>}
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="min-h-0 overflow-auto border-r border-sand-200 bg-sand-100/70 p-4"><StatementViewer url={fileUrl} mediaType={mediaType} pages={pages} focus={focus} /></div>
          <div className="min-h-0 overflow-auto px-6 py-5">
            {miss && <p className="mb-4 rounded-[12px] border border-[#efd9a6] bg-warning-soft/60 px-5 py-3.5 text-[14.5px] leading-relaxed"><b>One line looks misread.</b> {miss.sentence} Check the amount on the highlighted line against the statement.</p>}
            <table className="w-full text-[14.5px]">
              <thead><tr className="border-b border-sand-200 text-left text-[12px] font-semibold tracking-[.06em] text-ink-3 uppercase">
                <th className="py-2.5 pr-3">Date</th><th className="py-2.5 pr-3">Description</th><th className="py-2.5 pr-3">Type</th><th className="py-2.5 pr-3 text-right">Amount</th><th className="py-2.5 text-right">Bank balance</th></tr></thead>
              <tbody>
                {acc0.lines.map((l) => {
                  const on = l.id === line0?.id;
                  return (
                    <tr key={l.id} className={`border-b border-sand-100 ${on ? "bg-warning-soft/60" : ""}`}>
                      <td className="py-3 pr-3 whitespace-nowrap">{day(l.date)}</td><td className="py-3 pr-3">{l.description}</td><td className="py-3 pr-3">{typeLabel(acc0.kind, l.dir)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{on && editable
                        ? <AmountInput name="amount" value={value} onValue={setValue} aria-label={`Amount for ${l.description}`} className="input h-10 w-[10rem] border-2 border-[#d08a1a] text-right text-[15px]" />
                        : amt(l.amountCents)}</td>
                      <td className="py-3 text-right text-ink-3 tabular-nums">{l.balanceCents === null ? "" : amt(l.balanceCents)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-sand-200 px-6 py-4">
          <span className={`text-[14.5px] ${diff === 0 ? "text-success" : "text-danger"}`}>{diff === 0 ? "Difference 0.00." : `Difference ${amt(Math.abs(diff))}. Import turns on at 0.00.`}</span>
          <span className="flex-1" />
          {editable && <button type="button" disabled={diff !== 0 || busy} onClick={doImport} className="btn h-11 px-8 text-[15px]">{busy ? "Importing…" : "Import"}</button>}
        </div>
      </div>
    </div>
  );
}
