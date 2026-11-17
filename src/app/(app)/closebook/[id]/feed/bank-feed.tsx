"use client";
// Round 31, step 4 (Hashim, Nov 17, 2026): Code transactions as QuickBooks Online's "Bank transactions" page.
// Top to bottom: the account cards, the tabs (Pending, Posted, Excluded), the toolbar, the list, and the black bar when
// lines are ticked. Nothing posts until a line is posted. The page keeps its own list: posting, ticking, editing and
// paging never reload it; the counts, cards and trial balance update at once.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Calendar, ChevronLeft, ChevronRight, Download, MessageSquare, Paperclip, Plus, Printer, Search, Settings, Check, X } from "lucide-react";
import { notify } from "@/components/save-state";
import { formatDate } from "@/lib/dates";
import { splitLine } from "@/lib/closebook/sales-tax";
import type { FeedData, FeedSplit } from "@/lib/closebook/feed-server";
import {
  FILTERS, applyRules, barText, cardBalances, findPairs, inFilter, isExcluded, isOut, isPending, isPosted, matchesSearch, pairType, postItem, rowView, testRule,
  type BankRule, type FeedAccount, type FeedLine, type FilterKey, type PostItem, type RowView,
} from "@/lib/closebook/bank-feed";
import { AccountPicker, type Pick } from "./account-picker";
import { AskWindow, EXCLUDE_REASONS, EditWindow, ExcludeWindow, FLD, PairWindow, Pop, SplitWindow, TaxSelect, money, type EditChoice } from "./windows";
import { RulePane, RulesPage, blankRule, type RuleDraft } from "./rules";
import {
  askClientLines, attachReceipt, clearSplits, excludeLines, excludedReviewed, exportList, fillLines, getLines, pairChoice, postLines, receiptUrl, reorderRules, restoreLines,
  ruleAction, saveRule, saveSplits, setClientAnswer, setDate, setMemo, unpostLines,
} from "../../feed-actions";

type Tab = "pending" | "posted" | "excluded";
type Win = { k: "edit" } | { k: "split"; id: string } | { k: "ask"; ids: string[] } | { k: "exclude"; ids: string[] } | { k: "pair"; id: string }
  | { k: "rule"; draft: RuleDraft; id: string | null; from?: string } | null;
type PopState = { k: "dates" | "settings" | "filter"; el: HTMLElement } | { k: "date" | "memo" | "files"; el: HTMLElement; id: string } | null;
const fmtSigned = (c: number) => `${c < 0 ? "−" : ""}${money(c)}`;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// The page size and columns are kept in this browser (QuickBooks Online keeps its table settings).
const STORE_EVENT = "cb-feed-settings";
const subscribe = (f: () => void) => { window.addEventListener("storage", f); window.addEventListener(STORE_EVENT, f); return () => { window.removeEventListener("storage", f); window.removeEventListener(STORE_EVENT, f); }; };
function useStored<T>(key: string, initial: T): [T, (v: T) => void] {
  const raw = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key) ?? ""; } catch { return ""; } }, () => "");
  const v = useMemo(() => { try { return raw ? (JSON.parse(raw) as T) : initial; } catch { return initial; } }, [raw]);   // eslint-disable-line react-hooks/exhaustive-deps
  return [v, (x: T) => { try { localStorage.setItem(key, JSON.stringify(x)); window.dispatchEvent(new Event(STORE_EVENT)); } catch { /* this visit only */ } }];
}

export function BankFeed({ data, editable, isReviewer, initialAccount, focusLine, initialRules = false }: {
  data: FeedData; editable: boolean; isReviewer: boolean; initialAccount?: string; focusLine?: string | null; initialRules?: boolean;
}) {
  const accounts = data.accounts;
  const [lines, setLines] = useState<FeedLine[]>(data.lines);
  const [splits, setSplits] = useState<Record<string, FeedSplit[]>>(data.splits);
  const [files, setFiles] = useState(data.files);
  const [rules, setRules] = useState<BankRule[]>(data.rules);
  const [choices, setChoices] = useState(data.choices);
  const [reviewed, setReviewed] = useState(data.excludedReviewed.current);
  const [reviewedBy, setReviewedBy] = useState<{ by: string | null; at: string | null }>({ by: data.excludedReviewed.by, at: data.excludedReviewed.at });
  const focus = focusLine ? data.lines.find((l) => l.id === focusLine) : undefined;
  const [acc, setAcc] = useState<string>(focus?.account_id ?? (accounts.some((a) => a.id === initialAccount) ? initialAccount! : accounts[0]?.id ?? ""));
  const [tab, setTab] = useState<Tab>(focus ? (isExcluded(focus) ? "excluded" : isPosted(focus) ? "posted" : "pending") : "pending");
  const [view, setView] = useState<"list" | "rules">(initialRules ? "rules" : "list");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [dates, setDates] = useState<{ mode: string; from: string; to: string }>({ mode: "all", from: "", to: "" });
  // Opened from a report's ledger: the line's own page.
  const [page, setPage] = useState(() => {
    if (!focus) return 1;
    const same = data.lines.filter((l) => l.account_id === focus.account_id && (isExcluded(focus) ? isExcluded(l) : isPosted(focus) ? isPosted(l) : isPending(l)));
    return Math.floor(Math.max(0, same.findIndex((l) => l.id === focus.id)) / 50) + 1;
  });
  const [size, setSize] = useStored<number>("cb-feed-size", 50);
  const [cols, setCols] = useStored<{ itc: boolean; clip: boolean; memo: boolean }>("cb-feed-cols", { itc: true, clip: true, memo: true });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [win, setWin] = useState<Win>(null);
  const [pop, setPop] = useState<PopState>(null);
  const [busy, setBusy] = useState(false);

  const accById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const chartOf = useMemo(() => new Map(data.chart.map((c) => [c.number, c])), [data.chart]);
  const codeOf = useMemo(() => new Map(data.codes.map((c) => [c.code, c])), [data.codes]);
  const history = useMemo(() => new Map(data.history), [data.history]);
  const firm = useMemo(() => new Map(data.firm), [data.firm]);
  const taxFor = useCallback((a: string) => data.defaultTax[a] ?? null, [data.defaultTax]);
  const pairs = useMemo(() => findPairs(lines, accounts, choices), [lines, accounts, choices]);
  const ruleMap = useMemo(() => applyRules(lines, rules, accounts, pairs), [lines, rules, accounts, pairs]);
  const views = useMemo(() => {
    const m = new Map<string, RowView>();
    for (const l of lines) if (isPending(l)) m.set(l.id, rowView(l, pairs, ruleMap, history, firm, accounts, taxFor));
    return m;
  }, [lines, pairs, ruleMap, history, firm, accounts, taxFor]);
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const a = accById.get(acc);
  const kind = a?.kind ?? "bank";
  const outOf = (l: FeedLine) => isOut(accById.get(l.account_id)?.kind ?? "bank", l.cents);
  const chartLabel = (n: string | null) => (n ? `${n} ${chartOf.get(n)?.name ?? ""}`.trim() : "");
  const accShort = (id: string | null | undefined) => (id ? accById.get(id)?.label.split(" · ")[0] ?? "" : "");

  // ---------- The list for this account and tab
  const mine = useMemo(() => lines.filter((l) => l.account_id === acc), [lines, acc]);
  const inTab = useMemo(() => mine.filter((l) => (tab === "pending" ? isPending(l) : tab === "excluded" ? isExcluded(l) : isPosted(l))), [mine, tab]);
  const range = dates.mode === "all" ? null : dates;
  const inDates = (l: FeedLine) => !range || ((!range.from || l.acct_date >= range.from) && (!range.to || l.acct_date <= range.to));
  const base = inTab.filter((l) => matchesSearch(l, q) && inDates(l));
  const rows = base.filter((l) => inFilter(filter, l, views.get(l.id) ?? null, kind));
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(page, pages);
  const shown = rows.slice((p - 1) * size, p * size);
  // A new account, tab, search, filter, dates or page size starts at page 1 with nothing ticked.
  const viewKey = JSON.stringify([acc, tab, q, filter, dates, size]);
  const [seenKey, setSeenKey] = useState(viewKey);
  if (seenKey !== viewKey) { setSeenKey(viewKey); setPage(1); setTicked(new Set()); }
  useEffect(() => { if (focus) setTimeout(() => document.getElementById(`line-${focus.id}`)?.scrollIntoView({ block: "center" }), 50); }, [focus]);
  const pendingCount = mine.filter(isPending).length;

  // ---------- Talking to the server
  const refresh = useCallback(async (ids: string[]) => {
    const r = await getLines(data.fileId, [...new Set(ids)]);
    if (!r.ok) return;
    const fresh = new Map(r.lines.map((l) => [l.id, l]));
    setLines((ls) => ls.map((l) => fresh.get(l.id) ?? l));
    setSplits((s) => { const n = { ...s }; for (const id of ids) { if (r.splits[id]) n[id] = r.splits[id]; else delete n[id]; } return n; });
  }, [data.fileId]);
  const fail = (e: string) => { notify(e, "error"); };

  // What posting does to the lines, at once (the server's answer then replaces them).
  const applyLocal = useCallback((ls: FeedLine[], items: PostItem[]) => {
    const m = new Map(ls.map((l) => [l.id, l]));
    const put = (l: FeedLine, p: Partial<FeedLine>) => m.set(l.id, { ...m.get(l.id)!, ...p });
    for (const it of items) {
      const l = m.get(it.id);
      if (!l || !isPending(l)) continue;
      if (it.kind === "code") put(l, { status: "done", chart_account: it.account!, tax_code: it.tax!, transfer_account: null, is_split: false, source: it.source ?? "manual", rule_id: it.rule_id ?? null });
      else if (it.kind === "split") put(l, { status: "done", source: "manual" });
      else if (it.kind === "transfer") put(l, { status: "done", transfer_account: it.transfer_account!, chart_account: accById.get(it.transfer_account!)?.chart ?? null, tax_code: null, source: it.source ?? "manual" });
      else if (it.kind === "pair") {
        const o = m.get(it.other!);
        if (!o || !isPending(o)) continue;
        const [out, inn] = outOf(l) ? [l, o] : [o, l];
        put(out, { status: "done", source: "transfer", chart_account: accById.get(inn.account_id)?.chart ?? null, transfer_account: null, tax_code: null, transfer: { other: inn.id, role: "posts" } });
        put(inn, { status: "matched", source: "transfer", chart_account: null, transfer_account: null, tax_code: null, transfer: { other: out.id, role: "matched" } });
      } else if (it.kind === "already") {
        const o = m.get(it.other!);
        if (!o) continue;
        put(l, { status: "matched", source: "transfer", chart_account: null, tax_code: null, transfer: { other: o.id, role: "matched" } });
        put(o, { transfer: { other: l.id, role: "posts" } });
      }
    }
    return ls.map((l) => m.get(l.id)!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accById]);

  const unpost = useCallback(async (ids: string[]) => {
    const partners = ids.flatMap((id) => { const t = byId.get(id)?.transfer; return t ? [t.other] : []; });
    setLines((ls) => ls.map((l) => (ids.includes(l.id) || (partners.includes(l.id) && (byId.get(l.id)?.transfer?.role === "matched" || byId.get(l.id)?.source === "transfer"))) && !isPending(l) && !isExcluded(l)
      ? { ...l, status: "new", transfer: null, ...(l.source === "transfer" ? { chart_account: null, tax_code: null, source: "" } : {}) } : l));
    const r = await unpostLines(data.fileId, ids);
    if (!r.ok) fail(r.error);
    await refresh([...ids, ...partners]);
  }, [byId, data.fileId, refresh]);

  const post = useCallback(async (ids: string[], opts: { quiet?: string } = {}) => {
    const items = ids.map((id) => { const l = byId.get(id); const v = views.get(id); return l && v ? postItem(l, v) : null; }).filter((x): x is PostItem => !!x);
    if (!items.length) return false;
    const touched = [...new Set(items.flatMap((i) => [i.id, ...(i.other ? [i.other] : [])]))];
    const ruleMemos = items.filter((i) => i.rule_id).map((i) => ({ id: i.id, memo: rules.find((r) => r.id === i.rule_id)?.memo ?? "" })).filter((x) => x.memo && !byId.get(x.id)?.memo);
    setLines((ls) => applyLocal(ls, items));
    setTicked(new Set());
    const r = await postLines(data.fileId, items);
    if (!r.ok) { fail(r.error); await refresh(touched); return false; }
    for (const m of ruleMemos) await setMemo(m.id, m.memo);
    await refresh(touched);
    const pairOnly = items.length === 1 && (items[0].kind === "pair" || items[0].kind === "already");
    const text = opts.quiet ?? (pairOnly ? (items[0].kind === "pair" ? "Transfer posted" : "Posted, no second entry") : items.length === 1 ? "Posted" : `${items.length} posted`);
    notify(text, "ok", { ms: 5000, action: { label: "Undo", run: () => { void unpost(items.map((i) => i.id)); } } });
    return true;
  }, [byId, views, rules, applyLocal, data.fileId, refresh, unpost]);

  // A choice on a Pending line is kept (QuickBooks Online keeps it); nothing posts. On a paired line it unpairs first.
  const fill = useCallback(async (ids: string[], pick: Pick | null, tax: string | null) => {
    for (const id of ids) {
      const pr = pairs.get(id);
      if (!pr) continue;
      if (pr.kind !== "options" && pick && "transfer" in pick && pr.other.account_id === pick.transfer) continue;
      const others = pr.kind === "options" ? pr.options.map((o) => o.id) : [pr.other.id];
      for (const o of others) { await pairChoice(data.fileId, id, o, "rejected"); setChoices((c) => [...c, { a: id < o ? id : o, b: id < o ? o : id, kind: "rejected" }]); }
    }
    const items = ids.filter((id) => !(pick && "transfer" in pick && pairs.get(id)?.kind !== "options" && pairs.get(id) && (pairs.get(id) as { other: { account_id: string } }).other.account_id === pick.transfer))
      .map((id) => ({ id, account: pick && "account" in pick ? pick.account : null, tax: pick && "account" in pick ? tax : null, transfer_account: pick && "transfer" in pick ? pick.transfer : null }));
    if (!items.length) return true;
    setLines((ls) => ls.map((l) => { const it = items.find((x) => x.id === l.id); return it ? { ...l, chart_account: it.account, tax_code: it.tax, transfer_account: it.transfer_account, is_split: false, source: "manual", rule_id: null } : l; }));
    const r = await fillLines(data.fileId, items);
    if (!r.ok) { fail(r.error); await refresh(items.map((x) => x.id)); return false; }
    return true;
  }, [pairs, data.fileId, refresh]);

  // Auto-post rules: lines a rule with Auto-post finds post as the page opens (and after a rule is saved).
  const autoDone = useRef(false);
  useEffect(() => {
    if (autoDone.current || !editable || !data.gstAnswered) return;
    const ids = [...views.entries()].filter(([, v]) => v.source === "auto" && v.badge === "rule" && v.ready).map(([id]) => id);
    if (!ids.length) return;
    const t = setTimeout(() => { autoDone.current = true; void post(ids, { quiet: `${ids.length} posted by rules (auto-post)` }); }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Cards
  const cards = useMemo(() => accounts.map((x) => ({ a: x, ...cardBalances(x, lines, accounts) })), [accounts, lines]);
  const strip = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState(false);
  useEffect(() => {
    const s = strip.current;
    if (!s) return;
    const o = new ResizeObserver(() => setArrows(s.scrollWidth > s.clientWidth + 2));
    o.observe(s);
    return () => o.disconnect();
  }, []);

  // ---------- Ticks and the black bar
  const tickedLines = [...ticked].map((id) => byId.get(id)).filter((l): l is FeedLine => !!l);
  const notReady = tickedLines.filter((l) => !views.get(l.id)?.ready).length;
  const allOut = tickedLines.every(outOf), allIn = tickedLines.every((l) => !outOf(l));
  const toggle = (id: string) => setTicked((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const pageIds = shown.map((l) => l.id);
  const allTicked = pageIds.length > 0 && pageIds.every((id) => ticked.has(id));

  // The black bar spans the list (QuickBooks Online): it follows the list's left edge and width.
  const listRef = useRef<HTMLElement>(null);
  const [barBox, setBarBox] = useState<{ left: number; width: number } | null>(null);
  const barOn = ticked.size > 0 && tab === "pending";
  // While the bar shows, space under the list equal to its height, so the last row scrolls clear of it.
  const barRef = useRef<HTMLDivElement>(null);
  const [barH, setBarH] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el || !barOn) return;
    const o = new ResizeObserver(() => setBarH(el.getBoundingClientRect().height));
    o.observe(el);
    return () => o.disconnect();
  }, [barOn]);
  useEffect(() => {
    const el = listRef.current;
    if (!el || !barOn) return;
    const place = () => { const r = el.getBoundingClientRect(); setBarBox({ left: r.left, width: r.width }); };
    const o = new ResizeObserver(place);
    o.observe(el); window.addEventListener("resize", place);
    return () => { o.disconnect(); window.removeEventListener("resize", place); };
  }, [barOn]);

  // ---------- Filter counts
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, base.filter((l) => inFilter(k, l, views.get(l.id) ?? null, kind)).length])) as Record<FilterKey, number>;
  const dateLabel = !range ? "All dates" : `${range.from ? formatDate(range.from) : "Start"} to ${range.to ? formatDate(range.to) : "End"}`;

  // ---------- Rules
  const testDraft = (r: RuleDraft) => testRule({ ...r, id: "draft", priority: 0, active: true }, lines, accounts, pairs);
  const saveDraft = async (r: RuleDraft, id: string | null) => {
    const res = await saveRule(data.fileId, id, { ...r, account: r.chart_account, tax: r.tax_code });
    if (!res.ok) { fail(res.error); return false; }
    const next: BankRule[] = id ? rules.map((x) => (x.id === id ? { ...x, ...r } : x)) : [...rules, { ...r, id: res.id, priority: Math.max(0, ...rules.map((x) => x.priority)) + 1, active: true }];
    setRules(next);
    const found = applyRules(lines, next, accounts, pairs);
    const mineFound = [...found.entries()].filter(([, x]) => x.id === res.id).map(([lid]) => lid);
    if (r.auto_post && mineFound.length) {
      const items = mineFound.map((lid) => { const l = byId.get(lid)!; return postItem(l, rowView(l, pairs, found, history, firm, accounts, taxFor)); }).filter((x): x is PostItem => !!x);
      setLines((ls) => applyLocal(ls, items));
      const pr = await postLines(data.fileId, items);
      if (!pr.ok) fail(pr.error);
      await refresh(items.map((i) => i.id));
      notify(`Rule saved · ${mineFound.length} line${mineFound.length === 1 ? "" : "s"} posted`);
    } else notify(`Rule saved · ${mineFound.length} line${mineFound.length === 1 ? "" : "s"} found`);
    return true;
  };
  const fromRow = (l: FeedLine): RuleDraft => {
    const v = views.get(l.id);
    const name = l.description.replace(/\s+/g, " ").trim().slice(0, 120);
    const out = outOf(l);
    return { ...blankRule(out ? "out" : "in"), name, conditions: [{ field: "description", op: "contains", value: name }],
      ...(v?.transfer ? { txn_type: "transfer", bank_number: accById.get(v.transfer)?.number ?? null } : v?.account ? { chart_account: v.account, tax_code: v.tax } : {}) };
  };

  // ---------- Export and print
  const exportRows = async () => {
    const cols2 = tab === "excluded" ? ["Date", "Bank description", "Spent", "Received", "Reason", "Excluded by"] : ["Date", "Bank description", "Spent", "Received", "Sales tax", "Account", ...(tab === "posted" ? ["Posted"] : [])];
    const data2 = rows.map((l) => {
      const out = outOf(l), v = views.get(l.id);
      const base2: (string | number | null)[] = [formatDate(l.acct_date), l.description, out ? Math.abs(l.cents) : null, out ? null : Math.abs(l.cents)];
      if (tab === "excluded") return [...base2, EXCLUDE_REASONS.find(([k]) => k === l.excluded_reason)?.[1] ?? "", data.people[l.excluded_by ?? ""]?.name ?? ""];
      return [...base2, taxName(l, v), accountText(l, v), ...(tab === "posted" ? [postedBy(l)] : [])];
    });
    const r = await exportList(`${a?.label.split(" · ")[0] ?? ""} ${tab}`.slice(0, 31), cols2, data2);
    if (!r.ok) { fail(r.error); return; }
    const blob = new Blob([Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0))], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const u = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = u; link.download = `Bank transactions ${a?.number ?? ""} ${tab}.xlsx`; link.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  };

  // ---------- Words for a row
  const taxName = (l: FeedLine, v?: RowView) => {
    if (l.transfer || l.transfer_account || v?.transfer || v?.pair) return "No tax";
    if (l.is_split || v?.split) return "Split";
    const t = isPending(l) ? v?.tax : l.tax_code;
    return t ? codeOf.get(t)?.name ?? t : "";
  };
  const accountText = (l: FeedLine, v?: RowView): string => {
    if (isPending(l) && v) {
      if (v.split) return `Split (${splits[l.id]?.length ?? 0})`;
      if (v.pair?.kind === "options") return `PAIR · ${v.pair.options.length} option${v.pair.options.length === 1 ? "" : "s"}`;
      if (v.pair?.kind === "already") return `PAIR · Already posted from ${accShort(v.pair.other.account_id)}`;
      if (v.pair) return `PAIR · ${accShort(v.pair.other.account_id)}`;
      if (v.transfer) return accById.get(v.transfer)?.label ?? "";
      return chartLabel(v.account);
    }
    if (l.is_split) return `Split (${splits[l.id]?.length ?? 0})`;
    if (l.status === "matched" && l.source === "outstanding") return "Clears last year's outstanding item";
    if (l.transfer) return `PAIR · ${accShort(byId.get(l.transfer.other)?.account_id)}`;
    if (l.transfer_account) return accById.get(l.transfer_account)?.label ?? "";
    return chartLabel(l.chart_account);
  };
  // Round 31 follow-up (QuickBooks Online): the Posted column says who posted, or AUTO for an auto-post rule; RULE and PAIR
  // are badges inside the Account field.
  const postedBy = (l: FeedLine) => (l.source === "auto" ? "AUTO" : data.people[l.coded_by ?? ""]?.initials || "");
  const itcOf = (l: FeedLine, v?: RowView) => {
    const rowsTax = (isPending(l) ? v?.split : l.is_split) ? (splits[l.id] ?? []).map((s) => ({ acct: s.account, tax: s.tax, cents: s.cents }))
      : [{ acct: isPending(l) ? v?.account ?? null : l.chart_account, tax: isPending(l) ? v?.tax ?? null : l.tax_code, cents: Math.abs(l.cents) }];
    let itc = 0;
    for (const r of rowsTax) {
      const c = r.acct ? chartOf.get(r.acct) : undefined;
      if (!c || !r.tax || c.type === "Revenue") continue;
      const s = splitLine(r.cents, codeOf.get(r.tax) ?? null, "purchase", data.ctx, c.type === "Asset");
      itc += outOf(l) ? s.itcCents : -s.itcCents;
    }
    return itc;
  };

  if (!a) return <p className="text-[14px] text-ink-3">Add the bank, card and loan accounts in step 3 first.</p>;

  if (view === "rules") return (
    <>
      <RulesPage rules={rules} accounts={accounts} chart={data.chart} codes={data.codes} editable={editable} onBack={() => setView("list")}
        onNew={() => setWin({ k: "rule", draft: blankRule(), id: null })} onEdit={(r) => setWin({ k: "rule", draft: { ...r }, id: r.id })}
        onAction={async (r, act) => {
          const res = await ruleAction(data.fileId, r.id, act);
          if (!res.ok) { fail(res.error); return; }
          if (act === "delete") setRules((rs) => rs.filter((x) => x.id !== r.id));
          else if (act === "copy") setRules((rs) => [...rs, { ...r, id: res.id, name: `Copy of ${r.name}`.slice(0, 120), auto_post: false, active: true, priority: Math.max(...rs.map((x) => x.priority)) + 1 }]);
          else setRules((rs) => rs.map((x) => (x.id === r.id ? { ...x, active: act === "enable" } : x)));
          notify(act === "delete" ? "Rule deleted" : act === "copy" ? "Rule copied" : act === "disable" ? "Rule disabled" : "Rule enabled");
        }}
        onReorder={async (ids) => { setRules((rs) => rs.map((x) => ({ ...x, priority: ids.indexOf(x.id) + 1 }))); const r = await reorderRules(data.fileId, ids); if (!r.ok) fail(r.error); }} />
      {win?.k === "rule" && <RulePane initial={win.draft} id={win.id} accounts={accounts} chart={data.chart} codes={data.codes} defaultTax={data.defaultTax} test={testDraft} onClose={() => setWin(null)} onSave={saveDraft} />}
    </>
  );

  const rowCtx = makeCtx({ views, outOf, cols, itcOf, accShort, a, accById, accountText, ticked, focus, editable, toggle, setPop, data, splits, setWin, fill, post: (ids) => post(ids),
    fromRow, fail, setChoices, setLines, accounts, attach });
  const th = "px-2 py-2 text-left text-[12px] font-semibold tracking-[.04em] text-ink-3 uppercase";
  const thR = `${th} text-right`;
  return (
    <div className="grid gap-3">
      {data.error && <p role="alert" className="text-[13px] text-danger">{data.error}</p>}
      {!data.gstAnswered && <p className="text-[13px] text-warning">Answer the GST/HST questions in step 1 first: nothing posts until then.</p>}

      {/* 1. Account cards (QuickBooks Online's tiles) */}
      <div className="flex items-stretch gap-1.5 print:hidden">
        {arrows && <button type="button" aria-label="Earlier accounts" onClick={() => strip.current?.scrollBy({ left: -320, behavior: "smooth" })} className="grid w-7 place-items-center rounded hover:bg-sand-100"><ChevronLeft className="h-5 w-5" /></button>}
        <div ref={strip} className="flex flex-1 gap-2.5 overflow-hidden" role="tablist" aria-label="Accounts">
          {cards.map(({ a: x, bank, posted, pending }) => (
            <button key={x.id} type="button" role="tab" aria-selected={x.id === acc} onClick={() => { setAcc(x.id); setTab("pending"); }}
              className={`w-[23rem] flex-none rounded-[10px] bg-white px-3.5 py-2 text-left ${x.id === acc ? "border-2 border-navy-600 px-[13px] py-[7px]" : "border border-sand-300 hover:border-navy-300"}`}>
              <span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold" title={x.label}>{x.label}</span>
                {pending ? <span className="grid h-6 min-w-6 place-items-center rounded-full bg-sand-200 px-1.5 text-[12px] font-bold text-ink-2" aria-label={`${pending} pending`}>{pending}</span>
                  : <span className="grid h-6 w-6 place-items-center rounded-full bg-success text-white" aria-label="None pending"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>}</span>
              <span className="mt-1 flex gap-4 text-[13px] text-ink-2 tabular-nums"><span>Bank: <b className="font-semibold text-ink">{fmtSigned(bank)}</b></span><span>Posted: <b className="font-semibold text-ink">{fmtSigned(posted)}</b></span></span>
            </button>))}
        </div>
        {arrows && <button type="button" aria-label="More accounts" onClick={() => strip.current?.scrollBy({ left: 320, behavior: "smooth" })} className="grid w-7 place-items-center rounded hover:bg-sand-100"><ChevronRight className="h-5 w-5" /></button>}
      </div>

      <section ref={listRef} className="rounded-[10px] border border-sand-200 bg-white" aria-label="Bank transactions">
        {/* 2. Tabs */}
        <div className="flex items-end gap-1 border-b border-sand-200 px-3 print:hidden" role="tablist" aria-label="Pending, Posted, Excluded">
          {([["pending", `Pending (${pendingCount})`], ["posted", "Posted"], ["excluded", "Excluded"]] as const).map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
              className={`-mb-px border-b-2 px-3 py-2 text-[14px] ${tab === k ? "border-navy-700 font-semibold text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>{l}</button>))}
          <span className="flex-1" />
          <button type="button" onClick={() => setView("rules")} className="mb-2 text-[14px] font-semibold text-navy-700 hover:underline">Rules</button>
        </div>

        {/* 3. Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 px-3 py-2 print:hidden">
          <label className="flex h-8 w-60 items-center gap-1.5 rounded-[6px] border border-sand-300 px-2"><Search className="h-4 w-4 text-ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description or amount" aria-label="Search" className="min-w-0 flex-1 text-[13.5px] outline-none" /></label>
          <button type="button" onClick={(e) => setPop({ k: "dates", el: e.currentTarget })} className="flex h-8 items-center gap-1.5 rounded-[6px] border border-sand-300 px-2.5 text-[13.5px] hover:border-navy-400">
            {dateLabel} <Calendar className="h-4 w-4 text-ink-3" /></button>
          <select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)} className="h-8 rounded-[6px] border border-sand-300 bg-white px-2 text-[13.5px]">
            {FILTERS.map(([k, l]) => <option key={k} value={k}>{l} ({counts[k]})</option>)}</select>
          <span className="flex-1" />
          <span className="text-[13px] text-ink-2 tabular-nums">{rows.length ? `${(p - 1) * size + 1}-${Math.min(p * size, rows.length)} of ${rows.length}` : "0 of 0"}</span>
          <span className="flex items-center gap-1 text-[13px]">
            <button type="button" aria-label="Previous page" disabled={p <= 1} onClick={() => setPage(p - 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-sand-100 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            Page <input aria-label="Page" value={p} onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= pages) setPage(n); }} className="h-7 w-9 rounded border border-sand-300 text-center tabular-nums" /> of {pages}
            <button type="button" aria-label="Next page" disabled={p >= pages} onClick={() => setPage(p + 1)} className="grid h-7 w-7 place-items-center rounded hover:bg-sand-100 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button></span>
          <button type="button" aria-label="Print" title="Print" onClick={() => window.print()} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><Printer className="h-4 w-4" /></button>
          <button type="button" aria-label="Export" title="Export the list to Excel" onClick={exportRows} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><Download className="h-4 w-4" /></button>
          <button type="button" aria-label="Settings" title="Settings" onClick={(e) => setPop({ k: "settings", el: e.currentTarget })} className="grid h-8 w-8 place-items-center rounded hover:bg-sand-100"><Settings className="h-4 w-4" /></button>
        </div>

        {tab === "excluded" && mine.some(isExcluded) && (
          <div className="flex flex-wrap items-center gap-3 border-b border-sand-200 bg-warning-soft/40 px-3 py-2 text-[13.5px]">
            <span>Excluded: {mine.filter(isExcluded).length} line{mine.filter(isExcluded).length === 1 ? "" : "s"} · {money(mine.filter(isExcluded).reduce((n, l) => n + Math.abs(l.cents), 0))}. The trial balance differs from the bank by these amounts.</span>
            <span className="flex-1" />
            <label className={`flex items-center gap-2 font-semibold ${isReviewer ? "" : "cursor-not-allowed text-ink-3"}`} title={isReviewer ? undefined : "Reviewer only"}>
              <input type="checkbox" checked={reviewed} disabled={!isReviewer || !editable} title={isReviewer ? undefined : "Reviewer only"}
                onChange={async (e) => { const on = e.target.checked; setReviewed(on); const r = await excludedReviewed(data.fileId, on); if (!r.ok) { setReviewed(!on); fail(r.error); } else { setReviewedBy({ by: on ? data.me : null, at: on ? new Date().toISOString() : null }); notify(on ? "Excluded lines reviewed" : "Review removed"); } }} />
              Excluded lines reviewed</label>
            {reviewed && reviewedBy.at && <span className="text-[12.5px] text-ink-2">by {data.people[reviewedBy.by ?? ""]?.name ?? "the reviewer"} on {formatDate(reviewedBy.at.slice(0, 10))}</span>}
          </div>)}

        {/* 4. The list */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] table-fixed text-[13.5px]">
            {tab === "pending" ? <>
              <colgroup><col className="w-9" /><col className="w-[7.6rem]" /><col /><col className="w-[6.4rem]" /><col className="w-[6.4rem]" />
                {cols.clip && <col className="w-9" />}{cols.memo && <col className="w-9" />}<col className="w-[9.5rem]" /><col className="w-[19rem]" />{cols.itc && <col className="w-[5.2rem]" />}<col className="w-[6.6rem]" /></colgroup>
              <thead><tr className="border-b border-sand-200">
                <th className="px-2 py-2"><input type="checkbox" aria-label="Tick all on this page" checked={allTicked} disabled={!editable || !shown.length}
                  onChange={() => setTicked((t) => { const n = new Set(t); if (allTicked) pageIds.forEach((id) => n.delete(id)); else pageIds.forEach((id) => n.add(id)); return n; })} /></th>
                <th className={th}>Date</th><th className={th}>Bank description</th><th className={thR}>Spent</th><th className={thR}>Received</th>
                {cols.clip && <th className={th} aria-label="Receipts">📎</th>}{cols.memo && <th className={th} aria-label="Memo">💬</th>}
                <th className={th}>Sales tax</th><th className={th}>Account</th>{cols.itc && <th className={thR}>ITC</th>}<th className={thR}>Action</th></tr></thead>
              <tbody>{shown.map((l) => <PendingRow key={l.id} l={l} c={rowCtx} />)}</tbody>
            </> : tab === "posted" ? <>
              <colgroup><col className="w-[7.6rem]" /><col /><col className="w-[6.4rem]" /><col className="w-[6.4rem]" /><col className="w-[9.5rem]" /><col className="w-[19rem]" /><col className="w-[5.5rem]" /><col className="w-[5rem]" /></colgroup>
              <thead><tr className="border-b border-sand-200"><th className={th}>Date</th><th className={th}>Bank description</th><th className={thR}>Spent</th><th className={thR}>Received</th>
                <th className={th}>Sales tax</th><th className={th}>Account</th><th className={th}>Posted</th><th className={thR}>Action</th></tr></thead>
              <tbody>{shown.map((l) => {
                const out = outOf(l);
                return (
                  <tr key={l.id} id={`line-${l.id}`} className={`h-12 border-b border-sand-100 ${focus?.id === l.id ? "bg-navy-50" : ""}`}>
                    <td className="px-2 tabular-nums">{formatDate(l.acct_date)}</td><td className="truncate px-2" title={l.description}>{l.description}</td>
                    <td className="px-2 text-right tabular-nums">{out ? money(l.cents) : ""}</td><td className="px-2 text-right tabular-nums">{out ? "" : money(l.cents)}</td>
                    <td className="truncate px-2">{taxName(l)}</td>
                    <td className="truncate px-2" title={l.reviewer_reason || accountText(l)}>{l.transfer && <span className="mr-1.5 rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-bold text-success">PAIR</span>}
                      {!l.transfer && (l.source === "rule" || l.source === "auto") && <span title={rules.find((r) => r.id === l.rule_id)?.name ?? "Bank rule"} className="mr-1.5 rounded bg-sand-200 px-1.5 py-0.5 text-[11px] font-bold text-ink-2">RULE</span>}
                      {l.transfer ? accountText(l).replace(/^PAIR · /, "") : accountText(l)}{l.status === "reviewer" && <span className="ml-1.5 rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-semibold text-warning">For the reviewer</span>}</td>
                    <td className="px-2 text-[12px] font-semibold text-ink-2">{postedBy(l)}</td>
                    <td className="px-2 text-right">{editable && l.source !== "outstanding" && <button type="button" className="font-semibold text-navy-700 hover:underline" onClick={() => unpost([l.id])}>Undo</button>}</td>
                  </tr>);
              })}</tbody>
            </> : <>
              <colgroup><col className="w-[7.6rem]" /><col /><col className="w-[6.4rem]" /><col className="w-[6.4rem]" /><col className="w-[16rem]" /><col className="w-[10rem]" /><col className="w-[5rem]" /></colgroup>
              <thead><tr className="border-b border-sand-200"><th className={th}>Date</th><th className={th}>Bank description</th><th className={thR}>Spent</th><th className={thR}>Received</th>
                <th className={th}>Reason</th><th className={th}>Excluded by</th><th className={thR}>Action</th></tr></thead>
              <tbody>{shown.map((l) => {
                const out = outOf(l);
                return (
                  <tr key={l.id} id={`line-${l.id}`} className="h-12 border-b border-sand-100">
                    <td className="px-2 tabular-nums">{formatDate(l.acct_date)}</td><td className="truncate px-2" title={l.description}>{l.description}</td>
                    <td className="px-2 text-right tabular-nums">{out ? money(l.cents) : ""}</td><td className="px-2 text-right tabular-nums">{out ? "" : money(l.cents)}</td>
                    <td className="truncate px-2" title={l.excluded_note}>{EXCLUDE_REASONS.find(([k]) => k === l.excluded_reason)?.[1]}{l.excluded_note ? `: ${l.excluded_note}` : ""}</td>
                    <td className="truncate px-2">{data.people[l.excluded_by ?? ""]?.name ?? ""}</td>
                    <td className="px-2 text-right">{editable && <button type="button" className="font-semibold text-navy-700 hover:underline" onClick={async () => {
                      setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, status: "new" } : x)));
                      const r = await restoreLines(data.fileId, [l.id]); if (!r.ok) fail(r.error); await refresh([l.id]); notify("Back in Pending");
                    }}>Undo</button>}</td>
                  </tr>);
              })}</tbody>
            </>}
          </table>
          {!shown.length && <p className="px-3 py-4 text-[13.5px] text-ink-3">{tab === "pending" && !inTab.length ? "Nothing pending in this account." : "Nothing here."}</p>}
        </div>
      </section>
      {barOn && <div aria-hidden data-bar-space className="-mt-3 print:hidden" style={{ height: barH }} />}

      {/* 5. The black bar */}
      {barOn && (
        <div ref={barRef} role="toolbar" aria-label="Ticked lines" style={barBox ? { left: barBox.left, width: barBox.width } : { left: 0, right: 0 }}
          className="fixed bottom-0 z-[60] flex min-h-14 flex-wrap items-center gap-2 rounded-t-[10px] bg-[#1d2330] px-5 py-2.5 text-[14px] text-white shadow-[0_-8px_24px_rgba(0,0,0,.25)] print:hidden">
          <span className="mr-auto font-semibold tabular-nums">{barText(tickedLines.map((l) => ({ cents: l.cents, out: outOf(l) })))}</span>
          {([["Post", () => post([...ticked]), notReady > 0, notReady ? `${notReady} ticked line${notReady === 1 ? " has" : "s have"} no account.` : undefined],
            ["Edit", () => setWin({ k: "edit" }), !(allOut || allIn), allOut || allIn ? undefined : "Tick money in or money out lines, not both."],
            ["Exclude", () => setWin({ k: "exclude", ids: [...ticked] }), false, undefined],
            ["Ask client", () => setWin({ k: "ask", ids: [...ticked] }), false, undefined]] as const).map(([label, run, off, why]) => (
            <span key={label} title={why} className="inline-flex"><button type="button" disabled={off || busy || !editable} onClick={run}
              className="h-9 rounded-[6px] border border-white/80 px-4 font-semibold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:border-white/30 disabled:text-white/40 disabled:hover:bg-transparent">{label}</button></span>))}
          <button type="button" aria-label="Clear the ticks" onClick={() => setTicked(new Set())} className="ml-3 grid h-9 w-9 place-items-center rounded-full hover:bg-white/15"><X className="h-5 w-5" /></button>
        </div>)}

      {/* Windows */}
      {win?.k === "edit" && <EditWindow n={ticked.size} out={allOut} chart={data.chart} banks={accounts.filter((x) => tickedLines.every((l) => l.account_id !== x.id))} codes={data.codes} defaultTax={data.defaultTax}
        onClose={() => setWin(null)} onApply={async (c: EditChoice, andPost) => {
          const ids = [...ticked];
          // What each line had before, so Undo returns it exactly as it was.
          const before = ids.map((id) => { const l = byId.get(id)!; return { id, account: l.chart_account, tax: l.tax_code, transfer_account: l.transfer_account }; });
          setBusy(true);
          const ok = await fill(ids, c.pick, c.pick && "account" in c.pick ? c.tax : null);
          setBusy(false);
          if (!ok) return;
          setWin(null);
          if (andPost) {
            // Post what was just filled (the views recompute from the new lines).
            const items: PostItem[] = ids.map((id) => c.pick && "transfer" in c.pick ? { id, kind: "transfer", transfer_account: c.pick.transfer, source: "manual" }
              : { id, kind: "code", account: (c.pick as { account: string }).account, tax: c.tax, source: "manual" });
            setLines((ls) => applyLocal(ls, items));
            setTicked(new Set());
            const r = await postLines(data.fileId, items);
            if (!r.ok) { fail(r.error); await refresh(ids); return; }
            await refresh(ids);
            notify(`${items.length} posted`, "ok", { ms: 5000, action: { label: "Undo", run: async () => {
              await unpost(ids);
              setLines((ls) => ls.map((l) => { const b = before.find((x) => x.id === l.id); return b ? { ...l, chart_account: b.account, tax_code: b.tax, transfer_account: b.transfer_account, source: b.account || b.transfer_account ? "manual" : "" } : l; }));
              const r2 = await fillLines(data.fileId, before);
              if (!r2.ok) fail(r2.error);
            } } });
          } else notify(`${ids.length} line${ids.length === 1 ? "" : "s"} filled`);
        }} />}
      {win?.k === "split" && (() => {
        const l = byId.get(win.id)!;
        return <SplitWindow line={{ date: l.acct_date, description: l.description, cents: l.cents }} out={outOf(l)} chart={data.chart} codes={data.codes} defaultTax={data.defaultTax}
          initial={splits[l.id] ?? []} onClose={() => setWin(null)}
          onRemove={l.is_split ? async () => { const r = await clearSplits(l.id); if (!r.ok) fail(r.error); await refresh([l.id]); setWin(null); } : undefined}
          onSave={async (rs) => { const r = await saveSplits(l.id, rs); if (!r.ok) { fail(r.error); return false; } await refresh([l.id]); notify(`Split in ${rs.length}`); return true; }} />;
      })()}
      {win?.k === "ask" && <AskWindow lines={win.ids.map((id) => byId.get(id)!).map((l) => ({ date: l.acct_date, description: l.description, cents: l.cents }))} onClose={() => setWin(null)}
        onSend={async (question) => {
          const r = await askClientLines(data.fileId, win.ids, question);
          if (!r.ok) { fail(r.error); return false; }
          const now = new Date().toISOString();
          setLines((ls) => ls.map((l) => (win.ids.includes(l.id) ? { ...l, asked_at: now, client_question: question } : l)));
          setTicked(new Set()); notify(`On the client's list: ${win.ids.length} line${win.ids.length === 1 ? "" : "s"}`); return true;
        }} />}
      {win?.k === "exclude" && <ExcludeWindow n={win.ids.length} onClose={() => setWin(null)} onExclude={async (reason, note) => {
        const r = await excludeLines(data.fileId, win.ids, reason, note);
        if (!r.ok) { fail(r.error); return false; }
        setLines((ls) => ls.map((l) => (win.ids.includes(l.id) ? { ...l, status: "excluded", excluded_reason: reason, excluded_note: note, excluded_at: new Date().toISOString() } : l)));
        setTicked(new Set()); setReviewed(false); await refresh(win.ids);
        notify(`Excluded: ${win.ids.length} line${win.ids.length === 1 ? "" : "s"}`, "ok", { ms: 5000, action: { label: "Undo", run: async () => { await restoreLines(data.fileId, win.ids); await refresh(win.ids); } } });
        return true;
      }} />}
      {win?.k === "pair" && (() => {
        const pr = pairs.get(win.id);
        if (!pr || pr.kind !== "options") return null;
        return <PairWindow options={pr.options} accounts={accounts} onClose={() => setWin(null)} onPick={async (other) => {
          const r = await pairChoice(data.fileId, win.id, other, "chosen");
          if (!r.ok) { fail(r.error); return; }
          setChoices((c) => [...c.filter((x) => !(x.kind === "chosen" && [x.a, x.b].some((y) => y === win.id || y === other))), { a: win.id < other ? win.id : other, b: win.id < other ? other : win.id, kind: "chosen" }]);
        }} />;
      })()}
      {win?.k === "rule" && <RulePane initial={win.draft} id={win.id} accounts={accounts} chart={data.chart} codes={data.codes} defaultTax={data.defaultTax} test={testDraft} onClose={() => setWin(null)} onSave={saveDraft} />}

      {/* Small boxes */}
      {pop?.k === "dates" && <DatesBox anchor={pop.el} yearStart={data.yearStart} yearEnd={data.yearEnd} value={dates} onClose={() => setPop(null)} onApply={(d) => { setDates(d); setPop(null); }} />}
      {pop?.k === "settings" && <Pop anchor={pop.el} onClose={() => setPop(null)} align="right" width={260}>
        <fieldset className="grid gap-1.5"><legend className="mb-1 font-semibold">Rows per page</legend>
          {[50, 100, 300].map((n) => <label key={n} className="flex items-center gap-2"><input type="radio" name="size" checked={size === n} onChange={() => setSize(n)} />{n}</label>)}</fieldset>
        <fieldset className="grid gap-1.5"><legend className="mb-1 font-semibold">Columns</legend>
          {([["itc", "ITC"], ["clip", "📎 Receipts"], ["memo", "💬 Memo"]] as const).map(([k, l]) => <label key={k} className="flex items-center gap-2"><input type="checkbox" checked={cols[k]} onChange={(e) => setCols({ ...cols, [k]: e.target.checked })} />{l}</label>)}</fieldset>
      </Pop>}
      {pop?.k === "date" && <DateBox anchor={pop.el} line={byId.get(pop.id)!} yearStart={data.yearStart} yearEnd={data.yearEnd} onClose={() => setPop(null)} onSave={async (d) => {
        const l = byId.get(pop.id)!;
        setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, acct_date: d } : x)));
        setPop(null);
        const r = await setDate(data.fileId, l.id, d, isPosted(l));
        if (!r.ok) { fail(r.error); await refresh([l.id]); } else notify("Date changed");
      }} />}
      {pop?.k === "memo" && <MemoBox anchor={pop.el} line={byId.get(pop.id)!} editable={editable} onClose={() => setPop(null)} onSave={async (memo, answer) => {
        const l = byId.get(pop.id)!;
        setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, memo, client_answer: answer } : x)));
        setPop(null);
        if (memo !== l.memo) { const r = await setMemo(l.id, memo); if (!r.ok) fail(r.error); }
        if (answer !== l.client_answer) { const r = await setClientAnswer(l.id, answer); if (!r.ok) fail(r.error); }
      }} />}
      {pop?.k === "files" && <Pop anchor={pop.el} onClose={() => setPop(null)} width={300}>
        <span className="font-semibold">Receipts</span>
        <ul className="grid gap-1">{(files[pop.id] ?? []).map((f) => <li key={f.id}><button type="button" className="text-left text-navy-700 underline"
          onClick={async () => { const r = await receiptUrl(f.id); if (r.ok) window.open(r.url, "_blank", "noopener"); else fail(r.error); }}>{f.name}</button></li>)}</ul>
        {editable && <AttachButton label="Add a file" onFile={(f) => attach(pop.id, f)} />}
      </Pop>}
    </div>
  );

  async function attach(lineId: string, f: File) {
    const fd = new FormData(); fd.set("fileId", data.fileId); fd.set("lineId", lineId); fd.set("file", f);
    const r = await attachReceipt(fd);
    if (!r.ok) { fail(r.error); return; }
    setFiles((x) => ({ ...x, [lineId]: [...(x[lineId] ?? []), { id: r.id, name: r.name }] }));
    setLines((ls) => ls.map((l) => (l.id === lineId ? { ...l, files: l.files + 1 } : l)));
    notify("Receipt attached");
  }

}

function AttachButton({ label, onFile, icon = false }: { label: string; onFile: (f: File) => void; icon?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (<>
    <button type="button" aria-label={label} title={label} onClick={() => ref.current?.click()} className={icon ? "text-ink-3 hover:text-navy-700" : "justify-self-start text-navy-700 underline"}>
      {icon ? <Plus className="h-4 w-4" /> : label}</button>
    <input ref={ref} type="file" className="sr-only" accept=".pdf,.jpg,.jpeg,.png,.heic,.heif,.webp,application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onFile(f); }} />
  </>);
}

function DatesBox({ anchor, yearStart, yearEnd, value, onClose, onApply }: { anchor: HTMLElement; yearStart: string; yearEnd: string; value: { mode: string; from: string; to: string };
  onClose: () => void; onApply: (v: { mode: string; from: string; to: string }) => void }) {
  const [mode, setMode] = useState(value.mode);
  const [from, setFrom] = useState(value.from), [to, setTo] = useState(value.to);
  const months: { key: string; label: string; from: string; to: string }[] = [];
  for (let d = new Date(`${yearStart.slice(0, 7)}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= yearEnd; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const s = d.toISOString().slice(0, 10), e = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    months.push({ key: `m:${s.slice(0, 7)}`, label: `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`, from: s < yearStart ? yearStart : s, to: e > yearEnd ? yearEnd : e });
  }
  const resolve = (m: string) => m === "all" ? { mode: m, from: "", to: "" } : m === "year" ? { mode: m, from: yearStart, to: yearEnd }
    : m.startsWith("m:") ? { mode: m, ...(({ from: f, to: t }) => ({ from: f, to: t }))(months.find((x) => x.key === m)!) } : { mode: m, from, to };
  return (
    <Pop anchor={anchor} onClose={onClose} width={320}>
      <label className="grid gap-1 font-semibold">Date<select aria-label="Date" value={mode} onChange={(e) => setMode(e.target.value)} className={`${FLD} font-normal`}>
        <option value="all">All dates</option><option value="year">This file&rsquo;s year</option>
        {months.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}<option value="custom">Custom</option></select></label>
      {mode === "custom" && <div className="grid grid-cols-2 gap-2">
        <label className="grid gap-1 text-[12.5px] font-semibold">From<input type="date" aria-label="From" value={from} min={yearStart} max={yearEnd} onChange={(e) => setFrom(e.target.value)} className={`${FLD} font-normal`} /></label>
        <label className="grid gap-1 text-[12.5px] font-semibold">To<input type="date" aria-label="To" value={to} min={yearStart} max={yearEnd} onChange={(e) => setTo(e.target.value)} className={`${FLD} font-normal`} /></label></div>}
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-compact" onClick={() => { setMode("all"); onApply({ mode: "all", from: "", to: "" }); }}>Reset</button>
        <button type="button" className="btn btn-compact" onClick={() => onApply(resolve(mode))}>Apply</button></div>
    </Pop>
  );
}

function DateBox({ anchor, line, yearStart, yearEnd, onClose, onSave }: { anchor: HTMLElement; line: FeedLine; yearStart: string; yearEnd: string; onClose: () => void; onSave: (d: string) => void }) {
  const [d, setD] = useState(line.acct_date);
  return (
    <Pop anchor={anchor} onClose={onClose} width={280}>
      <label className="grid gap-1 font-semibold">Accounting date<input type="date" aria-label="Accounting date" value={d} min={yearStart} max={yearEnd} onChange={(e) => setD(e.target.value)} className={`${FLD} font-normal`} /></label>
      <p className="text-[12.5px] text-ink-3">Bank date: {formatDate(line.txn_date)}. It never changes. The accounting date stays within the file&rsquo;s year.</p>
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-compact" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-compact" disabled={!d || d < yearStart || d > yearEnd || d === line.acct_date} onClick={() => onSave(d)}>Save</button></div>
    </Pop>
  );
}

function MemoBox({ anchor, line, editable, onClose, onSave }: { anchor: HTMLElement; line: FeedLine; editable: boolean; onClose: () => void; onSave: (memo: string, answer: string) => void }) {
  const [memo, setMemoV] = useState(line.memo), [answer, setAnswer] = useState(line.client_answer);
  return (
    <Pop anchor={anchor} onClose={onClose} width={340} align="right">
      <label className="grid gap-1 font-semibold">Memo<textarea aria-label="Memo" value={memo} onChange={(e) => setMemoV(e.target.value)} maxLength={300} rows={2} disabled={!editable} className="input font-normal" /></label>
      {line.asked_at && <>
        <p className="text-[13px]"><span className="font-semibold">Asked the client</span> on {formatDate(line.asked_at.slice(0, 10))}: {line.client_question}</p>
        <label className="grid gap-1 font-semibold">The client&rsquo;s answer<textarea aria-label="The client's answer" value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={1000} rows={2} disabled={!editable} className="input font-normal" /></label></>}
      {editable && <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-compact" onClick={onClose}>Cancel</button>
        <button type="button" className="btn btn-compact" onClick={() => onSave(memo.trim(), answer.trim())}>Save</button></div>}
    </Pop>
  );
}

type RowCtx = ReturnType<typeof makeCtx>;
// The parts of the page a row needs (a row is its own component, so ticking or opening a menu redraws one row).
function makeCtx(x: {
  views: Map<string, RowView>; outOf: (l: FeedLine) => boolean; cols: { itc: boolean; clip: boolean; memo: boolean }; itcOf: (l: FeedLine, v?: RowView) => number;
  accShort: (id: string | null | undefined) => string; a: FeedAccount | undefined; accById: Map<string, FeedAccount>; accountText: (l: FeedLine, v?: RowView) => string;
  ticked: Set<string>; focus: FeedLine | undefined; editable: boolean; toggle: (id: string) => void; setPop: (p: PopState) => void; data: FeedData;
  splits: Record<string, FeedSplit[]>; setWin: (w: Win) => void; fill: (ids: string[], pick: Pick | null, tax: string | null) => Promise<boolean>;
  post: (ids: string[]) => Promise<boolean>; fromRow: (l: FeedLine) => RuleDraft; fail: (e: string) => void;
  setChoices: React.Dispatch<React.SetStateAction<FeedData["choices"]>>; setLines: React.Dispatch<React.SetStateAction<FeedLine[]>>; accounts: FeedAccount[];
  attach: (lineId: string, f: File) => Promise<void>;
}) { return x; }

function PendingRow({ l, c }: { l: FeedLine; c: RowCtx }) {
  const { views, outOf, cols, itcOf, accShort, a, accById, accountText, ticked, focus, editable, toggle, setPop, data, splits, setWin, fill, post, fromRow, fail, setChoices, setLines, accounts, attach } = c;
  const v = views.get(l.id)!;
  const out = outOf(l);
  const transferish = !!v.pair || !!v.transfer;
  const itc = cols.itc ? itcOf(l, v) : 0;
  const [menu, setMenu] = useState(false);
  const badge = v.badge === "rule" ? <span className="rounded bg-sand-200 px-1.5 py-0.5 text-[10.5px] font-bold text-ink-2">RULE</span>
    : v.badge === "pair" || v.badge === "already" ? <span title={`Transaction type: ${v.pair && v.pair.kind !== "options" ? pairType(a, accById.get(v.pair.other.account_id)) : "Transfer"}`} className="rounded bg-success-soft px-1.5 py-0.5 text-[10.5px] font-bold text-success">PAIR</span>
    : v.badge === "history" ? <span title={`Coded this way ${v.historyCount} time${v.historyCount === 1 ? "" : "s"}`} className="grid h-4 w-4 place-items-center rounded-full bg-success text-white"><Check className="h-3 w-3" strokeWidth={3} /></span>
    : v.badge === "firm" ? <span title="Firm rule (Settings)" className="rounded bg-sand-200 px-1.5 py-0.5 text-[10.5px] font-bold text-ink-2">RULE</span> : null;
  const label = v.pair?.kind === "pair" ? accShort(v.pair.other.account_id)
    : v.pair?.kind === "already" ? `Already posted from ${accShort(v.pair.other.account_id)}` : accountText(l, v);
  return (
    <tr id={`line-${l.id}`} className={`h-12 border-b border-sand-100 ${ticked.has(l.id) ? "bg-navy-50/60" : ""} ${focus?.id === l.id ? "bg-navy-50" : ""}`}>
      <td className="px-2"><input type="checkbox" aria-label={`Tick ${l.description}`} checked={ticked.has(l.id)} disabled={!editable} onChange={() => toggle(l.id)} /></td>
      <td className="px-2 whitespace-nowrap tabular-nums">
        <button type="button" disabled={!editable} title={l.acct_date !== l.txn_date ? `Bank date: ${formatDate(l.txn_date)}` : "Change the accounting date"}
          onClick={(e) => setPop({ k: "date", el: e.currentTarget, id: l.id })} className="inline-flex items-center gap-1 hover:underline">
          {formatDate(l.acct_date)}<Calendar className="h-3.5 w-3.5 text-ink-3" />{l.acct_date !== l.txn_date && <span className="text-[11px] text-warning">•</span>}</button></td>
      <td className="truncate px-2" title={`${l.description}${l.reviewer_reason ? `\nFor the reviewer: ${l.reviewer_reason}` : ""}`}>
        {l.reviewer_reason && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warning align-middle" aria-label="For the reviewer" />}{l.description}</td>
      <td className="px-2 text-right tabular-nums">{out ? money(l.cents) : ""}</td>
      <td className="px-2 text-right tabular-nums">{out ? "" : money(l.cents)}</td>
      {cols.clip && <td className="px-1 text-center">{l.files ? <button type="button" aria-label={`${l.files} receipt${l.files === 1 ? "" : "s"}`} onClick={(e) => setPop({ k: "files", el: e.currentTarget, id: l.id })}
        className="inline-flex items-center text-navy-700"><Paperclip className="h-4 w-4" /><span className="text-[11px] font-bold">{l.files}</span></button>
        : editable ? <AttachButton label="Attach a receipt" icon onFile={(f) => attach(l.id, f)} /> : null}</td>}
      {cols.memo && <td className="px-1 text-center"><button type="button" aria-label={l.memo || l.asked_at ? "Memo" : "Add a memo"} title={[l.memo, l.asked_at ? `Asked: ${l.client_question}` : "", l.client_answer ? `Client: ${l.client_answer}` : ""].filter(Boolean).join("\n") || "Add a memo"}
        onClick={(e) => setPop({ k: "memo", el: e.currentTarget, id: l.id })} className={l.memo || l.asked_at ? "text-navy-700" : "text-ink-3 hover:text-navy-700"}>
        {l.memo || l.asked_at ? <MessageSquare className={`h-4 w-4 ${l.client_answer ? "fill-navy-100" : ""}`} /> : <Plus className="h-4 w-4" />}</button></td>}
      <td className="px-1.5">{transferish || v.split ? <span className="block truncate px-1 text-ink-3">{v.split ? "Split" : "No tax"}</span>
        : <TaxSelect codes={data.codes} value={v.tax ?? ""} disabled={!editable || !data.gstAnswered || !v.account} label={`Sales tax for ${l.description}`}
          onChange={(t) => fill([l.id], { account: v.account! }, t || null)} />}</td>
      <td className="px-1.5">{v.pair?.kind === "options" ? (
        <button type="button" disabled={!editable} onClick={() => setWin({ k: "pair", id: l.id })} className="flex h-8 w-full items-center gap-1.5 rounded-[6px] border border-[#efd9a6] bg-warning-soft px-2 text-left text-[13px] font-semibold text-warning">
          PAIR · {v.pair.options.length} option{v.pair.options.length === 1 ? "" : "s"}</button>
      ) : v.split ? (
        <button type="button" disabled={!editable} onClick={() => setWin({ k: "split", id: l.id })} className="flex h-8 w-full items-center rounded-[6px] border border-sand-300 px-2 text-left text-navy-700">Split ({splits[l.id]?.length ?? 0})</button>
      ) : (
        <AccountPicker chart={data.chart} banks={accounts} out={out} ownAccount={l.account_id} label={label} badge={badge} disabled={!editable}
          onPick={(pk) => { void fill([l.id], pk, "account" in pk ? (data.defaultTax[pk.account] ?? null) : null); }} />)}</td>
      {cols.itc && <td className={`px-2 text-right tabular-nums ${itc < 0 ? "text-danger" : ""}`}>{itc ? (itc < 0 ? `(${money(itc)})` : money(itc)) : ""}</td>}
      <td className="relative px-2 text-right whitespace-nowrap">{editable && <>
        <button type="button" disabled={!v.ready || !data.gstAnswered} onClick={() => post([l.id])} title={v.ready ? undefined : "Choose an account and a sales tax code first."}
          className="font-semibold text-navy-700 hover:underline disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline">Post</button>
        <span className="mx-1.5 text-sand-300">|</span>
        <button type="button" aria-label={`More actions for ${l.description}`} onClick={() => setMenu(!menu)} className="text-navy-700">▾</button>
        {menu && <span className="card absolute right-1 z-30 mt-1 grid w-max gap-0.5 p-1.5 text-left" onMouseLeave={() => setMenu(false)}>
          {([["Ask client", () => setWin({ k: "ask", ids: [l.id] })], ["Exclude", () => setWin({ k: "exclude", ids: [l.id] })],
            ["Split", () => setWin({ k: "split", id: l.id })], ["Save as rule", () => setWin({ k: "rule", draft: fromRow(l), id: null, from: l.id })],
            ...(v.pair ? [["Unpair", async () => {
              const others = v.pair!.kind === "options" ? v.pair!.options.map((o) => o.id) : [v.pair!.other.id];
              for (const o of others) { const r = await pairChoice(data.fileId, l.id, o, "rejected"); if (!r.ok) { fail(r.error); return; } }
              setChoices((c) => [...c, ...others.map((o) => ({ a: l.id < o ? l.id : o, b: l.id < o ? o : l.id, kind: "rejected" as const }))]);
              setLines((ls) => ls.map((x) => ([l.id, ...others].includes(x.id) && isPending(x) ? { ...x, chart_account: null, tax_code: null, transfer_account: null, source: "" } : x)));
              notify("Unpaired");
            }] as const] : [])] as [string, () => void][]).map(([t, run]) => (
            <button key={t} type="button" className="rounded px-3 py-1 hover:bg-sand-100" onClick={() => { setMenu(false); run(); }}>{t}</button>))}
        </span>}</>}</td>
    </tr>
  );
}
