import { redirectKeep } from "../redirect-keep";

// Round 17: now a tab of Sales tax rates.
export default async function Old({ searchParams }: PageProps<"/admin/tax-rates">) {
  return redirectKeep("/admin/sales-tax?tab=rates", searchParams);
}
