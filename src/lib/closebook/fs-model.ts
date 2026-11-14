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
const SHAREHOLDER_TO = new Set(["2780", "2781", "2782", "3260", "3261", "3262"]);
const RELATED = /related (part|corp|canadian|foreign)|affiliat/i;
const cents = (n: number) => Math.round(n * 100);

// The caption: the statement line on the GIFI line (Appendix C's CAP list, now on the master lines). A
// statement line that contradicts its line (a cost or receivable line captioned "Accumulated
// amortization ..." or "Allowance for ...", a fill-down slip) falls back to the GIFI name in sentence
// case, Appendix C's own fallback.
const CONTRA = /^(accumulated|allowance|less)\b/i, CONTRA_NAME = /accumulated|allowance|amortization|depletion|\bless\b/i;
export function caption(l: FsLine | undefined, code: string): string {
  if (!l) return `GIFI ${code}`;
  const sentence = l.name.charAt(0).toUpperCase() + l.name.slice(1).toLowerCase();
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
// shown as one line (CaseWare: one row per lead sheet line). A row keeps its first code. Values in cents.
function rows(lo: number, hi: number, inp: FsInput, notes: Record<string, string> = {}): FsRow[] {
  const out = new Map<string, FsRow>();
  const add = (code: string, cur: number, pri: number) => {
    const n = Number(code);
    if (TOTALS.has(code) || n < lo || n > hi || (!cur && !pri)) return;
    const cash = n >= 1000 && n < 1060;
    let cap = cash ? "Cash and cash equivalents" : caption(inp.lines.get(code), code);
    if (inp.related[code]) cap = `${cap} (${inp.related[code]})`;
    const key = cash ? "1000" : `cap:${cap.toLowerCase()}`;
    const o = out.get(key) ?? { cap, cur: 0, pri: 0, code: cash ? "1000" : code, note: notes[code] };
    o.cur += cur; o.pri += pri; out.set(key, o);
  };
  const codes = new Set([...inp.cur.keys(), ...(inp.prior?.keys() ?? [])]);
  for (const c of [...codes].sort()) add(c, cents(inp.cur.get(c) ?? 0), cents(inp.prior?.get(c) ?? 0));
  return [...out.values()];
}
const sum = (rs: FsRow[], k: "cur" | "pri") => rs.reduce((a, r) => a + r[k], 0);
const range = (m: Map<string, number> | null, lo: number, hi: number) => { let s = 0; for (const [c, v] of m ?? []) { const n = Number(c); if (n >= lo && n <= hi) s += cents(v); } return s; };

// Whole dollars: each row rounded, and the section's rounding difference on its largest row, so the
// rows add to the section total (rounded from the exact figure).
const dollars = (c: number) => Math.round(c / 100);
function roundTo(rs: FsRow[], k: "cur" | "pri", total: number) {
  for (const r of rs) r[k] = dollars(r[k]);
  const diff = total - rs.reduce((a, r) => a + r[k], 0);
  if (diff && rs.length) { const big = rs.reduce((a, r) => (Math.abs(r[k]) > Math.abs(a[k]) ? r : a), rs[0]); big[k] += diff; }
}

export function buildFs(inp: FsInput) {
  const p = periodOf(inp.yearStart, inp.yearEnd);
  const hasPrior = !!inp.prior && [...inp.prior.values()].some((v) => v !== 0);
  const prior = hasPrior ? inp.prior : null;
  const pin = { ...inp, prior };

  // Income statement first: the year's net income feeds retained earnings.
  const rev = rows(8000, 8299, pin), cos = rows(8300, 8518, pin), exp = rows(8520, 9367, pin).concat(rows(9370, 9989, pin).filter((r) => !["9990", "9995"].includes(r.code)));
  const tax = { cur: cents(inp.cur.get("9990") ?? 0) + cents(inp.cur.get("9995") ?? 0), pri: cents(prior?.get("9990") ?? 0) + cents(prior?.get("9995") ?? 0) };
  const ni = { cur: sum(rev, "cur") - sum(cos, "cur") - sum(exp, "cur") - tax.cur, pri: sum(rev, "pri") - sum(cos, "pri") - sum(exp, "pri") - tax.pri };
  // Retained earnings: start (3660), prior period adjustments (3720 to 3739), dividends (3700 to 3719,
  // written negative), other items (3740 to 3848), end.
  const reOpen = { cur: cents(inp.cur.get("3660") ?? 0), pri: cents(prior?.get("3660") ?? 0) };
  const ppa = { cur: range(inp.cur, 3720, 3739), pri: range(prior, 3720, 3739) };
  const div = { cur: -range(inp.cur, 3700, 3719), pri: -range(prior, 3700, 3719) };
  const other = { cur: range(inp.cur, 3740, 3848), pri: range(prior, 3740, 3848) };
  const reClose = { cur: reOpen.cur + ppa.cur + ni.cur - div.cur + other.cur, pri: reOpen.pri + ppa.pri + ni.pri - div.pri + other.pri };

  // Balance sheet (Appendix C's ranges).
  const ca = rows(1000, 1599, pin), nca = rows(1600, 2589, pin), cl = rows(2600, 3139, pin), ncl = rows(3140, 3450, pin);
  const eqRows = rows(3500, 3599, pin);
  const re: FsRow = { cap: "Retained earnings (deficit)", cur: reClose.cur, pri: reClose.pri, code: "3600" };
  // HST split out of taxes payable (2680), using the GST/HST payable account. Appendix C split the current
  // year only (the prior T2 does not say); Closebook splits last year too when it has the account.
  const hst = cents(inp.hst), hstPri = hasPrior ? cents(inp.hstPrior ?? 0) : 0;
  const t2680 = cl.find((r) => r.code === "2680");
  if (t2680 && (hst || hstPri)) { t2680.cur -= hst; t2680.pri -= hstPri; cl.splice(cl.indexOf(t2680) + 1, 0, { cap: "GST/HST payable", cur: hst, pri: hstPri, code: "HST" }); }

  // The four tie-outs, on the exact figures, for each column shown. Any failure stops the package.
  const ties: TieOut[] = [];
  for (const k of (hasPrior ? ["cur", "pri"] : ["cur"]) as ("cur" | "pri")[]) {
    const col = k === "cur" ? "current" : "prior";
    const TA = sum(ca, k) + sum(nca, k), TL = sum(cl, k) + sum(ncl, k), EQ = sum(eqRows, k) + re[k];
    ties.push({ name: "Total assets = total liabilities + total equity", column: col, left: TA, right: TL + EQ, ok: TA === TL + EQ });
    // 3640 = 2599: the GIFI totals worked from every code with a balance, against the statement.
    const all = k === "cur" ? inp.cur : prior!;
    const g2599 = range(all, 1000, 2589), g3640 = range(all, 2600, 3450) + range(all, 3500, 3599) + re[k];
    ties.push({ name: "Total liabilities and shareholder equity (3640) = total assets (2599)", column: col, left: g3640, right: g2599, ok: g3640 === g2599 });
    // 3680: net income worked from every Schedule 125 code with a balance; 9999: the statement's sections.
    const s3680 = range(all, 8000, 8299) - range(all, 8300, 8518) - range(all, 8520, 9989) - (k === "cur" ? tax.cur : tax.pri);
    ties.push({ name: "Net income on the income statement (9999) = net income in the retained earnings schedule (3680)", column: col, left: ni[k], right: s3680, ok: ni[k] === s3680 });
    const formula = reOpen[k] + ni[k] - div[k] + ppa[k];
    ties.push({ name: "Retained earnings end = start + net income − dividends + prior period adjustments (3720)", column: col, left: re[k], right: formula, ok: re[k] === formula });
  }
  const failed = ties.filter((t) => !t.ok);

  // Whole dollars, totals first (CaseWare's rounding to the largest item).
  const R = { TA: { cur: 0, pri: 0 }, CA: { cur: 0, pri: 0 }, EQ: { cur: 0, pri: 0 }, CL: { cur: 0, pri: 0 }, NI: { cur: 0, pri: 0 }, REV: { cur: 0, pri: 0 }, COS: { cur: 0, pri: 0 }, TAX: { cur: 0, pri: 0 } };
  for (const k of ["cur", "pri"] as const) {
    R.TA[k] = dollars(sum(ca, k) + sum(nca, k)); R.CA[k] = dollars(sum(ca, k));
    R.EQ[k] = dollars(sum(eqRows, k) + re[k]); R.CL[k] = dollars(sum(cl, k));
    R.NI[k] = dollars(ni[k]); R.REV[k] = dollars(sum(rev, k)); R.COS[k] = dollars(sum(cos, k)); R.TAX[k] = dollars(tax[k]);
    // A section with no rows cannot take a rounding difference: its sibling takes the whole total.
    if (!nca.length) R.CA[k] = R.TA[k];
    roundTo(ca, k, R.CA[k]); roundTo(nca, k, R.TA[k] - R.CA[k]);
    const reR = dollars(re[k]); re[k] = reR;
    if (!eqRows.length) R.EQ[k] = reR;
    roundTo(eqRows, k, R.EQ[k] - reR);
    if (!ncl.length) R.CL[k] = R.TA[k] - R.EQ[k];
    roundTo(cl, k, R.CL[k]); roundTo(ncl, k, R.TA[k] - R.EQ[k] - R.CL[k]);
    roundTo(rev, k, R.REV[k]); roundTo(cos, k, R.COS[k]); roundTo(exp, k, R.REV[k] - R.COS[k] - R.TAX[k] - R.NI[k]);
    tax[k] = R.TAX[k]; ni[k] = R.NI[k];
    reOpen[k] = dollars(reOpen[k]); ppa[k] = dollars(ppa[k]); other[k] = dollars(other[k]); reClose[k] = reR;
    div[k] = reOpen[k] + ppa[k] + ni[k] + other[k] - reClose[k];
  }

  // Notes: only those that apply, numbered in order after Note 1 (Appendix C's wording, plus round 11's two).
  const sh = [...ncl, ...cl].filter((r) => SHAREHOLDER_TO.has(r.code));
  const relatedRows = [...ca, ...nca, ...cl, ...ncl].filter((r) => RELATED.test(inp.lines.get(r.code)?.name ?? ""));
  const hasCapital = nca.some((r) => Number(r.code) >= 1600 && Number(r.code) <= 2178);
  let nn = 2;
  const notes = {
    has_ar: ca.some((r) => /^106[02]$/.test(r.code)), has_ppe: nca.length > 0, has_ap: cl.some((r) => r.code === "2620"), has_sd: cl.some((r) => r.code === "2627"),
    has_tax: cl.some((r) => r.code === "2680"), has_hst: !!hst,
    ppa: ppa.cur ? { n: nn++, amount: ppa.cur } : null,
    shareholder: sh.length ? { n: nn++, rows: sh, terms: inp.shTerms || `The amount due to the shareholder is non-interest bearing, unsecured, and has no set terms of repayment. It is classified as a ${sh.some((x) => Number(x.code) >= 3260) ? "non-current" : "current"} liability.` } : null,
    amortization: hasCapital ? { n: nn++, policy: inp.note1Policy } : null,
    related: relatedRows.length ? { n: nn++, rows: relatedRows } : null,
  };
  for (const r of sh) r.note = String(notes.shareholder!.n);
  for (const r of relatedRows) if (!r.note) r.note = String(notes.related!.n);
  return {
    name: inp.name, address: inp.address, ...p, y: inp.yearEnd.slice(0, 4), py: String(Number(inp.yearEnd.slice(0, 4)) - 1), hasPrior,
    bs: { ca, nca, cl, ncl, eq: [...eqRows, re] }, is: { rev, cos, exp, tax, ni, reOpen, ppa, div, other, reClose },
    totals: R, notes, ties, failed,
  };
}
export type FsModel = ReturnType<typeof buildFs>;

// Amounts as Appendix C prints them: whole dollars, commas, brackets for negatives, "-" for zero.
export const n = (v: number | null | undefined) => (v == null || v === 0 ? "-" : v < 0 ? `(${Math.abs(v).toLocaleString("en-US")})` : v.toLocaleString("en-US"));
