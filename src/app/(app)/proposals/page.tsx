import { redirect } from "next/navigation";

// "Proposals" is now "Quotes" (front office batch, section 3). Old links keep working.
export default function OldProposalsPage() {
  redirect("/quotes");
}
