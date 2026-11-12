import Link from "next/link";
import { requireAccessWithPricing } from "@/lib/access";
import { ArrowLeft } from "lucide-react";
import CorporateLetterPage from "../../documents/corporate-letter/page";
import T1LetterPage from "../../documents/t1-letter/page";

// Engagement letters › New letter (owners; front office batch, section 7): the Letter Builder,
// unchanged: corporate and T1 on one page, the type chosen at the top. Final sends it for online signing.
export default async function NewLetterPage({ searchParams }: PageProps<"/engagement-letters/new">) {
  await requireAccessWithPricing("documents", "edit");
  const sp = await searchParams;
  const type = sp.type === "t1" ? "t1" : "corporate";
  const keep = new URLSearchParams();
  // Switching type starts a fresh letter; only the client carries over.
  if (typeof sp.client === "string") keep.set("client", sp.client);
  const href = (t: string) => `/engagement-letters/new?type=${t}${keep.size ? "&" + keep : ""}`;
  return (
    <>
      <Link href="/engagement-letters" className="mb-2 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden />Engagement letters</Link>
      <div className="mb-2 flex shrink-0 items-center gap-3">
        <span className="text-[13px] font-medium text-ink-2" id="el-type">Letter type</span>
        <div role="group" aria-labelledby="el-type" className="inline-flex rounded-lg border border-sand-200 bg-surface p-0.5">
          {[["corporate", "Corporate"], ["t1", "Personal tax (T1)"]].map(([k, l]) => (
            <Link key={k} href={href(k)} aria-current={type === k ? "page" : undefined}
              className={`rounded-md px-3 py-1 text-[13px] font-medium ${type === k ? "bg-navy-700 text-white" : "text-ink-2 hover:text-ink"}`}>{l}</Link>
          ))}
        </div>
      </div>
      {type === "t1" ? <T1LetterPage searchParams={Promise.resolve(sp)} params={Promise.resolve({})} /> : <CorporateLetterPage searchParams={Promise.resolve(sp)} params={Promise.resolve({})} />}
    </>
  );
}
