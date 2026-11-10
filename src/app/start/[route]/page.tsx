import { notFound } from "next/navigation";
import { ProgressBar } from "@/components/ds/client";
import { startGate } from "../gate";
import { Closed, PreviewNote } from "../closed";
import { StartForm } from "./start-form";
import { PersonalForm } from "./personal-form";
import { FIRM } from "@/components/ds/brand";
import { forBrowser, loadPublished } from "@/lib/screening/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function StartRoutePage({ params }: PageProps<"/start/[route]">) {
  const { route } = await params;
  if (route !== "personal" && route !== "company") notFound();
  const gate = await startGate();
  if (!gate.open) return <Closed />;
  if (route === "personal") {
    const qn = await loadPublished("personal");
    const { data: src } = await createAdminClient().from("settings").select("value").eq("key", "lead_sources").maybeSingle();
    return (
      <>
        {gate.preview && <PreviewNote />}
        {qn ? <PersonalForm qn={forBrowser(qn)} sources={(src?.value ?? ["Website"]) as string[]} />
          : <p className="card text-ink-2">This form is not ready yet. Please call us at {FIRM.phone}.</p>}
      </>
    );
  }
  return (
    <>
      {gate.preview && <PreviewNote />}
      <ProgressBar value={0.1} label="About you" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">My company</h1>
      <p className="mt-1 mb-6 text-ink-2">First, your details, so we can send you your quote.</p>
      <StartForm route={route} />
    </>
  );
}
