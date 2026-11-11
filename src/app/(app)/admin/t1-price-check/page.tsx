import { requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ds/primitives";
import { T1PricingScreen } from "@/components/studio/t1-pricing-screen";
import { screenSetup } from "@/lib/studio/page-data";

// Settings › Pricing › T1 price check (front office batch, section 6): the T1 pricing calculator,
// unchanged. Owners and staff with Pricing only. It reads the live price book and creates nothing:
// no lead, no quote, no record. Use it to check the client-facing prices and to try a price change.
export default async function T1PriceCheckPage() {
  const access = await requireAccess("pricing", "view");
  const supabase = await createClient();
  const { env } = await screenSetup(supabase, access, "letter");
  return (
    <>
      <PageHeader eyebrow="Settings › Pricing" title="T1 price check"
        description="Price a personal tax return from the scope answers, to check the client-facing prices or try a price change. Prices come from the live price book. It creates no lead, quote or record." />
      <T1PricingScreen env={env} />
    </>
  );
}
