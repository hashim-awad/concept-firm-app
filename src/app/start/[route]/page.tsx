import { notFound } from "next/navigation";
import { ProgressBar } from "@/components/ds/client";
import { startGate } from "../gate";
import { Closed, PreviewNote } from "../closed";
import { StartForm } from "./start-form";

export default async function StartRoutePage({ params }: PageProps<"/start/[route]">) {
  const { route } = await params;
  if (route !== "personal" && route !== "company") notFound();
  const gate = await startGate();
  if (!gate.open) return <Closed />;
  return (
    <>
      {gate.preview && <PreviewNote />}
      <ProgressBar value={0.1} label="About you" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{route === "personal" ? "My personal tax return" : "My company"}</h1>
      <p className="mt-1 mb-6 text-ink-2">First, your details, so we can send you your quote.</p>
      <StartForm route={route} />
    </>
  );
}
