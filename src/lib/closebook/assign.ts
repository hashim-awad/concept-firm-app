// Piece R2 (Hashim, Nov 19, 2026; mock O; benchmark CaseWare Cloud "Assign accounts"): step 4 "Assign mapping" on trial
// balance files. Each client account is assigned to a master account (the standard chart). This module is pure: the tree
// of QuickBooks Parent:Sub accounts, which accounts count (D9), and the suggestions in order (D4, D11): last year's match,
// then the QuickBooks type and detail type, then the name. Nothing here assigns: every suggestion needs a click.

export type ClientAcct = {
  id: string; key: string; number: string; name: string; fullName?: string | null; parentKey?: string | null;
  thisYear: number; lastYear: number; hasEntry?: boolean; inList?: boolean; chart?: string | null;
  tbType?: string | null; detail?: string | null;
};
export type MasterAcct = { number: string; name: string; type: string; line: string | null; sheet: string };
// Last year's decision for a client account: its master account and its name then (cb_client_mappings), or only the line it
// was on (files from before R2: the single master account on that line is the suggestion).
export type PriorMatch = { chart: string | null; name: string | null; line: string | null };
export type Suggestion = { chart: string; source: "last_year" | "type" | "name"; why: string; nameChanged?: boolean };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9$]+/g, " ").trim();
const words = (s: string | null | undefined) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
const STOP = new Set(["and", "the", "for", "other", "expense", "expenses", "account", "accounts", "general", "misc", "miscellaneous", "costs", "cost"]);

// D9: an account counts for step 4 when it has a balance this year or last year, or an entry.
export const counted = (a: ClientAcct) => a.thisYear !== 0 || a.lastYear !== 0 || !!a.hasEntry;
export const label = (a: { number: string; name: string }) => `${a.number ? `${a.number} ` : ""}${a.name}`;

// QuickBooks account types (the Account List's Type column) to the master chart's five types.
export function qboClass(t: string | null | undefined): string | null {
  const s = norm(t);
  if (!s) return null;
  if (/^(bank|accounts receivable|a r|other current assets?|fixed assets?|other assets?|current assets?)/.test(s)) return "Asset";
  if (/^(accounts payable|a p|credit card|other current liabilit|long term liabilit|current liabilit)/.test(s)) return "Liability";
  if (/^equity/.test(s)) return "Equity";
  if (/^(income|other income|revenue)/.test(s)) return "Revenue";
  if (/^(expenses?|other expense|cost of goods sold|cost of sales)/.test(s)) return "Expense";
  return null;
}

// The tree as QuickBooks shows it: parents in the client's order, each with its sub-accounts. A parent that has its own
// balance is an account too (shown as "(own balance)" under itself). Accounts with no parent are their own rows.
export type TreeNode = { key: string; name: string; number: string; self: ClientAcct | null; children: ClientAcct[] };
export function buildTree(accts: ClientAcct[]): TreeNode[] {
  const byKey = new Map(accts.map((a) => [a.key, a]));
  const nodes = new Map<string, TreeNode>();
  const out: TreeNode[] = [];
  const nodeFor = (key: string, name: string, number: string) => {
    let n = nodes.get(key);
    if (!n) { n = { key, name, number, self: byKey.get(key) ?? null, children: [] }; nodes.set(key, n); out.push(n); }
    return n;
  };
  for (const a of accts) {
    if (a.parentKey) {
      const p = byKey.get(a.parentKey);
      const pName = p?.name ?? parentName(a);
      const node = nodeFor(a.parentKey, pName, p?.number ?? (/^\d/.test(a.parentKey) ? a.parentKey : ""));
      if (!p && node.name === a.parentKey && pName !== a.parentKey) node.name = pName;   // a later child knows the parent's name
      node.children.push(a);
    } else if (!nodes.has(a.key)) {
      nodeFor(a.key, a.name, a.number);
    }
  }
  // Natural order: by number when there is one, else by name (the client's order in their chart).
  const ord = (n: { number: string; name: string }) => `${n.number ? `0${n.number.padStart(12, "0")}` : `1${n.name.toLowerCase()}`}`;
  for (const n of out) n.children.sort((x, y) => ord(x).localeCompare(ord(y)));
  return out.sort((x, y) => ord(x).localeCompare(ord(y)));
}
function parentName(a: ClientAcct): string {
  // "6000 Marketing - Digital:6000.01 Paid search ads" → "Marketing - Digital"
  const segs = (a.fullName ?? "").split(/\s*:\s*/);
  const p = segs.length > 1 ? segs[segs.length - 2] : a.parentKey ?? "";
  return p.replace(/^\d{3,6}(?:[.-]\d{1,4})?\s+[-–]?\s*/, "");
}

// Common accounts a realty team's books hold that have no master account of their own (Hashim, Nov 19, D2): clearing,
// Undeposited Funds and QuickBooks Opening Balance Equity go to 10900 Clearing; a US dollar bank account to 10200.
function special(a: ClientAcct): Suggestion | null {
  const n = norm(a.name), cls = qboClass(a.tbType);
  if (/opening balance equity/.test(n)) return { chart: "10900", source: "name", why: "Opening Balance Equity goes to Clearing" };
  // Never an expense or revenue account ("PayPal fees"): Clearing only for a balance sheet account or one of unknown type.
  if (cls !== "Expense" && cls !== "Revenue" && !/\b(fees?|charges?|commissions?|interest)\b/.test(n)
      && /undeposited funds|clearing|in transit|stripe|square|paypal|interac|e transfer/.test(n)) return { chart: "10900", source: "name", why: "A clearing account goes to Clearing" };
  if ((cls === "Asset" || cls === null) && /\b(usd|us|u s)\b|us dollar/.test(n) && /bank|chequing|checking|savings|account/.test(n)) return { chart: "10200", source: "name", why: "A US dollar bank account" };
  return null;
}

function bestByWords(text: string, pool: MasterAcct[]): MasterAcct | null {
  const w = words(text);
  if (!w.size) return null;
  let best: MasterAcct | null = null, score = 0;
  for (const m of pool) {
    const mw = words(m.name);
    let s = 0;
    for (const x of w) if (mw.has(x)) s += 1; else if ([...mw].some((y) => y.startsWith(x) || x.startsWith(y))) s += 0.5;
    if (s > score) { score = s; best = m; }
  }
  return score >= 1 ? best : null;
}

// D4: the suggestion for one account, in order. prior is keyed by the client account's key (its number, else its name).
export function suggest(a: ClientAcct, prior: Map<string, PriorMatch>, master: MasterAcct[]): Suggestion | null {
  const byNo = new Map(master.map((m) => [m.number, m]));
  // 1. Last year's match: by number only when the name also matches, else "Name changed"; by name for no number.
  const p = prior.get(a.key);
  if (p) {
    const nameChanged = !!a.number && !!p.name && norm(p.name) !== norm(a.name);
    const chart = p.chart ?? (p.line ? single(p.line, master) : null);
    if (chart && byNo.has(chart)) return { chart, source: "last_year", why: nameChanged ? `Last year's match; the name changed from "${p.name}"` : "Last year's match", nameChanged };
  }
  const sp = special(a);
  if (sp) return sp;
  // 2. The QuickBooks type and detail type (the Account List upload), within the master accounts of that type.
  const cls = qboClass(a.tbType);
  const pool = cls ? master.filter((m) => m.type === cls) : master;
  if (a.detail) {
    const m = bestByWords(`${a.detail} ${a.name}`, pool);
    if (m) return { chart: m.number, source: "type", why: `From the account name and QuickBooks type "${a.detail}"` };
  }
  // 3. The name.
  const m = bestByWords(a.name, pool);
  return m ? { chart: m.number, source: "name", why: "From the account name" } : null;
}
function single(line: string, master: MasterAcct[]): string | null {
  const on = master.filter((m) => m.line === line);
  return on.length === 1 ? on[0].number : null;
}

// "Accept last year's matches (n)": every unassigned, counted account whose suggestion is last year's match and whose name did
// not change (T1b, D4).
export function lastYearMatches(accts: ClientAcct[], prior: Map<string, PriorMatch>, master: MasterAcct[]): { account: string; chart: string }[] {
  return accts.filter((a) => !a.chart && counted(a)).flatMap((a) => {
    const s = suggest(a, prior, master);
    return s && s.source === "last_year" && !s.nameChanged ? [{ account: a.id, chart: s.chart }] : [];
  });
}

// The toast and the Undo button: "8 accounts to 60000 Advertising" (mock O; T1c).
export function actionText(n: number, m: MasterAcct | null): string {
  const what = `${n} account${n === 1 ? "" : "s"}`;
  return m ? `${what} to ${m.number} ${m.name}` : `${what} unassigned`;
}

// Amounts in cents as the trial balance shows them: credits in brackets, "–" for zero.
export function money(c: number): string {
  if (c === 0) return "–";
  const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return c < 0 ? `(${t})` : t;
}
