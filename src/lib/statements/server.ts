import "server-only";
// Bank statement PDF to CSV, server side (round 20, Hashim, Nov 15, 2026).
// Reads use the signed-in person's Supabase client, so row level security applies: a file's statements
// for anyone with Closebook, a standalone statement only for the person who uploaded it.
// The runner (route /api/statements/run) uses the secret key: it has no signed-in person.

import { createHash, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import type { ReadResult, StatementStatus } from "./types";
import { statementStatus, statementSummary, type StatementSummaryRow } from "./checks";
import { prepare, PrepareError, type Prepared } from "./prepare";
import { apiClient, NOT_SET_UP, ReaderError, readerErrorFrom, readStatement, type ReadOutput } from "./reader";
import { fixtureMode, readFixture } from "./fixture-reader";

export const BUCKET = "statement-uploads";
export const MAX_READING = 3;

export type StatementRow = {
  id: string; file_id: string | null; file_name: string; media_type: string; status: StatementStatus; error: string | null;
  pages: number | null; cost_usd: number | null; model: string | null; created_at: string; finished_at: string | null;
  accounts: number; lines: number; difference_cents: number | null; review: number;
};

type DbRow = {
  id: string; file_id: string | null; file_name: string; media_type: string; status: StatementStatus; error: string | null;
  pages: number | null; cost_usd: number | string | null; model: string | null; created_at: string; finished_at: string | null;
  started_at: string | null; summary: Partial<StatementSummaryRow> | null;
};
const ROW_COLUMNS = "id, file_id, file_name, media_type, status, error, pages, cost_usd, model, created_at, finished_at, started_at, summary";

function toRow(r: DbRow): StatementRow {
  const s = r.summary ?? {};
  return {
    id: r.id, file_id: r.file_id, file_name: r.file_name, media_type: r.media_type, status: r.status, error: r.error,
    pages: r.pages, cost_usd: r.cost_usd === null ? null : Number(r.cost_usd), model: r.model, created_at: r.created_at, finished_at: r.finished_at,
    accounts: s.accounts ?? 0, lines: s.lines ?? 0, difference_cents: s.difference_cents ?? null, review: s.review ?? 0,
  };
}

// The rows and whether the runner should be woken: a job is waiting and none is reading, or one has
// been reading for over 10 minutes (its runner stopped).
export async function listStatementsWithKick(fileId: string | null): Promise<{ rows: StatementRow[]; kick: boolean }> {
  const supabase = await createClient();
  let q = supabase.from("cb_statement_imports").select(ROW_COLUMNS).neq("status", "discarded").order("created_at", { ascending: true }).limit(500);
  if (fileId) q = q.eq("file_id", fileId);
  else {
    const { data: u } = await supabase.auth.getUser();
    q = q.is("file_id", null).eq("created_by", u.user?.id ?? "00000000-0000-0000-0000-000000000000");
  }
  const { data } = await q;
  const rows = (data ?? []) as DbRow[];
  const stale = Date.now() - 10 * 60_000;
  const queued = rows.some((r) => r.status === "queued");
  const reading = rows.filter((r) => r.status === "reading");
  const kick = (queued && reading.length < MAX_READING) || reading.some((r) => r.started_at !== null && Date.parse(r.started_at) < stale);
  return { rows: rows.map(toRow), kick };
}

// null = my standalone jobs.
export async function listStatements(fileId: string | null): Promise<StatementRow[]> {
  return (await listStatementsWithKick(fileId)).rows;
}

export type StatementFile = { id: string; yearStart: string; yearEnd: string; bankAccounts: { id: string; name: string; kind: "bank" | "card"; last4: string | null }[] };
export type StatementDetail = { row: StatementRow; data: ReadResult | null; fileUrl: string; file: StatementFile | null };

// One statement for the verify screen: the working copy (or the result as read), a signed link to the
// file (1 hour), and the file's year and bank accounts.
export async function getStatement(id: string): Promise<StatementDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("cb_statement_imports").select(`${ROW_COLUMNS}, storage_path, result, edited`).eq("id", id).maybeSingle();
  if (!data) return null;
  const r = data as DbRow & { storage_path: string; result: ReadResult | null; edited: ReadResult | null };
  const signed = await createAdminClient().storage.from(BUCKET).createSignedUrl(r.storage_path, 3600);
  let file: StatementFile | null = null;
  if (r.file_id) {
    const [{ data: f }, { data: accts }] = await Promise.all([
      supabase.from("cb_files").select("id, year_start, year_end").eq("id", r.file_id).maybeSingle(),
      supabase.from("cb_bank_accounts").select("id, name, kind, last4, number").eq("file_id", r.file_id).order("number"),
    ]);
    if (f) file = {
      id: f.id as string, yearStart: f.year_start as string, yearEnd: f.year_end as string,
      bankAccounts: ((accts ?? []) as { id: string; name: string; kind: "bank" | "card"; last4: string | null }[]).map((a) => ({ id: a.id, name: a.name, kind: a.kind, last4: a.last4 })),
    };
  }
  return { row: toRow(r), data: r.edited ?? r.result, fileUrl: signed.data?.signedUrl ?? "", file };
}

// My day: my statements ready to check or needing a look, and the files they are on.
export async function statementsReadyCount(): Promise<{ ready: number; needsLook: number; files: { fileId: string; client: string; n: number }[] }> {
  const { data } = await (await createClient()).rpc("statement_ready_counts");
  const d = (data ?? {}) as { ready?: number; needs_look?: number; files?: { fileId: string; client: string; n: number }[] };
  return { ready: Number(d.ready ?? 0), needsLook: Number(d.needs_look ?? 0), files: d.files ?? [] };
}

// The stored file, read with the secret key (after the row was read with the person's client).
export async function storedBytes(path: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeStored(paths: (string | null | undefined)[]): Promise<void> {
  const list = paths.filter((p): p is string => !!p);
  if (list.length) await createAdminClient().storage.from(BUCKET).remove(list);
}

// ---------- The runner

// The runner's own key: derived from the server key, so no new setting is needed and the key itself is
// never sent anywhere.
export function runnerToken(): string {
  return createHash("sha256").update(`statement-runner:${env.supabaseSecretKey()}`).digest("hex");
}
export function runnerAllowed(authorization: string | null): boolean {
  const got = Buffer.from(authorization ?? "");
  const ok = (secret: string | undefined) => {
    if (!secret) return false;
    const want = Buffer.from(`Bearer ${secret}`);
    return got.length === want.length && timingSafeEqual(got, want);
  };
  try { return ok(runnerToken()) || ok(process.env.CRON_SECRET); } catch { return false; }
}

// Wake the runner: a request to its route, which reads in its own time (up to 300 seconds). If the route
// cannot be reached, the jobs run here. Called with after(), so the person never waits for it.
export async function kickRunner(): Promise<void> {
  try {
    const headers: Record<string, string> = { authorization: `Bearer ${runnerToken()}` };
    // Vercel preview deployments behind Deployment Protection let the app call itself with this header.
    if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    // redirect "manual": a sign-in redirect is not the runner answering.
    const res = await fetch(`${env.siteUrl()}/api/statements/run`, { method: "POST", headers, cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(10_000) });
    if (res.status === 202) return;
    console.error("statement runner: the route answered", res.status);
  } catch (e) {
    console.error("statement runner: the route could not be reached", e);
  }
  await runJobs({ budgetMs: 240_000 });
}

type Job = { id: string; file_id: string | null; storage_path: string; media_type: string; attempts: number };

// Claim and read jobs until none are left or the time is up. New jobs are claimed only in the first
// minute, so each read has time to finish; a job cut off by the platform comes back after 10 minutes.
export async function runJobs(opts: { budgetMs?: number } = {}): Promise<{ done: number; purged: number }> {
  const admin = createAdminClient();
  const start = Date.now(), budget = opts.budgetMs ?? 280_000;
  const { data: purged } = await admin.rpc("statement_purge_standalone");
  const old = (purged ?? []) as string[];
  if (old.length) await admin.storage.from(BUCKET).remove(old);
  const running = new Map<string, Promise<void>>();
  let done = 0;
  for (;;) {
    if (Date.now() - start < 60_000 && running.size < MAX_READING) {
      const { data: jobs, error } = await admin.rpc("statement_claim_jobs", { p_limit: MAX_READING - running.size });
      if (error) console.error("statement runner: claim failed", error.message);
      for (const j of (jobs ?? []) as Job[]) {
        const timeoutMs = Math.max(30_000, start + budget - Date.now() - 10_000);
        running.set(j.id, processJob(admin, j, timeoutMs).finally(() => { running.delete(j.id); done++; }));
      }
    }
    if (!running.size) break;
    await Promise.race(running.values());
  }
  return { done, purged: old.length };
}

async function processJob(admin: SupabaseClient, job: Job, timeoutMs: number): Promise<void> {
  let prepared: Prepared | null = null;
  try {
    const { data: blob, error } = await admin.storage.from(BUCKET).download(job.storage_path);
    if (error || !blob) throw new ReaderError("unreadable", "The uploaded file is missing. Upload it again.", false);
    const original = new Uint8Array(await blob.arrayBuffer());
    try {
      prepared = await prepare(original, job.media_type);
    } catch (e) {
      if (e instanceof PrepareError) throw new ReaderError("unreadable", e.message, false);
      console.error("statement runner: prepare failed", e);
      throw new ReaderError("unreadable", "The file could not be opened. It tries again by itself.", true);
    }
    let out: ReadOutput;
    if (fixtureMode()) out = await readFixture(original, prepared.pages);
    else {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new ReaderError("not_set_up", NOT_SET_UP, false);
      out = await readStatement({ bytes: prepared.bytes, mediaType: prepared.mediaType, pages: prepared.pages }, apiClient(key), { timeoutMs });
    }
    const result: ReadResult = { ...out.result, pages: prepared.pages };
    // A HEIC photo is kept as the JPEG the reader saw, so the verify screen can show it.
    let newPath: string | null = null, newType: string | null = null;
    if (prepared.converted) {
      const p = job.storage_path.replace(/\.[^./]+$/, "") + ".jpg";
      const up = await admin.storage.from(BUCKET).upload(p, prepared.bytes, { contentType: "image/jpeg", upsert: true });
      if (!up.error) { newPath = p; newType = "image/jpeg"; }
    }
    const { data: finished, error: fe } = await admin.rpc("statement_finish_job", {
      p_id: job.id, p_status: statementStatus(result), p_result: result, p_summary: statementSummary(result), p_pages: prepared.pages,
      p_model: out.model, p_input: out.inputTokens, p_output: out.outputTokens, p_cost: out.costUsd, p_storage_path: newPath, p_media_type: newType,
    });
    if (fe) throw new Error(fe.message);
    if (finished && newPath && newPath !== job.storage_path) await admin.storage.from(BUCKET).remove([job.storage_path]);
  } catch (e) {
    const r = e instanceof ReaderError ? e : readerErrorFrom(e);
    if (!(e instanceof ReaderError)) console.error("statement runner: read failed", e);
    const { error } = await admin.rpc("statement_fail_job", {
      p_id: job.id, p_error: r.message, p_retry: r.retry, p_pages: prepared?.pages ?? null,
      p_model: r.usage?.model ?? null, p_input: r.usage?.inputTokens ?? null, p_output: r.usage?.outputTokens ?? null, p_cost: r.usage?.costUsd ?? null,
    });
    if (error) console.error("statement runner: could not record the failure", error.message);
  }
}
