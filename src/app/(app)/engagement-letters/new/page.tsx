import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAccessWithPricing, letterTypes } from "@/lib/access";
import { withMessage } from "@/lib/messages";
import { ArrowLeft } from "lucide-react";
import CorporateLetterPage from "../../documents/corporate-letter/page";
import T1LetterPage from "../../documents/t1-letter/page";

// Engagements › Letters › New letter (front office batch, section 7): the Letter Builder, unchanged:
// corporate and T1 on one page, the type chosen at the top. Round 19: only the types ticked on the
// person's role (owners: both). Marking Final and sending stays with owners (save.ts and the database).
export default async function NewLetterPage({ searchParams }: PageProps<"/engagement-letters/new">) {
  const access = await requireAccessWithPricing("documents", "edit");
  const sp = await searchParams;
  const type = sp.type === "t1" ? "t1" : "corporate";
  const allowed = letterTypes(access);
  if (!allowed.length) redirect(withMessage("/engagements?tab=letters", "error", "Your role does not include engagement letters."));
  if (!allowed.includes(type)) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (typeof v === "string") q.set(k, v);
    q.set("type", allowed[0]);
    redirect(`/engagement-letters/new?${q}`);
  }
  const keep = new URLSearchParams();
  // Switching type starts a fresh letter; only the client carries over.
  if (typeof sp.client === "string") keep.set("client", sp.client);
  const href = (t: string) => `/engagement-letters/new?type=${t}${keep.size ? "&" + keep : ""}`;
  return (
    <>
      <Link href="/engagements?tab=letters" className="mb-2 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Letters</Link>
      <div className="mb-2 flex shrink-0 items-center gap-3">
        <span className="text-[13px] font-medium text-ink-2" id="el-type">Letter type</span>
        <div role="group" aria-labelledby="el-type" className="inline-flex rounded-lg border border-sand-200 bg-surface p-0.5">
          {[["corporate", "Corporate"], ["t1", "Personal tax (T1)"]].filter(([k]) => allowed.includes(k as "corporate" | "t1")).map(([k, l]) => (
            <Link key={k} href={href(k)} aria-current={type === k ? "page" : undefined}
              className={`rounded-md px-3 py-1 text-[13px] font-medium ${type === k ? "bg-navy-700 text-white" : "text-ink-2 hover:text-ink"}`}>{l}</Link>
          ))}
        </div>
      </div>
      {type === "t1" ? <T1LetterPage searchParams={Promise.resolve(sp)} params={Promise.resolve({})} /> : <CorporateLetterPage searchParams={Promise.resolve(sp)} params={Promise.resolve({})} />}
    </>
  );
}
