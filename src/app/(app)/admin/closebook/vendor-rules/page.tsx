import { redirectKeep } from "../../redirect-keep";

// Round 17: now its own page, Vendor rules.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/vendor-rules">) {
  return redirectKeep("/admin/vendor-rules", searchParams);
}
