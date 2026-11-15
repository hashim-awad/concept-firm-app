import { redirect } from "next/navigation";

// Round 17: an old Settings address goes to its new place, keeping its message (a form saved on the old
// address reports there).
export async function redirectKeep(to: string, searchParams: Promise<Record<string, string | string[] | undefined>>): Promise<never> {
  const sp = await searchParams;
  const q = new URLSearchParams(to.includes("?") ? to.slice(to.indexOf("?") + 1) : "");
  for (const k of ["msg", "error"]) { const v = sp[k]; if (typeof v === "string") q.set(k, v); }
  const base = to.split("?")[0];
  redirect(q.size ? `${base}?${q}` : base);
}
