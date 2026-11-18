// Round 36 (Hashim, Nov 17, 2026): what the person sees when Microsoft 365 will not send a client email. Never
// Microsoft's own text: that goes to History in full. Plain, and it says nothing reached the client.
export type MailFailure = { status?: number; code?: string };

export function notSentText(f: MailFailure | null, mailbox: string): string {
  if (f && (f.status === 403 || /AccessDenied/i.test(f.code ?? "")))
    return `Not sent. Microsoft 365 has not allowed Studio to send from ${mailbox} yet. Nothing went to the client.`;
  const code = f?.code || (f?.status ? String(f.status) : "no reply");
  return `Not sent. Microsoft 365 refused the email (${code}). Nothing went to the client.`;
}

// The error code inside Microsoft Graph's reply ({"error":{"code":"ErrorAccessDenied","message":"..."}}), if any.
export function graphCode(reply: string): string {
  try { const j = JSON.parse(reply) as { error?: { code?: unknown } }; return typeof j.error?.code === "string" ? j.error.code : ""; } catch { return ""; }
}
