// Wording samples for the template library: each template's text, built by Studio's own code
// with made-up client details, so an owner reads the exact wording before approving it.
import "server-only";
 
import { createStudioEngine, type StudioEnv } from "./engine.generated";
import { CorporateLetter, Proposal, T1Letter } from "./controllers";
import { wordingEnv, type Wording } from "./wording";
import { T1Q_TEMPLATES } from "../t1-quote/wording";
import { renderEmail, renderQuote, SAMPLE, SAMPLE_SENDER } from "../t1-quote/render";

const LH = "/studio/letterhead.jpg", ILLUS = "/studio/illustrative-watermark.png";
const DUMMY = { company: "Example Holdings Inc.", signer: "Taylor Sample", signerTitle: "Director", salutation: "Taylor", addr1: "1 Test Street", city: "Kitchener", postal: "N2A 1A1", province: "ON", ye: "2026-12-31" };

let WORDING: Wording | null = null;
let MARK = false;
function engine(signer: { name: string; title: string }) {
  const paper = { innerHTML: "", classList: { toggle() {} } };
  const e = createStudioEngine({ LH, ILLUS, SIGNER: signer.name, SIGNER_TITLE: signer.title, ...wordingEnv(WORDING), WORDING_MARK: MARK, $: ((id: string) => (id === "paper" ? paper : null)) as StudioEnv["$"] });
  return { e, paper };
}

// A corporate letter with the given services ticked, as Studio's preview shows it.
function corporate(signer: { name: string; title: string }, services: string[], extra: Record<string, string | boolean> = {}) {
  const { e, paper } = engine(signer);
  const c = new CorporateLetter(e, "2026-11-08");
  for (const [k] of e.SVC_UI as [string][]) c.set("svc_" + k, services.includes(k));
  for (const [k, v] of Object.entries({ ...DUMMY, ...extra })) c.set(k, v);
  e.render(c.state());
  return paper.innerHTML;
}

// The part of the letter from a numbered heading ("3. Catch-up bookkeeping") to the next heading.
// Editor markers may sit anywhere inside the heading, so the match allows them between characters.
const M = "(?:\\uE000[^\\uE001]*\\uE001|\\uE002)*";
const loose = (t: string) => t.split("").map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(M);
function section(html: string, title: string) {
  const start = html.search(new RegExp(`<h3>${M}\\d+\\.${M} ${M}${loose(title)}[^<]*</h3>`));
  if (start < 0) return "";
  const rest = html.slice(start + 4);
  const next = rest.search(/<h3>|<div class="sig"|<div class="pgb"/);
  return html.slice(start, next < 0 ? undefined : start + 4 + next);
}
function between(html: string, from: string, to?: string) {
  const a = html.indexOf(from);
  if (a < 0) return "";
  const b = to ? html.indexOf(to, a + from.length) : -1;
  return html.slice(a, b < 0 ? undefined : b);
}

const SCHEDULE: Record<string, [string, string]> = {
  sComp: ["comp", "Compilation engagement"], sT2: ["t2", "Corporate income tax return"], sCatch: ["catchup", "Catch-up bookkeeping"],
  sBooks: ["books", "Monthly bookkeeping"], sGst: ["gst", "GST/HST returns"], sPay: ["pay", "Payment administration"],
  sCfo: ["cfo", "CFO reporting"], sBudget: ["budget", "Annual budget"], sCoord: ["coord", "Year-end support for your external accountant"],
};

export type Sample = { parts: { label: string; html: string }[]; note?: string };

// Markers from the engine's editor mode become clickable <span data-w="key"> elements.
export const markToSpans = (html: string) => html.replace(/\uE000(w[0-9a-f]{10})\uE003([^\uE001]*)\uE001/g, '<span class="wmark" data-w="$1" data-wa="$2">').replace(/\uE002/g, "</span>");

export type TemplateInfo = { k: string; name: string; group: string; basis: string; status: string };
// Every template on the Templates page: the engine's letters, then the T1 quote and its emails.
export function allTemplates(): TemplateInfo[] {
  return [...(createStudioEngine({}).TEMPLATES as TemplateInfo[]), ...T1Q_TEMPLATES];
}

export function templateSample(key: string, signers: { letter: { name: string; title: string }; proposal: { name: string; title: string } }, wording: Wording | null = null, mark = false): Sample | null {
  // The T1 quote (Appendix A) and its emails, with made-up client details.
  if (key === "t1quote" || key === "t1email1" || key === "t1email2") {
    const texts = wording?.texts ?? {};
    const d = { ...SAMPLE, signer: signers.letter };
    if (key === "t1quote") return { parts: [
      ...renderQuote(texts, d, { mark }).map((p) => ({ ...p, label: `Couple: ${p.label}` })),
      { label: "Single filer: Part A", html: renderQuote(texts, { ...d, spouse: null, lines: [{ code: "PTX-110", person: null, quantity: 1 }, { code: "PTX-120", person: null, quantity: 2 }], totalCents: 79700 }, { mark })[0].html },
    ] };
    const e = renderEmail(texts, key === "t1email2" ? d : { ...d, spouse: null }, SAMPLE_SENDER, ["https://example.test/q/link-1", "https://example.test/q/link-2"], { mark });
    return { parts: [{ label: "Subject", html: `<p>${e.subjectHtml}</p>` }, { label: "Email", html: e.html }] };
  }
  if (mark) {
    const prev = MARK; MARK = true;
    try { const r = templateSample(key, signers, wording, false); return r && { ...r, parts: r.parts.map((p) => ({ ...p, html: markToSpans(p.html) })) }; }
    finally { MARK = prev; }
  }
  WORDING = wording;
  const L = signers.letter;
  if (key === "master") return { parts: [{ label: "Full corporate letter, every service ticked", html: corporate(L, Object.values(SCHEDULE).map(([k]) => k).concat("payroll", "t1"), { t1Owner: "Taylor Sample" }) }] };
  if (SCHEDULE[key]) {
    const [svc, title] = SCHEDULE[key];
    const services = svc === "comp" || svc === "t2" ? [svc] : ["comp", "t2", svc];
    return { parts: [{ label: title, html: section(corporate(L, services), title) }] };
  }
  if (key === "sPayroll") return { parts: [
    { label: "Payroll: we run payroll", html: section(corporate(L, ["comp", "t2", "payroll"], { payrollMode: "full" }), "Payroll") },
    { label: "Payroll: client runs payroll, we support", html: section(corporate(L, ["comp", "t2", "payroll"], { payrollMode: "advisory" }), "Payroll") },
  ] };
  if (key === "sExcl") return { parts: [{ label: "Other matters (the work not included is in this section)", html: section(corporate(L, ["comp", "t2"]), "Other matters") }] };
  if (key === "appA") return { parts: [{ label: "Appendix: expected form of the compilation engagement report", html: between(corporate(L, ["comp", "t2"]), '<div class="illus">', '<div class="pgb">') }] };
  if (key === "termsC") { const h = corporate(L, ["comp", "t2"]); return { parts: [{ label: "Standard Terms and Conditions: corporate clients", html: h.slice(h.lastIndexOf('<div class="tc">')) }] }; }
  if (key === "t1" || key === "termsI") {
    const { e } = engine(L);
    const c = new T1Letter(e, "2026-11-08");
    for (const [k, v] of Object.entries({ name0: "Jordan Sample", salutation: "Jordan", addr1: "4 Test Court", city: "Guelph", postal: "N1G 1A1", province: "ON", taxYear: "2026", corp: "Example Holdings Inc." })) c.set(k, v);
    const html = e.t1Html(c.state());
    return key === "t1" ? { parts: [{ label: "T1 letter for a company-client owner", html }] }
      : { parts: [{ label: "Standard Terms and Conditions: individuals (from the T1 letter)", html: html.lastIndexOf('<div class="tc">') >= 0 ? html.slice(html.lastIndexOf('<div class="tc">')) : html }] };
  }
  if (key === "t1td") { const { e } = engine(L); return { parts: [{ label: "Standalone T1 master wording (sent from TaxDome)", html: e.t1TdHtml() }] }; }
  if (key === "prop") {
    const { e } = engine(signers.proposal);
    const p = new Proposal(e, "2026-11-08");
    for (const [k, v] of Object.entries({ name: "Example Team Inc.", contact: "Alex Sample", salutation: "Alex", h0: "Books are behind by several months.", h1: "They want a monthly view of profit." })) p.set(k, v);
    p.addOption();
    p.opts.forEach((o, i) => { o.name = "Option " + "AB"[i]; o.lines[0].amt = i ? "1450" : "1150"; });
    p.setRecommended(1);
    return { parts: [{ label: "Proposal with two options (made-up prices)", html: e.pHtml(p.state()) }] };
  }
  if (key === "memo") return { parts: [], note: "The compilation file memo is part of Year-End (Phase 3). Its wording will be shown here when Phase 3 is built." };
  return null;
}

// Which wording pieces each template shows (to say where a change appears).
export function templateKeys(signers: { letter: { name: string; title: string }; proposal: { name: string; title: string } }, wording: Wording | null, keys: string[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const k of keys) {
    const s = templateSample(k, signers, wording, true);
    const set = new Set<string>();
    for (const p of s?.parts ?? []) for (const m of p.html.matchAll(/data-w="(w[0-9a-f]{10})"/g)) set.add(m[1]);
    out.set(k, set);
  }
  return out;
}
