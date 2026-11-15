import { redirectKeep } from "../redirect-keep";

// Round 17: now a tab of Online sales.
export default async function Old({ searchParams }: PageProps<"/admin/screening">) {
  return redirectKeep("/admin/online-sales?tab=screening", searchParams);
}
