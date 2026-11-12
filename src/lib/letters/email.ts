// The engagement letter email (front office batch, section 7): the private signing link(s) for a New
// letter, as editable pieces on the Templates page ("Engagement letter email"). Pure.
import { LETTER_EMAIL as E, type QPiece } from "../t1-quote/wording.ts";
import { emailButton, longDate, type Sender } from "../t1-quote/render.ts";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const fill = (t: string, f: (string | number)[]) => t.replace(/\{(\d+)\}/g, (m, i) => (f[Number(i) - 1] !== undefined ? String(f[Number(i) - 1]) : m));

export function renderLetterEmail(texts: Record<string, string>, d: { names: string[]; validUntil: string }, sender: Sender, links: string[], o: { mark?: boolean } = {}) {
  const plain = (p: QPiece, ...f: (string | number)[]) => fill(texts[p.key] ?? p.text, f);
  const t = (p: QPiece, ...f: (string | number)[]) => { const h = fill(esc(texts[p.key] ?? p.text), f.map((x) => esc(String(x)))); return o.mark ? `<span class="wmark" data-w="${p.key}">${h}</span>` : h; };
  const p = (s: string) => `<p style="margin: 0 0 12px;">${s}</p>`;
  const two = d.names.length > 1;
  const who = d.names.join(" and ");
  const valid = longDate(d.validUntil);
  const buttons = two ? d.names.map((n, i) => emailButton(links[i] ?? "#", t(E.buttonFor, n))).join("") : emailButton(links[0] ?? "#", t(E.button));
  const html = `<div style="font-family: Arial, Helvetica, sans-serif; font-size: 15px; line-height: 1.5; color: #1c1f1e;">${p(t(E.hi, who))}${p(t(E.ready))}${two ? p(t(E.couple)) : ""}<div style="margin: 16px 0;">${buttons}</div>${p(t(E.valid, valid))}${p(t(E.questions))}<p style="margin: 16px 0 0;">${esc(sender.name)}<br>${t(E.firm)}<br>${esc([sender.phone, sender.email].filter(Boolean).join(" | "))}</p></div>`;
  const text = [plain(E.hi, who), "", plain(E.ready), ...(two ? ["", plain(E.couple)] : []), "",
    ...(two ? d.names.map((n, i) => `${plain(E.buttonFor, n)}: ${links[i] ?? ""}`) : [`${plain(E.button)}: ${links[0] ?? ""}`]), "",
    plain(E.valid, valid), "", plain(E.questions), "", sender.name, plain(E.firm), [sender.phone, sender.email].filter(Boolean).join(" | ")].join("\n");
  return { subject: plain(E.subject), subjectHtml: t(E.subject), html, text };
}
