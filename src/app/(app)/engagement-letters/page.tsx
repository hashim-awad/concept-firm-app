import { redirect } from "next/navigation";

// Round 19: Engagement letters became the Letters tab under Engagements. Old addresses still open.
export default async function EngagementLettersPage({ searchParams }: PageProps<"/engagement-letters">) {
  const sp = await searchParams;
  // The Letter Builder moved to New letter; old links (with a letter type, client or document) still work.
  if (["type", "client", "doc", "proposal"].some((k) => typeof sp[k] === "string")) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    redirect(`/engagement-letters/new?${q}`);
  }
  const q = new URLSearchParams({ tab: "letters" });
  if (sp.tab === "signed" || sp.tab === "all") q.set("status", sp.tab);
  for (const k of ["msg", "error"]) if (typeof sp[k] === "string") q.set(k, sp[k] as string);
  redirect(`/engagements?${q}`);
}
