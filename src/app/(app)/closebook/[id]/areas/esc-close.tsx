"use client";
// UI finding 13 (piece R1): Escape closes a panel that lives in the address (the postings drill), as its Close link does.
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function EscClose({ href }: { href: string }) {
  const router = useRouter();
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.querySelector("[role=dialog]")) router.push(href, { scroll: false }); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [href, router]);
  return null;
}
