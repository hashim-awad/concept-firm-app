import { notFound } from "next/navigation";
import { canEdit, requireAccess } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { staffNames } from "@/lib/closebook/server";
import { loadTaxCodes } from "@/lib/closebook/entry-form-server";
import { defaultTaxCode } from "@/lib/closebook/sales-tax";
import { identOf, GEN_MEMO, type GenOrigin } from "@/lib/books/ledger";
import { acctLabel, getBooks, todayIso } from "../../../data";
import { JournalWindow, type WinEntry, type WinLine } from "../window";

// CB2-1 Part 3c: QBO's Journal Entry window, full screen. "new" opens an unsaved entry (from ?copy= or ?reverse= too);
// an entry's id opens it; a worked-out entry ("gen:...": opening balances, opening difference, trial balance import)
// opens like any other and becomes a saved entry when someone saves it.
const nextMonthFirst = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1)).toISOString().slice(0, 10); };

export default async function EntryPage({ params, searchParams }: { params: Promise<{ client: string; entry: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const access = await requireAccess("closebook", "view");
  const { client, entry: rawId } = await params;
  const id = decodeURIComponent(rawId);
  const sp = await searchParams;
  const b = await getBooks(client);
  if (!b) notFound();
  const supabase = await createClient();
  const byIdent = b.byIdent;
  const editable = canEdit(access, "closebook");

  // The entry's lines in the client's accounts. A saved entry's lines name the year's own accounts: by number (or name).
  const savedLines = async (entryId: string): Promise<WinLine[]> => {
    const e = b.entries.find((x) => x.id === entryId);
    if (!e) return [];
    const ids = e.lines.map((l) => l.account_id);
    const { data } = await supabase.from("cb_accounts").select("id, number, name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    const acct = new Map(((data ?? []) as { id: string; number: string; name: string }[]).map((a) => [a.id, a]));
    return e.lines.filter((l) => !l.is_tax).map((l) => {
      const a = acct.get(l.account_id);
      const ca = a ? byIdent.get(identOf(a)) : undefined;
      return { account: ca?.id ?? "", amount: Math.round(l.amount * 100), memo: l.memo ?? "", tax: l.tax_code ?? "" };
    });
  };
  const genLines = (genId: string): WinLine[] => (b.books.generated.find((g) => g.id === genId)?.lines ?? []).map((l) => ({ account: byIdent.get(l.ident)?.id ?? "", amount: l.cents, memo: "", tax: "" }));

  let entry: WinEntry;
  if (id === "new") {
    const src = sp.copy ?? sp.reverse;
    const flip = !!sp.reverse;
    const from = src ? (src.startsWith("gen:") ? genLines(src) : await savedLines(src)) : [];
    const srcDate = src ? (src.startsWith("gen:") ? b.books.generated.find((g) => g.id === src)?.date : b.entries.find((e) => e.id === src)?.date) : undefined;
    const srcMemo = src ? (src.startsWith("gen:") ? b.books.generated.find((g) => g.id === src)?.memo : b.entries.find((e) => e.id === src)?.note) : "";
    entry = { id: null, saved: false, origin: null, no: "", date: flip && srcDate ? nextMonthFirst(srcDate) : srcDate ?? todayIso(), reclass: false,
      memo: flip ? `Reverses ${srcMemo ?? ""}`.trim() : srcMemo ?? "", lines: from.map((l) => ({ ...l, amount: flip ? -l.amount : l.amount })), attachments: [], locked: false };
  } else if (id.startsWith("gen:")) {
    const g = b.books.generated.find((x) => x.id === id);
    if (!g) notFound();
    entry = { id: null, genId: g.id, saved: false, origin: g.origin, no: "", date: g.date, reclass: false, memo: GEN_MEMO[g.origin as GenOrigin], lines: genLines(g.id), attachments: [],
      locked: b.files.find((f) => f.id === g.fileId)?.phase === "locked" };
  } else {
    const e = b.entries.find((x) => x.id === id);
    if (!e) notFound();
    entry = { id: e.id, saved: true, origin: e.origin ?? null, no: e.no, date: e.date, reclass: e.is_reclass ?? e.kind === "RJE", memo: e.note, lines: await savedLines(e.id),
      attachments: (e.attachments ?? []).map((p) => p.split("/").pop()!.replace(/^\d+-/, "")), locked: e.locked, schedule: e.origin === "schedule" || e.origin === "expenses_personal" };
  }

  // The next number in the client's sequence (the year that holds the date numbers it; the database gives it on Save).
  const yearOf = (d: string) => b.files.find((f) => f.year_start <= d && d <= f.year_end) ?? b.files[b.files.length - 1];
  const y = yearOf(entry.date);
  const used = b.entries.filter((e) => e.fileId === y?.id).map((e) => e.seq);
  const nextNo = y ? `${y.year_end.slice(0, 4)}-${String((used.length ? Math.max(...used) : 0) + 1).padStart(3, "0")}` : "";

  // Sales tax: the client's province, the rates in force; registration from the year file.
  const codes = await loadTaxCodes(supabase, b.client.province, entry.date);
  const { data: setups } = await supabase.from("cb_files").select("id, year_start, year_end, setup").eq("cb_client_id", client);
  const years = ((setups ?? []) as { id: string; year_start: string; year_end: string; setup: { gst_registered?: boolean; quick_method?: boolean } | null }[])
    .map((f) => ({ from: f.year_start, to: f.year_end, registered: f.setup?.gst_registered !== false, quick: f.setup?.quick_method === true }));

  // Every active account, plus any inactive one this entry uses.
  // An account with no default tax code of its own takes the chart template's (QBO: the account's default tax code).
  const { data: tpl } = await supabase.from("cb_chart_accounts").select("number, tax_default");
  const tplTax = new Map(((tpl ?? []) as { number: string; tax_default: string | null }[]).map((t) => [t.number, t.tax_default ?? ""]));
  const usedIds = new Set(entry.lines.map((l) => l.account));
  const accounts = b.chart.filter((a) => !a.merged_into && (a.active || usedIds.has(a.id))).map((a) => ({ value: a.id, label: acctLabel(a), sort: a.number || `~${a.name}`, type: a.account_type,
    tax: a.tax_code ?? (tplTax.has(a.number) ? defaultTaxCode(tplTax.get(a.number)!, b.client.province, a.number) ?? "" : ""), number: a.number }));

  // Audit history (one row per action) and the transaction journal (the postings this entry made, sales tax included).
  const [{ data: hist }, names] = entry.id ? await Promise.all([
    supabase.from("cb_file_history").select("id, at, actor_id, action, detail, old_value, new_value").eq("entry_id", entry.id).order("at", { ascending: false }),
    staffNames(supabase),
  ]) : [{ data: [] }, new Map<string, string>()];
  const ref = entry.id ?? entry.genId ?? "";
  const postings = ref ? b.books.postings.filter((p) => p.ref === ref) : [];
  const journal = postings.map((p) => ({ account: byIdent.get(p.ident) ? acctLabel(byIdent.get(p.ident)!) : p.ident.replace(/^name:/, ""), cents: p.cents }));

  // The three opening checks, as warnings (never refusals).
  const warnings: string[] = [];
  if (entry.origin === "opening_balances" || entry.origin === "opening_difference") {
    const { data: f } = await supabase.from("cb_files").select("opening_re_stated").eq("id", y?.id ?? "").maybeSingle();
    const re = entry.lines.filter((l) => byIdent.get(b.re)?.id === l.account).reduce((n, l) => n + l.amount, 0);
    const stated = f?.opening_re_stated === null || f?.opening_re_stated === undefined ? null : Math.round(Number(f.opening_re_stated) * 100);
    if (entry.origin === "opening_balances" && stated !== null && -re !== stated) warnings.push(`Retained earnings in this entry (${(-re / 100).toFixed(2)}) differ from last year's T2 line 3849 (${(stated / 100).toFixed(2)}).`);
    for (const l of entry.lines) {
      const a = b.chart.find((x) => x.id === l.account);
      if (!a || !l.amount) continue;
      if (/opening balance/i.test(a.name)) warnings.push(`${acctLabel(a)} is not cleared: ${(l.amount / 100).toFixed(2)}.`);
      if ((a.line_no ?? "").startsWith("370")) warnings.push(`${acctLabel(a)} carries ${(l.amount / 100).toFixed(2)} from last year. Move it to retained earnings once.`);
    }
  }

  return <JournalWindow clientId={client} entry={entry} nextNo={nextNo} accounts={accounts} codes={codes} years={years} canEdit={editable && !entry.locked}
    history={((hist ?? []) as { id: string; at: string; actor_id: string | null; action: string; detail: string; old_value: string | null; new_value: string | null }[])
      .map((h) => ({ id: h.id, at: h.at, who: h.actor_id ? names.get(h.actor_id) ?? "" : "", detail: h.detail, old: h.old_value, now: h.new_value }))}
    journal={journal} warnings={warnings} back={sp.back ?? `/cb/${client}/journal`} openHistory={sp.history === "1"} />;
}
