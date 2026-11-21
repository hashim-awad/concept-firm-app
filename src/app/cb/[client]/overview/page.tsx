import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { bracketAmount } from "@/lib/closebook/amount";
import { formatDate } from "@/lib/dates";
import { statements, trialBalance } from "@/lib/closebook/reports";
import { overviewOn } from "@/lib/books/overview";
import { balancesOn, currentYear, getBankAccounts, getBooks, inputFor } from "../../data";

// CB2-1 Part 3a: one page, no tabs. Every figure opens its report in one click.

export default async function Overview({ params }: { params: Promise<{ client: string }> }) {
  const { client } = await params;
  const b = await getBooks(client);
  if (!b) notFound();
  const cur = currentYear(b);
  const base = `/cb/${client}`;
  if (!b.files.length) {
    return <div className="mx-auto max-w-3xl"><h1 className="text-[22px] font-bold">Overview</h1>
      <p className="mt-3 text-[14px] text-ink-2">This client has no year in Closebook yet. Start the year in Closebook (old screens), then its books show here.</p></div>;
  }
  const ytd = inputFor(b, cur.from, cur.asOf);
  const ni = statements(trialBalance(ytd.accounts, ytd.postings), b.info).pl.net.now;
  const bal = balancesOn(b, cur.asOf);
  const banks = await getBankAccounts(client);
  const supabase = await createClient();
  const ids = banks.flatMap((x) => x.ids);
  const { data: pending } = ids.length ? await supabase.from("cb_bank_lines").select("account_id").in("account_id", ids).eq("status", "new").limit(50000) : { data: [] };
  const review = new Map<string, number>();
  for (const r of (pending ?? []) as { account_id: string }[]) review.set(r.account_id, (review.get(r.account_id) ?? 0) + 1);
  // Cash and the shareholder figure by GIFI line, never by account number (the balance sheet's own totals).
  const fig = overviewOn(b, cur.asOf);
  const gl = (keys: string[]) => `${base}/reports/gl?to=${cur.asOf}&from=${cur.from}&account=${encodeURIComponent(keys.join(","))}`;
  const range = `${formatDate(cur.from)} to ${formatDate(cur.asOf)}`;
  const tile = (label: string, cents: number, href: string, note: string, attr: string) => (
    <Link href={href} className="card block p-4 hover:border-navy-500" {...{ [attr]: "" }}>
      <p className="text-[12px] font-semibold uppercase tracking-[.06em] text-ink-3">{label}</p>
      <p className="mt-1 text-[24px] font-bold tabular-nums text-navy-900">{bracketAmount(cents)}</p>
      <p className="mt-0.5 text-[12px] text-ink-3">{note}</p>
    </Link>
  );
  return (
    <div className="mx-auto grid max-w-6xl gap-5">
      <div><h1 className="text-[22px] font-bold">Overview</h1><p className="text-[13px] text-ink-3">Fiscal year {formatDate(cur.from)} to {formatDate(cur.to)}</p></div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tile("Net income, year to date", ni, `${base}/reports/pl?from=${cur.from}&to=${cur.asOf}`, range, "data-ov-ni")}
        {tile("Cash and bank", fig.cash, gl(fig.cashKeys), `At ${formatDate(cur.asOf)}`, "data-ov-cash")}
        <Link href={`${base}/chart`} className="card block p-4 hover:border-navy-500" data-ov-gst>
          <p className="text-[12px] font-semibold uppercase tracking-[.06em] text-ink-3">GST/HST payable</p>
          <p className="mt-1 text-[15px] font-semibold text-navy-700">Set up sales tax accounts</p>
          <p className="mt-0.5 text-[12px] text-ink-3">The tile reads the CRA control accounts (next update).</p>
        </Link>
        {tile("Due to (from) shareholder", fig.shareholder, gl(fig.shareholderKeys), `At ${formatDate(cur.asOf)} (positive: owed to the shareholder)`, "data-ov-sh")}
      </div>
      <section className="card p-0">
        <h2 className="border-b border-sand-200 px-4 py-2.5 text-[14px] font-bold">Bank and card accounts</h2>
        <table className="table">
          <thead><tr><th>Account</th><th className="text-right">Balance in Closebook</th><th className="text-right">For review</th></tr></thead>
          <tbody>{banks.map((x) => {
            const n = x.ids.reduce((c, id) => c + (review.get(id) ?? 0), 0);
            const v = bal.get(x.ident) ?? 0;
            return (
              <tr key={x.ident} data-ov-bank={x.ident}>
                <td><Link href={gl([x.ident])} className="font-semibold text-navy-700 hover:underline">{x.ident} {x.name}</Link> <span className="text-[12px] text-ink-3">{x.kind === "card" ? "Card" : "Bank"}</span></td>
                <td className="text-right tabular-nums"><Link href={gl([x.ident])} className="hover:underline">{bracketAmount(x.kind === "card" ? -v : v)}</Link></td>
                <td className="text-right tabular-nums">{n}</td>
              </tr>
            );
          })}
            {!banks.length && <tr><td colSpan={3} className="text-ink-3">No bank or card account yet.</td></tr>}</tbody>
        </table>
      </section>
    </div>
  );
}
