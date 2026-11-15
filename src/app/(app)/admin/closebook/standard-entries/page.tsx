import { redirectKeep } from "../../redirect-keep";

// Round 17: now its own page, Standard entries.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/standard-entries">) {
  return redirectKeep("/admin/standard-entries", searchParams);
}
