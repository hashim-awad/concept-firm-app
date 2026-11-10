import "server-only";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

// Supabase client with the secret key. Bypasses row level security.
// Use ONLY for creating or removing staff logins, after the caller's permission is checked.
export function createAdminClient() {
  return createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// For the staff-only problem line: what kind of key the server has, never the key itself.
export function serverKeyKind(): string {
  let k = "";
  try { k = env.supabaseSecretKey(); } catch { return "no server key set"; }
  const urlRef = (() => { try { return new URL(env.supabaseUrl()).hostname.split(".")[0]; } catch { return "?"; } })();
  let kind: string;
  if (k.startsWith("sb_secret_")) kind = "a secret key (sb_secret_), as it should be";
  else if (k.startsWith("sb_publishable_")) kind = "the publishable key (sb_publishable_), not a secret key";
  else if (k.startsWith("eyJ")) {
    try {
      const p = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString("utf8")) as { role?: string; ref?: string };
      kind = `an old-style key with role "${p.role ?? "?"}" for project ${p.ref ?? "?"}${p.role === "service_role" ? "" : " (it must be service_role)"}`;
    } catch { kind = "an old-style key that cannot be read"; }
  } else kind = "an unknown kind of key";
  return `The server key is ${kind}. The app's Supabase project is ${urlRef}.`;
}
