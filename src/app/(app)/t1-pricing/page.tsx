import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { T1PricingScreen } from "@/components/studio/t1-pricing-screen";
import { screenSetup } from "@/lib/studio/page-data";

export default async function T1PricingPage() {
  const access = await requireAccess("documents", "edit");
  const { env } = await screenSetup(await createClient(), access, "letter");
  return (
    <>
      <PageHeader eyebrow="Documents" title="T1 Pricing Calculator" description="Price a standalone personal tax return from the client's scope answers. Prices come from the Service catalogue. One fee, charged once, before tax." />
      <T1PricingScreen env={env} />
    </>
  );
}
