// Screen rules Studio applied around its engine: the extra checks about the client record,
// when Final is allowed, and the short summary above the checks list. Each function mirrors
// the named Studio function (refresh, t1Refresh, pRefresh, collapseChecks, clientDiff).
// Only wording that names Studio's own buttons differs: "Save client to Concept Studio" is
// "Save client" here. The screen parity test applies exactly that one change.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { StudioEngine } from "./engine.generated";
import type { StudioClientRow } from "./controllers";

export type Check = { lvl: "err" | "warn" | "ok"; msg: string; key?: string };

export type ScreenContext = {
  client: StudioClientRow | null; // selected client record, if any
  loaded: boolean;                // client records are available (always true in the app)
  isOwner: boolean;
  acks: Record<string, boolean>;
};

export type ScreenResult = {
  checks: Check[];
  errs: number;
  needAck: string[];   // check keys that need the registration confirmation box
  ok: boolean;         // the Download button is enabled
  message: string;     // why it is disabled, in Studio's words
  showSaveClient: boolean;
};

const verified = (c: StudioClientRow | null) => !!c && c["Name verified"] === "__YES__";

// Studio clientDiff(): fields on the letter that differ from the client record.
export function clientDiff(e: StudioEngine, s: any, c: StudioClientRow | null): string[] {
  if (!c) return [];
  const pairs: [string, string][] = [["company", "Legal name"], ["signer", "Signing officer"], ["signerTitle", "Signer title"], ["salutation", "Salutation"], ["addr1", "Street address"], ["addr2", "Address line 2"], ["city", "City"], ["postal", "Postal code"]];
  return pairs.filter((p) => e.trim(s[p[0]]) !== e.trim(c[p[1]])).map((p) => p[1]);
}

function finish(C: Check[], s: any, ctx: ScreenContext, nameBlock: boolean, finalMsgName: string, okLabel: string): ScreenResult {
  const errs = C.filter((x) => x.lvl === "err");
  const needAck = C.filter((x) => x.key && !ctx.acks[x.key]).map((x) => x.key as string);
  const canFinal = !errs.length && !needAck.length && !!s.reviewed && ctx.isOwner && !nameBlock;
  const ok = s.mode === "final" ? canFinal : !errs.length;
  let message = "";
  if (!ok) {
    if (errs.length) message = "Fix the items listed first.";
    else if (s.mode === "final") {
      if (!ctx.isOwner) message = "Only Hashim can issue a Final letter.";
      else if (nameBlock) message = finalMsgName;
      else message = "Final needs the review box and any registration confirmations.";
    }
  }
  const list: Check[] = errs.length ? C : [{ lvl: "ok", msg: okLabel }, ...C];
  return { checks: list, errs: errs.length, needAck, ok, message, showSaveClient: ctx.loaded && !errs.length && s.mode === "draft" && !ctx.client };
}

// Studio refresh() for the Corporate Letter.
export function corporateScreen(e: StudioEngine, s: any, ctx: ScreenContext): ScreenResult {
  const C: Check[] = e.checks(s).slice();
  const c = ctx.client;
  const diff = clientDiff(e, s, c);
  if (c && diff.length) C.push({ lvl: "warn", msg: "This letter differs from the client record (" + diff.join(", ") + "). Update the record under Clients, Edit, so next year’s letter is right." });
  const nameBlock = s.mode === "final" && !verified(c) && ctx.loaded;
  if (ctx.loaded && !c) C.push({ lvl: "warn", msg: "No client record selected. A Final letter needs a client record with a verified legal name. Use Save client on a draft, then confirm the legal name under Clients, Edit." });
  else if (c && !verified(c)) C.push({ lvl: "warn", msg: "Legal name not yet verified against the registry. Go to Clients, click Edit and confirm it. Required for Final." });
  return finish(C, s, ctx, nameBlock, "Final needs a client record with a verified legal name.", "No blanks or placeholders. Letter is complete.");
}

// Studio t1Refresh() (company-client letters; standalone letters are sent from TaxDome).
export function t1Screen(e: StudioEngine, s: any, ctx: ScreenContext): ScreenResult {
  const C: Check[] = e.t1Checks(s).slice();
  const c = ctx.client;
  if (ctx.loaded && !c) C.push({ lvl: "warn", msg: "No client record selected. A Final letter needs a client record with a verified name. Save the client from a draft, then confirm the name under Clients, Edit." });
  else if (c && !verified(c)) C.push({ lvl: "warn", msg: "Name not yet verified (check against government ID or CRA records). Go to Clients, Edit. Required for Final." });
  const nameBlock = s.mode === "final" && ctx.loaded && !verified(c);
  return finish(C, s, ctx, nameBlock, "Final needs a client record with a verified name.", "No blanks or placeholders. Letter is complete.");
}

// Studio pRefresh(): no client-record checks; Final needs an owner.
export function proposalScreen(e: StudioEngine, s: any, ctx: ScreenContext): ScreenResult {
  const C: Check[] = e.pChecks(s).slice();
  const errs = C.filter((x) => x.lvl === "err").length;
  const ok = !errs && (s.mode !== "final" || ctx.isOwner);
  const message = errs ? "Fix the items listed first." : !ok ? "Only Hashim can issue a Final proposal." : "";
  return { checks: errs ? C : [{ lvl: "ok", msg: "Proposal is complete." }, ...C], errs, needAck: [], ok, message, showSaveClient: false };
}

// Studio collapseChecks(): the one-line summary above the list.
export function checksSummary(list: Check[]): { text: string; tone: "err" | "warn" | "ok" } {
  const e = list.filter((x) => x.lvl === "err").length, w = list.filter((x) => x.lvl === "warn").length;
  const text = e ? e + " item" + (e > 1 ? "s" : "") + " to fix" + (w ? " · " + w + " to check" : "") : w ? "Ready · " + w + " to check" : "Ready to download";
  return { text, tone: e ? "err" : w ? "warn" : "ok" };
}

// Studio prefixes each item with "Fix: " or "Check: ".
export const checkLabel = (x: Check) => (x.lvl === "ok" ? x.msg : (x.lvl === "err" ? "Fix: " : "Check: ") + x.msg);

/* ---------- App records in the shapes Studio's functions read ---------- */

export type ClientRecord = {
  id: string; kind: "individual" | "corporation"; legal_name: string; entity_type: string; signing_officer: string; signer_title: string;
  salutation: string; street_address: string; address_line2: string; city: string; postal_code: string; province: string;
  year_end_md: string; basis: string; custom_basis_wording: string; third_party_user: string; third_party_basis: string; name_verified: boolean;
};

export function toStudioClient(c: ClientRecord): StudioClientRow {
  return {
    url: c.id,
    "Legal name": c.legal_name, "Entity type": c.kind === "individual" ? "Individual" : c.entity_type,
    "Signing officer": c.signing_officer, "Signer title": c.signer_title, Salutation: c.salutation,
    "Street address": c.street_address, "Address line 2": c.address_line2, City: c.city, "Postal code": c.postal_code,
    Province: c.province === "OTHER" ? "Other" : c.province, "Year end (month-day)": c.year_end_md,
    "Basis of accounting": ({ cash: "Cash basis", custom: "Custom", standard: "Concept standard" } as Record<string, string>)[c.basis] ?? "Concept standard",
    "Custom basis wording": c.custom_basis_wording, "Third-party user": c.third_party_user, "Third-party basis": c.third_party_basis,
    "Name verified": c.name_verified ? "__YES__" : "__NO__",
  };
}

export type OfferRecord = {
  offer: string; segment: string; is_package: boolean; services: string[]; monthly_fee: number | null; software_per_month: number | null;
  year_end_fee: number | null; annual_floor: number | null; monthly_reference: number | null; allows_payment_admin: boolean;
  t1_group: string | null; unit: string; unit_price: number | null; notes: string; sort_order: number;
};

const num = (v: number | string | null) => (v === null || v === undefined ? "" : Number(v));

// Price book rows in Studio's Price Floors shape.
export function toStudioFloor(o: OfferRecord): Record<string, unknown> {
  return {
    url: o.offer, Offer: o.offer, Segment: o.segment, Package: o.is_package ? "__YES__" : "__NO__", Services: JSON.stringify(o.services ?? []),
    "Monthly fee": num(o.monthly_fee), "Software per month": num(o.software_per_month), "Year-end fee": num(o.year_end_fee),
    "Annual floor": num(o.annual_floor), "Monthly reference": num(o.monthly_reference), "Payment admin allowed": o.allows_payment_admin ? "__YES__" : "__NO__",
    "T1 group": o.t1_group ?? "", Unit: o.unit, Price: num(o.unit_price), Notes: o.notes, Order: Number(o.sort_order),
  };
}
