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
