import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET } from "@/lib/statements/server";

// Hourly (vercel.json): Bank statement PDF to CSV keeps nothing past 24 hours after a statement was
// converted (fix, Hashim, Nov 15, 2026), even when nobody uses the tool again. Each deleted statement
// leaves a log row (who, when, pages, cost). Only Vercel's scheduler can call it: it sends the CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("statement_purge_standalone");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const paths = ((data ?? []) as string[]).filter(Boolean);
  if (paths.length) await admin.storage.from(BUCKET).remove(paths);
  return NextResponse.json({ deleted: paths.length });
}
