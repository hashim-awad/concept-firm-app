// The statement reader's runner (round 20, Hashim, Nov 15, 2026). Woken with after() by an upload, a Retry
// or the status poll; it can also be called by a scheduler with the CRON_SECRET. It answers at once and
// reads in the background: up to 3 statements at a time across the firm, for up to 300 seconds.
// Standalone jobs left over 24 hours are deleted here too.
import { after, NextResponse, type NextRequest } from "next/server";
import { runJobs, runnerAllowed } from "@/lib/statements/server";

export const maxDuration = 300;

async function wake(req: NextRequest) {
  if (!runnerAllowed(req.headers.get("authorization"))) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  after(async () => {
    try {
      await runJobs({ budgetMs: 280_000 });
    } catch (e) {
      console.error("statement runner failed", e);
    }
  });
  return NextResponse.json({ ok: true }, { status: 202 });
}

export const POST = wake;
export const GET = wake;
