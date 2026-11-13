// Working reports for a Closebook file (Hashim, Nov 13, 2026): balance sheet and income statement, this
// year (after Closebook entries) against last year, by account. A working view like QuickBooks' reports,
// not the client package (step 8). Pure, tested. Amounts in dollars, debits positive in; shown with
// credits as positive on the credit side (liabilities, equity, revenue).

export type RepAccount = { key: string; number: string; name: string; type: string | null; final: number; last: number };
export type RepLine = { name: string; now: number; last: number };
export type RepSection = { title: string; lines: RepLine[]; now: number; last: number };
export type Reports = {
  bs: { sections: RepSection[]; totalAssets: { now: number; last: number }; totalOther: { now: number; last: number }; balanced: boolean };
  pl: { revenue: RepSection; expenses: RepSection; net: { now: number; last: number } };
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const section = (title: string, accts: RepAccount[], sign: 1 | -1): RepSection => {
  const lines = accts.filter((a) => a.final !== 0 || a.last !== 0).sort((a, b) => a.number.localeCompare(b.number) || a.name.localeCompare(b.name))
    .map((a) => ({ name: `${a.number ? `${a.number} ` : ""}${a.name}`, now: r2(sign * a.final), last: r2(sign * a.last) }));
  return { title, lines, now: r2(lines.reduce((n, l) => n + l.now, 0)), last: r2(lines.reduce((n, l) => n + l.last, 0)) };
};

export function buildReports(accounts: RepAccount[]): Reports {
  const of = (t: string) => accounts.filter((a) => a.type === t);
  const revenue = section("Revenue", of("Revenue"), -1);
  const expenses = section("Expenses", of("Expense"), 1);
  const net = { now: r2(revenue.now - expenses.now), last: r2(revenue.last - expenses.last) };
  const assets = section("Assets", of("Asset"), 1);
  const liabilities = section("Liabilities", of("Liability"), -1);
  const equity = section("Equity", of("Equity"), -1);
  equity.lines.push({ name: "Net income for the year", now: net.now, last: net.last });
  equity.now = r2(equity.now + net.now); equity.last = r2(equity.last + net.last);
  // Accounts without a type yet (not yet coded, opening balances to enter, unmatched): shown, so it balances.
  const open = accounts.filter((a) => !a.type);
  const sections = [assets, liabilities, equity];
  if (open.some((a) => a.final || a.last)) sections.push(section("Not yet sorted", open, -1));
  const other = sections.slice(1).reduce((n, s) => ({ now: n.now + s.now, last: n.last + s.last }), { now: 0, last: 0 });
  const totalOther = { now: r2(other.now), last: r2(other.last) };
  return {
    bs: { sections, totalAssets: { now: assets.now, last: assets.last }, totalOther, balanced: Math.abs(assets.now - totalOther.now) < 0.005 },
    pl: { revenue, expenses, net },
  };
}
