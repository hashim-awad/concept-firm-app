import { redirectKeep } from "../../redirect-keep";

// Round 17: now Data retention.
export default async function Old({ searchParams }: PageProps<"/admin/settings/retention">) {
  return redirectKeep("/admin/retention", searchParams);
}
