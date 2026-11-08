// Test-only (STUDIO_HARNESS=1): renders a made-up corporate letter with the server PDF code,
// so the CI screen test proves PDFs build in the production bundle. "Not found" everywhere else.
import { NextResponse } from "next/server";
import { rebuild, engineFor, BLANK_PNG } from "@/lib/studio/build";
import { renderPdf } from "@/lib/studio/pdf";
import { CorporateLetter } from "@/lib/studio/controllers";
import { createStudioEngine } from "@/lib/studio/engine.generated";

export async function GET() {
  if (process.env.STUDIO_HARNESS !== "1") return new NextResponse("Not found", { status: 404 });
  const ctl = new CorporateLetter(createStudioEngine({}), "2026-11-08");
  for (const [k, v] of Object.entries({ company: "Example Holdings Inc.", signer: "Taylor Sample", salutation: "Taylor", addr1: "1 Test Street", city: "Kitchener", postal: "N2A 1A1", ye: "2026-12-31" })) ctl.set(k, v);
  ctl.fees.forEach((f, i) => ctl.setFee(i, "amt", i === 0 ? "2800" : "Included"));
  const data = { floors: [], floorsOk: false, cat: [], signers: { letter: { name: "Test Signer, CPA", title: "Director" }, proposal: { name: "Test Signer", title: "Director" } } };
  const b = rebuild("corporate_letter", engineFor("corporate_letter", data, BLANK_PNG), { f: ctl.f, fees: ctl.fees, mode: "draft" }, null, false, "2026-11-08");
  const pdf = await renderPdf(b.def, { regenerated: true });
  return new NextResponse(new Uint8Array(pdf.bytes), { headers: { "Content-Type": "application/pdf", "X-Sha256": pdf.sha256 } });
}
