// The signature image for the Final letter preview. Owners only (storage policy); never public.
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { SIGNATURE_PATH } from "@/lib/studio/data";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from("brand-private").download(SIGNATURE_PATH);
  if (error || !data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(data, { headers: { "Content-Type": "image/png", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}
