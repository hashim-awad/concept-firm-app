import { redirectKeep } from "../../redirect-keep";

// Round 17: now a tab of Firm details.
export default async function Old({ searchParams }: PageProps<"/admin/settings/signers">) {
  return redirectKeep("/admin/firm?tab=signers", searchParams);
}
