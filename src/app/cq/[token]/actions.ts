"use server";
// The client's questions page (round 32; no code, firm decision Nov 17, 2026). Every action checks the link is live;
// anyone with the link can answer, as with DocuSign's default link. Nothing here sends an email.
import { CqReadError, ERROR_TEXT, findLink, prepareUploads, reportLinkError, submitAnswer, type CqUpload } from "@/lib/closebook/client-questions-server";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const GONE = { ok: false as const, error: "This link is no longer active. Contact Concept Accounting for a new one." };
const BUSY = { ok: false as const, error: ERROR_TEXT };
// A database problem is said as such, never as "no longer active", and goes in History and the bell (round 32 fix).
async function safe<T>(token: string, run: () => Promise<T>): Promise<T | typeof BUSY> {
  try { return await run(); } catch (e) {
    if (!(e instanceof CqReadError)) throw e;
    await reportLinkError(token, e.message);
    return BUSY;
  }
}

export async function getUploads(token: string, lineId: string, files: CqUpload[]) {
  return safe(token, async () => {
    const cq = await findLink(token);
    if (!cq || !cq.live) return GONE;
    return prepareUploads(cq, lineId, files);
  });
}

export async function sendAnswer(token: string, lineId: string, text: string, files: { path: string; name: string; size: number }[]): Promise<R> {
  return safe(token, async () => {
    const cq = await findLink(token);
    if (!cq || !cq.live) return GONE;
    return submitAnswer(cq, cq.email, lineId, text, files);
  });
}
