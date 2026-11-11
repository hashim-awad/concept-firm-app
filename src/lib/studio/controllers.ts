// Screen logic for the Studio document screens. Each controller holds the form values and
// reproduces what Studio's page did around its engine: defaults, the order of fee lines,
// automatic billing rules, and how the engine's input ("state") is assembled.
// The engine itself (letters, checks, PDF definitions) is Studio's code, unchanged.
// Every rule here mirrors a named Studio function; the screen parity test compares the result.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { StudioEngine } from "./engine.generated";

type Val = string | boolean;

function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

/* ------------------------------------------------------------------ */
/* Corporate letter (Studio: elHTML, buildEL, state, refresh)         */
/* ------------------------------------------------------------------ */

export type Fee = { svc: string; detail: string; kind: string; amt: string; tag?: string; user?: boolean };

export class CorporateLetter {
  e: StudioEngine;
  f: Record<string, Val> = {};
  mode: "draft" | "final" = "draft";
  feeType: string | null = null;
  acks: Record<string, boolean> = { ab: false, bc: false };

  constructor(engine: StudioEngine, today = todayISO()) {
    this.e = engine;
    this.e.__set("FEES", []);
    // Field defaults exactly as Studio's form starts.
    for (const k of this.e.IDS as string[]) this.f[k] = "";
    for (const k of ["firstYear", "thirdParty", "reviewed", "catchTBD", "pnl"]) this.f[k] = false;
    for (const [k, , on] of this.e.SVC_UI as [string, string, number][]) this.f["svc_" + k] = !!on;
    Object.assign(this.f, {
      type: "ye", letterDate: today, signerTitle: "Director", province: "ON", basis: "standard", tpBasis: "request",
      billOnce: "sign", payMethod: "", payrollMode: "full", t1Cra: "done",
    });
    const d = new Date(today + "T12:00:00"); d.setMonth(d.getMonth() + 1);
    this.f.startMonth = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    this.refresh();
  }

  get fees(): Fee[] { return this.e.__get("FEES"); }

  // Studio state(): the engine input, built from the form.
  state(): any {
    const s: any = {};
    for (const k of this.e.IDS as string[]) s[k] = this.f[k];
    s.fees = this.fees.map((x) => ({ svc: x.svc, detail: x.detail, kind: x.kind, amt: x.amt, tag: x.tag }));
    s.svc = {};
    for (const [k] of this.e.SVC_UI as [string][]) s.svc[k] = !!s["svc_" + k];
    s.type = this.e.deriveType(s.svc); this.f.type = s.type;
    s.thirdParty = false;
    s.yeOnly = s.fees.some((x: Fee) => x.kind === "once" && this.e.feeVal(x.amt).k === "num" && !(x.tag === "catchup" && s.catchTBD))
      && !s.fees.some((x: Fee) => (x.kind === "month" || x.kind === "quarter") && this.e.feeVal(x.amt).k === "num");
    if (s.yeOnly) { s.billOnce = "split"; this.f.billOnce = "split"; }
    s.addT1 = false; s.t1Name = ""; s.mode = this.mode;
    return s;
  }

  // Studio refresh(): fee lines follow the ticked services (only when the services change).
  refresh() {
    const s = this.state();
    const svKey = this.svKey(s);
    if (this.feeType !== svKey) { this.feeType = svKey; this.e.syncFees(s); }
  }
  private svKey(s: any) { return JSON.stringify(s.svc) + s.payrollMode + "|" + s.pnl + "|" + s.catchTBD + "|" + this.e.trim(s.t1Owner) + "|" + s.catchFrom + s.catchTo; }

  // Reopen a saved letter exactly as it was: its fields and its fee lines, unchanged.
  load(f: Record<string, Val>, fees: Fee[], mode: "draft" | "final" = "draft") {
    Object.assign(this.f, f); this.e.__set("FEES", fees.map((x) => ({ ...x }))); this.mode = mode;
    this.feeType = this.svKey(this.state());
  }

  set(id: string, v: Val) { this.f[id] = v; this.refresh(); }
  setMode(m: "draft" | "final") { this.mode = m; this.refresh(); }
  // Studio: when the signer field loses focus and the salutation is blank, use the first name.
  signerBlur() { if (!String(this.f.salutation).trim() && String(this.f.signer).trim()) { this.f.salutation = String(this.f.signer).trim().split(" ")[0]; this.refresh(); } }
  setFee(i: number, field: "svc" | "detail" | "kind" | "amt", v: string) { const F = this.fees; F[i][field] = v; F[i].user = true; this.refresh(); }
  addFee(preset: number) { this.fees.push(this.e.feeRow(preset)); this.refresh(); }
  removeFee(i: number) { this.fees.splice(i, 1); this.refresh(); }

  // Studio applyClient()
  applyClient(c: StudioClientRow | null) {
    if (!c) { this.refresh(); return; }
    Object.assign(this.f, {
      company: c["Legal name"] || "", signer: c["Signing officer"] || "", signerTitle: c["Signer title"] || "Director", salutation: c["Salutation"] || "",
      addr1: c["Street address"] || "", addr2: c["Address line 2"] || "", city: c["City"] || "", postal: c["Postal code"] || "",
      province: ({ ON: "ON", AB: "AB", BC: "BC" } as Record<string, string>)[c["Province"] || ""] || "OTHER",
      basis: ({ "Cash basis": "cash", Custom: "custom" } as Record<string, string>)[c["Basis of accounting"] || ""] || "standard",
      basisCustom: c["Custom basis wording"] || "",
      thirdParty: !!this.e.trim(c["Third-party user"]), tpName: c["Third-party user"] || "",
      tpBasis: c["Third-party basis"] === "Agreed basis of accounting" ? "agreed" : "request",
    });
    const ye = this.e.lastYE(c["Year end (month-day)"], String(this.f.letterDate) || todayISO());
    if (ye) this.f.ye = ye;
    this.refresh();
  }

  // Studio applyPackage()
  applyPackage(r: any) {
    const S: string[] = this.e.pbServices(r), m = this.e.pbNum(r["Monthly fee"]), sw = this.e.pbNum(r["Software per month"]), y = this.e.pbNum(r["Year-end fee"]);
    for (const [k] of this.e.SVC_UI as [string][]) this.f["svc_" + k] = S.indexOf(k) >= 0;
    this.f.pnl = S.indexOf("cfo") >= 0;
    const ye = this.e.parseD?.(String(this.f.ye)) ?? (this.f.ye ? new Date(String(this.f.ye) + "T00:00:00") : null);
    if (S.indexOf("catchup") >= 0 && ye) {
      const e = new Date(ye), from = new Date(e); from.setFullYear(from.getFullYear() - 1); from.setDate(from.getDate() + 1);
      const iso = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
      this.f.catchFrom = iso(from); this.f.catchTo = iso(e);
    }
    this.e.__set("FEES", []); this.feeType = null; this.refresh();
    for (const fee of this.fees) {
      if (fee.tag === "main" && m != null) { fee.amt = String(m); fee.user = true; }
      if (fee.tag === "soft") { fee.amt = sw ? String(sw) : "Included"; fee.user = true; }
      if (fee.tag === "comp" && y != null && !m) { fee.amt = String(y); fee.svc = S.indexOf("catchup") >= 0 ? "Year-end bookkeeping, financial statements and T2" : "Year-end financial statements and T2"; fee.user = true; }
      if (fee.tag === "catchup" && y != null && !m) { fee.amt = "Included"; fee.user = true; }
    }
    if (y != null && m) this.fees.push({ svc: "Year-end financial statements and T2", kind: "year", detail: "", amt: String(y), user: true });
    this.refresh();
  }

  // Studio pToLetter(): an accepted proposal option fills the letter. "o" is the option in
  // Studio's packed form ({n, s, l}); "c" the prospect ({n, ct, sa, pr}) when there is no client record.
  fromProposal(o: { n: string; s: string[]; l: [string, string, string][] }, c: { n: string; ct: string; sa: string; pr: string } | null, client: StudioClientRow | null) {
    if (client) this.applyClient(client);
    else if (c) Object.assign(this.f, { company: c.n, signer: c.ct, salutation: c.sa, province: c.pr || "ON" });
    for (const [k] of this.e.SVC_UI as [string][]) this.f["svc_" + k] = o.s.indexOf(k) >= 0;
    this.f.pnl = o.s.indexOf("pnl") >= 0;
    this.refresh();
    this.e.__set("FEES", o.l.map((l) => ({ svc: l[0], detail: "", kind: ["month", "quarter", "year", "once"].indexOf(l[1]) >= 0 ? l[1] : "once", amt: l[2] })));
    const st = this.state(); this.feeType = JSON.stringify(st.svc) + st.payrollMode;
    this.refresh();
  }

  output() {
    const s = this.state();
    return { s, checks: this.e.checks(s), blocks: this.e.build(s), fileName: this.e.fileName(s) };
  }
}

/* ------------------------------------------------------------------ */
/* T1 letter (Studio: t1ViewHTML, buildT1View, t1State, t1Refresh)    */
/* ------------------------------------------------------------------ */

export class T1Letter {
  e: StudioEngine;
  f: Record<string, Val> = {};
  mode: "draft" | "final" = "draft";
  acks: Record<string, boolean> = { ab: false, bc: false };

  constructor(engine: StudioEngine, today = todayISO()) {
    this.e = engine;
    for (const k of ["letterDate", "taxYear", "addr1", "addr2", "city", "province", "postal", "salutation", "card", "corp"]) this.f[k] = "";
    this.f.reviewed = false; this.f.spouseBlank = false;
    const REL = this.e.T1_REL as string[];
    for (let i = 0; i < 4; i++) { this.f["name" + i] = ""; this.f["rel" + i] = REL[i === 0 ? 0 : i === 1 ? 1 : 2]; }
    const d = new Date(today + "T12:00:00");
    Object.assign(this.f, { letterDate: today, taxYear: String(d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1), province: "ON", card: "company" });
  }

  set(id: string, v: Val) { this.f[id] = v; }
  setMode(m: "draft" | "final") { this.mode = m; }
  name0Blur() { if (!String(this.f.salutation).trim() && String(this.f.name0).trim()) this.f.salutation = String(this.f.name0).trim().split(" ")[0]; }

  applyClient(c: StudioClientRow | null) {
    if (!c) return;
    Object.assign(this.f, {
      name0: c["Legal name"] || "", salutation: c["Salutation"] || "", addr1: c["Street address"] || "", addr2: c["Address line 2"] || "",
      city: c["City"] || "", postal: c["Postal code"] || "",
      province: ({ ON: "ON", AB: "AB", BC: "BC" } as Record<string, string>)[c["Province"] || ""] || "OTHER",
    });
  }

  // Studio t1State()
  state(): any {
    const s: any = { type: "t1", mode: this.mode };
    for (const k of ["letterDate", "taxYear", "addr1", "addr2", "city", "province", "postal", "salutation", "card", "corp", "feeBase", "feeRental", "feeSale", "feeT1135", "feeT2125", "feeHST"]) {
      s[k] = k in this.f ? this.f[k] : "";
    }
    // Studio has no inputs for the fee* fields (standalone letters are sent from TaxDome).
    for (const k of ["feeBase", "feeRental", "feeSale", "feeT1135", "feeT2125", "feeHST"]) s[k] = "";
    s.reviewed = !!this.f.reviewed; s.spouseBlank = !!this.f.spouseBlank;
    s.card = s.card || "company";
    s.people = [];
    for (let i = 0; i < 4; i++) { const n = this.e.trim(String(this.f["name" + i])); if (n) s.people.push({ name: n, rel: this.f["rel" + i] }); }
    if (s.spouseBlank && s.people.length) s.people.splice(1, 0, { name: "", rel: "Spouse or common-law partner", blank: true });
    s.company = this.e.t1Names(s); s.ye = (s.taxYear || "") + "-12-31"; s.signer = s.people.length ? s.people[0].name : ""; s.signerTitle = "Individual";
    return s;
  }

  output() {
    const s = this.state();
    if (s.card === "standalone") return { s, standalone: true, masterHtml: this.e.t1TdHtml(), masterText: this.e.t1TdText(), checks: [], blocks: [], fileName: "" };
    return { s, standalone: false, checks: this.e.t1Checks(s), blocks: this.e.buildT1(s), fileName: this.e.t1FileName(s) };
  }
}

/* ------------------------------------------------------------------ */
/* Proposal (Studio: pViewHTML, buildPropView, pState, pFormat)        */
/* ------------------------------------------------------------------ */

export class Proposal {
  e: StudioEngine;
  f: Record<string, string> = {};
  mode: "draft" | "final" = "draft";

  // live: the proposal builder in Quotes (front office batch, section 5, items 3 to 6). Without it,
  // the screen is Studio's, unchanged (the screen parity test checks that).
  live: boolean;

  constructor(engine: StudioEngine, today = todayISO(), opts: { live?: boolean } = {}) {
    this.e = engine;
    this.live = !!opts.live;
    Object.assign(this.f, { name: "", contact: "", salutation: "", province: "ON", segment: "Team or brokerage", date: today, valid: "30", h0: "", h1: "", h2: "" });
    const first = this.e.pNewOption(0); first.name = "Your package";
    this.e.__set("POPTS", [first]); this.e.__set("pRec", 0);
    // Studio sets the format from the client type when the screen opens (without reshaping options).
    // In Quotes every proposal opens as one option, with no warning (item 5).
    this.f.format = this.live ? "single" : this.f.segment === "Team or brokerage" ? "options" : "single";
    if (this.live) this.teamTicks();
  }

  // Item 6: what sells to a team is ticked: the monthly P&L report and the quarterly review.
  private teamTicks() {
    if (this.f.segment !== "Team or brokerage") return;
    for (const o of this.opts) { o.svc.pnl = true; o.svc.cfo = true; }
  }

  // Item 3: choosing a package fills its services and prices from the price book (the floor check
  // still runs). r: the price book row ({Services, Monthly fee, Software per month, Year-end fee}).
  applyOffer(i: number, r: Record<string, unknown> | undefined) {
    const o = this.opts[i];
    o.offer = r ? String(r["Offer"] ?? "") : "";
    if (!r) return;
    const S: string[] = this.e.pbServices(r), m = this.e.pbNum(r["Monthly fee"]), sw = this.e.pbNum(r["Software per month"]), y = this.e.pbNum(r["Year-end fee"]);
    for (const [k] of this.e.PSVC as [string, string][]) o.svc[k] = S.indexOf(k) >= 0 || (k === "pnl" && S.indexOf("cfo") >= 0);
    const lines: { svc: string; kind: string; amt: string }[] = [];
    if (m != null) lines.push({ svc: "Monthly accounting and compliance services", kind: "month", amt: String(m) });
    if (sw != null) lines.push({ svc: "Software subscription (QuickBooks Online and Dext)", kind: "month", amt: sw ? String(sw) : "Included" });
    if (y != null) lines.push({ svc: "Year-end financial statements and T2", kind: "year", amt: String(y) });
    if (lines.length) o.lines = lines;
  }

  get opts(): any[] { return this.e.__get("POPTS"); }
  get rec(): number { return this.e.__get("pRec"); }

  set(id: string, v: string) {
    this.f[id] = v;
    if (id === "segment" && this.live) { this.teamTicks(); return; }
    if (id === "segment") { this.f.format = v !== "Team or brokerage" ? "single" : "options"; this.formatChanged(); }
    if (id === "format") this.formatChanged();
  }
  setMode(m: "draft" | "final") { this.mode = m; }
  contactBlur() { if (!this.f.salutation.trim() && this.f.contact.trim()) this.f.salutation = this.f.contact.trim().split(" ")[0]; }

  // Studio pFormat()
  formatChanged() {
    const single = this.f.format === "single";
    let P = this.opts;
    if (single && P.length > 1) { P = P.slice(0, 1); this.e.__set("POPTS", P); }
    if (!single && P.length < 2) {
      const c = JSON.parse(JSON.stringify(P[0])); c.name = "Option B"; c.offer = "";
      if (P[0].name === "Option A" || !P[0].name) P[0].name = "Option A";
      P.push(c);
    }
    if (single && /^Option [A-C]$/.test(P[0].name)) P[0].name = "Your package";
    this.e.__set("pRec", 0);
  }

  setRecommended(i: number) { this.e.__set("pRec", i); }
  setOption(i: number, field: string, v: string) { this.opts[i][field] = v; }
  setService(i: number, key: string, on: boolean) { this.opts[i].svc[key] = on; }
  setLine(i: number, j: number, field: string, v: string) { this.opts[i].lines[j][field] = v; }
  addLine(i: number) { this.opts[i].lines.push({ svc: "", kind: "month", amt: "" }); }
  removeLine(i: number, j: number) { this.opts[i].lines.splice(j, 1); }
  removeOption(i: number) { this.opts.splice(i, 1); if (this.rec >= this.opts.length) this.e.__set("pRec", 0); }
  addOption() { const P = this.opts; const c = JSON.parse(JSON.stringify(P[P.length - 1])); c.name = "Option " + "ABC"[P.length]; c.offer = ""; P.push(c); }

  applyClient(c: StudioClientRow | null) {
    if (!c) return;
    this.f.name = c["Legal name"] || ""; this.f.contact = c["Signing officer"] || ""; this.f.salutation = c["Salutation"] || "";
    this.f.province = ({ ON: "ON", AB: "AB", BC: "BC" } as Record<string, string>)[c["Province"] || ""] || "OTHER";
  }

  // Studio pState()
  state(): any {
    const g = (k: string) => this.f[k] ?? "";
    return {
      single: (g("format") || "single") === "single", mode: this.mode, name: this.e.trim(g("name")), contact: this.e.trim(g("contact")),
      salutation: this.e.trim(g("salutation")), province: g("province"), segment: g("segment"), date: g("date"), valid: g("valid"),
      heard: [g("h0"), g("h1"), g("h2")].map((x) => this.e.trim(x)).filter((x: string) => x), opts: this.opts, rec: this.rec,
    };
  }

  output() {
    const s = this.state();
    const name = "Proposal_" + s.name.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + s.date + (s.mode === "final" ? "" : "_DRAFT") + ".pdf";
    return { s, checks: this.e.pChecks(s), blocks: this.e.pBuild(s), fileName: name };
  }
}

// A client record in the shape Studio's functions expect (Notion column names).
export type StudioClientRow = Record<string, string | undefined> & { url?: string };
