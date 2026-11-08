"use client";
import { useEffect, useState } from "react";
import type { ScreenEnv } from "@/components/studio/kit";
import { CorporateLetterScreen } from "@/components/studio/corporate-letter-screen";
import { T1LetterScreen } from "@/components/studio/t1-letter-screen";
import { ProposalScreen } from "@/components/studio/proposal-screen";

type Init = { env: ScreenEnv; isOwner: boolean; key: number };

export function Harness({ screen }: { screen: "corporate" | "t1" | "proposal" }) {
  const [init, setInit] = useState<Init | null>(null);
  useEffect(() => {
    // The test calls this with dummy price book rows and image stand-ins, then fills the form.
    (window as unknown as { __harnessInit: (i: Omit<Init, "key">) => void }).__harnessInit = (i) => setInit({ ...i, key: Date.now() });
  }, []);
  if (!init) return <p id="harness-waiting">Waiting for test data.</p>;
  const props = { key: init.key, env: init.env, clients: [], isOwner: init.isOwner };
  return (
    <main className="p-4" id="harness-ready">
      {screen === "corporate" && <CorporateLetterScreen {...props} />}
      {screen === "t1" && <T1LetterScreen {...props} />}
      {screen === "proposal" && <ProposalScreen {...props} />}
    </main>
  );
}
