import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/access";

// Import TaxDome export (decision 43). Round 18: the import opens as a dialog on Clients, so the gear's
// Tools entry sends owners there. The access check stays here for the gear menu test.
export default async function TaxdomeImportPage() {
  await requireAdmin("clients");
  redirect("/clients?import=1");
}
