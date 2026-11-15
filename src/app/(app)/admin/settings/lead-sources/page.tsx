import { redirectKeep } from "../../redirect-keep";

// Round 17: now Lead sources in the gear menu.
export default async function Old({ searchParams }: PageProps<"/admin/settings/lead-sources">) {
  return redirectKeep("/admin/lead-sources", searchParams);
}
