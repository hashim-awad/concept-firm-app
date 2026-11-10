import { notFound } from "next/navigation";
import { startGate } from "../gate";
import { Closed, PreviewNote } from "../closed";
import { PersonalForm } from "./personal-form";
import { CompanySteps } from "./company-steps";
import { FIRM } from "@/components/ds/brand";
import { forBrowser, loadPublishedWhy, readT1Rules } from "@/lib/screening/server";
import { getAccess } from "@/lib/access";
import { T1Steps } from "./t1-steps";
import { T1_STEP_KEYS } from "@/lib/screening/t1-steps";
import { todayToronto } from "@/lib/dates";
import { taxYearFor } from "@/lib/screening/tax-year";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function StartRoutePage({ params }: PageProps<"/start/[route]">) {
  const { route } = await params;
  if (route !== "personal" && route !== "company") notFound();
  const gate = await startGate();
  if (!gate.open) return <Closed />;
  if (route === "personal") {
    const { qn, problem } = await loadPublishedWhy("personal");
    const { data: src } = await createAdminClient().from("settings").select("value").eq("key", "lead_sources").maybeSingle();
    return (
      <>
        {gate.preview && <PreviewNote />}
        {/* Steps when the published questions have the batch section 4 keys; otherwise the plain form
            (an owner changed the questions), which shows whatever is published. */}
        {qn && T1_STEP_KEYS.every((k) => qn.questions.some((x) => x.key === k))
          ? <T1Steps qn={forBrowser(qn)} sources={(src?.value ?? ["Website"]) as string[]} rules={await readT1Rules()} taxYear={taxYearFor(todayToronto())} />
          : qn ? <PersonalForm qn={forBrowser(qn)} sources={(src?.value ?? ["Website"]) as string[]} />
          : <div className="card text-ink-2"><p>This form is not ready yet. Please call us at {FIRM.phone}.</p>
              {/* Staff only: the real reason, so it can be fixed without guessing. */}
              {(await getAccess()) && <p className="mt-3 text-sm text-danger">Staff only: {problem || "unknown reason"}</p>}</div>}
      </>
    );
  }
  // Company (batch section 10).
  return (
    <>
      {gate.preview && <PreviewNote />}
      <CompanySteps />
    </>
  );
}

