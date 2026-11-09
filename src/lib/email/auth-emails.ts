// Builds the login emails staff receive (invite, password reset, password changed).
// Plain words, short sentences. No client information is ever in these emails.
// Kept free of framework imports so it can be tested on its own.

export type HookPayload = {
  user: { id: string; email: string; user_metadata?: { full_name?: string } };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new: string;
    token_hash_new: string;
  };
};

export type AuthEmail = { to: string; subject: string; html: string; text: string };

const FIRM = "Concept Accounting & Advisory";

export class UnsupportedEmailType extends Error {}

export function buildAuthEmail(payload: HookPayload, siteUrl: string): AuthEmail {
  const { user, email_data } = payload;
  const type = email_data.email_action_type;
  const name = user.user_metadata?.full_name?.split(" ")[0];
  const greeting = name ? `Hi ${escapeHtml(name)},` : "Hi,";

  if (type === "invite" || type === "recovery") {
    const link =
      `${siteUrl}/auth/confirm?token_hash=${encodeURIComponent(email_data.token_hash)}` +
      `&type=${type}&next=/set-password`;
    const isInvite = type === "invite";
    const subject = isInvite ? "Your login for Concept Studio" : "Reset your Concept Studio password";
    const lines = isInvite
      ? ["You have been added to Concept Studio.", "Click the button to set your password. The link works once."]
      : ["We got a request to reset your password.", "Click the button to set a new one. The link works once.",
         "If you did not ask for this, ignore this email. Your password stays the same."];
    const button = isInvite ? "Set my password" : "Reset my password";
    return {
      to: user.email,
      subject,
      html: layout(siteUrl, greeting, lines, { href: link, label: button }),
      text: `${greeting}\n\n${lines.join("\n")}\n\n${button}: ${link}\n\n${FIRM}`,
    };
  }

  if (type === "password_changed_notification") {
    const lines = [
      "The password for your Concept Studio login was just changed.",
      "If this was you, you do not need to do anything.",
      "If it was not you, tell an owner of the firm today.",
    ];
    return {
      to: user.email,
      subject: "Your Concept Studio password was changed",
      html: layout(siteUrl, greeting, lines),
      text: `${greeting}\n\n${lines.join("\n")}\n\n${FIRM}`,
    };
  }

  // Sign-up, magic links and email changes are not used by this app.
  throw new UnsupportedEmailType(`Email type not used by this app: ${type}`);
}

function layout(siteUrl: string, greeting: string, lines: string[], button?: { href: string; label: string }) {
  const paragraphs = lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join("");
  const cta = button
    ? `<p style="margin:20px 0"><a href="${escapeHtml(button.href)}" style="background:#1A3C7C;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">${escapeHtml(button.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1f1e;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="margin:0 0 20px"><img src="${escapeHtml(siteUrl)}/brand/studio-logo-navy.png" alt="Concept Studio" width="150" height="59" style="display:block;border:0"></p>
<p style="margin:0 0 12px">${greeting}</p>${paragraphs}${cta}
<p style="margin:24px 0 0;color:#5f6663;font-size:13px">${escapeHtml(FIRM)}</p>
</div></body></html>`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
