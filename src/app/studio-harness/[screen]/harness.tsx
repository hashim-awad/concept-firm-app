"use client";
import { useEffect, useState } from "react";
import type { ScreenEnv } from "@/components/studio/kit";
import { CorporateLetterScreen } from "@/components/studio/corporate-letter-screen";
import { T1LetterScreen } from "@/components/studio/t1-letter-screen";
import { ProposalScreen } from "@/components/studio/proposal-screen";
import { WorkspaceHeader } from "@/components/studio/kit";
import { AppSidebar } from "../../(app)/app-sidebar";
import { MainArea } from "../../(app)/main-area";

type Init = { env: ScreenEnv; isOwner: boolean; key: number };

export function Harness({ screen, signOut }: { screen: "corporate" | "t1" | "proposal"; signOut: () => Promise<void> }) {
  const [init, setInit] = useState<Init | null>(null);
  useEffect(() => {
    // The test calls this with dummy price book rows and image stand-ins, then fills the form.
    (window as unknown as { __harnessInit: (i: Omit<Init, "key">) => void }).__harnessInit = (i) => setInit({ ...i, key: Date.now() });
  }, []);
  if (!init) return <p id="harness-waiting">Waiting for test data.</p>;
  const props = { key: init.key, env: init.env, clients: [], isOwner: init.isOwner };
  const title = { corporate: "Corporate Letter", t1: "Personal Tax Letter (T1)", proposal: "Proposal" }[screen];
  // Same frame as the app: sidebar (dummy test user) and the full-width document area.
  return (
    <div id="harness-ready" className="min-h-screen bg-paper md:flex">
      <AppSidebar signOut={signOut} access={{ fullName: "Test User", roleName: "Owner", isOwner: true, leads: true, vault: true, pricing: true, screening: true, templates: true, documents: true, documentsEdit: true, clients: true, taxRates: true, staff: true, settings: true, closebook: true }} counts={{ quotesAwaiting: 2, lettersAwaiting: 0, leadsNew: 0 }} />
      <MainArea workspace>
        <WorkspaceHeader title={title} description="Test page with made-up data." />
        {screen === "corporate" && <CorporateLetterScreen {...props} />}
        {screen === "t1" && <T1LetterScreen {...props} />}
        {screen === "proposal" && <ProposalScreen {...props} />}
      </MainArea>
    </div>
  );
}
