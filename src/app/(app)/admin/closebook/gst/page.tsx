import { redirectKeep } from "../../redirect-keep";

// Round 17: the due dates are a tab of Closebook rules; the quick method rates are a tab of Sales tax rates.
export default async function Old({ searchParams }: PageProps<"/admin/closebook/gst">) {
  return redirectKeep("/admin/closebook-rules?tab=due-dates", searchParams);
}
