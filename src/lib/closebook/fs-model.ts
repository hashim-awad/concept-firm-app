// Step 9, the year-end package (round 11, Hashim, Nov 27, 2026). Benchmark: the firm's package,
// Appendix C (docs/phase3/Year-end-package-standard.zip, build_model.py): the same captions, grouping,
// cash merge, HST split, period wording, prior-year column and the four tie-outs. What changes: the
// figures come from Closebook's final trial balance through the step 7 matches (the codes of the final
// GIFI export), and last year's column from step 2, not from a parsed ProFile PDF. Pure and tested.
//
// Amounts: GIFI-signed codes in, as the GIFI file holds them (assets, liabilities, equity, revenue and
// expenses positive; contra lines, a deficit and dividends negative). The statements show whole dollars,
// as Appendix C (ProFile's figures are whole dollars). Rounding follows CaseWare's "round to the largest
// item": every total is rounded from the exact figure, and a line's $1 rounding difference goes to the
// largest line of its section, so each statement adds and ties.

export type FsLine = { code: string; name: string; caption: string };
export type FsRow = { cap: string; cur: number; pri: number; code: string; note?: string };
export type TieOut = { name: string; column: "current" | "prior"; left: number; right: number; ok: boolean };

export type FsInput = {
  name: string; address: { street: string; city: string; prov: string; postal: string };
  yearStart: string; yearEnd: string;
  cur: Map<string, number>; prior: Map<string, number> | null;   // null: no prior-year column (first year)
  lines: Map<string, FsLine>;                                     // per GIFI code: its name and statement line
  hst: number;                                                    // GST/HST payable in 2680 (current year)
  hstPrior?: number;                                              // and last year, when Closebook knows it
  related: Record<string, string>; shTerms: string; note1Policy: string;
};

const TOTALS = new Set(["2599", "3499", "3620", "3640", "3849", "3660", "3680", "3600", "8089", "8299", "8519", "9367", "9368", "9369", "9970", "9990", "9995", "9999", "9659", "9898", "9899", "8518", "8300"]);
const SHAREHOLDER_TO = new Set(["2780", "2781", "2782", "2783", "3260", "3261", "3262", "3263"]);
// Round 14: a debit balance on a due to shareholder line (the shareholder owes the company) prints on the
// matching due from shareholder line, a current asset (CaseWare's sign-based reclassification).
const DUE_FROM: Record<string, string> = { "2780": "1300", "3260": "1300", "2781": "1301", "3261": "1301", "2782": "1302", "3262": "1302", "2783": "1303", "3263": "1303" };
const SHAREHOLDER_FROM = new Set(["1300", "1301", "1302", "1303"]);
export function reclassDueTo(m: Map<string, number>): Map<string, number> {
  const out = new Map(m);
  for (const [code, v] of m) if (DUE_FROM[code] && v < 0) {
    out.set(code, 0);
    out.set(DUE_FROM[code], (out.get(DUE_FROM[code]) ?? 0) - v);
  }
  return out;
}
const RELATED = /related (part|corp|canadian|foreign)|affiliat/i;
const cents = (n: number) => Math.round(n * 100);

// The caption: the statement line on the GIFI line (Appendix C's CAP list, now on the master lines). A
// statement line that contradicts its line (a cost or receivable line captioned "Accumulated
// amortization ..." or "Allowance for ...", a fill-down slip) falls back to the GIFI name in sentence
// case, Appendix C's own fallback.
const CONTRA = /^(accumulated|allowance|less)\b/i, CONTRA_NAME = /accumulated|allowance|amortization|depletion|\bless\b/i;
export function caption(l: FsLine | undefined, code: string): string {
  if (!l) return `GIFI ${code}`;
  const sentence = (l.name.charAt(0).toUpperCase() + l.name.slice(1).toLowerCase()).replace(/\bcanad/g, "Canad");
  const cap = (l.caption ?? "").trim();
  if (!cap || cap === "Calculated total") return sentence;
  if (CONTRA.test(cap) && !CONTRA_NAME.test(l.name)) return sentence;
  return cap;
}

// "For the year ended", or "For the period from X to Y" under 358 days (Appendix C).
export const longDate = (iso: string) => { const d = new Date(`${iso}T12:00:00Z`); return isNaN(d.getTime()) ? iso : `${d.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" })} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };
export function periodOf(yearStart: string, yearEnd: string) {
  const days = Math.round((Date.parse(`${yearEnd}T12:00:00Z`) - Date.parse(`${yearStart}T12:00:00Z`)) / 86400000) + 1;
  const isYear = days >= 358;
  return { days, isYear, period: isYear ? `For the year ended ${longDate(yearEnd)}` : `For the period from ${longDate(yearStart)} to ${longDate(yearEnd)}`, asat: `As at ${longDate(yearEnd)}` };
}

// Rows of a code range, cash 1000 to 1059 merged (Appendix C), and codes that share a statement line
// shown as one line (CaseWare: one row per lead sheet line). A row keeps its first code. The maps are
// already in the unit wanted (cents for the tie-outs, whole dollars for the statements).
type Col = Map<string, number>;
function rows(lo: number, hi: number, inp: FsInput, cur: Col, pri: Col | null): FsRow[] {
  const out = new Map<string, FsRow>();
  const add = (code: string, c: number, p: number) => {
    const n = Number(code);
    if (TOTALS.has(code) || n < lo || n > hi || (!c && !p)) return;
    const cash = n >= 1000 && n < 1060;
    let cap = cash ? "Cash and cash equivalents" : caption(inp.lines.get(code), code);
    if (inp.related[code]) cap = `${cap} (${inp.related[code]})`;
    const key = cash ? "1000" : `cap:${cap.toLowerCase()}`;
    const o = out.get(key) ?? { cap, cur: 0, pri: 0, code: cash ? "1000" : code };
    o.cur += c; o.pri += p; out.set(key, o);
  };
  const codes = new Set([...cur.keys(), ...(pri?.keys() ?? [])]);
  for (const c of [...codes].sort()) add(c, cur.get(c) ?? 0, pri?.get(c) ?? 0);
  return [...out.values()];
}
const sum = (rs: FsRow[], k: "cur" | "pri") => rs.reduce((a, r) => a + r[k], 0);
const range = (m: Col | null, lo: number, hi: number) => { let s = 0; for (const [c, v] of m ?? []) { const n = Number(c); if (n >= lo && n <= hi && !TOTALS.has(c)) s += v; } return s; };

// The statements from one pair of columns (in cents or in whole dollars).
function sheet(inp: FsInput, cur: Col, pri: Col | null) {
  const rev = rows(8000, 8299, inp, cur, pri), cos = rows(8300, 8518, inp, cur, pri);
  const exp = rows(8520, 9367, inp, cur, pri).concat(rows(9370, 9989, inp, cur, pri));
  const tax = { cur: (cur.get("9990") ?? 0) + (cur.get("9995") ?? 0), pri: (pri?.get("9990") ?? 0) + (pri?.get("9995") ?? 0) };
  const ni = { cur: sum(rev, "cur") - sum(cos, "cur") - sum(exp, "cur") - tax.cur, pri: sum(rev, "pri") - sum(cos, "pri") - sum(exp, "pri") - tax.pri };
  // Retained earnings: start (3660), prior period adjustments (3720 to 3739), dividends (3700 to 3719,
  // written negative), other items (3740 to 3848), end.
  const reOpen = { cur: cur.get("3660") ?? 0, pri: pri?.get("3660") ?? 0 };
  const ppa = { cur: range(cur, 3720, 3739), pri: range(pri, 3720, 3739) };
  const div = { cur: -range(cur, 3700, 3719), pri: -range(pri, 3700, 3719) };
  const other = { cur: range(cur, 3740, 3848), pri: range(pri, 3740, 3848) };
  const reClose = { cur: reOpen.cur + ppa.cur + ni.cur - div.cur + other.cur, pri: reOpen.pri + ppa.pri + ni.pri - div.pri + other.pri };
  const ca = rows(1000, 1599, inp, cur, pri), nca = rows(1600, 2589, inp, cur, pri), cl = rows(2600, 3139, inp, cur, pri), ncl = rows(3140, 3450, inp, cur, pri);
  const eqRows = rows(3500, 3599, inp, cur, pri);
  const re: FsRow = { cap: "Retained earnings (deficit)", cur: reClose.cur, pri: reClose.pri, code: "3600" };
  const out = (k: "cur" | "pri") => sum(ca, k) + sum(nca, k) - sum(cl, k) - sum(ncl, k) - sum(eqRows, k) - re[k];
  return { rev, cos, exp, tax, ni, reOpen, ppa, div, other, reClose, ca, nca, cl, ncl, eqRows, re, out };
}

// ProFile's rounding (Hashim, Nov 14, 2026): each GIFI line to the dollar on its own (half away from
// zero); a statement line is the sum of its rounded GIFI lines, every total the sum of the lines above it.
const dollarsOf = (v: number) => Math.sign(v) * Math.round(Math.abs(v));
// A balance sheet left out by a dollar or two takes the difference on its largest line, as the preparer
// does in ProFile so Schedule 100 balances.
export type ProfileFix = { code: string; name: string; from: number; to: number };
function balance(m: Col, out: number, inp: FsInput): ProfileFix | null {
  if (!out) return null;
  let best = "";
  for (const [c, v] of m) { const n = Number(c); if (TOTALS.has(c) || n < 1000 || n > 3599 || !v) continue; if (!best || Math.abs(v) > Math.abs(m.get(best)!)) best = c; }
  if (!best) return null;
  const from = m.get(best)!, to = Number(best) <= 2589 ? from - out : from + out;
  m.set(best, to);
  return { code: best, name: inp.lines.get(best)?.name ?? "", from, to };
}

export function buildFs(input: FsInput) {
  const inp: FsInput = { ...input, cur: reclassDueTo(input.cur), prior: input.prior ? reclassDueTo(input.prior) : null };
  const p = periodOf(inp.yearStart, inp.yearEnd);
  const hasPrior = !!inp.prior && [...inp.prior.values()].some((v) => v !== 0);
  const prior = hasPrior ? inp.prior : null;
  const scale = (m: Col | null, f: (v: number) => number) => (m ? new Map([...m].map(([c, v]) => [c, f(v)] as [string, number])) : null);

  // The four tie-outs, on the exact figures, for each column shown. Any failure stops the package.
  const X = sheet(inp, scale(inp.cur, cents)!, scale(prior, cents));
  const exC = scale(inp.cur, cents)!, exP = scale(prior, cents);
  const ties: TieOut[] = [];
  for (const k of (hasPrior ? ["cur", "pri"] : ["cur"]) as ("cur" | "pri")[]) {
    const col = k === "cur" ? "current" : "prior";
    const TA = sum(X.ca, k) + sum(X.nca, k), TL = sum(X.cl, k) + sum(X.ncl, k), EQ = sum(X.eqRows, k) + X.re[k];
    ties.push({ name: "Total assets = total liabilities + total equity", column: col, left: TA, right: TL + EQ, ok: TA === TL + EQ });
    // 3640 = 2599: the GIFI totals worked from every code with a balance, against the statement.
    const all = k === "cur" ? exC : exP!;
    const g2599 = range(all, 1000, 2589), g3640 = range(all, 2600, 3450) + range(all, 3500, 3599) + X.re[k];
    ties.push({ name: "Total liabilities and shareholder equity (3640) = total assets (2599)", column: col, left: g3640, right: g2599, ok: g3640 === g2599 });
    // 3680: net income worked from every Schedule 125 code with a balance; 9999: the statement's sections.
    const s3680 = range(all, 8000, 8299) - range(all, 8300, 8518) - range(all, 8520, 9989) - X.tax[k];
    ties.push({ name: "Net income on the income statement (9999) = net income in the retained earnings schedule (3680)", column: col, left: X.ni[k], right: s3680, ok: X.ni[k] === s3680 });
    const formula = X.reOpen[k] + X.ni[k] - X.div[k] + X.ppa[k];
    ties.push({ name: "Retained earnings end = start + net income − dividends + prior period adjustments (3720)", column: col, left: X.re[k], right: formula, ok: X.re[k] === formula });
  }
  const failed = ties.filter((t) => !t.ok);

  // Whole dollars, ProFile's way, then the balance sheet balanced on its largest line if it is out.
  const rC = scale(inp.cur, dollarsOf)!, rP = scale(prior, dollarsOf);
  const first = sheet(inp, rC, rP);
  const failedIn = (c: string) => failed.some((t) => t.column === c);
  const profileFix = failedIn("current") ? null : balance(rC, first.out("cur"), inp);
  if (rP && !failedIn("prior")) balance(rP, first.out("pri"), inp);
  const S = sheet(inp, rC, rP);
  const { rev, cos, exp, tax, ni, reOpen, ppa, div, other, reClose, ca, nca, cl, ncl, eqRows, re } = S;

  // GST/HST split out of taxes payable (2680) with the GST/HST payable account; the two parts add up to
  // the rounded 2680. Closebook splits last year too when it has the account.
  const hst = dollarsOf(inp.hst), hstPri = hasPrior ? dollarsOf(inp.hstPrior ?? 0) : 0;
  const t2680 = cl.find((r) => r.code === "2680");
  if (t2680 && (hst || hstPri)) { t2680.cur -= hst; t2680.pri -= hstPri; cl.splice(cl.indexOf(t2680) + 1, 0, { cap: "GST/HST payable", cur: hst, pri: hstPri, code: "HST" }); }
  // A statement line nil in every column is left out.
  for (const sec of [rev, cos, exp, ca, nca, cl, ncl, eqRows]) for (let i = sec.length - 1; i >= 0; i--) if (!sec[i].cur && !sec[i].pri) sec.splice(i, 1);

  // Notes: only those that apply, numbered in order after Note 1 (Appendix C's wording, plus related
  // parties). The capital assets note comes back in round 12 with its table.
  const sh = [...ncl, ...cl].filter((r) => SHAREHOLDER_TO.has(r.code));
  const shFrom = ca.filter((r) => SHAREHOLDER_FROM.has(r.code));
  const relatedRows = [...ca, ...nca, ...cl, ...ncl].filter((r) => RELATED.test(inp.lines.get(r.code)?.name ?? ""));
  const has = (lo: number, hi: number, skip: string[] = []) => [...rC].some(([c, v]) => v && Number(c) >= lo && Number(c) <= hi && !skip.includes(c));
  let nn = 2;
  const notes = {
    has_ar: has(1060, 1063), has_ppe: nca.length > 0, has_ap: has(2620, 2628, ["2627"]), has_sd: has(2627, 2627),
    has_tax: cl.some((r) => r.code === "2680"), has_hst: !!hst, note1Policy: inp.note1Policy,
    ppa: ppa.cur ? { n: nn++, amount: ppa.cur } : null,
    // One note for the shareholder balances, due to and due from, with the terms typed in step 9.
    shareholder: sh.length || shFrom.length ? { n: nn++, rows: [...shFrom, ...sh],
      heading: sh.length && shFrom.length ? "Due to and from shareholder" : sh.length ? "Due to shareholder" : "Due from shareholder",
      terms: inp.shTerms || [
        ...(shFrom.length ? ["The amount due from the shareholder is non-interest bearing, unsecured, and has no set terms of repayment. It is classified as a current asset."] : []),
        ...(sh.length ? [`The amount due to the shareholder is non-interest bearing, unsecured, and has no set terms of repayment. It is classified as a ${sh.some((x) => Number(x.code) >= 3260) ? "non-current" : "current"} liability.`] : []),
      ].join(" ") } : null,
    related: relatedRows.length ? { n: nn++, rows: relatedRows } : null,
  };
  for (const r of [...shFrom, ...sh]) r.note = String(notes.shareholder!.n);
  for (const r of relatedRows) if (!r.note) r.note = String(notes.related!.n);
  return {
    name: inp.name, address: inp.address, ...p, y: inp.yearEnd.slice(0, 4), py: String(Number(inp.yearEnd.slice(0, 4)) - 1), hasPrior,
    bs: { ca, nca, cl, ncl, eq: [...eqRows, re] }, is: { rev, cos, exp, tax, ni, reOpen, ppa, div, other, reClose },
    notes, ties, failed, profileFix,
  };
}
export type FsModel = ReturnType<typeof buildFs>;

// Amounts as Appendix C prints them: whole dollars, commas, brackets for negatives, "-" for zero.
export const n = (v: number | null | undefined) => (v == null || v === 0 ? "-" : v < 0 ? `(${Math.abs(v).toLocaleString("en-US")})` : v.toLocaleString("en-US"));
