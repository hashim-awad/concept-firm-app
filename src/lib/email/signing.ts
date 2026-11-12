import "server-only";
// Signing emails sent from Studio (Hashim, Nov 12, 2026): from the issuing person's own Microsoft 365
// mailbox, with the private signing link(s). One switch per path in Settings; New letters first. The
// result is kept on the quote, and the Copy buttons stay as the fallback when sending is off or fails.
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { sendMail } from "./graph";
import { emailAllowed } from "./safety";
import { renderLetterEmail } from "@/lib/letters/email";

export type SendPath = "letters" | "quotes" | "proposals";
export type EmailResult = { ok: boolean; at: string; from: string; to: string[]; skipped?: string[]; error?: string };

export async function signingEmailOn(path: SendPath): Promise<boolean> {
  const { data } = await createAdminClient().from("settings").select("value").eq("key", "signing_email").maybeSingle();
  return !!(data?.value as Record<string, boolean> | null)?.[path];
}

// A New letter's signing email, from the sender's mailbox (the person who issued it).
export async function sendLetterEmail(quoteId: string): Promise<EmailResult> {
  const db = createAdminClient();
  const at = new Date().toISOString();
  const { data: q } = await db.from("quotes").select("id, kind, valid_until, sender, wording").eq("id", quoteId).maybeSingle();
  const { data: s } = await db.from("quote_signers").select("person, first_name, email, token").eq("quote_id", quoteId).order("person");
  const sender = (q?.sender ?? null) as { name: string; phone: string; email: string } | null;
  const signers = (s ?? []) as { person: number; first_name: string; email: string; token: string }[];
  const from = sender?.email ?? "";
  let result: EmailResult;
  if (!q || q.kind !== "letter" || !signers.length) result = { ok: false, at, from, to: [], error: "Letter not found." };
  else if (!from) result = { ok: false, at, from, to: [], error: "Your staff record has no email address to send from." };
  else {
    const all = [...new Set(signers.map((x) => x.email.toLowerCase()))];
    const to = all.filter((a) => emailAllowed(a));
    const skipped = all.filter((a) => !emailAllowed(a));
    if (!to.length) result = { ok: false, at, from, to, skipped, error: "Not sent: the Test app only emails the firm's own addresses. Copy the email instead." };
    else {
      const mail = renderLetterEmail((q.wording ?? {}) as Record<string, string>, { names: signers.map((x) => x.first_name), validUntil: q.valid_until ?? "" }, sender!, signers.map((x) => `${env.siteUrl()}/q/${x.token}`));
      try {
        await sendMail({ from, to, subject: mail.subject, html: mail.html });
        result = { ok: true, at, from, to, ...(skipped.length ? { skipped } : {}) };
      } catch (e) {
        result = { ok: false, at, from, to, error: e instanceof Error ? e.message : "Microsoft 365 did not accept the email." };
      }
    }
  }
  await db.rpc("record_quote_email", { p_id: quoteId, p_result: result });
  return result;
}
