// Build a fresh LOCAL client from an answer key given as CSV files (README.md in the folder), through the app's own
// save functions, signed in as the local dummy owner: the file, setup answers, step 2 (last year's T2), bank and card
// accounts, their lines (CSV import), the coding of every line (splits included), and the year-end entries.
//   node --import ./scripts/answer-keys/register.mjs scripts/answer-keys/build-from-csv.ts <csv folder> <answer-key folder>
// Then it saves the client as tests/answer-keys/<answer-key folder>/tables (like export.ts) and copies the CSV inputs
// and the expected results next to them. Tests only: the figures, names and descriptions stay in that folder.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { signIn } from "./compute.ts";
import { json, lit, sql } from "./db.ts";
import { fileTables, whereOf } from "./tables.ts";
import { rebuildTb } from "../../src/lib/closebook/tb-build-server.ts";

const [src, folder] = process.argv.slice(2);
if (!src || !folder) throw new Error("Usage: build-from-csv.ts <csv folder> <answer-key folder>");
const csv = (f: string): Record<string, string>[] => {
  const text = readFileSync(path.join(src, f), "utf8").replace(/\r/g, "").trim();
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  row.push(cell); rows.push(row);
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
};
const client = JSON.parse(readFileSync(path.join(src, "client.json"), "utf8"));
const t2 = JSON.parse(readFileSync(path.join(src, "prior_year_t2.json"), "utf8"));
const cents = (s: string) => Math.round(Number(s) * 100);
const fail = (what: string, e: { message: string } | null) => { if (e) throw new Error(`${what}: ${e.message}`); };
// The app's tax codes for the codes as the coding export prints them. "No tax" has no rate; Out of Scope is the app's code
// with no rate (on an expense it changes no return line; no revenue line is coded "No tax").
const TAX: Record<string, string> = { "HST ON": "HST_ON", "No tax": "OUT_OF_SCOPE", "HST ON, meals half ITC": "MEALS_HST_50", "": "" };

const sb = await signIn();
const { data: me } = await sb.auth.getUser();
const uid = me.user!.id;

// The client (Studio's client record) and the file.
const name = String(client.name);
if (!/dummy/i.test(name)) throw new Error("The answer key's client must be a dummy name.");
const old = json<string[]>(`select coalesce(json_agg(id), '[]') from public.clients where legal_name = ${lit(name)}`);
// A copy left by an earlier build is removed first (local only).
const tables = fileTables().reverse();
for (const id of old) sql(`begin; set local session_replication_role = replica;\n${tables.map((k) => `delete from public.${k.table} where ${whereOf(k, id)};`).join("\n")}\ncommit;`);
const [ye, ys] = [String(client.year_end), String(client.first_day)];
// The client is added the way the TaxDome import adds one (its guard allows only that import to set a Business Number).
const clientId = json<string>(`begin; set local session_replication_role = replica; insert into public.clients (kind, legal_name, province, year_end_md, business_number) values ('corporation', ${lit(name)}, ${lit(client.province)}, ${lit(ye.slice(5))},
  '7${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}') returning to_json(id); commit;`);
const { data: fileId, error: e1 } = await sb.rpc("cb_create_file", { p_client: clientId, p_year_end: ye, p_year_start: ys, p_reason: "", p_type: "full", p_books: "statements", p_preparer: uid, p_reviewer: uid });
fail("New file", e1);
const file = String(fileId);
const gst = client.gst_hst ?? {};
fail("Setup", (await sb.rpc("cb_save_setup", { p_file: file, p_setup: { gst_registered: true, gst_frequency: gst.filing ?? "annual", quick_method: gst.method === "quick", gst_year_same: true, gst_rt: "RT0001", owner_paid: true, payroll: false, dividends: false, holdco: false, realtor: false } })).error);

// Step 2: last year's T2 as typed (Schedule 100 and 125).
// The account each T2 line opens on, as chosen in step 2 (opening_balances.csv: "..., GIFI <code>").
const openAcct = new Map<string, string>();
for (const o of csv("opening_balances.csv")) { const m = /GIFI (\d{4})/.exec(o.note); if (m && !/books|rounding/i.test(o.note)) openAcct.set(m[1], o.account); }
const s100 = Object.entries(t2.schedule_100 as Record<string, number>).filter(([c]) => !["2599", "3499", "3600", "3620", "3640", "3680", "3849"].includes(c));
fail("Step 2", (await sb.rpc("cb_save_opening", { p_file: file, p_codes: s100.map(([code, amount]) => ({ code, amount, ...(openAcct.get(code) ? { account: openAcct.get(code) } : {}) })), p_re_stated: t2.schedule_100["3849"], p_ni_typed: t2.schedule_125?.["9999"] ?? null, p_note: "" })).error);
if (t2.schedule_125) fail("Step 2 Schedule 125", (await sb.rpc("cb_save_opening_s125", { p_file: file, p_lines: Object.entries(t2.schedule_125 as Record<string, number>).filter(([c]) => !["8299", "9368", "9999"].includes(c)).map(([code, amount]) => ({ code, amount })) })).error);

// Bank and card accounts, with their balance in the books at the start of the year (opening_balances.csv).
const opening = csv("opening_balances.csv");
const chart = new Map(csv("chart.csv").map((r) => [r.account, r]));
const TYPE: Record<string, string> = { "10000": "chequing", "22000": "card", "22100": "loc" };
const banks = new Map<string, { id: string; kind: "bank" | "card"; opening: number }>();
for (const number of Object.keys(client.bank_accounts)) {
  const type = TYPE[number];
  if (!type) throw new Error(`Bank account ${number}: no type known`);
  const nm = chart.get(number)!.name;
  const m = /·\s*(.+?)\s*•+\s*(\d+)/.exec(nm);
  const bal = opening.filter((o) => o.account === number && /books/i.test(o.note)).reduce((n, o) => n + cents(o.amount), 0);
  const isBank = type === "chequing";
  const owing = isBank ? bal : -bal;   // the balance as the statement prints it
  const t2line = number === "22100" ? "2707" : null;   // last year's T2 put the line of credit with the card on 2707
  const { data, error } = await sb.rpc("cb_save_bank_account", { p_file: file, p_id: null, p_type: type, p_bank: m?.[1] ?? "Bank", p_last4: m?.[2] ?? "0000", p_balance: Math.abs(owing) / 100,
    p_negative: owing < 0, p_long_term: false, p_confirm: true, p_t2_line: t2line });
  fail(`Account ${number}`, error);
  banks.set(number, { id: String(data), kind: isBank ? "bank" : "card", opening: owing });
}

// The lines, one CSV import per account. A card line's amount is the charge (the posting to the card, sign reversed).
const lines = csv("bank_lines.csv");
const ids = new Map<string, string>();
for (const [number, b] of banks) {
  const mine = lines.filter((l) => l.bank_account === number);
  if (!mine.length) continue;
  const rows = mine.map((l, i) => ({ line: i + 1, date: l.date, description: l.description, amount: (b.kind === "bank" ? cents(l.amount) : -cents(l.amount)) / 100 }));
  const closing = b.opening + rows.reduce((n, r) => n + Math.round(r.amount * 100), 0);
  const { error } = await sb.rpc("cb_import_csv", { p_file: file, p_account: b.id, p_file_name: `${number}.csv`, p_opening: b.opening / 100, p_closing: closing / 100, p_rows: rows, p_confirm: true });
  fail(`Import ${number}`, error);
  const { data: got } = await sb.from("cb_bank_lines").select("id, row_no").eq("account_id", b.id).order("row_no");
  for (const g of (got ?? []) as { id: string; row_no: number }[]) ids.set(mine[g.row_no - 1].line_id, g.id);
}
if (ids.size !== lines.length) throw new Error(`Imported ${ids.size} of ${lines.length} lines`);

// The coding. The export shows the sales tax as its own row on 21500; in the app it is part of the coded amount.
// A line coded only to 21500 is a payment to the CRA; a line coded to another bank account is a transfer.
const coding = csv("bank_line_coding.csv");
const byLine = new Map<string, Record<string, string>[]>();
for (const c of coding) byLine.set(c.line_id, [...(byLine.get(c.line_id) ?? []), c]);
const bankById = new Map([...banks].map(([n, b]) => [n, b.id]));
const posts: Record<string, unknown>[] = [];
for (const l of lines) {
  const rows = byLine.get(l.line_id) ?? [];
  const id = ids.get(l.line_id)!;
  const main = rows.filter((r) => r.account !== "21500");
  if (!main.length) { posts.push({ id, kind: "code", account: "21500", tax: "OUT_OF_SCOPE" }); continue; }
  if (main.length === 1 && bankById.has(main[0].account)) { posts.push({ id, kind: "transfer", transfer_account: bankById.get(main[0].account) }); continue; }
  const taxRow = rows.filter((r) => r.account === "21500").reduce((n, r) => n + cents(r.amount), 0);
  const taxed = main.filter((r) => r.tax_code && TAX[r.tax_code] !== "OUT_OF_SCOPE");
  if (main.length === 1) {
    const code = TAX[main[0].tax_code];
    if (code === undefined) throw new Error(`${l.line_id}: tax code ${main[0].tax_code} unknown`);
    posts.push({ id, kind: "code", account: main[0].account, tax: code || "OUT_OF_SCOPE" });
    continue;
  }
  // A split: each row's amount includes its own sales tax (the 21500 row goes to the taxed rows, all of it to the last).
  const sign = Math.sign(Number(l.amount));   // the posting to the bank or card account, debit positive
  let left = taxRow;
  const split = main.map((r, i) => {
    let c = cents(r.amount);
    if (taxed.includes(r)) { const share = taxed.indexOf(r) === taxed.length - 1 ? left : Math.round((taxRow * cents(r.amount)) / taxed.reduce((n, x) => n + cents(x.amount), 0)); left -= share; c += share; }
    return { account: r.account, tax: TAX[r.tax_code] || "OUT_OF_SCOPE", amount: ((-c * sign) / 100).toFixed(2), memo: "", i };
  });
  fail(`Split ${l.line_id}`, (await sb.rpc("cb_save_splits", { p_line: id, p_rows: split.map(({ i: _i, ...x }) => x) })).error);
  posts.push({ id, kind: "split" });
}
for (let i = 0; i < posts.length; i += 100) fail("Post lines", (await sb.rpc("cb_post_lines", { p_file: file, p_items: posts.slice(i, i + 100) })).error);

// The year-end entries, in order, each with its number. Lines on 21500 are the entry's sales tax; the other expense
// lines of an entry with sales tax carry the tax code the entry used (meals: half the ITC).
const entries = csv("entries.csv");
const nos = [...new Set(entries.map((e) => e.entry))];
for (const no of nos) {
  const ls = entries.filter((e) => e.entry === no);
  const hasTax = ls.some((e) => e.account === "21500");
  const lines2 = ls.map((e) => {
    const amount = (cents(e.debit || "0") - cents(e.credit || "0")) / 100;
    const memo = (/\(([^)]*)\)\s*$/.exec(e.line_description)?.[1] ?? "").slice(0, 200);
    const isTax = e.account === "21500";
    const exp = /^[5-9]/.test(e.account);
    const tax = isTax || !hasTax || !exp ? null : e.account === "60200" ? "MEALS_HST_50" : "HST_ON";
    return { chart: e.account, amount, memo, tax_code: tax, is_tax: isTax };
  });
  const { error } = await sb.rpc("cb_add_entry", { p_file: file, p_kind: ls[0].old_type, p_reason: ({ AJE: "correction", RJE: "reclassification", TJE: "tax" } as Record<string, string>)[ls[0].old_type] ?? "correction", p_note: (/: (.*?) \(/.exec(ls[0].line_description)?.[1] ?? "").slice(0, 200),
    p_reverse: false, p_lines: lines2, p_wp_ref: `E${no.slice(5)}`, p_date: ls[0].date, p_standard: null, p_attachments: [], p_seq: Number(no.slice(5)) });
  fail(`Entry ${no}`, error);
}
const err = await rebuildTb(sb, file);
if (err) throw new Error(`Trial balance: ${err}`);

// Save as an answer-key folder, with the inputs and the expected results.
execFileSync("node", ["--import", "./scripts/answer-keys/register.mjs", "scripts/answer-keys/export.ts", clientId, folder], { stdio: "inherit" });
const dir = path.resolve("tests/answer-keys", folder, "source");
mkdirSync(dir, { recursive: true });
cpSync(src, dir, { recursive: true });
console.log(`Built ${name} (file ${file}) and saved it as tests/answer-keys/${folder}.`);
