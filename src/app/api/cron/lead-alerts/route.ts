import { NextResponse, type NextRequest } from "next/server";
import { runLeadAlerts } from "@/lib/leads/alerts";

// Every 5 minutes (vercel.json): retries first lead alerts that failed and sends the 45-business-minute
// reminder (Phase 2 batch, section 3). Only Vercel's scheduler can call it: it sends the CRON_SECRET.
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not set." }, { status: 500 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  try {
    return NextResponse.json(await runLeadAlerts());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed." }, { status: 500 });
  }
}
