import { redirectKeep } from "../../redirect-keep";

// Round 17: now a tab of Online sales.
export default async function Old({ searchParams }: PageProps<"/admin/settings/booking-link">) {
  return redirectKeep("/admin/online-sales?tab=booking", searchParams);
}
