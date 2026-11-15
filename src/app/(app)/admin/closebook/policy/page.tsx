import { redirectKeep } from "../../redirect-keep";

// Round 17: now a tab of Closebook rules.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/policy">) {
  return redirectKeep("/admin/closebook-rules?tab=policy", searchParams);
}
