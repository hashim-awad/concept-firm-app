"use server";
// The proposal builder's saving and sending (front office batch, section 5, items 1 and 2).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { revalidatePath } from "next/cache";
import { getAccess, canEdit, canView } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { createStudioEngine } from "@/lib/studio/engine.generated.js";
import { Proposal } from "@/lib/studio/controllers";
import { loadStudioData } from "@/lib/studio/data";
import { wordingEnv } from "@/lib/studio/wording";
import { todayToronto } from "@/lib/dates";
import { letterProblems, lk, type ProposalInputs } from "@/lib/proposal/letter";

export type SaveInput = { quoteId: string | null; clientId: string | null; leadId: string | null; title: string; data: ProposalInputs };
type Result = { ok: true; id: string } | { ok: false; error: string };

const uuid = (v: string | null) => (v && /^[0-9a-f-]{36}$/.test(v) ? v : null);

// Saves the draft (the builder calls this a moment after each change).
export async function saveProposalAction(input: SaveInput): Promise<Result> {
  const access = await getAccess();
  if (!access || !canEdit(access, "documents") || !canView(access, "pricing")) return { ok: false, error: "You need Edit on Documents and the Pricing permission to work on a proposal." };
  const data = { f: input.data.f, opts: input.data.opts, rec: input.data.rec };
  const { data: id, error } = await (await createClient()).rpc("save_proposal", {
    p_id: uuid(input.quoteId), p_client: uuid(input.clientId), p_lead: uuid(input.leadId), p_title: String(input.title ?? "").slice(0, 200), p_data: data,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/quotes");
  return { ok: true, id: id as string };
}

export async function deleteProposalAction(quoteId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await (await createClient()).rpc("delete_proposal_draft", { p_id: quoteId });
  revalidatePath("/quotes");
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Send for signing: owners only. The proposal and every option's letter must be complete, and the
// province needs an approved GST/HST rate (decision 22). Then the quote opens for the client for 21 days.
export async function sendProposalAction(quoteId: string): Promise<{ ok: true; href: string } | { ok: false; error: string; problems?: string[] }> {
  const access = await getAccess();
  if (!access?.is_owner) return { ok: false, error: "Only an owner can send a proposal." };
  const supabase = await createClient();
  const { data: q } = await supabase.from("quotes").select("id, kind, status, proposal").eq("id", quoteId).maybeSingle();
  if (!q || q.kind !== "proposal") return { ok: false, error: "Proposal not found." };
  if (q.status !== "draft") return { ok: false, error: "This proposal was already sent." };
  const data = q.proposal as ProposalInputs;
  const prov = String(data.f.province ?? "");
  const { data: rate } = ["ON", "AB", "BC"].includes(prov) ? await supabase.rpc("approved_tax_rate", { p_province: prov }) : { data: null };
  if (!(rate as unknown[] | null)?.length) return { ok: false, error: "No approved GST/HST rate for this province. An owner approves rates under GST/HST rates first." };

  // The same checks the screen shows, with the wording in use today.
  const studio = await loadStudioData(supabase, access);
  const make = () => createStudioEngine({ DB: { floors: studio.floors, floorsOk: studio.floorsOk, loaded: true, cat: studio.cat }, ...wordingEnv(studio.wording), P_LINES: true } as any) as any;
  const pe = make();
  const p = new Proposal(pe, todayToronto());
  Object.assign(p.f, data.f, { date: todayToronto(), valid: "21" });
  pe.__set("POPTS", JSON.parse(JSON.stringify(data.opts)));
  pe.__set("pRec", data.rec ?? 0);
  p.setMode("final");
  const s = p.state();
  const problems = (pe.pChecks(s) as { lvl: string; msg: string }[]).filter((x) => x.lvl === "err").map((x) => x.msg);
  for (const o of letterProblems(make(), data, pe, s, todayToronto())) for (const m of o.errors) problems.push(`${o.option} letter: ${m}`);
  if (problems.length) return { ok: false, error: "Fix these first.", problems };

  const signer = (data.f[lk("signer")] || data.f.contact || "").trim().split(/\s+/);
  const { error } = await supabase.rpc("send_proposal", { p_id: quoteId, p_first: signer[0] ?? "", p_last: signer.slice(1).join(" "), p_email: (data.f[lk("email")] ?? "").trim() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/quotes"); revalidatePath("/");
  return { ok: true, href: `/quotes/${quoteId}` };
}
