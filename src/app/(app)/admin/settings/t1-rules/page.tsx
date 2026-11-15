import { redirectKeep } from "../../redirect-keep";

// Round 17: now T1 rule values in the gear menu.
export default async function Old({ searchParams }: PageProps<"/admin/settings/t1-rules">) {
  return redirectKeep("/admin/t1-rules", searchParams);
}
