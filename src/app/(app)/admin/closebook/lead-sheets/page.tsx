import { redirectKeep } from "../../redirect-keep";

// Round 17: now a tab of Chart and GIFI.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/lead-sheets">) {
  return redirectKeep("/admin/chart?tab=lead-sheets", searchParams);
}
