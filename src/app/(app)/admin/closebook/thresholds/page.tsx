import { redirectKeep } from "../../redirect-keep";

// Round 17: now a tab of Closebook rules.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/thresholds">) {
  return redirectKeep("/admin/closebook-rules?tab=thresholds", searchParams);
}
