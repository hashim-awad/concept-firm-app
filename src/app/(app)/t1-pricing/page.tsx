import { redirect } from "next/navigation";

// The T1 pricing calculator now lives in Settings › Pricing › T1 price check.
export default function T1PricingPage() {
  redirect("/admin/t1-price-check");
}
