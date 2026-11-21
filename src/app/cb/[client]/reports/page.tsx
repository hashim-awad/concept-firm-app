import Link from "next/link";
import { notFound } from "next/navigation";
import { getBooks, rangeOf } from "../../data";
import { REPORTS } from "./compute";

// CB2-1 Part 3d: QBO's Reports page, the Books reports in one list.
const ABOUT: Record<string, string> = {
  tb: "Each account's balance, debits and credits.",
  tbg: "Prelim, Adj's, Reclass, Final, Prior, $ change and % change, by group.",
  bs: "What the company owns and owes on a date.",
  pl: "Income and expenses for a period.",
  gl: "Every transaction by account, with a running balance.",
  journal: "Every transaction with its debits and credits.",
};

export default async function ReportsPage({ params }: { params: Promise<{ client: string }> }) {
  const { client } = await params;
  const b = await getBooks(client);
  if (!b) notFound();
  const r = rangeOf(b, {});
  return (
    <div className="mx-auto grid max-w-4xl gap-4">
      <h1 className="text-[22px] font-bold">Reports</h1>
      <ul className="card divide-y divide-sand-200 p-0">
        {Object.entries(REPORTS).map(([k, name]) => (
          <li key={k}><Link href={`/cb/${client}/reports/${k}?from=${r.from}&to=${r.to}`} className="block px-4 py-3 hover:bg-sand-50" data-report-link={k}>
            <span className="text-[14px] font-semibold text-navy-700">{name}</span><span className="block text-[12.5px] text-ink-3">{ABOUT[k]}</span></Link></li>
        ))}
      </ul>
    </div>
  );
}
