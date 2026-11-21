// What the engine says about each file of a loaded client, read the way the app reads it (signed in as the local
// dummy owner, through row-level security): the trial balance by account, net income, every GIFI line and every
// GST/HST return line.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { loadFile, loadReference } from "../../src/lib/closebook/server.ts";
import { loadReportData } from "../../src/lib/closebook/report-data.ts";
import { gifiFor } from "../../src/lib/closebook/gifi-server.ts";
import { gstFor } from "../../src/lib/closebook/gst-server.ts";

export type TbRow = { account: string; name: string; gifi: string; prior: number; prelim: number; adj: number; reclass: number; final: number };
export type FileResult = { year_end: string; books: string; tb: TbRow[]; net_income: number; gifi: Record<string, number>;
  gst: { period: string; lines: Record<string, number> }[] | null };

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const d = (cents: number) => Math.round(cents) / 100;

export async function signIn(): Promise<SupabaseClient> {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!/^http:\/\/(127\.0\.0\.1|localhost)/.test(url)) throw new Error("Answer keys run on the local app only.");
  const sb = createClient(url, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { error } = await sb.auth.signInWithPassword({ email: "owner.dummy@example.test", password: "dummy-pass-123" });
  if (error) throw new Error(`Sign-in as the dummy owner failed: ${error.message}`);
  return sb;
}

export async function computeClient(sb: SupabaseClient, clientId: string): Promise<FileResult[]> {
  const { data: files } = await sb.from("cb_files").select("id, year_end, books").eq("client_id", clientId).order("year_end");
  const ref = await loadReference(sb);
  const out: FileResult[] = [];
  for (const f of (files ?? []) as { id: string; year_end: string; books: string }[]) {
    const data = await loadFile(sb, f.id);
    if (!data) throw new Error(`File ${f.year_end} did not load`);
    const rd = await loadReportData(sb, data.file, data.accounts, data.entries, ref.lines, ref.sheets);
    const tb = new Map<string, { prior: number; prelim: number; adj: number; reclass: number }>();
    for (const a of rd.accounts) tb.set(a.key, { prior: a.lastCents, prelim: 0, adj: 0, reclass: 0 });
    for (const p of rd.postings) {
      const r = tb.get(p.key) ?? { prior: 0, prelim: 0, adj: 0, reclass: 0 };
      tb.set(p.key, r);
      if (p.kind !== "entry") r.prelim += p.cents;
      else if (p.reclass) r.reclass += p.cents;
      else r.adj += p.cents;
    }
    const acct = new Map(rd.accounts.map((a) => [a.key, a]));
    const rows: TbRow[] = [...tb.entries()].map(([key, r]) => {
      const a = acct.get(key);
      return { account: a?.number || key, name: a?.name ?? "", gifi: (a?.line_no ?? "").replace(/\.00$/, ""), prior: d(r.prior), prelim: d(r.prelim), adj: d(r.adj), reclass: d(r.reclass), final: d(r.prelim + r.adj + r.reclass) };
    }).filter((r) => r.prior || r.prelim || r.adj || r.reclass).sort((x, y) => x.account.localeCompare(y.account) || x.name.localeCompare(y.name));
    const g = await gifiFor(sb, f.id, "final");
    const gifi = Object.fromEntries((g?.codes ?? []).map(([c, v]) => [c, Math.round(v * 100) / 100]).sort(([a], [b]) => String(a).localeCompare(String(b))));
    const gst = await gstFor(sb, f.id);
    out.push({
      year_end: f.year_end, books: f.books, tb: rows, net_income: Math.round((g?.totals?.["9999"] ?? 0) * 100) / 100, gifi,
      gst: gst && gst.applies ? gst.returns.map((r) => ({ period: `${r.period.start} to ${r.period.end}`, lines: Object.fromEntries(Object.entries(r.lines).map(([k, v]) => [k, d(Number(v))])) })) : null,
    });
  }
  return out;
}
