import { redirectKeep } from "../../redirect-keep";

// Round 17: now Email sending.
export default async function Old({ searchParams }: PageProps<"/admin/settings/signing-email">) {
  return redirectKeep("/admin/email-sending", searchParams);
}
