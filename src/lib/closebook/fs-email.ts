// Step 10, the client email after the T2 is filed (round 12, Hashim, Nov 14, 2026): Appendix C's
// render_email.py, line for line: the same blocks, wording and rules. Never rewrite the wording. Where
// Appendix C read the T2 PDF, the figures come from step 10's fields, typed from ProFile. Signed
// Hashim Awad, CPA (Hashim's instruction for Closebook). Pure: no database, no clock (today is passed in).

export type InstalmentRow = { date: string; amount: number };   // ProFile's instalment schedule: due date, amount required
export type EmailInput = {
  name: string; yearEnd: string; days: number; officerFirst: string; bn9: string; today: string;
  // A. Corporate tax: balance owing (+) or refund (-), due date, filed date, the Notice of Assessment.
  tax: { balance: number; due: string; filed: string; noaIssued: boolean; noaPenalty: number; noaInterest: number };
  // B. GST/HST, only when a return was filed with this package.
  hst: { balance: number; due: string | null; rt: string } | null;
  // C. Instalments: federal and provincial tax for the year filed and the year before, the schedule, the threshold.
  inst: { fedTax: number; provTax: number; fedTaxPrior: number; provTaxPrior: number; threshold: number; schedule: InstalmentRow[] };
  fs?: boolean; minuteLetter: boolean; draft: boolean;
};
export type Email = { subject: string; text: string; html: string; review: string[] };

const D = (s: string) => new Date(`${s}T12:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fd = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
const monthName = (d: Date) => MONTHS[d.getUTCMonth()];
export function money(v: number): string {
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? `$${r.toLocaleString("en-US")}` : `$${r.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
// Appendix C's add_months: the same day n months on, or the month end when the day is the 28th or later.
export function addMonths(d: Date, n: number): Date {
  const t = d.getUTCMonth() + n, y = d.getUTCFullYear() + Math.floor(t / 12), mo = ((t % 12) + 12) % 12;
  return new Date(Date.UTC(y, mo, d.getUTCDate() < 28 ? Math.min(d.getUTCDate(), lastDay(y, mo)) : lastDay(y, mo), 12));
}
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

type Section = [title: string, lines: string[], kind: "bul" | "para" | "dates"];

export function buildEmail(E: EmailInput): Email {
  const today = D(E.today), ye = D(E.yearEnd), yr = String(ye.getUTCFullYear());
  const first = E.officerFirst;
  const bn = E.bn9, rc = `${bn} RC 0001`;
  const REVIEW: string[] = [];
  const S: Section[] = [];
  let payAny = false;

  // ---- A corporate tax
  const bal = E.tax.balance;
  const balDue = D(E.tax.due);
  const fileDue = addMonths(ye, 6);
  const filed = E.tax.filed ? D(E.tax.filed) : today;
  const late = filed > fileDue;
  const pen = E.tax.noaPenalty || 0, intr = E.tax.noaInterest || 0, noa = E.tax.noaIssued;
  const A: string[] = [];
  if (bal > 2) {
    const was = balDue < today ? "was" : "is";
    A.push(`The T2 return shows a balance owing of ${money(bal)}. It ${was} due to the CRA by ${fd(balDue)}.`);
    if (late) A.push(`The return itself was due ${fd(fileDue)} and was filed late.` + (noa && pen ? ` The CRA's Notice of Assessment adds ${money(pen)} for late filing and ${money(intr)} interest to date.`
      : noa && intr ? ` The CRA's Notice of Assessment adds ${money(intr)} interest to date.` : " The CRA will charge a late-filing penalty and interest on its Notice of Assessment."));
    else if (noa && intr) A.push(`The CRA's Notice of Assessment adds ${money(intr)} interest to date.`);
    const tot = bal + (noa ? pen : 0) + (noa ? intr : 0);
    if (balDue < today) A.push(`Please pay ${money(tot)} now. Interest grows every day until it is paid. Pay to business number ${rc}.`);
    else A.push(`Please pay ${money(tot)} by ${fd(balDue)}. The CRA charges interest on any amount not paid by the due date. Pay to business number ${rc}.`);
    if (!noa) A.push("The amount may change slightly once the CRA sends its Notice of Assessment. Please forward it to us when it arrives.");
    payAny = true;
  } else if (bal < -2) {
    A.push(`The T2 return shows a refund of ${money(-bal)}. The CRA will send it after it processes the return. No action is needed.`);
    if (!noa) A.push("Please forward the Notice of Assessment to us when it arrives.");
  } else {
    A.push("The T2 return shows no balance owing and no refund. No action is needed.");
    if (!noa) A.push("Please forward the Notice of Assessment to us when it arrives.");
  }
  S.push([`${yr} corporate tax`, A, "bul"]);

  // ---- B GST/HST
  const H = E.hst;
  if (H) {
    const rt = `${bn} ${H.rt || "RT 0001"}`, B: string[] = [];
    const hb = H.balance, hdue = H.due ? D(H.due) : null;
    if (hb > 0) {
      B.push(`The GST/HST return shows a balance owing of ${money(hb)}.` + (hdue ? ` It ${hdue < today ? "was" : "is"} due to the CRA by ${fd(hdue)}.` : ""));
      B.push(`Please pay ${money(hb)} ${hdue && hdue < today ? "now" : hdue ? "by " + fd(hdue) : "as soon as possible"}. Pay to business number ${rt}. This is a different account from A, so make it a separate payment.`);
      if (hdue && hdue < today) B.push("The CRA may add a late penalty and interest to this amount too.");
      payAny = true;
    } else if (hb < 0) B.push(`The GST/HST return shows a refund of ${money(-hb)}. The CRA will send it after it processes the return. No action is needed.`);
    else B.push("The GST/HST return shows no balance owing and no refund. No action is needed.");
    S.push([`${yr} GST/HST`, B, "bul"]);
  }

  // ---- C instalments. ProFile's schedule gives each instalment required; a date already passed is
  // caught up in the first payment still to come (Appendix C's "payable").
  const sched = [...E.inst.schedule].filter((x) => x.date && x.amount > 0).sort((a, b) => a.date.localeCompare(b.date));
  const passed = sched.filter((x) => D(x.date) < today).reduce((n, x) => n + x.amount, 0);
  const all = sched.map((x, i) => ({ date: x.date, required: x.amount, payable: D(x.date) < today ? 0 : x.amount + (sched.findIndex((y) => D(y.date) >= today) === i ? passed : 0) }));
  const inst = all.filter((x) => x.payable > 0 && D(x.date) >= today);
  if (inst.length) {
    const T = E.inst.threshold;
    const nxt = addMonths(ye, 12);
    const req = all.filter((x) => (x.required || 0) > 0);
    const pays = inst.map((x) => x.payable);
    const regular = [...new Set(pays)].reduce((a, b) => (pays.filter((v) => v === b).length > pays.filter((v) => v === a).length ? b : a));
    const gaps = inst.slice(1).map((b, i) => (D(b.date).getTime() - D(inst[i].date).getTime()) / 86400000);
    const quarterly = gaps.length > 0 && Math.min(...gaps) > 60;
    const per = quarterly ? "every three months" : "each month", unit = quarterly ? "quarter" : "month";
    const C = [`The CRA wants the corporation to pay its tax a little ${per}, not all at once after the year ends. These payments are called instalments.`];
    const months = Math.round(E.days / 30.44);
    const fed = E.inst.fedTax || 0, prov = E.inst.provTax || 0;
    const ann = (v: number) => (v * 365) / E.days;
    if (E.days < 358 && (ann(fed) > T || ann(prov) > T)) {
      C.push(`Last year, the corporation was open for only ${months} months. Stretched to a full year, its tax comes to more than ${money(T)}. When that happens, the CRA asks for these payments the next year.`);
    } else if (fed > T || prov > T) {
      C.push(`Last year, the corporation's tax was more than ${money(T)}. When that happens, the CRA asks for these payments the next year.`);
    } else {
      C.push(`The corporation's tax for this year is expected to be more than ${money(T)}. When that happens, the CRA asks for these payments during the year.`);
      REVIEW.push("Instalments are based on a current-year estimate, not last year. Check the wording in section C.");
      if ((E.inst.fedTaxPrior || 0) > T || (E.inst.provTaxPrior || 0) > T) REVIEW.push(`The tax for the year before was more than ${money(T)}. Check that section C explains why instalments apply.`);
    }
    C.push(`These payments are not extra tax. They count toward the corporation's tax for the year ending ${fd(nxt)}. If you skip them, the CRA charges interest.`);
    const f = inst[0];
    if (f.payable > regular && req.length) {
      const missed = req.filter((x) => D(x.date) <= D(f.date));
      const n = missed.length;
      C.push(`The payments are ${money(regular)} a ${unit} starting in ${monthName(D(req[0].date))}. ${monthName(D(req[0].date))} to ${monthName(D(f.date))} have passed, so the first payment catches up ${n} ${unit}s: ${n} x ${money(regular)} = ${money(f.payable)}. The CRA may still charge a small amount of interest on those late ${unit}s.`);
      if (n * regular !== f.payable) REVIEW.push(`Catch-up math check: ${n} x ${money(regular)} != ${money(f.payable)}. Fix section C.`);
    }
    S.push([`Tax instalments for the year ending ${fd(nxt)}`, C, "para"]);
    S.push(["Instalment due dates", [...inst.map((x) => `${fd(D(x.date))}: ${money(x.payable)}`), 'Pay instalments to the same RC 0001 account and choose "instalment" as the payment type.'], "dates"]);
    payAny = true;
  }
  if (payAny) S.push(["How to pay", ["Pay through your online banking or through CRA My Payment on the CRA website. Each amount above is its own payment."], "para"]);
  const docs = E.fs === false ? [] : ["compiled financial statements"];
  docs.push("full T2 return", "signed T183CORP", "CRA e-file confirmation");
  if (H) docs.push("GST/HST return");
  if (E.minuteLetter) docs.push("minute book letter (please forward it to your lawyer)");
  const dl = `${docs.slice(0, -1).join(", ")} and ${docs[docs.length - 1]}`;
  S.push(["Your documents", [`Your ${dl} are in your TaxDome portal. The CRA requires you to keep them for 6 years.`], "para"]);

  const subject = `${E.name}: FYE ${fd(ye)} tax return results`;
  const opening = `We filed the corporation's T2 return${H ? " and its GST/HST return" : ""} with the CRA.`;
  const sig = ["Warm regards,", "", "Hashim Awad, CPA"];
  const L = "ABCDEFGH";
  let i = 0;
  const out: [string | null, string, string[], Section[2]][] = S.map(([ti, ls, k]) => (k === "dates" ? [null, ti, ls, k] : [L[i++], ti, ls, k]));

  // Text: the body as it is pasted, under its subject.
  const T: string[] = [...(E.draft ? ["DRAFT FOR REVIEW", ""] : []), `Dear ${first},`, "", opening, ""];
  for (const [lt, ti, ls, k] of out) {
    T.push((lt ? `${lt}. ` : "") + ti + (!lt ? ":" : ""));
    ls.forEach((l, j) => {
      if (k === "para" && j > 0) T.push("");
      T.push((k === "bul" || k === "dates") && !l.startsWith("Pay instalments") ? `- ${l}` : l);
    });
    T.push("");
  }
  T.push(...sig);
  // HTML, to paste into Outlook.
  const Hh = ['<div style="font-family:Aptos,Calibri,Arial,sans-serif;font-size:11pt">',
    ...(E.draft ? ['<p><b style="color:#C00000">DRAFT FOR REVIEW</b></p>'] : []), `<p>Dear ${esc(first)},</p>`, `<p>${esc(opening)}</p>`];
  for (const [lt, ti, ls, k] of out) {
    Hh.push(`<p style="margin-bottom:4px"><b style="color:#1A5CA8">${lt ? `${lt}. ` : ""}${esc(ti)}</b></p>`);
    if (k === "bul" || k === "dates") {
      const items = ls.filter((l) => !l.startsWith("Pay instalments")), tail = ls.filter((l) => l.startsWith("Pay instalments"));
      Hh.push(`<ul style="margin-top:0">${items.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
      for (const l of tail) Hh.push(`<p><b>${esc(l)}</b></p>`);
    } else Hh.push(...ls.map((l) => `<p>${esc(l)}</p>`));
  }
  Hh.push("<p>Warm regards,</p><p><b>Hashim Awad</b>, CPA</p></div>");
  return { subject: (E.draft ? "DRAFT FOR REVIEW: " : "") + subject, text: T.join("\n"), html: Hh.join("\n"), review: REVIEW };
}
export const _test = { iso };
