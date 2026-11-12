// Emails from the Test app never reach real clients (Hashim, Nov 12, 2026). Outside Live (Vercel
// production), only addresses at the domains in TEST_EMAIL_ALLOW (comma separated; default the firm's
// own domain) are sent to; the rest are skipped and reported. Pure.
export function emailAllowed(address: string, env: { vercelEnv?: string; allow?: string } = { vercelEnv: process.env.VERCEL_ENV, allow: process.env.TEST_EMAIL_ALLOW }): boolean {
  if (env.vercelEnv === "production") return true;
  const domains = (env.allow ?? "conceptaccounting.ca").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
  const domain = address.trim().toLowerCase().split("@")[1] ?? "";
  return domains.includes(domain);
}
