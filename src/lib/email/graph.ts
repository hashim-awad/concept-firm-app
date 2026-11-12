import "server-only";

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

// from: the mailbox to send from (a staff member's own for signing emails); MAIL_FROM when not given.
export async function sendMail(email: { to: string | string[]; subject: string; html: string; from?: string }) {
  const from = email.from || required("MAIL_FROM");
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
      },
      saveToSentItems: true,
    }),
  });
  if (res.status !== 202) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Microsoft 365 did not accept the email (${res.status}). ${detail.slice(0, 200)}`);
  }
}
