import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: () => required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
  supabaseSecretKey: () => required("SUPABASE_SECRET_KEY"),
  // The app's own address for invite and reset links. On Vercel previews, falls back to the
  // branch's stable preview address, so previews work without setting SITE_URL.
  siteUrl: () => {
    const explicit = process.env.SITE_URL;
    if (explicit) return explicit.replace(/\/$/, "");
    const vercel = process.env.VERCEL_BRANCH_URL ?? process.env.VERCEL_URL;
    if (vercel) return `https://${vercel}`;
    throw new Error("Missing environment variable SITE_URL. See .env.example.");
  },
};
