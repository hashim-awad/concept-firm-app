// Lead alert emails to staff (Phase 2 batch, section 3). They show the lead type, household, province
// and quote total (or "Call needed"), with a button to open the lead. No client name or contact
// details, so the email holds as little client information as possible.
import { provinceName } from "./provinces.ts";

export type AlertLead = { id: string; route: string; province: string; status: string; answers: Record<string, unknown>; quote_cents?: number | null; source?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Household from the screening answers (filing_type); quote total from the quote the server worked out.
export function leadFacts(l: AlertLead): [string, string][] {
  const h = l.answers.household;
  const filing = typeof h === "object" && h !== null ? (h as Record<string, unknown>).filing_type : h;
  const household = filing === "couple" ? "Couple" : filing === "single" ? "Single" : l.route === "company" ? "Does not apply" : "Not asked yet";
  const total = (l.quote_cents ?? 0) / 100;
  const quote = l.status === "call_needed" ? "Call needed"
    : l.status === "out_of_scope" ? "Out of scope, no quote"
    : total > 0 ? `$${total.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} plus GST/HST`
    : "Not worked out yet";
  return [["Lead type", l.route === "company" ? "Company" : "Personal tax (T1)"], ["Household", household], ["Province", provinceName(l.province)], ["Quote", quote]];
}

export function buildLeadAlert(kind: "new" | "reminder", l: AlertLead, siteUrl: string, minutes = 45) {
  const facts = leadFacts(l);
  const what = `${facts[0][1]}, ${facts[2][1]}`;
  const subject = kind === "new" ? `New lead: ${what}` : `Reminder: quote not sent after ${minutes} business minutes (${what})`;
  const intro = kind === "new"
    ? (/^phone/i.test(l.source ?? "") ? "A lead taken by phone was sent to you." : "A new lead came in from the start page.")
    : `This lead has waited ${minutes} business minutes and the quote is not marked sent yet.`;
  const rows = facts.map(([k, v]) => `<tr><td style="padding:4px 16px 4px 0;color:#5f6663">${esc(k)}</td><td style="padding:4px 0;font-weight:bold">${esc(v)}</td></tr>`).join("");
  const href = `${siteUrl}/leads/${encodeURIComponent(l.id)}`;
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1c1f1e;line-height:1.5">
<div style="max-width:520px;margin:0 auto;padding:24px">
<p style="margin:0 0 20px"><img src="${esc(siteUrl)}/brand/studio-logo-navy.png" alt="Concept Studio" width="150" height="59" style="display:block;border:0"></p>
<p style="margin:0 0 12px">${esc(intro)}</p>
<table style="border-collapse:collapse;margin:0 0 16px">${rows}</table>
<p style="margin:20px 0"><a href="${esc(href)}" style="background:#1A3C7C;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open the lead</a></p>
<p style="margin:24px 0 0;color:#5f6663;font-size:13px">Sent to everyone with the Pricing permission in Concept Studio.</p>
</div></body></html>`;
  return { subject, html };
}
