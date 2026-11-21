import { notFound } from "next/navigation";
import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import type { CsvMapping } from "@/lib/books/csv";
import { acctLabel, getBankAccounts, getBooks } from "../../../data";
import { UploadView } from "./view";

// CB2-1 PR B part h: QBO's Upload from file. Choose the account and the CSV, map the columns once, preview, Upload.
export default async function UploadPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAccess("closebook", "edit");
  const { client } = await params;
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const cards = await getBankAccounts(client);
  const supabase = await createClient();
  const { data: maps } = await supabase.from("cb_books_csv_maps").select("ident, mapping").eq("cb_client_id", client);
  const saved: Record<string, CsvMapping> = {};
  for (const m of (maps ?? []) as { ident: string; mapping: CsvMapping }[]) saved[m.ident] = m.mapping;
  return <UploadView clientId={client} accounts={cards.map((c) => ({ value: c.ident, label: acctLabel({ number: c.ident, name: c.name }), kind: c.kind }))}
    initial={cards.some((c) => c.ident === sp.account) ? sp.account! : cards[0]?.ident ?? ""} saved={saved}
    years={b.files.map((f) => ({ from: f.year_start, to: f.year_end }))} />;
}
