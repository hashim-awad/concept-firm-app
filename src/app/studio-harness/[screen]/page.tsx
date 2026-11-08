// Test page for the screen parity test. It exists only when the app is started with
// STUDIO_HARNESS=1 (the CI parity job). Everywhere else, including Vercel, it is "not found".
// It shows the real Studio screens with dummy data that the test passes in; nothing is saved
// and no database is touched.
import { notFound } from "next/navigation";
import { Harness } from "./harness";

export default async function StudioHarnessPage({ params }: PageProps<"/studio-harness/[screen]">) {
  if (process.env.STUDIO_HARNESS !== "1") notFound();
  const { screen } = await params;
  if (!["corporate", "t1", "proposal"].includes(screen)) notFound();
  async function signOut() {
    "use server";
  }
  return <Harness screen={screen as "corporate" | "t1" | "proposal"} signOut={signOut} />;
}
