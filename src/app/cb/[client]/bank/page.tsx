import { notFound } from "next/navigation";
import { canEdit, requireAccess } from "@/lib/access";
import { loadBankPage } from "./load";
import { BankView } from "./view";

// CB2-1 PR B part g: QBO's Bank transactions. One card per bank or card account; tabs For review, Categorized, Excluded.
export default async function BankPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess("closebook", "view");
  const { client } = await params;
  const sp = await searchParams;
  const data = await loadBankPage(client, sp.account ?? null);
  if (!data) notFound();
  const tab = sp.tab === "categorized" || sp.tab === "excluded" ? sp.tab : "review";
  return <BankView clientId={client} data={data} tab={tab} canEdit={canEdit(access, "closebook")} />;
}
