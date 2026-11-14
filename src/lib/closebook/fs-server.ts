import "server-only";
// Step 9, the year-end package (round 11): everything the step and its documents read, from the final
// trial balance through the step 7 matches (the codes of the final GIFI export) and step 2's last year.
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFile, loadReference } from "./server";
import { gifiCodes } from "./gifi";
import { buildFs, caption, longDate, type FsLine } from "./fs-model";
import { DATE_PLACEHOLDER, type Dividend, type Lawyer } from "./fs-text";
import type { FsCtx } from "./fs-pdf";

export type DivField = { line: string; cls: string; declared: string; paid: string; eligible?: boolean | null };
export type FsFields = { officer_name: string; officer_position: string; officer_email: string; sh_terms: string; related: Record<string, string>; audit_waiver: boolean; first_year: boolean | null; dividends: DivField[] };
export type MalStatus = { mal_quote_id: string | null; mal_status: string | null; mal_sent_at: string | null; mal_token: string | null; mal_email: string | null; mal_signed_at: string | null;
  mal_signed_name: string | null; mal_signed_title: string | null; mal_withdrawn_at: string | null; mal_withdrawn_why: string | null };

const SH = new Set(["1300", "1301", "1302", "2180", "2181", "2182", "2780", "2781", "2782", "3260", "3261", "3262"]);
const RELATED = /related (part|corp|canadian|foreign)|affiliat/i;
const torontoDate = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Toronto" });

export async function loadPackage(supabase: SupabaseClient, fileId: string) {
  const data = await loadFile(supabase, fileId);
  if (!data) return null;
  const ref = await loadReference(supabase);
  const { file, client, accounts, entries } = data;
  const byNo = new Map(ref.lines.map((l) => [l.line_no, l]));
  const entryTotals = new Map<string, number>();
  for (const e of entries) for (const l of e.lines) entryTotals.set(l.account_id, (entryTotals.get(l.account_id) ?? 0) + l.amount);
  const finalOf = (a: { id: string; this_year: number }) => Math.round((Number(a.this_year) + (entryTotals.get(a.id) ?? 0)) * 100) / 100;
  // This year: the same codes as the final GIFI export.
  const g = gifiCodes(accounts, entryTotals, byNo);
  const cur = new Map(g.codes);

  const [{ data: cf }, { data: ff }, { data: ob }, { data: s125 }, { data: settings }, { data: st }] = await Promise.all([
    supabase.from("cb_client_fs_fields").select("officer_name, officer_position, officer_email, sh_terms, related, audit_waiver").eq("client_id", file.client_id).maybeSingle(),
    supabase.from("cb_file_fs").select("first_year, dividends").eq("file_id", fileId).maybeSingle(),
    supabase.from("cb_opening_balances").select("code, amount, chart_account").eq("file_id", fileId),
    supabase.from("cb_opening_s125").select("code, amount").eq("file_id", fileId),
    supabase.from("cb_settings").select("note1_policy").maybeSingle(),
    supabase.rpc("cb_fs_status", { p_file: fileId }),
  ]);
  const bank = ["statements", "paper"].includes(file.books);
  const lastYearExists = bank ? (ob ?? []).length > 0 : accounts.some((a) => Number(a.last_year) !== 0);
  // The fields, filled from the file where the data exists (the signing officer from the client record).
  const fields: FsFields = {
    officer_name: cf?.officer_name || client?.signing_officer || "", officer_position: cf?.officer_position ?? "", officer_email: cf?.officer_email ?? "",
    sh_terms: cf?.sh_terms ?? "", related: (cf?.related ?? {}) as Record<string, string>, audit_waiver: cf?.audit_waiver ?? true,
    first_year: ff ? (ff.first_year as boolean | null) : null, dividends: ((ff?.dividends ?? []) as DivField[]),
  };
  const firstYearSuggested = !lastYearExists;
  const firstYear = fields.first_year ?? firstYearSuggested;

  // Last year's column from step 2: Schedule 100 and Schedule 125 on a bank-statement file, the
  // trial balance's last-year column otherwise. None in the first year.
  let prior: Map<string, number> | null = null;
  const missingS125 = !firstYear && bank && !(s125 ?? []).length;
  if (!firstYear) {
    if (bank) prior = new Map([...(ob ?? []).map((x) => [x.code as string, Number(x.amount)] as [string, number]), ...(s125 ?? []).map((x) => [x.code as string, Number(x.amount)] as [string, number])]);
    else prior = new Map(gifiCodes(accounts.map((a) => ({ ...a, this_year: Number(a.last_year), needs_reviewer: false })), new Map(), byNo).codes);
  }

  // Captions: the statement line of each GIFI code's main line.
  const lines = new Map<string, FsLine>();
  for (const l of ref.lines) if (l.line_no.endsWith(".00") || !lines.has(l.gifi_code)) lines.set(l.gifi_code, { code: l.gifi_code, name: (l as { gifi_name?: string }).gifi_name ?? l.name, caption: l.statement_line ?? "" });
  const { data: gn } = await supabase.from("cb_master_lines").select("gifi_code, gifi_name, statement_line").like("line_no", "%.00");
  for (const x of (gn ?? []) as { gifi_code: string; gifi_name: string; statement_line: string }[]) lines.set(x.gifi_code, { code: x.gifi_code, name: x.gifi_name, caption: x.statement_line });

  // GST/HST payable split out of 2680: the GST/HST payable account (21500, or a client account on 2680 named for it).
  const isHst = (a: { account_key: string | null; line_no: string | null; name: string }) => a.account_key === "chart:21500" || (!!a.line_no?.startsWith("2680") && /gst|hst/i.test(a.name));
  const hst = accounts.filter(isHst).reduce((n, a) => n + finalOf(a), 0);
  // Last year: the trial balance's last-year column, or step 2's 2680 line when it sits on the GST/HST account.
  const hstPrior = !prior ? 0 : bank ? -Number(((ob ?? []) as { code: string; amount: number; chart_account?: string | null }[]).find((x) => x.code === "2680" && x.chart_account === "21500")?.amount ?? 0)
    : accounts.filter(isHst).reduce((n, a) => n + Number(a.last_year), 0);
  const address = { street: client?.street_address ?? "", city: client?.city ?? "", prov: client?.province === "OTHER" ? "" : client?.province ?? "", postal: client?.postal_code ?? "" };
  const m = buildFs({ name: client?.legal_name ?? "", address, yearStart: file.year_start, yearEnd: file.year_end, cur, prior, lines, hst: -hst, hstPrior: -hstPrior,
    related: fields.related, shTerms: fields.sh_terms, note1Policy: (settings?.note1_policy as string) ?? "" });

  // What the fields need, from the file (each one empty shows "To fill").
  const codeOf = (a: { line_no: string | null }) => (a.line_no ? byNo.get(a.line_no)?.gifi_code ?? "" : "");
  const live = accounts.filter((a) => finalOf(a) !== 0 && a.line_no);
  const needsShTerms = live.some((a) => SH.has(codeOf(a)));
  const relatedCodes = [...new Set(live.filter((a) => RELATED.test(lines.get(codeOf(a))?.name ?? "")).map(codeOf))].sort().map((c) => ({ code: c, name: lines.get(c)?.name ?? c }));
  const divLines = [...new Set(live.filter((a) => { const c = Number(codeOf(a)); return c >= 3700 && c <= 3719; }).map((a) => a.line_no!))].sort().map((line) => ({
    line, name: byNo.get(line)?.name ?? line, // A dividend is a debit in the trial balance: shown as a positive amount on the letter.
    amount: Math.round(live.filter((a) => a.line_no === line).reduce((n, a) => n + finalOf(a), 0)),
    // 3701.10 non-eligible, 3701.20 eligible (the master lines); any other dividend line: the preparer says.
    eligible: line === "3701.20" ? true : line === "3701.10" ? false : null }));

  const mal = (st ?? {}) as MalStatus;
  const signed = !!mal.mal_signed_at && !!mal.mal_quote_id;
  const signedDate = signed ? torontoDate(mal.mal_signed_at!) : null;
  // The report, the MAL and the minute book letter share one date: the day the signing officer signs.
  const ctx: FsCtx = { draft: !signed, reportDate: signedDate ? longDate(signedDate) : DATE_PLACEHOLDER, officer: { name: fields.officer_name, position: fields.officer_position },
    // The minute book copy of the MAL shows it signed, on its own signature line.
    esign: signedDate ? `Signed electronically by ${mal.mal_signed_name}${mal.mal_signed_title ? `, ${mal.mal_signed_title}` : ""}, on ${longDate(signedDate)}` : undefined };
  const dividends: Dividend[] = divLines.map((d) => {
    const f = fields.dividends.find((x) => x.line === d.line);
    return { cls: f?.cls ?? "", amount: d.amount, eligible: d.eligible ?? !!f?.eligible, declared: f?.declared ? longDate(f.declared) : "", paid: f?.paid ? longDate(f.paid) : "" };
  });
  const lawyer: Lawyer = { auditWaiver: fields.audit_waiver, dividends };

  // What stops the package (named), and the notes to add by hand.
  const signs = await supabase.from("cb_step_signoffs").select("step, prepared_at, reviewed_at").eq("file_id", fileId);
  const sg = new Map(((signs.data ?? []) as { step: string; prepared_at: string | null; reviewed_at: string | null }[]).map((x) => [x.step, x]));
  const blocked: string[] = [];
  if (!sg.get("t2")?.prepared_at) blocked.push("Step 8 must be signed by the preparer first.");
  if (missingS125) blocked.push("Enter last year's Schedule 125 in step 2.");
  if (!g.codes.length) blocked.push("There is no trial balance yet.");
  // Without last year's Schedule 125 the prior column cannot tie: the missing schedule is the one problem named.
  for (const t of m.failed.filter((x) => !(missingS125 && x.column === "prior"))) blocked.push(`Tie-out failed (${t.column === "current" ? "this year" : "last year"}): ${t.name}. ${(t.left / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })} against ${(t.right / 100).toLocaleString("en-CA", { minimumFractionDigits: 2 })}.`);
  const byHand: string[] = [];
  if ((cur.get("1483") ?? 0) !== 0) byHand.push("Note to add by hand: income taxes recoverable.");
  // Captions where the master line's statement line contradicts its line: the GIFI name is used.
  const captionFallbacks = [...new Set([...cur.keys(), ...(prior?.keys() ?? [])])].filter((c) => { const l = lines.get(c); return !!l && !!l.caption && l.caption !== "Calculated total" && caption(l, c) !== l.caption.trim(); })
    .map((c) => ({ code: c, used: caption(lines.get(c), c), statementLine: lines.get(c)!.caption }));

  return { data, m, ctx, fields, firstYear, firstYearSuggested, lastYearExists, needsShTerms, relatedCodes, divLines, lawyer, mal, signed, blocked, byHand, captionFallbacks,
    reviewed: !!sg.get("statements")?.reviewed_at, prepared: !!sg.get("statements")?.prepared_at, bank };
}
export type PackageData = NonNullable<Awaited<ReturnType<typeof loadPackage>>>;
