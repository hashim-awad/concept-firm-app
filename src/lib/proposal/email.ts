// The proposal email (front office batch, section 3): the private signing link, as editable pieces
// on the Templates page ("Proposal email"). Pure: the staff page and the Templates sample use it.
import { PROPOSAL_EMAIL as E, type QPiece } from "../t1-quote/wording.ts";
import { emailButton, longDate, type Sender } from "../t1-quote/render.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fill = (t: string, f: (string | number)[]) => t.replace(/\{(\d+)\}/g, (m, i) => (f[Number(i) - 1] !== undefined ? String(f[Number(i) - 1]) : m));

export type ProposalEmailData = { first: string; validUntil: string; options: number };

export function renderProposalEmail(texts: Record<string, string>, d: ProposalEmailData, sender: Sender, link: string, o: { mark?: boolean } = {}) {
  const plain = (p: QPiece, ...f: (string | number)[]) => fill(texts[p.key] ?? p.text, f);
  const t = (p: QPiece, ...f: (string | number)[]) => {
    const h = fill(esc(texts[p.key] ?? p.text), f.map((x) => esc(String(x))));
    return o.mark ? `<span class="wmark" data-w="${p.key}">${h}</span>` : h;
  };
  const p = (s: string) => `<p style="margin: 0 0 12px;">${s}</p>`;
  const valid = longDate(d.validUntil);
  const how = d.options > 1 ? E.howOptions : E.howOne;
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1f1e;">${p(t(E.hi, d.first))}${p(t(E.thanks))}${p(t(how))}<div style="margin: 16px 0;">${emailButton(link, t(E.button))}</div>${p(t(E.valid, valid))}${p(t(E.questions))}<p style="margin: 16px 0 0;">${esc(sender.name)}<br>${t(E.firm)}<br>${esc([sender.phone, sender.email].filter(Boolean).join(" | "))}</p></div>`;
  const text = [plain(E.hi, d.first), "", plain(E.thanks), "", plain(how), "", `${plain(E.button)}: ${link}`, "", plain(E.valid, valid), "", plain(E.questions), "",
    sender.name, plain(E.firm), [sender.phone, sender.email].filter(Boolean).join(" | ")].join("\n");
  return { subject: plain(E.subject), subjectHtml: t(E.subject), html, text };
}
