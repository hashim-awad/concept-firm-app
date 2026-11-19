"use client";
// Piece R2 (Hashim, Nov 19, 2026; mock O; benchmark CaseWare Cloud "Assign accounts", QuickBooks Online bank feed Undo): step 4
// "Assign mapping" on a trial balance file. Left: the client's unassigned accounts as in their books (QuickBooks Parent:Sub as a
// tree). Right: the master chart by lead sheet, each master account with its count, total and Assign. One database call per
// action; the last 20 actions of the session can be undone. No GIFI code anywhere on this page.
import { useMemo, useRef, useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Search, Undo2, X } from "lucide-react";
import { notify, confirmAction } from "@/components/save-state";
import { buildTree, counted, suggest, lastYearMatches, actionText, money, label, qboClass,
  type ClientAcct, type MasterAcct, type PriorMatch, type Suggestion } from "@/lib/closebook/assign";
import { assignInline, pickChartAccountInline, undoAssignInline, unassignAllInline } from "../actions";

type Props = { fileId: string; accounts: ClientAcct[]; master: MasterAcct[]; groups: string[]; prior: [string, PriorMatch][]; locked: string | null; picks?: Record<string, string> };
type Done = { id: string; label: string };
const cents = (v: number) => Math.round(v * 100);

export function AssignStep({ fileId, accounts, master, groups, prior: priorList, locked, picks = {} }: Props) {
  const router = useRouter();
  const [, startRefresh] = useTransition();
  const [busy, setBusy] = useState(false);
  const [chart, setChart] = useState<Record<string, string | null>>(() => Object.fromEntries(accounts.map((a) => [a.id, a.chart ?? null])));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [hideEmpty, setHideEmpty] = useState(true);
  const [shut, setShut] = useState<Set<string>>(new Set());
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [stack, setStack] = useState<Done[]>([]);
  const [win, setWin] = useState<string | null>(null);
  const prior = useMemo(() => new Map(priorList), [priorList]);
  const byId = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const byNo = useMemo(() => new Map(master.map((m) => [m.number, m])), [master]);
  const now = accounts.map((a) => ({ ...a, chart: chart[a.id] ?? null }));
  const countedAll = now.filter(counted);
  const assigned = countedAll.filter((a) => a.chart).length;
  const left = countedAll.length - assigned;

  // The left pane: unassigned accounts, filtered, as a tree. Visible rows in order, for shift-click and the keyboard.
  const f = filter.trim().toLowerCase();
  const unassigned = now.filter((a) => !a.chart && (!hideEmpty || counted(a)) && (!f || a.number.toLowerCase().includes(f) || a.name.toLowerCase().includes(f) || (a.fullName ?? "").toLowerCase().includes(f)));
  const tree = buildTree(unassigned);
  const flat: string[] = [];
  for (const n of tree) {
    if (n.children.length) { if (!shut.has(n.key)) { if (n.self && !n.self.chart) flat.push(n.self.id); for (const c of n.children) flat.push(c.id); } }
    else if (n.self) flat.push(n.self.id);
  }
  const selected = [...sel].filter((id) => byId.has(id) && !chart[id]);
  const selTotal = selected.reduce((s, id) => s + cents(byId.get(id)!.thisYear), 0);
  const lastYear = lastYearMatches(now, prior, master);

  // The suggestion box: the selection's suggestions, each shown once.
  const sugg = (() => {
    const m = new Map<string, { s: Suggestion; ids: string[] }>();
    for (const id of selected) { const s = suggest(byId.get(id)!, prior, master); if (!s) continue; const e = m.get(s.chart) ?? { s, ids: [] }; e.ids.push(id); m.set(s.chart, e); }
    return [...m.values()].sort((x, y) => y.ids.length - x.ids.length);
  })();

  const pick = (id: string, e: { shiftKey: boolean }) => {
    setSel((cur) => {
      const n = new Set(cur);
      if (e.shiftKey && anchor) {
        const a = flat.indexOf(anchor), b = flat.indexOf(id);
        if (a >= 0 && b >= 0) { for (const x of flat.slice(Math.min(a, b), Math.max(a, b) + 1)) n.add(x); return n; }
      }
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
    setAnchor(id);
  };
  const pickParent = (ids: string[]) => setSel((cur) => { const n = new Set(cur); const all = ids.every((i) => n.has(i)); for (const i of ids) { if (all) n.delete(i); else n.add(i); } return n; });

  const after = (r: { action?: string; n?: number; error?: string }, text: string) => {
    if (r.error) { notify(r.error, "error"); return false; }
    if (r.action) {
      const done = { id: r.action, label: text };
      setStack((s) => [done, ...s].slice(0, 20));
      notify(text.startsWith("Unassigned") ? text : `Assigned ${text}`, "ok", { ms: 10000, action: { label: "Undo", run: () => { void undo(done); } } });
    }
    startRefresh(() => router.refresh());
    return true;
  };
  const assign = async (ids: string[], to: string | null, source = "manual", items?: { account: string; chart: string }[]) => {
    if (locked || busy) return;
    const list = items ?? ids.map((id) => ({ account: id, chart: to }));
    if (!list.length) return;
    const m = to ? byNo.get(to) ?? null : null;
    // D10, D16: a QuickBooks type that differs from the master account's type asks first; the account then waits for the
    // reviewer in step 8.
    // On "Accept last year's matches" each account is checked against its own master account.
    const off = list.filter((i) => { const mm = i.chart && i.chart !== "10900" ? byNo.get(i.chart) : null; const c = qboClass(byId.get(i.account)!.tbType); return mm && c && c !== mm.type; }).map((i) => i.account);   // Clearing takes any type (D2)
    if (off.length && !(await confirmAction({ title: `Assign ${off.length === 1 ? "an account" : `${off.length} accounts`} of another type?`, confirm: "Assign anyway",
      body: <p>{off.map((id) => label(byId.get(id)!)).join(", ")}: the QuickBooks type is not the master account&apos;s type. {off.length === 1 ? "It waits" : "They wait"} for the reviewer in step 8.</p> }))) return;
    const nA = `${list.length} account${list.length === 1 ? "" : "s"}`;
    // The Undo label says what will be undone (mock O): "8 accounts to 60000 Advertising".
    const text = items ? `${nA} to last year's master accounts` : to ? actionText(list.length, m) : `Unassigned ${nA}`;
    setBusy(true);
    const before = Object.fromEntries(list.map((i) => [i.account, chart[i.account] ?? null]));
    setChart((c) => ({ ...c, ...Object.fromEntries(list.map((i) => [i.account, i.chart])) }));
    const r = await assignInline(fileId, list, text.startsWith("Unassigned") ? text : `Assigned ${text}`, items ? "last_year" : source);
    setBusy(false);
    if (!after(r, text)) setChart((c) => ({ ...c, ...before }));
    else setSel((s) => { const n = new Set(s); for (const i of list) n.delete(i.account); return n; });
  };
  const undo = async (d: Done) => {
    if (locked) return;
    setBusy(true);
    const err = await undoAssignInline(fileId, d.id);
    setBusy(false);
    if (err) { notify(err, "error"); return; }
    setStack((s) => s.filter((x) => x.id !== d.id));
    notify(`Undone: ${d.label}`);
    router.refresh();
  };
  // After a refresh the server's figures are the truth again (another person may have changed something).
  const [seen, setSeen] = useState(accounts);
  if (seen !== accounts) { setSeen(accounts); setChart(Object.fromEntries(accounts.map((a) => [a.id, a.chart ?? null]))); }

  const unassignAll = async () => {
    const n = now.filter((a) => a.chart && !a.key.startsWith("new:")).length;
    if (!n || locked) return;
    if (!(await confirmAction({ title: `Unassign all ${n} accounts?`, danger: true, confirm: "Unassign all",
      body: <p>The trial balance and its figures stay as imported. Assignments carried from last year return as suggestions.</p> }))) return;
    setBusy(true);
    const r = await unassignAllInline(fileId);
    setBusy(false);
    after(r, `Unassigned all ${n} accounts`);
  };

  // Drag and drop: the selection (or the row dragged) onto a master account, or back onto the left pane.
  const [dragIds, setDragIds] = useState<string[]>([]);
  const onDrag = (id: string) => setDragIds(sel.has(id) ? selected : [id]);
  const dropOn = (to: string | null) => (e: React.DragEvent) => { e.preventDefault(); const ids = dragIds; setDragIds([]); if (ids.length) void assign(ids, to); };

  // Keyboard on the tree: arrows move, Right and Left open and close a parent, Space ticks, Shift+Space extends the range.
  const listRef = useRef<HTMLDivElement>(null);
  const onKey = (e: React.KeyboardEvent) => {
    const t = e.target as HTMLElement, id = t.dataset.rid, pk = t.dataset.parent;
    const rows = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-rid],[data-parent]") ?? [])];
    const i = rows.indexOf(t);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus(); }
    else if (pk && (e.key === "ArrowRight" || e.key === "ArrowLeft")) { e.preventDefault(); setShut((s) => { const n = new Set(s); if (e.key === "ArrowLeft") n.add(pk); else n.delete(pk); return n; }); }
    else if (e.key === " ") { e.preventDefault(); if (id) pick(id, e); else if (pk) pickParent(tree.find((n) => n.key === pk)?.children.map((c) => c.id) ?? []); }
  };

  // The right pane: groups by lead sheet name, each master account with the client accounts on it.
  const on = new Map<string, ClientAcct[]>();
  for (const a of now) if (a.chart) { const l = on.get(a.chart) ?? []; l.push(a); on.set(a.chart, l); }
  const q = search.trim().toLowerCase();
  const shown = q.length >= 2 ? master.filter((m) => m.number.includes(q) || m.name.toLowerCase().includes(q)) : master;
  const sheetOf = (m: MasterAcct) => m.sheet || "Clearing (must be nil at year end)";
  const sheetList = [...groups, ...(master.some((m) => !m.sheet) ? ["Clearing (must be nil at year end)"] : [])];
  const can = !locked && !busy;

  return (
    <div className="grid gap-3" data-assign-step>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm" data-assign-head><b>{assigned}</b> of <b>{countedAll.length}</b> accounts with a balance assigned · <b>{left}</b> left</p>
        <span className="ml-auto flex items-center gap-2">
          {stack[0] && <button type="button" disabled={!can} onClick={() => void undo(stack[0])} className="btn-secondary btn-compact" data-undo><Undo2 className="h-4 w-4" aria-hidden />Undo: {stack[0].label}</button>}
          <button type="button" disabled={!can || assigned === 0} onClick={() => void unassignAll()} className="btn-danger btn-compact">Unassign all…</button>
        </span>
      </div>
      {locked && <p className="rounded-md border border-sand-200 bg-sand-50 px-3 py-2 text-sm text-ink-2">{locked}</p>}

      <div className="grid gap-3 lg:grid-cols-2">
        {/* LEFT: the client's accounts, as in their books. */}
        <section aria-label="Unassigned accounts" data-left-pane className="card flex min-h-[420px] flex-col p-0" onDragOver={(e) => e.preventDefault()} onDrop={dropOn(null)}>
          <div className="border-b border-sand-200 px-4 py-3">
            <h2 className="font-semibold">Unassigned ({countedAll.filter((a) => !a.chart).length})</h2>
            <p className="text-xs text-ink-3">The client&apos;s accounts, as in their books</p>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by number or name" aria-label="Filter accounts" className="input input-compact w-56" />
              <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />Hide no balance</label>
              {lastYear.length > 0 && <button type="button" disabled={!can} className="btn-secondary btn-compact" data-accept-last
                onClick={() => void assign(lastYear.map((x) => x.account), null, "last_year", lastYear)}>Accept last year&apos;s matches ({lastYear.length})</button>}
            </div>
          </div>
          <div ref={listRef} role="tree" aria-multiselectable onKeyDown={onKey} className="max-h-[65vh] overflow-y-auto py-1 text-sm">
            {tree.length === 0 && <p className="px-4 py-6 text-ink-3">{countedAll.length && !left ? "Every account with a balance is assigned." : "No account matches the filter."}</p>}
            {tree.map((n) => {
              if (!n.children.length) return n.self ? <Row key={n.key} a={n.self} sel={sel.has(n.self.id)} onPick={pick} onDrag={onDrag} /> : null;
              const ids = [...(n.self && !n.self.chart ? [n.self.id] : []), ...n.children.map((c) => c.id)];
              const nSel = ids.filter((i) => sel.has(i)).length;
              const total = ids.reduce((s, i) => s + cents(byId.get(i)!.thisYear), 0);
              const open = !shut.has(n.key);
              return (
                <div key={n.key} role="group">
                  <div data-parent={n.key} tabIndex={0} role="treeitem" aria-expanded={open} aria-selected={nSel === ids.length}
                    className="flex items-center gap-2 px-3 py-1 font-medium hover:bg-sand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600">
                    <button type="button" aria-label={open ? "Close" : "Open"} tabIndex={-1} onClick={() => setShut((s) => { const x = new Set(s); if (open) x.add(n.key); else x.delete(n.key); return x; })}>
                      <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden /></button>
                    <input type="checkbox" tabIndex={-1} aria-label={`Tick ${n.name}`} checked={nSel === ids.length && ids.length > 0} ref={(el) => { if (el) el.indeterminate = nSel > 0 && nSel < ids.length; }} onChange={() => pickParent(ids)} />
                    <span className="min-w-0 flex-1 break-words">{n.number && <span className="mr-1.5 tabular-nums text-ink-3">{n.number}</span>}{n.name} <span className="font-normal text-ink-3">({ids.length})</span></span>
                    <span className="tabular-nums">{money(total)}</span>
                  </div>
                  {open && <div className="pl-6">
                    {n.self && !n.self.chart && <Row a={{ ...n.self, name: `${n.self.name} (own balance)` }} sel={sel.has(n.self.id)} onPick={pick} onDrag={onDrag} />}
                    {n.children.map((c) => <Row key={c.id} a={c} sel={sel.has(c.id)} onPick={pick} onDrag={onDrag} />)}
                  </div>}
                </div>
              );
            })}
          </div>
        </section>

        {/* RIGHT: the master chart. */}
        <section aria-label="Master chart" className="card flex min-h-[420px] flex-col p-0">
          <div className="border-b border-sand-200 px-4 py-3">
            <h2 className="font-semibold">Master chart</h2>
            <p className="text-sm" data-selected><b>{selected.length}</b> selected · {money(selTotal)}</p>
            {selected.length > 0 && (
              <div className="mt-2 grid max-h-56 gap-1.5 overflow-y-auto rounded-md border border-navy-200 bg-navy-50/60 px-3 py-2" data-suggestion>
                {sugg.length === 0 && <p className="text-sm text-ink-2">No suggestion: choose a master account below.</p>}
                {sugg.map(({ s, ids }) => (
                  <div key={s.chart} className="flex items-center gap-3">
                    <p className="flex-1 text-sm"><b>Suggested: {s.chart} {byNo.get(s.chart)?.name}</b><br /><span className="text-xs text-ink-2">{s.why}{ids.length < selected.length ? ` · ${ids.length} of ${selected.length}` : ""}</span></p>
                    <button type="button" disabled={!can} className="btn btn-compact" onClick={() => void assign(ids, s.chart, s.source)}>Assign {ids.length}</button>
                  </div>
                ))}
              </div>
            )}
            <label className="mt-2 flex items-center gap-2"><Search className="h-4 w-4 text-ink-3" aria-hidden />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search master accounts (number or name)" aria-label="Search master accounts" className="input input-compact flex-1" /></label>
          </div>
          <div className="max-h-[65vh] overflow-y-auto py-1 text-sm">
            {sheetList.map((g) => {
              const ms = shown.filter((m) => sheetOf(m) === g);
              if (!ms.length) return null;
              const open = q.length >= 2 || openGroups.has(g);
              const clients = ms.flatMap((m) => on.get(m.number) ?? []);
              return (
                <div key={g}>
                  <button type="button" aria-expanded={open} onClick={() => setOpenGroups((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; })}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-medium hover:bg-sand-50">
                    <ChevronRight className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`} aria-hidden />
                    <span className="flex-1">{g} <span className="font-normal text-ink-3">({clients.length})</span></span>
                    <span className="tabular-nums">{money(clients.reduce((s, a) => s + cents(a.thisYear), 0))}</span>
                  </button>
                  {open && ms.map((m) => {
                    const cl = on.get(m.number) ?? [];
                    return (
                      <div key={m.number} data-master={m.number} onDragOver={(e) => e.preventDefault()} onDrop={dropOn(m.number)}
                        className="flex items-center gap-2 py-1 pr-3 pl-9 hover:bg-sand-50">
                        <button type="button" onClick={() => setWin(m.number)} className="min-w-0 flex-1 break-words text-left hover:underline"><span className="mr-1.5 tabular-nums text-ink-3">{m.number}</span>{m.name}
                          <span className="ml-1 text-ink-3">({cl.length})</span></button>
                        <span className="w-28 text-right tabular-nums">{money(cl.reduce((s, a) => s + cents(a.thisYear), 0))}</span>
                        <button type="button" disabled={!can || !selected.length} onClick={() => void assign(selected, m.number)} className="btn-secondary btn-compact w-16 justify-center">Assign</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {win && <MasterWindow fileId={fileId} m={byNo.get(win)!} accts={on.get(win) ?? []} can={can} pick={picks[win] ?? null} canPick={!!locked ? !locked.startsWith("This file is locked") && !locked.startsWith("You can view") : true} onClose={() => setWin(null)} onUnassign={(id) => void assign([id], null)} onDrag={onDrag} onDropBack={dropOn(null)} />}
    </div>
  );
}

function Row({ a, sel, onPick, onDrag }: { a: ClientAcct; sel: boolean; onPick: (id: string, e: { shiftKey: boolean }) => void; onDrag: (id: string) => void }) {
  return (
    <div data-rid={a.id} tabIndex={0} role="treeitem" aria-selected={sel} draggable onDragStart={() => onDrag(a.id)}
      onClick={(e) => { if ((e.target as HTMLElement).tagName !== "INPUT") onPick(a.id, e); }}
      className={`flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-sand-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-navy-600 ${sel ? "bg-navy-50" : ""}`}>
      <input type="checkbox" tabIndex={-1} aria-label={`Tick ${label(a)}`} checked={sel} onChange={(e) => onPick(a.id, { shiftKey: (e.nativeEvent as MouseEvent).shiftKey })} />
      <span className="min-w-0 flex-1 break-words">{a.number && <span className="mr-1.5 tabular-nums text-ink-3">{a.number}</span>}{a.name}</span>
      <span className="tabular-nums">{money(cents(a.thisYear))}</span>
    </div>
  );
}

// A master account opened: its client accounts, each with Unassign (or dragged back to the left pane). Escape closes it.
function MasterWindow({ fileId, m, accts, can, canPick, pick, onClose, onUnassign, onDrag, onDropBack }: { fileId: string; m: MasterAcct; accts: ClientAcct[]; can: boolean; canPick: boolean; pick: string | null;
  onClose: () => void; onUnassign: (id: string) => void; onDrag: (id: string) => void; onDropBack: (e: React.DragEvent) => void }) {
  const close = useRef(onClose);
  const box = useRef<HTMLElement>(null);
  const router = useRouter();
  const [taking, setTaking] = useState(pick);
  const [choice, setChoice] = useState(pick ?? "");
  // A pick not yet saved (the select still has focus) is saved when the window closes: Escape, X or a click outside
  // remove the select before its blur fires.
  const pending = useRef({ choice, taking });
  useEffect(() => { pending.current = { choice, taking }; });
  // Focus goes into the window and back to the master account's name on close; Tab stays inside (as the account panel).
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", k);
    box.current?.querySelector<HTMLElement>("button")?.focus();
    return () => { document.removeEventListener("keydown", k); opener?.focus(); };
  }, []);
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !box.current) return;
    const els = [...box.current.querySelectorAll<HTMLElement>("button:not([disabled]), select:not([disabled])")];
    if (!els.length) return;
    const first = els[0], last = els[els.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  // D12b: with several client accounts on one master account, the one entries and schedules post to (rolls forward).
  const choose = async (key: string) => {
    const a = accts.find((x) => x.key === key); if (!a) return;
    const err = await pickChartAccountInline(fileId, m.number, a.id);
    if (err) notify(err, "error"); else { setTaking(key); notify(`Entries to ${m.number} ${m.name} go to ${label(a)}.`); router.refresh(); }
  };
  const shut = () => { const p = pending.current; if (p.choice && p.choice !== p.taking) void choose(p.choice); onClose(); };
  useEffect(() => { close.current = shut; });
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={`${m.number} ${m.name}`} data-master-window={m.number}>
      {/* Dragging a client account out of the window onto the page (the left pane) unassigns it, as Unassign does. */}
      <div className="absolute inset-0 bg-navy-950/20" onClick={shut} onDragOver={(e) => e.preventDefault()} onDrop={(e) => {
        // Only a drop over the left pane unassigns; a drop anywhere else under the window does nothing.
        const r = document.querySelector("[data-left-pane]")?.getBoundingClientRect();
        if (r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) { onDropBack(e); onClose(); } else e.preventDefault();
      }} />
      <aside ref={box} onKeyDown={trap} className="absolute inset-y-0 right-0 flex w-[460px] max-w-full flex-col overflow-y-auto bg-white shadow-2xl">
        <div className="flex items-start gap-2 border-b border-sand-200 px-5 py-4">
          <div className="flex-1"><h2 className="text-base font-semibold"><span className="mr-2 tabular-nums">{m.number}</span>{m.name}</h2>
            <p className="text-[12.5px] text-ink-2">{m.sheet ? `Group: ${m.sheet}` : "Clearing: must be nil at year end"} · {accts.length} client account{accts.length === 1 ? "" : "s"}</p></div>
          <button type="button" onClick={shut} aria-label="Close" className="rounded p-1.5 text-ink-2 hover:bg-sand-100"><X className="h-5 w-5" /></button>
        </div>
        {accts.length > 1 && (
          <div className="mx-5 mt-3 grid gap-1 text-[13px]" data-entries-take>
            <label htmlFor="entries-take" className="font-semibold">Entries and schedules post to</label>
            <span className="flex items-center gap-2">
              <select id="entries-take" value={choice} disabled={!canPick} onChange={(e) => setChoice(e.target.value)} onBlur={() => { if (choice && choice !== taking) void choose(choice); }} className="input input-compact flex-1">
                {!taking && <option value="">Not chosen</option>}
                {accts.map((a) => <option key={a.id} value={a.key}>{label(a)}</option>)}
              </select>
            </span>
            <span className="text-xs text-ink-3">Optional. If left blank, the entry window asks.</span>
          </div>
        )}
        <ul className="divide-y divide-sand-100 text-sm">
          {accts.length === 0 && <li className="px-5 py-4 text-ink-3">No client account on this master account yet.</li>}
          {accts.map((a) => (
            <li key={a.id} draggable onDragStart={() => onDrag(a.id)} className="flex items-center gap-2 px-5 py-2">
              <span className="min-w-0 flex-1 break-words">{label(a)}</span><span className="tabular-nums">{money(Math.round(a.thisYear * 100))}</span>
              {can && !a.key.startsWith("new:") && <button type="button" onClick={() => onUnassign(a.id)} className="text-sm text-navy-700 underline">Unassign</button>}
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
