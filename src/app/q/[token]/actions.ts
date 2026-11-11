"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { signByToken } from "@/lib/t1-quote/sign";

export type SignState = { error: string } | { done: true } | null;

// Sign through a private link. forOther: the spouse signs on this device after the first signer.
export async function signQuote(token: string, forOther: boolean, _prev: SignState, formData: FormData): Promise<SignState> {
  const opt = formData.get("option");
  const h = await headers();
  const r = await signByToken(token, {
    name: String(formData.get("name") ?? ""),
    title: String(formData.get("title") ?? ""),
    consent: true, // clicking Sign, under the agreement statement
    forOther,
    option: opt === null || opt === "" ? null : Number(opt),
    ip: (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "",
    agent: h.get("user-agent") ?? "",
  });
  if (r.error) return { error: r.error };
  revalidatePath(`/q/${token}`);
  return { done: true };
}
