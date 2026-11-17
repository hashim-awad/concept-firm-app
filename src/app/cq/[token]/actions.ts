"use server";
// Round 32: the client's questions page. Every action checks the link, and all but the code steps check the browser's session.
import { cookies } from "next/headers";
import { cookieName, findLink, prepareUploads, requestCode, sessionOk, submitAnswer, verifyCode, type CqUpload } from "@/lib/closebook/client-questions-server";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const GONE = { ok: false as const, error: "This link is no longer active. Contact Concept Accounting for a new one." };

export async function sendCode(token: string): Promise<R> {
  const cq = await findLink(token);
  if (!cq || !cq.live) return GONE;
  return requestCode(cq);
}

export async function checkCode(token: string, code: string): Promise<R> {
  const cq = await findLink(token);
  if (!cq || !cq.live) return GONE;
  const r = await verifyCode(cq, code);
  if (!r.ok) return r;
  (await cookies()).set(cookieName(cq.link.id), r.session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: `/cq/${token}`, expires: r.expires });
  return { ok: true };
}

async function signedIn(token: string) {
  const cq = await findLink(token);
  if (!cq || !cq.live) return null;
  const email = await sessionOk(cq.link.id, (await cookies()).get(cookieName(cq.link.id))?.value);
  return email ? { cq, email } : null;
}

export async function getUploads(token: string, lineId: string, files: CqUpload[]) {
  const s = await signedIn(token);
  if (!s) return GONE;
  return prepareUploads(s.cq, lineId, files);
}

export async function sendAnswer(token: string, lineId: string, text: string, files: { path: string; name: string; size: number }[]): Promise<R> {
  const s = await signedIn(token);
  if (!s) return GONE;
  return submitAnswer(s.cq, s.email, lineId, text, files);
}
