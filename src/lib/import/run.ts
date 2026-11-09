// Runs an owner's Studio import: a dry run reports counts and problems; a real run writes
// only new rows (rows already in the app are left as they are). Every run is logged in
// import_runs. The CSV is read in memory and never stored.
import "server-only";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { todayToronto } from "@/lib/dates";
import { looseKey, nameKey, parseSource, proposalFromPack, type CatalogueRow, type ClientRow, type EngagementRow, type OfferRow, type ProposalRow, type Problem, type Source } from "./notion";
import { BLANK_PNG, engineFor, rebuild } from "@/lib/studio/build";
import { loadStudioData } from "@/lib/studio/data";
import { renderPdf, REGENERATED_LABEL } from "@/lib/studio/pdf";
import type { Access } from "@/lib/access";

export type ImportResult = { ok: true; source: Source; dryRun: boolean; counts: Record<string, number>; problems: Problem[] } | { ok: false; error: string };

const key = (s: string) => s.trim().toLowerCase();
const chunk = <T,>(a: T[], n = 200) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export async function runImport(supabase: SupabaseClient, fileName: string, text: string, dryRun: boolean): Promise<ImportResult> {
  const parsed = parseSource(text);
  if ("error" in parsed) return { ok: false, error: parsed.error };
  const { source, rows } = parsed;
  const problems = [...parsed.problems];
  const counts: Record<string, number> = { rows: rows.length, new: 0, already_in_app: 0, not_imported: 0 };
  type Write = () => Promise<{ saved: number; error: string | null }>;
  // A batch insert is one statement: all of its rows are saved, or none.
  const batch = async (n: number, q: PromiseLike<{ error: { message: string } | null }>) => { const { error } = await q; return { saved: error ? 0 : n, error: error?.message ?? null }; };
  let writes: Write[] = [];

  if (source === "offers") {
    const { data } = await supabase.from("offers").select("offer");
    const have = new Set((data ?? []).map((x) => key(x.offer)));
    const fresh = rows.filter((r) => !have.has(key((r.data as OfferRow).offer)));
    counts.already_in_app = rows.length - fresh.length; counts.new = fresh.length;
    writes = chunk(fresh).map((c) => () => batch(c.length, supabase.from("offers").insert(c.map((r) => ({ ...(r.data as OfferRow), source: { from: "Studio", row: r.row } })))));
  }

  if (source === "catalogue") {
    const [{ data: items }, { data: lines }] = await Promise.all([supabase.from("catalogue_items").select("code"), supabase.from("service_lines").select("id, key")]);
    const have = new Set((items ?? []).map((x) => x.code));
    const lineId = new Map((lines ?? []).map((l) => [l.key, l.id]));
    const fresh = rows.filter((r) => !have.has((r.data as CatalogueRow).code));
    counts.already_in_app = rows.length - fresh.length; counts.new = fresh.length;
    counts.with_price = fresh.filter((r) => (r.data as CatalogueRow).price != null).length;
    const today = todayToronto();
    writes = fresh.map((r) => async () => {
      const { price, line_key, ...d } = r.data as CatalogueRow;
      const { data: ins, error } = await supabase.from("catalogue_items").insert({ ...d, service_line_id: lineId.get(line_key) }).select("id").single();
      if (error || !ins) return { saved: 0, error: `Row ${r.row}: not saved (${error?.message})` };
      if (price != null) {
        const p = await supabase.from("item_prices").insert({ item_id: ins.id, amount_cents: Math.round(price * 100), effective_from: today, note: "From the Studio Service Catalog" });
        if (p.error) return { saved: 1, error: `Row ${r.row}: service saved, price not saved (${p.error.message})` };
      }
      return { saved: 1, error: null };
    });
  }

  if (source === "clients") {
    const { data } = await supabase.from("clients").select("legal_name");
    const have = new Set((data ?? []).map((x) => key(x.legal_name)));
    const seen = new Set<string>();
    const fresh = rows.filter((r) => {
      const k = key((r.data as ClientRow).legal_name);
      if (seen.has(k)) { problems.push({ row: r.row, msg: "Same legal name as an earlier row. Only the first is imported." }); counts.not_imported++; return false; }
      seen.add(k); return !have.has(k);
    });
    counts.already_in_app = rows.length - fresh.length - counts.not_imported; counts.new = fresh.length;
    counts.name_checked = fresh.filter((r) => (r.data as ClientRow).name_verified).length;
    writes = chunk(fresh).map((c) => () => batch(c.length, supabase.from("clients").insert(c.map((r) => {
      const d = r.data as ClientRow;
      return { ...d, name_verified_on: d.name_verified ? d.name_verified_on : null, source: { from: "Studio", row: r.row } };
    }))));
  }

  if (source === "engagements" || source === "proposals") {
    const { data: cl } = await supabase.from("clients").select("id, legal_name");
    // Match on the legal name, ignoring case, spacing and quote styles; if that finds nothing,
    // on letters and digits only (links that carry only the address form of the name).
    const exact = new Map<string, string[]>(), loose = new Map<string, string[]>();
    for (const c of cl ?? []) {
      exact.set(nameKey(c.legal_name), [...(exact.get(nameKey(c.legal_name)) ?? []), c.id]);
      loose.set(looseKey(c.legal_name), [...(loose.get(looseKey(c.legal_name)) ?? []), c.id]);
    }
    const clientId = (name: string | null, format: string, row: number, required: boolean): string | null | false => {
      if (!name) { if (required) { problems.push({ row, msg: "No client linked in the Client column. Not imported." }); return false; } return null; }
      let ids = exact.get(nameKey(name)) ?? [];
      if (!ids.length) ids = loose.get(looseKey(name)) ?? [];
      if (ids.length === 1) return ids[0];
      problems.push({ row, msg: ids.length
        ? "Linked client matches more than one client record. Not imported."
        : `Linked client not found among the ${cl?.length ?? 0} clients in the app (link written as: ${format}). Not imported.` });
      return false;
    };
    if (source === "engagements") {
      const { data: ex } = await supabase.from("engagements").select("client_id, type, fiscal_year_end, title");
      const have = new Set((ex ?? []).map((e) => `${e.client_id}|${e.type}|${e.fiscal_year_end}|${key(e.title)}`));
      const fresh: any[] = [];
      for (const r of rows) {
        const d = r.data as EngagementRow;
        const cid = clientId(d.client_name, d.link_format, r.row, true);
        if (cid === false) { counts.not_imported++; continue; }
        if (have.has(`${cid}|${d.type}|${d.fiscal_year_end}|${key(d.title)}`)) { counts.already_in_app++; continue; }
        const { client_name: _c, link_format: _f, ...rest } = d; void _c; void _f;
        fresh.push({ ...rest, client_id: cid, source: { from: "Studio", row: r.row } });
      }
      counts.new = fresh.length;
      counts.with_letter_data = fresh.filter((x) => x.letter_data && x.type !== "T1 personal").length;
      writes = chunk(fresh).map((c) => () => batch(c.length, supabase.from("engagements").insert(c)));
    } else {
      const { data: ex } = await supabase.from("proposals").select("title, date_sent");
      const have = new Set((ex ?? []).map((p) => `${key(p.title)}|${p.date_sent}`));
      const fresh: any[] = [];
      for (const r of rows) {
        const d = r.data as ProposalRow;
        const cid = clientId(d.client_name, d.link_format, r.row, false);
        if (cid === false) { counts.not_imported++; continue; }
        if (have.has(`${key(d.title)}|${d.date_sent}`)) { counts.already_in_app++; continue; }
        const { client_name: _c, link_format: _f, ...rest } = d; void _c; void _f;
        fresh.push({ ...rest, client_id: cid, source: { from: "Studio", row: r.row } });
      }
      counts.new = fresh.length;
      writes = chunk(fresh).map((c) => () => batch(c.length, supabase.from("proposals").insert(c)));
    }
  }

  counts.problems = problems.length;
  if (!dryRun) {
    counts.saved = 0; counts.not_saved = 0;
    for (const w of writes) { const r = await w(); counts.saved += r.saved; if (r.error) problems.push({ row: 0, msg: `Not saved: ${r.error}` }); }
    counts.not_saved = counts.new - counts.saved;
    counts.problems = problems.length;
  }
  await supabase.from("import_runs").insert({ source, file_name: fileName.slice(0, 200), dry_run: dryRun, counts, problems });
  return { ok: true, source, dryRun, counts, problems };
}

/* ---------- Past letters and proposals: regenerate the PDF from Studio's saved data ---------- */

export async function regeneratePast(supabase: SupabaseClient, access: Access, limit = 15): Promise<{ done: number; left: number; problems: string[] }> {
  const data = await loadStudioData(supabase, access);
  const problems: string[] = [];
  const { data: docs } = await supabase.from("documents").select("engagement_id, proposal_id");
  const hasEng = new Set((docs ?? []).map((d) => d.engagement_id).filter(Boolean));
  const hasProp = new Set((docs ?? []).map((d) => d.proposal_id).filter(Boolean));
  const { data: engs } = await supabase.from("engagements").select("id, client_id, title, el_issued, fiscal_year_end, registration_confirmed, letter_data").not("letter_data", "is", null).neq("type", "T1 personal");
  const { data: props } = await supabase.from("proposals").select("id, client_id, title, segment, date_sent, valid_until, recommended, options_data").not("options_data", "is", null).neq("status", "Draft");
  const todoE = (engs ?? []).filter((e) => !hasEng.has(e.id) && (e.letter_data as any)?.f);
  const todoP = (props ?? []).filter((p) => !hasProp.has(p.id));
  let done = 0;

  const file = async (kind: "corporate_letter" | "proposal", title: string, link: Record<string, string | null>, snapshot: any) => {
    const b = rebuild(kind, engineFor(kind, { ...data, wording: null }, BLANK_PNG), snapshot, null, true, todayToronto());
    const pdf = await renderPdf(b.def, { regenerated: true });
    const { data: doc, error } = await supabase.from("documents").insert({ kind, title, ...link }).select("id").single();
    if (error || !doc) throw new Error(error?.message ?? "document not created");
    const path = `${doc.id}/${randomUUID()}.pdf`;
    const up = await supabase.storage.from("documents").upload(path, pdf.bytes, { contentType: "application/pdf" });
    if (up.error) throw new Error(up.error.message);
    const v = await supabase.from("document_versions").insert({ document_id: doc.id, version: 1, mode: "final", el_version: b.e.EL_VERSION, inputs: snapshot, file_path: path,
      file_name: b.fileName.replace(/\.pdf$/, "_REGENERATED.pdf"), file_sha256: pdf.sha256, file_size: pdf.bytes.length, regenerated: true, label: REGENERATED_LABEL });
    if (v.error) throw new Error(v.error.message);
  };

  for (const e of todoE.slice(0, limit)) {
    const ld = e.letter_data as any;
    const snapshot = {
      f: { ...ld.f, letterDate: e.el_issued ?? e.fiscal_year_end, revOf: "", reviewed: true },
      fees: (ld.fees ?? []).map((r: string[]) => ({ ...(r[0] ? { tag: r[0] } : {}), svc: r[1], detail: r[2], kind: r[3], amt: r[4], user: true })),
      mode: "final", acks: { ab: !!e.registration_confirmed, bc: !!e.registration_confirmed },
    };
    try { await file("corporate_letter", `${e.title} (regenerated)`, { client_id: e.client_id, engagement_id: e.id }, snapshot); done++; }
    catch (err) { problems.push(`${e.title}: ${err instanceof Error ? err.message : "failed"}`); }
  }
  for (const p of todoP.slice(0, Math.max(0, limit - done))) {
    const snapshot = proposalFromPack(p);
    if (!snapshot) continue;
    try { await file("proposal", `${p.title} (regenerated)`, { client_id: p.client_id, proposal_id: p.id }, snapshot); done++; }
    catch (err) { problems.push(`${p.title}: ${err instanceof Error ? err.message : "failed"}`); }
  }
  return { done, left: todoE.length + todoP.length - done - problems.length, problems };
}

/* ---------- Decision 26: Price Floors corrections, applied after the import ---------- */

type Change = { offer: string; field: string; from: unknown; to: unknown };
const GCI = (notes: string, range: string) => (/GCI[^.;\n]*/.test(notes) ? notes.replace(/GCI[^.;\n]*/, `GCI ${range}`) : (notes ? notes.replace(/\s*$/, " ") : "") + `GCI ${range}.`);

export async function floorCorrections(supabase: SupabaseClient): Promise<{ changes: Change[]; patches: { offer: string; patch: Record<string, unknown> }[]; missing: string[] }> {
  const { data } = await supabase.from("offers").select("offer, software_per_month, annual_floor, notes");
  const by = new Map((data ?? []).map((o) => [o.offer, o]));
  const changes: Change[] = [], patches: { offer: string; patch: Record<string, unknown> }[] = [], missing: string[] = [];
  const agent = by.get("Agent: monthly bookkeeping plus year-end T2");
  if (!agent) missing.push("Agent: monthly bookkeeping plus year-end T2");
  else {
    const note = /\$5,388/.test(agent.notes) ? agent.notes : `${agent.notes ? agent.notes.replace(/\s*$/, " ") : ""}Floor: ($380 + $69) x 12 = $5,388.`;
    const patch: Record<string, unknown> = {};
    if (Number(agent.software_per_month) !== 69) { patch.software_per_month = 69; changes.push({ offer: agent.offer, field: "Software per month", from: agent.software_per_month, to: 69 }); }
    if (Number(agent.annual_floor) !== 5388) { patch.annual_floor = 5388; changes.push({ offer: agent.offer, field: "Annual floor", from: agent.annual_floor, to: 5388 }); }
    if (note !== agent.notes) { patch.notes = note; changes.push({ offer: agent.offer, field: "Notes", from: agent.notes, to: note }); }
    if (Object.keys(patch).length) patches.push({ offer: agent.offer, patch });
  }
  for (const [name, range] of [["Team: Finance Office", "$3M to $5M"], ["Team: Core", "$1M to $3M"], ["Team: Custom", "above $5M"]] as const) {
    const o = by.get(name);
    if (!o) { missing.push(name); continue; }
    const note = GCI(o.notes ?? "", range);
    if (note !== o.notes) { changes.push({ offer: name, field: "Notes", from: o.notes, to: note }); patches.push({ offer: name, patch: { notes: note } }); }
  }
  return { changes, patches, missing };
}
