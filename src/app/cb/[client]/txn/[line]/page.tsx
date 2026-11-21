import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/dates";
import { bracketAmount } from "@/lib/closebook/amount";
import { acctLabel, getBooks } from "../../../data";

// CB2-1: one bank transaction, read only, with the postings it made (QBO's transaction journal). Changing it comes with
// Bank transactions (PR B).
export default async function BankTxn({ params, searchParams }: { params: Promise<{ client: string; line: string }>; searchParams: Promise<{ back?: string }> }) {
  const { client, line } = await params;
  const { back } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(line)) notFound();
  const b = await getBooks(client);
  if (!b) notFound();
  const supabase = await createClient();
  const { data: l } = await supabase.from("cb_bank_lines").select("id, file_id, txn_date, acct_date, description, amount, memo, status, account:account_id(name)").eq("id", line).maybeSingle();
  if (!l || !b.files.some((f) => f.id === l.file_id)) notFound();
  const posts = b.books.postings.filter((p) => p.ref === line);
  const name = (ident: string) => { const a = b.byIdent.get(ident); return a ? acctLabel(a) : ident.replace(/^name:/, ""); };
  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      <Link href={back ?? `/cb/${client}/reports`} className="inline-flex items-center gap-1 text-[13px] font-semibold text-navy-700 hover:underline" data-back><ChevronLeft className="h-4 w-4" />Back</Link>
      <div className="card grid gap-3 p-5" data-bank-txn>
        <h1 className="text-[18px] font-bold">Bank transaction</h1>
        <dl className="grid grid-cols-[9rem_1fr] gap-y-1.5 text-[13.5px]">
          <dt className="text-ink-3">Account</dt><dd>{(l.account as unknown as { name: string } | null)?.name}</dd>
          <dt className="text-ink-3">Date</dt><dd>{formatDate(l.acct_date ?? l.txn_date)}</dd>
          <dt className="text-ink-3">Description</dt><dd>{l.description}</dd>
          <dt className="text-ink-3">Amount</dt><dd className="tabular-nums">{bracketAmount(Math.round(Number(l.amount) * 100))}</dd>
          {l.memo && <><dt className="text-ink-3">Memo</dt><dd>{l.memo}</dd></>}
        </dl>
        <h2 className="mt-2 text-[14px] font-bold">Transaction journal</h2>
        <table className="table table-compact"><thead><tr><th>Account</th><th className="text-right">Debit</th><th className="text-right">Credit</th></tr></thead>
          <tbody>{posts.map((p, i) => <tr key={i}><td>{name(p.ident)}</td><td className="text-right tabular-nums">{p.cents > 0 ? bracketAmount(p.cents) : ""}</td><td className="text-right tabular-nums">{p.cents < 0 ? bracketAmount(-p.cents) : ""}</td></tr>)}
            {!posts.length && <tr><td colSpan={3} className="text-ink-3">Not posted yet.</td></tr>}</tbody></table>
      </div>
    </div>
  );
}
