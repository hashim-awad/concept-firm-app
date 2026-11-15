import { redirectKeep } from "../../redirect-keep";

// Round 17: now a tab of Chart and GIFI.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/tax-codes">) {
  return redirectKeep("/admin/chart?tab=tax-codes", searchParams);
}
