"use client";
import { useEffect, useState } from "react";
import type { ScreenEnv } from "@/components/studio/kit";
import { CorporateLetterScreen } from "@/components/studio/corporate-letter-screen";
import { T1LetterScreen } from "@/components/studio/t1-letter-screen";
import { ProposalScreen } from "@/components/studio/proposal-screen";
import { WorkspaceHeader } from "@/components/studio/kit";
import { TopBar } from "../../(app)/top-bar";
import { MainArea } from "../../(app)/main-area";

type Init = { env: ScreenEnv; finalRight: boolean; key: number };

export function Harness({ screen, signOut }: { screen: "corporate" | "t1" | "proposal"; signOut: () => Promise<void> }) {
  const [init, setInit] = useState<Init | null>(null);
  useEffect(() => {
    // The test calls this with dummy price book rows and image stand-ins, then fills the form.
    (window as unknown as { __harnessInit: (i: Omit<Init, "key">) => void }).__harnessInit = (i) => setInit({ ...i, key: Date.now() });
  }, []);
  if (!init) return <p id="harness-waiting">Waiting for test data.</p>;
  const props = { key: init.key, env: init.env, clients: [], finalRight: init.finalRight };
  const title = { corporate: "Corporate Letter", t1: "Personal Tax Letter (T1)", proposal: "Proposal" }[screen];
  // Same frame as the app: top bar (dummy test user) and the full-width document area.
  return (
    <div id="harness-ready" data-ui1 className="flex min-h-screen flex-col bg-paper">
      <TopBar name="Test User" role="Partner" initials="TU" clients={false} newItems={[]} gear={[]} drafts={0} signOut={signOut}
        nav={{ leads: true, clients: true, closebook: true, engagements: true, documents: true }} counts={{ leadsNew: 0, lettersWaiting: 0, quotesWaiting: 2 }} />
      <MainArea workspace>
        <WorkspaceHeader title={title} description="Test page with made-up data." />
        {screen === "corporate" && <CorporateLetterScreen {...props} />}
        {screen === "t1" && <T1LetterScreen {...props} />}
        {screen === "proposal" && <ProposalScreen {...props} />}
      </MainArea>
    </div>
  );
}
