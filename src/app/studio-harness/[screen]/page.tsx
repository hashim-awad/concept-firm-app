// Test page for the screen parity test. It exists only when the app is started with
// STUDIO_HARNESS=1 (the CI parity job). Everywhere else, including Vercel, it is "not found".
// It shows the real Studio screens with dummy data that the test passes in; nothing is saved
// and no database is touched.
import { notFound } from "next/navigation";
import { Harness } from "./harness";
import { templateSample } from "@/lib/studio/samples";
import { PIECE, toFriendly } from "@/lib/studio/wording-pieces";
import { TemplateEditor } from "@/components/studio/template-editor";

export default async function StudioHarnessPage({ params }: PageProps<"/studio-harness/[screen]">) {
  if (process.env.STUDIO_HARNESS !== "1") notFound();
  const { screen } = await params;
  if (screen === "wording") {
    // Template editor with the original wording and made-up details (nothing can be saved here).
    const signers = { letter: { name: "Test Signer, CPA", title: "Director" }, proposal: { name: "Test Signer", title: "Director" } };
    const sample = templateSample("master", signers, null, true)!;
    const keys = [...new Set(sample.parts.flatMap((p) => [...p.html.matchAll(/data-w="(w[0-9a-f]{10})"/g)].map((m) => m[1])))];
    const pieces = keys.filter((k) => PIECE.has(k)).map((k) => { const t = toFriendly(k, PIECE.get(k)!.text); return { key: k, original: t, live: t, draft: t, fills: PIECE.get(k)!.fills ?? [] }; });
    return (
      <main id="harness-ready" className="bg-paper p-6">
        <h1 className="mb-4 text-[26px] font-semibold">Corporate master letter</h1>
        <TemplateEditor parts={sample.parts} pieces={pieces} canEdit />
      </main>
    );
  }
  if (!["corporate", "t1", "proposal"].includes(screen)) notFound();
  async function signOut() {
    "use server";
  }
  return <Harness screen={screen as "corporate" | "t1" | "proposal"} signOut={signOut} />;
}
