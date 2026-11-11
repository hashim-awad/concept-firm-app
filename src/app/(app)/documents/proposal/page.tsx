import { redirect } from "next/navigation";

// The proposal builder moved to Quotes (front office batch, section 3). Old links keep working.
export default async function OldProposalPage({ searchParams }: PageProps<"/documents/proposal">) {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
  redirect(`/quotes/proposal${q.size ? `?${q}` : ""}`);
}
