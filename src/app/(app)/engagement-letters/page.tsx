import Link from "next/link";
import { requireAccess } from "@/lib/access";
import CorporateLetterPage from "../documents/corporate-letter/page";
import T1LetterPage from "../documents/t1-letter/page";

// Engagement letters: corporate and T1 on one page, the type chosen at the top.
export default async function EngagementLettersPage({ searchParams }: PageProps<"/engagement-letters">) {
  await requireAccess("documents", "edit");
  const sp = await searchParams;
  const type = sp.type === "t1" ? "t1" : "corporate";
  const keep = new URLSearchParams();
  // Switching type starts a fresh letter; only the client carries over.
  if (typeof sp.client === "string") keep.set("client", sp.client);
  const href = (t: string) => `/engagement-letters?type=${t}${keep.size ? "&" + keep : ""}`;
  return (
    <>
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
