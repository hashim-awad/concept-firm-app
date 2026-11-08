// Test page for the screen parity test. It exists only when the app is started with
// STUDIO_HARNESS=1 (the CI parity job). Everywhere else, including Vercel, it is "not found".
// It shows the real Studio screens with dummy data that the test passes in; nothing is saved
// and no database is touched.
import { notFound } from "next/navigation";
import { Harness } from "./harness";
import { wordingSamples } from "@/lib/studio/samples";
import { PIECES } from "@/lib/studio/wording-pieces";
import { WordingEditor } from "../../(app)/admin/templates/versions/[id]/wording-editor";

export default async function StudioHarnessPage({ params }: PageProps<"/studio-harness/[screen]">) {
  if (process.env.STUDIO_HARNESS !== "1") notFound();
  const { screen } = await params;
  if (screen === "wording") {
    // Wording editor with the original wording and made-up details (nothing can be saved here).
    const signers = { letter: { name: "Test Signer, CPA", title: "Director" }, proposal: { name: "Test Signer", title: "Director" } };
    const samples = wordingSamples(signers, null);
    const pieces = PIECES.map((p) => ({ key: p.key, original: p.text, current: p.text, draft: p.text }));
    return (
      <div id="harness-ready" className="flex h-screen flex-col bg-paper p-4">
        <WordingEditor versionId="00000000-0000-0000-0000-000000000000" label="EL v3.32" currentLabel="EL v3.31" editable samples={samples} pieces={pieces} />
      </div>
    );
  }
  if (!["corporate", "t1", "proposal"].includes(screen)) notFound();
  async function signOut() {
    "use server";
  }
  return <Harness screen={screen as "corporate" | "t1" | "proposal"} signOut={signOut} />;
}
