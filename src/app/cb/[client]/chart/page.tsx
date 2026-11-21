import { notFound } from "next/navigation";
import { canEdit, requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { staffNames } from "@/lib/closebook/server";
import { balancesOn, currentYear, getBooks } from "../../data";
import { ChartView, type ChartRow } from "./view";

// CB2-1 Part 3b: QBO's Chart of accounts. New opens a side panel; each row's ⋯ menu: Edit, Run report, Make inactive,
// History. Merge: give an account another account's number.
export default async function ChartPage({ params, searchParams }: { params: Promise<{ client: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess("closebook", "view");
  const { client } = await params;
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const supabase = await createClient();
  const cur = currentYear(b);
  const bal = balancesOn(b, cur.asOf);
  const [{ data: codes }, history] = await Promise.all([
    supabase.from("cb_sales_tax_codes").select("code, name, provinces").order("sort_order"),
    sp.history && /^[0-9a-f-]{36}$/.test(sp.history)
      ? supabase.from("cb_books_history").select("id, action, detail, old_value, new_value, created_at, actor_id").eq("account_id", sp.history).order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ]);
  const names = history.data ? await staffNames(supabase) : new Map<string, string>();
  const rows: ChartRow[] = b.chart.filter((a) => !a.merged_into).map((a) => ({
    id: a.id, ident: a.ident, number: a.number, name: a.name, type: a.account_type, line_no: a.line_no, lineName: a.line_no ? b.lineName.get(a.line_no) ?? "" : "",
    tax: a.tax_code, active: a.active, balance: bal.get(a.ident) ?? 0, salesTax: a.salesTax,
  }));
  const lines = b.gifiLines.map((l) => ({ value: l.line_no, label: `${l.line_no.replace(/\.00$/, "")} ${l.name}`, sort: l.line_no }));
  const province = b.client.province;
  const taxes = ((codes ?? []) as { code: string; name: string; provinces: string[] | null }[]).filter((c) => !c.provinces || c.provinces.includes(province)).map((c) => ({ value: c.code, label: c.name }));
  return <ChartView clientId={client} rows={rows} lines={lines} taxes={taxes} canEdit={canEdit(access, "closebook")} asOf={cur.asOf} from={cur.from}
    panel={sp.panel ?? null} historyFor={sp.history ?? null}
    history={((history.data ?? []) as { id: string; action: string; detail: string; old_value: string | null; new_value: string | null; created_at: string; actor_id: string | null }[])
      .map((h) => ({ ...h, who: h.actor_id ? names.get(h.actor_id) ?? "" : "" }))} />;
}
