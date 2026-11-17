"use client";
// Round 35: "N with the reviewer", updated at once as lines and accounts are marked reviewed in step 7's list.
import { useEffect, useState } from "react";

export function ReviewChip({ other, initial }: { other: number; initial: number }) {
  const [n, setN] = useState(initial);
  useEffect(() => {
    const on = (e: Event) => setN(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener("cb-review-count", on);
    return () => window.removeEventListener("cb-review-count", on);
  }, []);
  const total = n + other;
  return <span data-review-chip className={`rounded-full px-2.5 py-0.5 ${total ? "bg-warning-soft text-warning" : "bg-sand-100 text-ink-2"}`}>{total} with the reviewer</span>;
}
