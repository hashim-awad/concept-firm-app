"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Round 18 (benchmark: QuickBooks Online customer list): the list filters as you type. The address
// (?q=) changes about 250 ms after the last key; the server does the search.
export function ClientSearch({ q, params }: { q: string; params: Record<string, string> }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  useEffect(() => {
    if (value.trim() === q) return;
    const t = setTimeout(() => {
      const sp = new URLSearchParams(params);
      if (value.trim()) sp.set("q", value.trim()); else sp.delete("q");
      const s = sp.toString();
      router.replace(s ? `/clients?${s}` : "/clients", { scroll: false });
    }, 250);
    return () => clearTimeout(t);
  }, [value, q, params, router]);
  return (
    <div>
      <label htmlFor="q" className="label">Search by name</label>
      <input id="q" name="q" type="search" value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" className="input w-64" />
    </div>
  );
}
