// Dummy bank and card statements for the round 20 "Bank statement PDF to CSV" tests (Hashim, Nov 15, 2026).
// Run: node tests/fixtures/statements/make.mjs
// Writes every PDF/JPG in this folder, the ReadResult JSON a perfect reader would return (<name>.json, shapes in
// src/lib/statements/types.ts), and manifest.json (sha256 of the file bytes -> result) for the fixture reader.
// All names are dummies. All money is integer cents. The output is deterministic: fixed dates, fixed PDF
// creation dates, a seeded random generator, so the hashes stay the same when this is run again on the same
// machine. (The two Playwright images, scanned.pdf and scanned-photo.jpg, can differ on another machine because
// Chromium's font rendering can differ.)
// After writing, each PDF is opened with pdf.js and checked: page count, and every line's description is on
// the page the JSON says.

import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const PdfPrinter = require("pdfmake");
const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(DIR, "..", "..", "..");

// ---------- Money, dates, random
const fmt = (c) => {
  const neg = c < 0;
  const a = Math.abs(c);
  const d = String(Math.floor(a / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (neg ? "-" : "") + d + "." + String(a % 100).padStart(2, "0");
};
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parts = (s) => s.split("-").map(Number);
const longDate = (s) => { const [y, m, d] = parts(s); return `${MONTH[m - 1]} ${d}, ${y}`; };
const shortDate = (s) => { const [y, m, d] = parts(s); return `${MON[m - 1]} ${d}, ${y}`; };
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const utc = (s, h = 6) => { const [y, m, d] = parts(s); return new Date(Date.UTC(y, m - 1, d, h, 0, 0)); };
const nextDay = (s) => { const t = utc(s, 12); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cents = (rand, lo, hi) => Math.round(lo * 100 + rand() * (hi - lo) * 100);

// ---------- Dummy banks and clients
const NORTH = {
  bank: "Northern Dummy Bank", initials: "NDB", color: "#14386b", light: "#e9eff8", rule: "#9fb3cf",
  address: ["Northern Dummy Bank", "PO Box 4100, Station A", "Toronto ON M5W 0A1"],
  phone: "1-800-555-0100", web: "northerndummybank.example",
  colOut: "Cheques & debits", colIn: "Deposits & credits",
  date: (s) => { const [, m, d] = parts(s); return `${MON[m - 1]} ${String(d).padStart(2, "0")}`; },
};
const LAKE = {
  bank: "Lakeshore Dummy Credit Union", initials: "LDCU", color: "#1d5c47", light: "#e8f3ee", rule: "#a6c7b9",
  address: ["Lakeshore Dummy Credit Union", "55 Dummy Lakeshore Road", "Burlington ON L7S 0A4"],
  phone: "1-888-555-0177", web: "lakeshoredummycu.example",
  colOut: "Withdrawals", colIn: "Deposits",
  date: (s) => { const [, m, d] = parts(s); return `${String(d).padStart(2, "0")} ${MON[m - 1].toUpperCase()}`; },
};
const MAPLE = { name: "Maple Dummy Realty Inc.", lines: ["MAPLE DUMMY REALTY INC.", "200 DUMMY KING ST W UNIT 4", "WATERLOO ON N2J 0B2"] };
const BIRCH = { name: "Birch Dummy Realty Inc.", lines: ["BIRCH DUMMY REALTY INC.", "18 DUMMY BIRCH AVE SUITE 210", "HAMILTON ON L8P 0A3"] };

// ---------- Lines: { date, desc, amt (cents, positive), dir: "in" | "out" }
const L = (date, desc, amt, dir) => ({ date, desc, amt, dir });
const signed = (l) => (l.dir === "in" ? l.amt : -l.amt);

function totals(acc) {
  let inT = 0, inN = 0, outT = 0, outN = 0, bal = acc.opening;
  for (const l of acc.lines) {
    if (l.dir === "in") { inT += l.amt; inN++; } else { outT += l.amt; outN++; }
    bal += signed(l);
    l.bal = bal;
  }
  acc.closing = bal;
  acc.sum = { inTotal: inT, inCount: inN, outTotal: outT, outCount: outN };
  // Which lines print a balance: every line, or (RBC style) only the last line of each date.
  acc.lines.forEach((l, i) => {
    const nx = acc.lines[i + 1];
    l.showBal = acc.balance === "every" ? true : acc.balance === "none" ? false : !nx || nx.date !== l.date;
  });
  return acc;
}

// A month of realistic chequing activity for a real estate brokerage or PREC.
function monthLines(rand, y, m, n, opening, opt = {}) {
  const last = daysIn(y, m);
  let chq = opt.cheque ?? 1040;
  const outs = [
    ["POS PURCHASE DUMMY OFFICE SUPPLY", 18, 380],
    ["INTERAC PURCHASE MAPLE DUMMY FUEL", 40, 125],
    ["PRE-AUTHORIZED DEBIT DUMMY HYDRO", 90, 260],
    ["PRE-AUTHORIZED DEBIT DUMMY TELECOM", 80, 190],
    ["PRE-AUTHORIZED DEBIT DUMMY INSURANCE", 150, 420],
    ["CHEQUE", 250, 3200],
    ["E-TRANSFER SENT DUMMY ASSISTANT", 400, 1800],
    ["ONLINE BILL PAYMENT NORTHERN DUMMY VISA", 500, 3800],
    ["CRA PAYMENT GST/HST", 800, 4200],
    ["CRA PAYMENT PAYROLL REMITTANCE", 600, 2400],
    ["PAYROLL DUMMY PAYROLL SERVICE", 1500, 4500],
    ["POS PURCHASE DUMMY PRINT SHOP", 30, 600],
    ["PRE-AUTHORIZED DEBIT DUMMY MLS BOARD", 120, 480],
    ["INTERAC PURCHASE DUMMY COFFEE HOUSE", 6, 48],
    ["ONLINE TRANSFER TO SAVINGS 7730", 1000, 5000],
  ];
  const ins = [
    ["COMMISSION DEPOSIT DUMMY BROKERAGE", 2500, 18000],
    ["E-TRANSFER RECEIVED DUMMY CLIENT", 300, 5000],
    ["MOBILE CHEQUE DEPOSIT", 500, 6000],
    ["DEPOSIT DUMMY REALTY TRUST", 1000, 9000],
  ];
  const days = [];
  for (let i = 0; i < n - 1; i++) days.push(1 + Math.floor(rand() * (last - 1)));
  days.sort((a, b) => a - b);
  const lines = [];
  let bal = opening;
  for (const d of days) {
    let l;
    if (rand() < 0.27) {
      const [desc, lo, hi] = ins[Math.floor(rand() * ins.length)];
      l = L(iso(y, m, d), desc, cents(rand, lo, hi), "in");
    } else {
      const [desc, lo, hi] = outs[Math.floor(rand() * outs.length)];
      const amt = cents(rand, lo, hi);
      if (bal - amt < 150000) l = L(iso(y, m, d), "COMMISSION DEPOSIT DUMMY BROKERAGE", cents(rand, 4000, 15000), "in");
      else l = L(iso(y, m, d), desc === "CHEQUE" ? `CHEQUE #${chq++}` : desc, amt, "out");
    }
    bal += signed(l);
    lines.push(l);
  }
  lines.push(L(iso(y, m, last), "MONTHLY ACCOUNT FEE", 2995, "out"));
  return lines;
}

// ---------- pdfmake
const printer = new PdfPrinter({
  Helvetica: { normal: "Helvetica", bold: "Helvetica-Bold", italics: "Helvetica-Oblique", bolditalics: "Helvetica-BoldOblique" },
});
function pdfBuffer(doc) {
  return new Promise((resolve, reject) => {
    const pdf = printer.createPdfKitDocument(doc);
    const chunks = [];
    pdf.on("data", (c) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}
const grid = (rule) => ({
  hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length ? 0.8 : 0.3),
  vLineWidth: () => 0,
  hLineColor: (i) => (i <= 1 ? rule : "#d4d8de"),
  paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 2.4, paddingBottom: () => 2.4,
});
const boxLayout = (rule) => ({
  hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0.8 : 0),
  vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0.8 : 0),
  hLineColor: () => rule, vLineColor: () => rule,
  paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 2.2, paddingBottom: () => 2.2,
});
const logo = (t) => ({
  table: { widths: [t.initials.length > 3 ? 44 : 38], body: [[{ text: t.initials, color: "#ffffff", bold: true, fontSize: 12, alignment: "center", margin: [0, 7, 0, 7] }]] },
  layout: { hLineWidth: () => 0, vLineWidth: () => 0, fillColor: () => t.color, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 0, paddingBottom: () => 0 },
});
const footer = (t, note) => (cur, count) => ({
  margin: [40, 10, 40, 0],
  columns: [
    { width: "*", fontSize: 6.3, color: "#6b7280", text: [note, "\n", `${t.bank} is a dummy name. This statement was made for software testing and is not a real bank document.`] },
    { width: 80, fontSize: 8, alignment: "right", text: `Page ${cur} of ${count}`, margin: [0, 2, 0, 0] },
  ],
});
const masked = (acc) => acc.masked;

// ---------- Bank statement (one or more accounts)
// stmt: { theme, client, accounts: [acc], created: "YYYY-MM-DD", firstCap, nextCap, multi: boolean, encrypt? }
// acc: { name, last4, masked, kind: "bank", periodStart, periodEnd, opening, lines, balance: "every" | "eod" }
function bankStatement(stmt) {
  const t = stmt.theme;
  for (const a of stmt.accounts) totals(a);
  const a0 = stmt.accounts[0];
  const period = `${longDate(a0.periodStart)} to ${longDate(a0.periodEnd)}`;
  const content = [];
  // Header block: logo, bank, title, period.
  content.push({
    columns: [
      { width: "auto", stack: [logo(t)] },
      { width: "*", margin: [8, 0, 0, 0], stack: [
        { text: t.bank, bold: true, fontSize: 15, color: t.color },
        { text: "Business Banking", fontSize: 8.5, color: "#4b5563", margin: [0, 1, 0, 0] },
      ] },
      { width: 220, alignment: "right", stack: [
        { text: stmt.multi ? "Business Account Package Statement" : "Business Account Statement", bold: true, fontSize: 11.5 },
        { text: `For the period ${period}`, fontSize: 8.5, margin: [0, 2, 0, 0] },
        { text: `Statement date: ${longDate(nextDay(a0.periodEnd))}`, fontSize: 8, color: "#4b5563" },
      ] },
    ],
  });
  content.push({ canvas: [{ type: "line", x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 1.4, lineColor: t.color }], margin: [0, 8, 0, 8] });
  // Client address left, bank details right.
  const contact = {
    width: 230, fontSize: 8, stack: [
      { text: t.address[0], bold: true },
      { text: t.address.slice(1).join("\n"), color: "#374151" },
      { text: `Business contact centre: ${t.phone}`, margin: [0, 4, 0, 0] },
      { text: t.web, color: "#374151" },
    ],
  };
  const holder = { width: "*", fontSize: 9, stack: [{ text: stmt.client.lines[0], bold: true }, { text: stmt.client.lines.slice(1).join("\n") }] };
  if (stmt.multi) {
    content.push({ columns: [holder, contact], margin: [0, 0, 0, 10] });
    content.push({ text: "Your accounts at a glance", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3] });
    content.push({
      table: {
        headerRows: 1, widths: ["*", 110, 95, 95],
        body: [
          [{ text: "Account", bold: true }, { text: "Account number", bold: true }, { text: "Opening balance", bold: true, alignment: "right" }, { text: "Closing balance", bold: true, alignment: "right" }],
          ...stmt.accounts.map((a) => [a.name, masked(a), { text: `$${fmt(a.opening)}`, alignment: "right" }, { text: `$${fmt(a.closing)}`, alignment: "right" }]),
        ],
      },
      layout: { ...grid(t.rule), fillColor: (r) => (r === 0 ? t.light : null) }, fontSize: 8, margin: [0, 0, 0, 12],
    });
    for (const a of stmt.accounts) {
      content.push({ text: [{ text: a.name, bold: true }, { text: `    Account number ${masked(a)}`, color: "#374151" }], fontSize: 9.5, color: t.color, margin: [0, 2, 0, 3] });
      content.push({
        table: {
          widths: ["*", "*", "*", "*"],
          body: [[
            { text: [{ text: `Opening balance on ${shortDate(a.periodStart)}\n`, color: "#4b5563" }, { text: `$${fmt(a.opening)}`, bold: true }] },
            { text: [{ text: `Total ${t.colIn.toLowerCase()} (${a.sum.inCount})\n`, color: "#4b5563" }, { text: `+ ${fmt(a.sum.inTotal)}`, bold: true }] },
            { text: [{ text: `Total ${t.colOut.toLowerCase()} (${a.sum.outCount})\n`, color: "#4b5563" }, { text: `- ${fmt(a.sum.outTotal)}`, bold: true }] },
            { text: [{ text: `Closing balance on ${shortDate(a.periodEnd)}\n`, color: "#4b5563" }, { text: `= $${fmt(a.closing)}`, bold: true }] },
          ]],
        },
        layout: { ...boxLayout(t.rule), fillColor: () => t.light }, fontSize: 8, margin: [0, 0, 0, 5],
      });
      content.push(activityTable(t, a, a.lines, { first: true, last: true }));
      content.push({ text: "", margin: [0, 0, 0, 10] });
    }
    a0.pageOf = a0.lines.map(() => 1);
    stmt.accounts.forEach((a) => (a.pageOf = a.lines.map(() => 1)));
  } else {
    const a = a0;
    content.push({ columns: [holder, contact], margin: [0, 0, 0, 10] });
    content.push({
      columns: [
        { width: 230, fontSize: 8.5, stack: [
          { text: "Your account", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3] },
          { table: { widths: [88, "*"], body: [
            ["Account", { text: a.name, bold: true }],
            ["Account number", masked(a)],
            ["Branch transit", a.transit || "00412"],
            ["Statement period", `${longDate(a.periodStart)} to\n${longDate(a.periodEnd)}`],
          ] }, layout: "noBorders" },
        ] },
        { width: "*", text: "" },
        { width: 265, fontSize: 8.5, stack: [
          { text: "Summary of account activity", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3] },
          { table: { widths: ["*", 92], body: [
            [`Opening balance on ${shortDate(a.periodStart)}`, { text: `$${fmt(a.opening)}`, alignment: "right" }],
            [`Total ${t.colIn.toLowerCase()} (${a.sum.inCount})`, { text: `+ ${fmt(a.sum.inTotal)}`, alignment: "right" }],
            [`Total ${t.colOut.toLowerCase()} (${a.sum.outCount})`, { text: `- ${fmt(a.sum.outTotal)}`, alignment: "right" }],
            [{ text: `Closing balance on ${shortDate(a.periodEnd)}`, bold: true }, { text: `= $${fmt(a.closing)}`, alignment: "right", bold: true }],
          ] }, layout: { ...boxLayout(t.rule), fillColor: () => t.light } },
        ] },
      ],
      margin: [0, 0, 0, 14],
    });
    // Pages: first page holds firstCap lines, the rest nextCap.
    const chunks = [];
    let i = 0;
    let cap = stmt.firstCap;
    while (i < a.lines.length) { chunks.push(a.lines.slice(i, i + cap)); i += cap; cap = stmt.nextCap; }
    a.pageOf = [];
    chunks.forEach((ch, p) => {
      ch.forEach(() => a.pageOf.push(p + 1));
      if (p === 0) content.push({ text: "Account activity details", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3] });
      else content.push({ text: "Account activity details (continued)", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3], pageBreak: "before" });
      content.push(activityTable(t, a, ch, { first: p === 0, last: p === chunks.length - 1, page: p + 1 }));
    });
    content.push({
      margin: [0, 10, 0, 0], fontSize: 7.5, color: "#374151",
      text: "Please check this statement. If you find an error or an item you did not authorize, call us within 45 days of the statement date. After that, we consider this statement correct.",
    });
  }
  const doc = {
    pageSize: "LETTER", pageMargins: [40, 52, 40, 52],
    info: { title: `${t.bank} statement ${a0.periodStart} to ${a0.periodEnd}`, author: t.bank, creator: `${t.bank} eStatements`, producer: "Dummy statement generator", creationDate: utc(stmt.created), modDate: utc(stmt.created) },
    defaultStyle: { font: "Helvetica", fontSize: 8, lineHeight: 1.12, color: "#111827" },
    header: (cur) => cur === 1 ? null : {
      margin: [40, 22, 40, 0], fontSize: 7.5, color: "#374151",
      columns: [
        { width: "*", text: [{ text: t.bank, bold: true, color: t.color }, `   ${stmt.client.name}   ${a0.name} ${masked(a0)}`] },
        { width: "auto", text: `${longDate(a0.periodStart)} to ${longDate(a0.periodEnd)}` },
      ],
    },
    footer: footer(t, `${t.bank}, ${t.address.slice(1).join(", ")}.  Deposits are held for testing only.`),
    content,
  };
  if (stmt.encrypt) Object.assign(doc, { version: "1.4", userPassword: "", ownerPassword: stmt.encrypt, permissions: { printing: "highResolution", modifying: false, copying: false, annotating: false, fillingForms: false, contentAccessibility: true, documentAssembly: false } });
  return doc;
}

function activityTable(t, a, lines, { first, last, page }) {
  const H = (s, al) => ({ text: s, bold: true, alignment: al || "left", fillColor: t.light });
  const body = [[H("Date"), H("Description"), H(t.colOut, "right"), H(t.colIn, "right"), H("Balance ($)", "right")]];
  const idx0 = a.lines.indexOf(lines[0]);
  const before = idx0 <= 0 ? a.opening : a.lines[idx0 - 1].bal;
  if (first) body.push([t.date(a.periodStart), { text: "Opening balance", bold: true }, "", "", { text: fmt(a.opening), alignment: "right" }]);
  else body.push(["", { text: `Balance forward from page ${page - 1}`, italics: true }, "", "", { text: fmt(before), alignment: "right" }]);
  let prevDate = null;
  for (const l of lines) {
    const showDate = a.balance === "eod" ? l.date !== prevDate : true;
    prevDate = l.date;
    body.push([
      showDate ? t.date(l.date) : "",
      l.desc,
      { text: l.dir === "out" ? fmt(l.amt) : "", alignment: "right" },
      { text: l.dir === "in" ? fmt(l.amt) : "", alignment: "right" },
      { text: l.showBal ? fmt(l.bal) : "", alignment: "right" },
    ]);
  }
  const end = lines[lines.length - 1].bal;
  if (last) body.push([t.date(a.periodEnd), { text: "Closing balance", bold: true }, "", "", { text: fmt(a.closing), alignment: "right", bold: true }]);
  else body.push(["", { text: `Balance carried forward to page ${page + 1}`, italics: true }, "", "", { text: fmt(end), alignment: "right" }]);
  return { table: { headerRows: 1, widths: [44, "*", 78, 78, 74], body }, layout: grid(t.rule), fontSize: 8 };
}

// ---------- Business credit card statement
function cardStatement(c) {
  const t = c.theme;
  const pays = c.lines.filter((l) => l.dir === "out");
  const buys = c.lines.filter((l) => l.dir === "in" && !l.interest);
  const ints = c.lines.filter((l) => l.interest);
  const sum = (xs) => xs.reduce((n, l) => n + l.amt, 0);
  const payT = sum(pays), buyT = sum(buys), intT = sum(ints);
  const closing = c.opening - payT + buyT + intT;
  const minPay = Math.max(1000, Math.round(closing * 0.03));
  const row = (l) => [t.date(l.date), t.date(l.post), l.desc, { text: (l.dir === "out" ? "-" : "") + fmt(l.amt), alignment: "right" }];
  const head = (s) => [{ text: s, bold: true, colSpan: 4, color: t.color, margin: [0, 3, 0, 0] }, "", "", ""];
  const tot = (s, v) => [{ text: s, bold: true, colSpan: 3, alignment: "right" }, "", "", { text: v, bold: true, alignment: "right" }];
  const H = (s, al) => ({ text: s, bold: true, alignment: al || "left", fillColor: t.light });
  const body = [
    [H("Trans. date"), H("Post date"), H("Description"), H("Amount ($)", "right")],
    head("Payments and credits"), ...pays.map(row), tot("Total payments and credits", "-" + fmt(payT)),
    head(`Purchases and other charges   Card number ${c.masked}   ${c.cardholder}`), ...buys.map(row), tot("Total purchases and other charges", fmt(buyT)),
    head("Interest charges"), ...ints.map(row), tot("Total interest charges", fmt(intT)),
  ];
  const content = [
    { columns: [
      { width: "auto", stack: [logo(t)] },
      { width: "*", margin: [8, 0, 0, 0], stack: [
        { text: c.product, bold: true, fontSize: 15, color: t.color },
        { text: `Issued by ${t.bank}`, fontSize: 8.5, color: "#4b5563", margin: [0, 1, 0, 0] },
      ] },
      { width: 220, alignment: "right", stack: [
        { text: "Statement", bold: true, fontSize: 11.5 },
        { text: `Statement period: ${longDate(c.periodStart)} to ${longDate(c.periodEnd)}`, fontSize: 8.5, margin: [0, 2, 0, 0] },
        { text: `Card number: ${c.masked}`, fontSize: 8.5 },
      ] },
    ] },
    { canvas: [{ type: "line", x1: 0, y1: 0, x2: 532, y2: 0, lineWidth: 1.4, lineColor: t.color }], margin: [0, 8, 0, 8] },
    { columns: [
      { width: "*", fontSize: 9, stack: [
        { text: c.client.lines[0], bold: true }, { text: `ATTN: ${c.cardholder}` }, { text: c.client.lines.slice(1).join("\n") },
        { text: "Payment information", bold: true, fontSize: 9.5, color: t.color, margin: [0, 12, 0, 3] },
        { table: { widths: [120, 90], body: [
          ["New balance", { text: `$${fmt(closing)}`, alignment: "right", bold: true }],
          ["Minimum payment", { text: `$${fmt(minPay)}`, alignment: "right" }],
          ["Payment due date", { text: longDate(c.due), alignment: "right" }],
        ] }, layout: { ...boxLayout(t.rule), fillColor: () => t.light }, fontSize: 8.5 },
      ] },
      { width: 255, fontSize: 8.5, stack: [
        { text: "Account summary", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3] },
        { table: { widths: ["*", 86], body: [
          [`Previous balance on ${shortDate(c.prevDate)}`, { text: `$${fmt(c.opening)}`, alignment: "right" }],
          ["Payments and credits", { text: `- ${fmt(payT)}`, alignment: "right" }],
          ["Purchases and other charges", { text: `+ ${fmt(buyT)}`, alignment: "right" }],
          ["Cash advances", { text: "+ 0.00", alignment: "right" }],
          ["Interest", { text: `+ ${fmt(intT)}`, alignment: "right" }],
          ["Fees", { text: "+ 0.00", alignment: "right" }],
          [{ text: `New balance on ${longDate(c.periodEnd)}`, bold: true }, { text: `= $${fmt(closing)}`, alignment: "right", bold: true }],
        ] }, layout: { ...boxLayout(t.rule), fillColor: () => t.light } },
        { table: { widths: ["*", 86], body: [
          ["Credit limit", { text: `$${fmt(c.limit)}`, alignment: "right" }],
          ["Available credit", { text: `$${fmt(c.limit - closing)}`, alignment: "right" }],
          ["Annual interest rate, purchases", { text: "19.99%", alignment: "right" }],
        ] }, layout: "noBorders", margin: [6, 4, 0, 0] },
      ] },
    ], margin: [0, 0, 0, 14] },
    { text: "Transactions since your last statement", bold: true, fontSize: 9.5, color: t.color, margin: [0, 0, 0, 3] },
    { table: { headerRows: 1, widths: [50, 50, "*", 80], body }, layout: grid(t.rule), fontSize: 8 },
    { margin: [0, 10, 0, 0], fontSize: 7.5, color: "#374151", text: "Pay at least the minimum payment by the payment due date. If you pay your new balance in full by the due date, you pay no interest on new purchases shown on this statement." },
  ];
  const doc = {
    pageSize: "LETTER", pageMargins: [40, 52, 40, 52],
    info: { title: `${c.product} statement ${c.periodEnd}`, author: t.bank, creator: `${t.bank} eStatements`, producer: "Dummy statement generator", creationDate: utc(c.created), modDate: utc(c.created) },
    defaultStyle: { font: "Helvetica", fontSize: 8, lineHeight: 1.12, color: "#111827" },
    footer: footer(t, `${t.bank}, ${t.address.slice(1).join(", ")}.  Card services ${t.phone}.`),
    content,
  };
  const printed = [...pays, ...buys, ...ints];
  const acc = {
    key: "a1", last4: c.last4, name: c.product, kind: "card", periodStart: c.periodStart, periodEnd: c.periodEnd,
    opening: c.opening, closing,
    summary: { inTotal: buyT + intT, inCount: null, outTotal: payT, outCount: null },
    lines: printed.map((l) => ({ ...l, showBal: false, page: 1 })),
  };
  return { doc, acc };
}

// ---------- ReadResult
function readResult(bank, accounts, pages) {
  let n = 0;
  return {
    accounts: accounts.map((a, k) => ({
      key: `a${k + 1}`, last4: a.last4, name: a.name, kind: a.kind, periodStart: a.periodStart, periodEnd: a.periodEnd,
      opening: a.opening, closing: a.closing,
      summary: a.summary !== undefined ? a.summary : a.sum,
      lines: a.lines.map((l, i) => ({
        id: `l${++n}`, date: l.date, description: l.desc, amountCents: l.amt, dir: l.dir,
        balanceCents: l.showBal ? l.bal : null, page: l.page ?? a.pageOf[i], unsure: false, unsureReason: "", source: "read",
      })),
    })),
    pages, bank,
  };
}
const pagesOf = (accs) => Math.max(...accs.flatMap((a) => (a.pageOf ? a.pageOf : a.lines.map((l) => l.page))));

// ---------- HTML statement (for the scanned image and the phone photo)
function statementHtml(stmt) {
  const t = stmt.theme;
  const a = totals(stmt.accounts[0]);
  a.pageOf = a.lines.map(() => 1);
  const tr = (cells, cls = "") => `<tr class="${cls}">${cells.map((c, i) => `<td class="${i > 1 ? "n" : ""}">${c}</td>`).join("")}</tr>`;
  return `<div class="st">
  <div class="hd"><div class="logo" style="background:${t.color}">${t.initials}</div><div class="bn"><b style="color:${t.color}">${t.bank}</b><br><span>Business Banking</span></div>
  <div class="r"><b>Business Account Statement</b><br>For the period ${longDate(a.periodStart)} to ${longDate(a.periodEnd)}<br><span>Statement date: ${longDate(nextDay(a.periodEnd))}</span></div></div>
  <div class="rule" style="background:${t.color}"></div>
  <div class="two"><div class="cl"><b>${stmt.client.lines[0]}</b><br>${stmt.client.lines.slice(1).join("<br>")}</div>
  <div class="ct"><b>${t.address[0]}</b><br>${t.address.slice(1).join("<br>")}<br>Business contact centre: ${t.phone}</div></div>
  <div class="two"><div><h3 style="color:${t.color}">Your account</h3><table class="kv"><tr><td>Account</td><td><b>${a.name}</b></td></tr><tr><td>Account number</td><td>${a.masked}</td></tr><tr><td>Statement period</td><td>${longDate(a.periodStart)} to ${longDate(a.periodEnd)}</td></tr></table></div>
  <div><h3 style="color:${t.color}">Summary of account activity</h3><table class="box" style="background:${t.light};border-color:${t.rule}">
  <tr><td>Opening balance on ${longDate(a.periodStart)}</td><td class="n">$${fmt(a.opening)}</td></tr>
  <tr><td>Total ${t.colIn.toLowerCase()} (${a.sum.inCount})</td><td class="n">+ ${fmt(a.sum.inTotal)}</td></tr>
  <tr><td>Total ${t.colOut.toLowerCase()} (${a.sum.outCount})</td><td class="n">- ${fmt(a.sum.outTotal)}</td></tr>
  <tr><td><b>Closing balance on ${longDate(a.periodEnd)}</b></td><td class="n"><b>= $${fmt(a.closing)}</b></td></tr></table></div></div>
  <h3 style="color:${t.color}">Account activity details</h3>
  <table class="tx"><thead><tr style="background:${t.light}"><th>Date</th><th>Description</th><th class="n">${t.colOut}</th><th class="n">${t.colIn}</th><th class="n">Balance ($)</th></tr></thead><tbody>
  ${tr([t.date(a.periodStart), "<b>Opening balance</b>", "", "", fmt(a.opening)])}
  ${a.lines.map((l) => tr([t.date(l.date), l.desc, l.dir === "out" ? fmt(l.amt) : "", l.dir === "in" ? fmt(l.amt) : "", l.showBal ? fmt(l.bal) : ""])).join("\n")}
  ${tr([t.date(a.periodEnd), "<b>Closing balance</b>", "", "", `<b>${fmt(a.closing)}</b>`])}
  </tbody></table>
  <p class="fine">Please check this statement. If you find an error or an item you did not authorize, call us within 45 days of the statement date.<br>${t.bank} is a dummy name. This statement was made for software testing and is not a real bank document.</p>
  <div class="pg">Page 1 of 1</div></div>`;
}
const STATEMENT_CSS = `
.st{font-family:Helvetica,Arial,'Liberation Sans',sans-serif;color:#151515;font-size:11px;line-height:1.35;position:relative}
.hd{display:flex;align-items:center;gap:10px}.logo{color:#fff;font-weight:700;font-size:15px;padding:9px 8px}
.bn{flex:1;font-size:18px}.bn span{font-size:11px;color:#444}.r{text-align:right;font-size:11px}.r b{font-size:14px}.r span{color:#444}
.rule{height:2px;margin:10px 0}.two{display:flex;justify-content:space-between;gap:24px;margin-bottom:14px}.two>div{flex:1}
.cl{font-size:12px}.ct{font-size:10.5px;max-width:280px}h3{font-size:12px;margin:0 0 4px}
table{border-collapse:collapse;width:100%}.kv td{padding:1px 6px 1px 0}.box{border:1px solid}.box td{padding:3px 8px}
.tx th{text-align:left;padding:4px 5px;border-top:1px solid #999;border-bottom:1px solid #999}.tx td{padding:3.5px 5px;border-bottom:1px solid #ddd}
.n{text-align:right!important}.fine{font-size:9px;color:#444;margin-top:14px}.pg{text-align:right;font-size:10px;margin-top:4px}`;

// ---------- Playwright pictures
async function shoot(html, { width, height, scale = 1, quality }) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
    await page.setContent(html, { waitUntil: "load" });
    return await page.screenshot({ type: "jpeg", quality, fullPage: false });
  } finally {
    await browser.close();
  }
}
// Grey noise, seeded, as an SVG turbulence layer (deterministic).
const NOISE = (seed, opacity) => `<svg style="position:absolute;inset:0;width:100%;height:100%;opacity:${opacity};mix-blend-mode:multiply;pointer-events:none" xmlns="http://www.w3.org/2000/svg"><filter id="n${seed}"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="${seed}" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(#n${seed})"/></svg>`;

function scannedHtml(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STATEMENT_CSS}
html,body{margin:0;background:#efece3}
.paper{position:absolute;inset:0;overflow:hidden;background:#f3f0e6;filter:grayscale(1) contrast(1.08) brightness(0.98)}
.page{position:absolute;left:58px;top:52px;width:700px;transform:rotate(0.8deg);transform-origin:20% 10%}
.speck{position:absolute;background:#555;border-radius:50%;opacity:.45}
.edge{position:absolute;inset:0;box-shadow:inset 0 0 40px rgba(0,0,0,.18)}
</style></head><body><div class="paper"><div class="page">${inner}</div>${NOISE(7, 0.32)}
<div class="speck" style="left:120px;top:900px;width:3px;height:2px"></div><div class="speck" style="left:640px;top:220px;width:2px;height:2px"></div>
<div class="speck" style="left:410px;top:610px;width:2px;height:3px"></div><div class="speck" style="left:735px;top:980px;width:4px;height:2px"></div>
<div class="edge"></div></div></body></html>`;
}
function photoHtml(inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${STATEMENT_CSS}
html,body{margin:0;width:900px;height:1200px;overflow:hidden;background:radial-gradient(ellipse at 40% 30%,#8a6a4a,#4a3422 75%)}
.desk{position:absolute;inset:0;background:repeating-linear-gradient(87deg,rgba(0,0,0,.05) 0 3px,rgba(255,255,255,.03) 3px 9px)}
.scene{position:absolute;inset:0;perspective:1400px}
.sheet{position:absolute;left:105px;top:95px;width:690px;min-height:900px;padding:34px 36px 30px;background:#fbf8f1;transform:rotateX(7deg) rotateY(-1.2deg) rotateZ(-0.5deg);transform-origin:50% 50%;box-shadow:0 30px 50px rgba(0,0,0,.45),0 4px 10px rgba(0,0,0,.3)}
.light{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 20%,rgba(255,250,235,.22),rgba(0,0,0,0) 45%),radial-gradient(ellipse at 80% 95%,rgba(0,0,0,.35),rgba(0,0,0,0) 55%);pointer-events:none}
.shadow{position:absolute;right:-120px;top:380px;width:420px;height:760px;background:rgba(0,0,0,.12);filter:blur(60px);transform:rotate(-18deg)}
.warm{position:absolute;inset:0;background:rgba(255,200,120,.07);mix-blend-mode:multiply}
</style></head><body><div class="desk"></div><div class="scene"><div class="sheet">${inner}</div></div><div class="shadow"></div><div class="light"></div><div class="warm"></div>${NOISE(11, 0.12)}</body></html>`;
}

// ---------- Output helpers
const files = []; // { file, result?, error? }
function writeJson(rel, data) { writeFileSync(join(DIR, rel), JSON.stringify(data, null, 2) + "\n"); }
async function writePdf(rel, doc) { const buf = await pdfBuffer(doc); writeFileSync(join(DIR, rel), buf); return buf; }
function addResult(rel, result) {
  const json = rel.replace(/\.(pdf|jpg)$/, ".json");
  writeJson(json, result);
  files.push({ file: rel, result: json });
}

// ======================================================================================
// 1. chequing-savings.pdf: one page, two accounts, the mock's numbers.
async function chequingSavings() {
  const y = 2026, m = 3, D = (d) => iso(y, m, d);
  const chq = {
    name: "Business Chequing Account", last4: "4821", masked: "XXXXXXX4821", kind: "bank", periodStart: D(1), periodEnd: D(31), opening: 1248015, balance: "every",
    lines: [
      L(D(2), "E-TRANSFER RECEIVED DUMMY CLIENT", 350000, "in"),
      L(D(3), "PRE-AUTHORIZED DEBIT DUMMY HYDRO", 18422, "out"),
      L(D(7), "POS PURCHASE DUMMY OFFICE SUPPLY", 9648, "out"),
      L(D(10), "CHEQUE #1042", 225000, "out"),
      L(D(14), "COMMISSION DEPOSIT DUMMY BROKERAGE", 891240, "in"),
      L(D(18), "MONTHLY ACCOUNT FEE", 1995, "out"),
      L(D(21), "ONLINE TRANSFER TO SAVINGS 7730", 500000, "out"),
      L(D(28), "INTERAC PURCHASE MAPLE DUMMY FUEL", 7310, "out"),
      L(D(31), "INTEREST PAID", 3760, "in"),
    ],
  };
  const sav = {
    name: "Business Savings Account", last4: "7730", masked: "XXXXXXX7730", kind: "bank", periodStart: D(1), periodEnd: D(31), opening: 2500000, balance: "every",
    lines: [L(D(21), "ONLINE TRANSFER FROM CHEQUING 4821", 500000, "in"), L(D(31), "INTEREST PAID", 4110, "in")],
  };
  const doc = bankStatement({ theme: NORTH, client: MAPLE, accounts: [chq, sav], created: "2026-04-01", multi: true });
  await writePdf("chequing-savings.pdf", doc);
  if (chq.closing !== 1730640 || sav.closing !== 3004110) throw new Error("chequing-savings does not match the mock");
  addResult("chequing-savings.pdf", readResult(NORTH.bank, [chq, sav], 1));
  return [chq, sav];
}

// 2. card.pdf: business Visa, about 20 lines.
async function card() {
  const C = (date, post, desc, amt, dir, interest = false) => ({ date, post, desc, amt, dir, interest });
  const lines = [
    C("2026-02-24", "2026-02-25", "PAYMENT - THANK YOU", 250000, "out"),
    C("2026-03-04", "2026-03-05", "DUMMY OFFICE SUPPLY WATERLOO ON - RETURN", 4520, "out"),
    C("2026-02-16", "2026-02-17", "DUMMY MLS BOARD FEES TORONTO ON", 38420, "in"),
    C("2026-02-17", "2026-02-18", "MAPLE DUMMY FUEL KITCHENER ON", 8735, "in"),
    C("2026-02-18", "2026-02-19", "DUMMY CRM SOFTWARE 800-555-0199 ON", 14900, "in"),
    C("2026-02-19", "2026-02-20", "DUMMY COFFEE HOUSE WATERLOO ON", 1845, "in"),
    C("2026-02-21", "2026-02-23", "DUMMY PHOTO STUDIO WATERLOO ON", 42375, "in"),
    C("2026-02-22", "2026-02-23", "DUMMY OFFICE SUPPLY WATERLOO ON", 11250, "in"),
    C("2026-02-25", "2026-02-26", "DUMMY STAGING CO GUELPH ON", 125000, "in"),
    C("2026-02-26", "2026-02-27", "DUMMY PRINT SHOP KITCHENER ON", 26893, "in"),
    C("2026-02-27", "2026-03-02", "DUMMY PARKING AUTHORITY TORONTO ON", 2400, "in"),
    C("2026-03-01", "2026-03-02", "DUMMY CLOUD STORAGE 855-555-0142 ON", 2499, "in"),
    C("2026-03-03", "2026-03-04", "DUMMY SIGN SUPPLY CAMBRIDGE ON", 31766, "in"),
    C("2026-03-05", "2026-03-06", "DUMMY TELECOM MOBILITY 888-555-0110 ON", 9604, "in"),
    C("2026-03-07", "2026-03-09", "DUMMY HARDWARE KITCHENER ON", 5689, "in"),
    C("2026-03-09", "2026-03-10", "DUMMY LEGAL SEARCHES TORONTO ON", 7910, "in"),
    C("2026-03-11", "2026-03-12", "MAPLE DUMMY FUEL KITCHENER ON", 9122, "in"),
    C("2026-03-12", "2026-03-13", "DUMMY RESTAURANT GROUP WATERLOO ON", 16438, "in"),
    C("2026-03-14", "2026-03-15", "DUMMY ADS ONLINE 866-555-0123 ON", 50000, "in"),
    C("2026-03-15", "2026-03-15", "PURCHASE INTEREST", 1842, "in", true),
  ];
  const { doc, acc } = cardStatement({
    theme: NORTH, client: MAPLE, product: "Northern Dummy Visa Business", cardholder: "DANA DUMMY", masked: "4510 XXXX XXXX 9034", last4: "9034",
    periodStart: "2026-02-16", periodEnd: "2026-03-15", prevDate: "2026-02-15", due: "2026-04-08", opening: 341267, limit: 1500000, created: "2026-03-16", lines,
  });
  await writePdf("card.pdf", doc);
  addResult("card.pdf", readResult(NORTH.bank, [acc], 1));
  return [acc];
}

// 3. locked.pdf: opens with no password (empty user password) but is encrypted (owner password).
async function locked() {
  const rand = mulberry32(303);
  const a = { name: "Business Chequing Account", last4: "4821", masked: "XXXXXXX4821", kind: "bank", periodStart: "2026-04-01", periodEnd: "2026-04-30", opening: 1730640, balance: "every" };
  a.lines = monthLines(rand, 2026, 4, 15, a.opening, { cheque: 1043 });
  const doc = bankStatement({ theme: NORTH, client: MAPLE, accounts: [a], created: "2026-05-01", firstCap: 27, nextCap: 44, encrypt: "dummy-owner-2026" });
  await writePdf("locked.pdf", doc);
  addResult("locked.pdf", readResult(NORTH.bank, [a], pagesOf([a])));
  return [a];
}

// 4. two-page.pdf: 45 lines, balance carried forward to page 2.
async function twoPage() {
  const rand = mulberry32(404);
  const a = { name: "Business Chequing", last4: "3307", masked: "XXXX-XXX3307", transit: "21870", kind: "bank", periodStart: "2026-05-01", periodEnd: "2026-05-31", opening: 2215460, balance: "every" };
  a.lines = monthLines(rand, 2026, 5, 45, a.opening, { cheque: 310 });
  const doc = bankStatement({ theme: LAKE, client: BIRCH, accounts: [a], created: "2026-06-01", firstCap: 27, nextCap: 44 });
  await writePdf("two-page.pdf", doc);
  addResult("two-page.pdf", readResult(LAKE.bank, [a], pagesOf([a])));
  return [a];
}

// 5. scanned.pdf (image only) and scanned-photo.jpg (phone photo).
async function scanned() {
  const rand = mulberry32(505);
  const a = { name: "Business Chequing", last4: "3307", masked: "XXXX-XXX3307", kind: "bank", periodStart: "2026-04-01", periodEnd: "2026-04-30", opening: 1964218, balance: "every" };
  a.lines = monthLines(rand, 2026, 4, 12, a.opening, { cheque: 298 });
  const stmt = { theme: LAKE, client: BIRCH, accounts: [a] };
  const jpg = await shoot(scannedHtml(statementHtml(stmt)), { width: 816, height: 1056, scale: 1.5625, quality: 62 });
  const doc = {
    pageSize: "LETTER", pageMargins: [0, 0, 0, 0],
    info: { title: "Scan 2026-05-04", creator: "Dummy office scanner", producer: "Dummy scan software", creationDate: utc("2026-05-04"), modDate: utc("2026-05-04") },
    defaultStyle: { font: "Helvetica" },
    content: [{ image: "data:image/jpeg;base64," + jpg.toString("base64"), width: 612, height: 792 }],
  };
  await writePdf("scanned.pdf", doc);
  addResult("scanned.pdf", readResult(LAKE.bank, [a], 1));

  const rp = mulberry32(506);
  const s = { name: "Business Savings Account", last4: "7730", masked: "XXXXXXX7730", kind: "bank", periodStart: "2026-02-01", periodEnd: "2026-02-28", opening: 1850000, balance: "every" };
  s.lines = [
    L("2026-02-03", "ONLINE TRANSFER FROM CHEQUING 4521", 300000, "in"),
    L("2026-02-10", "E-TRANSFER RECEIVED DUMMY CLIENT", cents(rp, 500, 1500), "in"),
    L("2026-02-17", "ONLINE TRANSFER TO CHEQUING 4521", 150000, "out"),
    L("2026-02-24", "ONLINE TRANSFER FROM CHEQUING 4521", 200000, "in"),
    L("2026-02-28", "INTEREST PAID", 2874, "in"),
  ];
  const photo = await shoot(photoHtml(statementHtml({ theme: NORTH, client: MAPLE, accounts: [s] })), { width: 900, height: 1200, scale: 1.333, quality: 78 });
  writeFileSync(join(DIR, "scanned-photo.jpg"), photo);
  addResult("scanned-photo.jpg", readResult(NORTH.bank, [s], 1));
  return [a, s];
}

// 6. batch/: 12 months of one chequing account (4521), each closing = the next opening.
async function batch() {
  mkdirSync(join(DIR, "batch"), { recursive: true });
  const rand = mulberry32(606);
  let opening = 821437;
  let cheque = 1101;
  const out = [];
  for (let m = 1; m <= 12; m++) {
    const n = 10 + Math.floor(rand() * 16);
    const a = { name: "Business Chequing Account", last4: "4521", masked: "XXXXXXX4521", kind: "bank", periodStart: iso(2026, m, 1), periodEnd: iso(2026, m, daysIn(2026, m)), opening, balance: "eod" };
    a.lines = monthLines(rand, 2026, m, n, opening, { cheque });
    cheque += a.lines.filter((l) => l.desc.startsWith("CHEQUE #")).length;
    const rel = `batch/Statement-${MON[m - 1]}-2026.pdf`;
    const doc = bankStatement({ theme: NORTH, client: MAPLE, accounts: [a], created: nextDay(a.periodEnd), firstCap: 27, nextCap: 44 });
    await writePdf(rel, doc);
    addResult(rel, readResult(NORTH.bank, [a], pagesOf([a])));
    opening = a.closing;
    out.push(a);
  }
  return out;
}

// 7. long-400.pdf: 424 lines over many pages, running balance on every line.
async function long400() {
  const rand = mulberry32(707);
  const a = { name: "Business Chequing", last4: "6610", masked: "XXXX-XXX6610", transit: "21870", kind: "bank", periodStart: "2026-09-01", periodEnd: "2026-09-30", opening: 4875012, balance: "every" };
  a.lines = monthLines(rand, 2026, 9, 424, a.opening, { cheque: 512 });
  const doc = bankStatement({ theme: LAKE, client: BIRCH, accounts: [a], created: "2026-10-01", firstCap: 27, nextCap: 44 });
  await writePdf("long-400.pdf", doc);
  addResult("long-400.pdf", readResult(LAKE.bank, [a], pagesOf([a])));
  return [a];
}

// 8. mismatch.pdf: the PDF is right; the JSON has a reader mistake (1,250.00 read as 1,520.00) and an unsure line.
async function mismatch() {
  const D = (d) => iso(2026, 6, d);
  const a = {
    name: "Business Chequing Account", last4: "4821", masked: "XXXXXXX4821", kind: "bank", periodStart: D(1), periodEnd: D(30), opening: 1486233, balance: "every",
    lines: [
      L(D(1), "PRE-AUTHORIZED DEBIT DUMMY INSURANCE", 28714, "out"),
      L(D(3), "E-TRANSFER RECEIVED DUMMY CLIENT", 150000, "in"),
      L(D(4), "POS PURCHASE DUMMY PRINT SHOP", 18342, "out"),
      L(D(8), "COMMISSION DEPOSIT DUMMY BROKERAGE", 1124560, "in"),
      L(D(9), "CHEQUE #1047", 125000, "out"),
      L(D(11), "PRE-AUTHORIZED DEBIT DUMMY HYDRO", 21208, "out"),
      L(D(15), "CRA PAYMENT GST/HST", 318450, "out"),
      L(D(16), "INTERAC PURCHASE MAPLE DUMMY FUEL", 9116, "out"),
      L(D(19), "E-TRANSFER SENT DUMMY ASSISTANT", 120000, "out"),
      L(D(22), "PAYROLL DUMMY PAYROLL SERVICE", 286500, "out"),
      L(D(24), "MOBILE CHEQUE DEPOSIT", 375000, "in"),
      L(D(26), "PRE-AUTHORIZED DEBIT DUMMY TELECOM", 13287, "out"),
      L(D(29), "ONLINE TRANSFER TO SAVINGS 7730", 300000, "out"),
      L(D(30), "MONTHLY ACCOUNT FEE", 2995, "out"),
    ],
  };
  const doc = bankStatement({ theme: NORTH, client: MAPLE, accounts: [a], created: "2026-07-01", firstCap: 27, nextCap: 44 });
  await writePdf("mismatch.pdf", doc);
  const r = readResult(NORTH.bank, [a], pagesOf([a]));
  const lines = r.accounts[0].lines;
  const bad = lines.find((l) => l.description === "CHEQUE #1047");
  bad.amountCents = 152000; // misread: 1,250.00 read as 1,520.00 (the printed balance after it was read right)
  const unsure = lines.find((l) => l.description === "PRE-AUTHORIZED DEBIT DUMMY TELECOM");
  unsure.unsure = true;
  unsure.unsureReason = "Amount hard to read";
  addResult("mismatch.pdf", r);
  return [a];
}

// Extra files with no result: the reader is out of credits, and a page nobody can read.
async function extras() {
  const a = { name: "Business Chequing Account", last4: "4821", masked: "XXXXXXX4821", kind: "bank", periodStart: "2026-02-01", periodEnd: "2026-02-28", opening: 1000000, balance: "every",
    lines: [L("2026-02-02", "E-TRANSFER RECEIVED DUMMY CLIENT", 120000, "in"), L("2026-02-28", "MONTHLY ACCOUNT FEE", 2995, "out")] };
  await writePdf("out-of-credits.pdf", bankStatement({ theme: NORTH, client: MAPLE, accounts: [a], created: "2026-03-01", firstCap: 27, nextCap: 44 }));
  files.push({ file: "out-of-credits.pdf", error: "out_of_credits" });

  const b = { name: "Business Chequing", last4: "3307", masked: "XXXX-XXX3307", kind: "bank", periodStart: "2026-01-01", periodEnd: "2026-01-31", opening: 500000, balance: "every",
    lines: monthLines(mulberry32(808), 2026, 1, 10, 500000) };
  const html = scannedHtml(statementHtml({ theme: LAKE, client: BIRCH, accounts: [b] })).replace(".paper{", ".paper{filter:blur(5px) grayscale(1) brightness(1.15) contrast(.55)!important;");
  const jpg = await shoot(html, { width: 816, height: 1056, scale: 0.4, quality: 30 });
  await writePdf("unreadable.pdf", {
    pageSize: "LETTER", pageMargins: [0, 0, 0, 0],
    info: { title: "Scan", creator: "Dummy office scanner", producer: "Dummy scan software", creationDate: utc("2026-02-05"), modDate: utc("2026-02-05") },
    defaultStyle: { font: "Helvetica" },
    content: [{ image: "data:image/jpeg;base64," + jpg.toString("base64"), width: 612, height: 792 }],
  });
  files.push({ file: "unreadable.pdf", error: "unreadable" });
}

// ---------- Check each text PDF with pdf.js: page count and each line's description on its page.
async function verify() {
  const pdfjs = await import(pathToFileURL(join(ROOT, "node_modules/pdfjs-dist/legacy/build/pdf.mjs")).href);
  const fontDir = join(ROOT, "node_modules/pdfjs-dist/standard_fonts/");
  for (const f of files) {
    if (!f.file.endsWith(".pdf")) continue;
    const data = new Uint8Array(readFileSync(join(DIR, f.file)));
    const task = pdfjs.getDocument({ data, standardFontDataUrl: fontDir, verbosity: 0 });
    const pdf = await task.promise;
    if (!f.result) { await task.destroy(); continue; }
    const r = JSON.parse(readFileSync(join(DIR, f.result), "utf8"));
    if (pdf.numPages !== r.pages) throw new Error(`${f.file}: ${pdf.numPages} pages, JSON says ${r.pages}`);
    if (f.file.startsWith("scanned")) {
      const tc = await (await pdf.getPage(1)).getTextContent();
      if (tc.items.length) throw new Error(`${f.file}: has a text layer`);
      await task.destroy();
      continue;
    }
    for (let p = 1; p <= pdf.numPages; p++) {
      const items = (await (await pdf.getPage(p)).getTextContent()).items.map((i) => i.str.trim());
      const want = new Map();
      for (const a of r.accounts) for (const l of a.lines) if (l.page === p) want.set(l.description, (want.get(l.description) || 0) + 1);
      for (const [d, n] of want) {
        const got = items.filter((s) => s === d).length;
        if (got !== n) throw new Error(`${f.file} page ${p}: "${d}" ${got} times, JSON has ${n}`);
      }
    }
    await task.destroy();
  }
}

// ---------- Run
const sha = (buf) => createHash("sha256").update(buf).digest("hex");
rmSync(join(DIR, "batch"), { recursive: true, force: true });
const numbers = {};
const note = (name, accs) => (numbers[name] = accs.map((a) => {
  const s = a.summary !== undefined && a.summary ? a.summary : a.sum;
  return `${a.last4}: opening ${fmt(a.opening)} + in ${fmt(s.inTotal)} (${s.inCount ?? "-"}) - out ${fmt(s.outTotal)} (${s.outCount ?? "-"}) = closing ${fmt(a.closing)}, ${a.lines.length} lines`;
}));
note("chequing-savings.pdf", await chequingSavings());
note("card.pdf", await card());
note("locked.pdf", await locked());
note("two-page.pdf", await twoPage());
note("scanned.pdf + scanned-photo.jpg", await scanned());
note("batch", await batch());
note("long-400.pdf", await long400());
note("mismatch.pdf (as printed)", await mismatch());
await extras();
await verify();

const manifest = {};
for (const f of files) {
  const h = sha(readFileSync(join(DIR, f.file)));
  if (manifest[h]) throw new Error(`${f.file} has the same bytes as ${manifest[h].file}`);
  manifest[h] = f.result ? { file: f.file, result: f.result } : { file: f.file, error: f.error };
}
writeJson("manifest.json", manifest);
if (process.argv.includes("--quiet")) process.exit(0);
for (const [k, v] of Object.entries(numbers)) console.log(k + "\n  " + v.join("\n  "));
for (const [h, v] of Object.entries(manifest)) console.log(h, v.file);
