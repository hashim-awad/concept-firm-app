import { Webhook } from "standardwebhooks";
import { buildAuthEmail, UnsupportedEmailType, type HookPayload } from "@/lib/email/auth-emails";
import { sendMail } from "@/lib/email/graph";
import { env } from "@/lib/env";

// Supabase Auth "Send Email" hook. Supabase calls this instead of sending login emails itself.
// Every request is signed by Supabase; anything without a valid signature is rejected.
export async function POST(request: Request) {
  const secret = process.env.SEND_EMAIL_HOOK_SECRET;
  if (!secret) return error(500, "Email hook is not configured.");

  const body = await request.text();
  let payload: HookPayload;
  try {
    const wh = new Webhook(secret.replace(/^v1,whsec_/, ""));
    payload = wh.verify(body, Object.fromEntries(request.headers)) as HookPayload;
  } catch {
    return error(401, "Invalid signature.");
  }

  try {
    const email = buildAuthEmail(payload, env.siteUrl());
    await sendMail(email);
  } catch (e) {
    if (e instanceof UnsupportedEmailType) return error(400, e.message);
    console.error("send-email hook failed", e instanceof Error ? e.message : e);
    return error(500, "Could not send the email. Try again in a few minutes.");
  }
  return Response.json({}, { status: 200 });
}

function error(status: number, message: string) {
  return Response.json({ error: { http_code: status, message } }, { status });
}
