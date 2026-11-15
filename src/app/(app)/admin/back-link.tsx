"use client";
// "Back" on every page opened from the gear: the page the person came from, or My day when the page was
// opened directly.
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

export function BackLink() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
      className="mb-2 inline-flex items-center gap-1 text-sm text-navy-700 hover:underline print:hidden"><ChevronLeft className="h-4 w-4" aria-hidden />Back</button>
  );
}
