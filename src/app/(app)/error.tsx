"use client";
// A page that failed inside the app (Hashim, Nov 16, 2026: "This page couldn't load" on Live): the menu stays, the
// error's code shows (it finds the server's log entry), with Try again. Before, a failure showed a blank page.
import { useEffect } from "react";
import Link from "next/link";

export default function AppError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = (error as { digest?: string } | null)?.digest;
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div className="mx-auto grid max-w-xl gap-3 px-6 py-16">
      <h2 className="text-[18px] font-semibold">This page did not load</h2>
      <p className="text-[14px] text-ink-2">Try again. If it happens again, send this code to the developer: <b className="font-mono">{digest ?? "no code (it failed in the browser)"}</b>.</p>
      <div className="flex gap-2"><button type="button" onClick={() => retry()} className="btn h-9">Try again</button><Link href="/" className="btn-secondary h-9">Home</Link></div>
    </div>
  );
}
