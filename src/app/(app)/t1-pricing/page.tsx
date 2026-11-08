import { redirect } from "next/navigation";

// The T1 pricing calculator now lives on the Proposals page.
export default function T1PricingPage() {
  redirect("/proposals?tab=calculator");
}
