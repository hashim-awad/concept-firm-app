// Rebuilds a letter or proposal from saved screen inputs, exactly as the screen does, and
// returns the checks and the PDF definition. Pure: no database, no files. Used by the save
// action on the server and by the unit test (tests/studio-build.test.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createStudioEngine, type StudioEngine } from "./engine.generated.js";
import { CorporateLetter, Proposal, T1Letter, type Fee } from "./controllers.ts";
import { corporateScreen, proposalScreen, t1Screen, type ScreenResult } from "./screen.ts";
import { ILLUSTRATIVE, LETTERHEAD } from "./assets.generated.ts";
import type { StudioData } from "./data";

export type DocKind = "corporate_letter" | "t1_letter" | "proposal";

export const BLANK_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

export function engineFor(kind: DocKind, data: Pick<StudioData, "floors" | "floorsOk" | "cat" | "signers">, sig: string): StudioEngine {
  const signer = kind === "proposal" ? data.signers.proposal : data.signers.letter;
  return createStudioEngine({
    DB: { floors: data.floors, floorsOk: data.floorsOk, loaded: true, cat: data.cat },
    LH: LETTERHEAD, ILLUS: ILLUSTRATIVE, SIG: sig, SIGNER: signer.name, SIGNER_TITLE: signer.title,
  });
}

export type Built = { s: any; scr: ScreenResult; def: any; fileName: string; title: string; inputs: any; e: StudioEngine };

// Rebuild the document from the saved inputs, exactly as the screen did.
export function rebuild(kind: DocKind, e: StudioEngine, snap: any, client: any, isOwner: boolean, today: string): Built {
  const mode = snap?.mode === "final" ? "final" : "draft";
  if (kind === "corporate_letter") {
    const c = new CorporateLetter(e, String(snap?.f?.letterDate || today));
    c.load(snap?.f ?? {}, (snap?.fees ?? []) as Fee[], mode);
    c.acks = { ab: !!snap?.acks?.ab, bc: !!snap?.acks?.bc };
    const s = c.state();
    const scr = corporateScreen(e, s, { client, loaded: true, isOwner, acks: c.acks });
    return { s, scr, e, def: e.pdfDoc(s, e.build(s), LETTERHEAD), fileName: e.fileName(s), title: `${e.trim(s.company)} engagement letter FYE ${s.ye}`, inputs: { f: c.f, fees: c.fees, mode, acks: c.acks } };
  }
  if (kind === "t1_letter") {
    const c = new T1Letter(e, String(snap?.f?.letterDate || today));
    Object.assign(c.f, snap?.f ?? {}); c.setMode(mode);
    c.acks = { ab: !!snap?.acks?.ab, bc: !!snap?.acks?.bc };
    const s = c.state();
    if (s.card === "standalone") throw new Error("Standalone T1 letters are sent from TaxDome.");
    const scr = t1Screen(e, s, { client, loaded: true, isOwner, acks: c.acks });
    return { s, scr, e, def: e.pdfDoc(s, e.buildT1(s), LETTERHEAD), fileName: e.t1FileName(s), title: `${e.t1Names(s)} T1 ${s.taxYear}`, inputs: { f: c.f, mode, acks: c.acks } };
  }
  const c = new Proposal(e, String(snap?.f?.date || today));
  Object.assign(c.f, snap?.f ?? {}); c.setMode(mode);
  e.__set("POPTS", Array.isArray(snap?.opts) && snap.opts.length ? snap.opts : c.opts);
  e.__set("pRec", Number(snap?.rec) || 0);
  const s = c.state();
  const scr = proposalScreen(e, s, { client: null, loaded: true, isOwner, acks: {} });
  const out = c.output();
  return { s, scr, e, def: e.pPdf(s), fileName: out.fileName, title: `${s.name} proposal ${s.date}`, inputs: { f: c.f, opts: s.opts, rec: s.rec, mode } };
}

