import "server-only";
import { graphCode } from "./not-sent";

// Sends email through Microsoft 365 (Microsoft Graph) using the app's own Microsoft Entra
// registration (OAuth client credentials). No mailbox password is used or stored.
// The app registration is limited in Exchange (an application access policy) to the mailboxes it may
// send from: MAIL_FROM for alerts, and staff mailboxes for signing emails (Hashim, Nov 12, 2026).

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return v;
}

let cached: { token: string; expiresAt: number } | null = null;

async function getToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const tenant = required("MS_TENANT_ID");
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("MS_CLIENT_ID"),
      client_secret: required("MS_CLIENT_SECRET"),
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Microsoft sign-in failed (${res.status}).`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return json.access_token;
}

// Round 32: can this app send through Microsoft 365 here? (The Notify client window shows Download only when not.)
// MAIL_SINK_DIR (local tests only, never set on Live) writes each email to a file instead of sending it.
export function mailReady(): { ok: true } | { ok: false; missing: string[] } {
  if (process.env.MAIL_SINK_DIR && process.env.VERCEL_ENV !== "production") return { ok: true };
  const missing = ["MS_TENANT_ID", "MS_CLIENT_ID", "MS_CLIENT_SECRET", "MAIL_FROM"].filter((k) => !process.env[k]);
  return missing.length ? { ok: false, missing } : { ok: true };
}

export type MailAttachment = { name: string; contentType: string; base64: string };

// Round 36: a refusal from Microsoft 365, with its HTTP status, its error code and its whole reply (for History).
// The message stays as before, so other callers read the same text.
export class MailError extends Error {
  constructor(public status: number, public code: string, public reply: string) {
    super(`Microsoft 365 did not accept the email (${status}). ${reply.slice(0, 200)}`);
    this.name = "MailError";
  }
}

// from: the mailbox to send from (a staff member's own for signing emails); MAIL_FROM when not given.
// Round 32: cc and attachments (the client questions email).
export async function sendMail(email: { to: string | string[]; subject: string; html: string; from?: string; cc?: string[]; attachments?: MailAttachment[] }) {
  const from = email.from || process.env.MAIL_FROM || (process.env.MAIL_SINK_DIR ? "system@example.test" : required("MAIL_FROM"));
  if (process.env.MAIL_SINK_DIR && process.env.VERCEL_ENV !== "production") {
    const { existsSync, mkdirSync, writeFileSync } = await import("node:fs");
    // Local tests only: while FAIL-403 exists, the sink refuses like Microsoft 365 without the Mail.Send permission;
    // FAIL-400 refuses like a bad recipient. The reply is Microsoft Graph's own shape.
    if (existsSync(`${process.env.MAIL_SINK_DIR}/FAIL-403`))
      throw new MailError(403, "ErrorAccessDenied", JSON.stringify({ error: { code: "ErrorAccessDenied", message: "Access is denied. Check credentials and try again." } }));
    if (existsSync(`${process.env.MAIL_SINK_DIR}/FAIL-400`))
      throw new MailError(400, "ErrorInvalidRecipients", JSON.stringify({ error: { code: "ErrorInvalidRecipients", message: "At least one recipient is not valid., Recipient 'x' is not resolved." } }));
    mkdirSync(process.env.MAIL_SINK_DIR, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(`${process.env.MAIL_SINK_DIR}/${name}.json`, JSON.stringify({ from, to: email.to, cc: email.cc ?? [], subject: email.subject, html: email.html,
      attachments: (email.attachments ?? []).map((a) => ({ name: a.name, contentType: a.contentType, bytes: Buffer.from(a.base64, "base64").length })) }, null, 2));
    for (const a of email.attachments ?? []) writeFileSync(`${process.env.MAIL_SINK_DIR}/${name}-${a.name}`, Buffer.from(a.base64, "base64"));
    return;
  }
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: email.subject,
        // Say the sender address outright, so it does not depend on how Exchange picks one.
        from: { emailAddress: { address: from } },
        body: { contentType: "HTML", content: email.html },
        toRecipients: (Array.isArray(email.to) ? email.to : [email.to]).map((address) => ({ emailAddress: { address } })),
        ...(email.cc?.length ? { ccRecipients: email.cc.map((address) => ({ emailAddress: { address } })) } : {}),
        ...(email.attachments?.length ? { attachments: email.attachments.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.name, contentType: a.contentType, contentBytes: a.base64 })) } : {}),
      },
      saveToSentItems: true,
    }),
  });
  if (res.status !== 202) {
    const detail = await res.text().catch(() => "");
    throw new MailError(res.status, graphCode(detail) || String(res.status), detail);
  }
}
