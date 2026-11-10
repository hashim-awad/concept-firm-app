import { Building2, User } from "lucide-react";
import { RouteCard, TrustRow } from "@/components/ds/client";
import { startGate } from "./gate";
import { Closed, PreviewNote } from "./closed";

// Public start page (brief "Lead flow" step 1; batch section 10 labels).
export default async function StartPage() {
  const gate = await startGate();
  if (!gate.open) return <Closed />;
  return (
    <>
      {gate.preview && <PreviewNote />}
      <h1 className="text-[28px] leading-9 font-semibold tracking-tight">Your tax return, prepared and reviewed by a CPA.</h1>
      <p className="mt-2 text-ink-2">Answer a few questions. We review them and email you your quote.</p>
      <div className="mt-8 grid gap-4">
        <RouteCard href="/start/personal" icon={<User />} title="My personal tax return" body="For individuals, couples and the self-employed." />
        <RouteCard href="/start/company" icon={<Building2 />} title="My company" body="Year-end, tax return and GST/HST, or monthly bookkeeping" />
      </div>
      <div className="mt-6"><TrustRow /></div>
    </>
  );
}
