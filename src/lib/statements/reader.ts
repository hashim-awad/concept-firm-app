// The statement reader (round 20, Hashim, Nov 15, 2026): one bank or card statement (PDF or photo) in,
// every account and every line out. Claude API, model claude-sonnet-5-5, a standard request (not batch),
// streamed (long statements, 400+ lines), with structured output, US-only processing (inference_geo "us",
// billed at 1.1x) and the server-side refusal fallback (fallbacks "default"). Only the file and a fixed
// instruction are sent: never the client's name or anything from the file in Closebook.
// The model that answered (response.model), the tokens and the cost are recorded with the result.
// No "server-only" here so the unit test can load it; only server code imports it.

import Anthropic from "@anthropic-ai/sdk";
import { costUsd } from "./pricing.ts";
import { OUT_OF_CREDITS, type ReadResult, type StatementAccount, type StatementLine } from "./types.ts";

export const MODEL = "claude-sonnet-5-5";
export const MAX_TOKENS = 64000;
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
export const NOT_SET_UP = "The statement reader is not set up yet.";

// The fixed instruction. Plain and complete; the schema below carries the shape.
export const INSTRUCTION = `You read one bank or credit card statement (a PDF or a photo) and copy it into the JSON format given. Copy what is printed. Do not add, merge, skip or reorder anything.

Accounts:
- Return every account in the file. One file can hold several accounts, each with its own opening and closing balance (for example chequing and savings). Each account is one entry, even when its pages are apart.
- A business credit card statement often lists several cardholders, each in its own section with its own card number and subtotal, under one new balance. All those sections belong to ONE account: the account the statement is for. Return them as one entry, with the lines of every cardholder section on every page, in the order printed. Never return a cardholder's section as a separate account, and never leave a section out.
- last_digits: the last digits of the account or card number as printed (often 4). Digits only. Empty when not printed. Never guess a digit. On a card statement with several cardholders, the number the statement is for: the one printed at the top with the statement's balance (usually the first card listed).
- name: the account name as printed, for example "Business chequing" or "Visa Business".
- kind: "bank" for chequing, savings and other deposit accounts; "card" for credit cards and lines of credit.
- period_start and period_end: the statement period as printed, as YYYY-MM-DD.
- opening_balance and closing_balance: as printed for this account. Card or line of credit: an amount owing is positive, a credit balance is negative. Bank: an overdrawn balance is negative.
- summary: the printed totals of money in and money out for the period, with their counts when printed (for example "Deposits (12) 4,210.00", or "Payments and credits" and "Purchases and charges" on a card). Use null for a count that is not printed. Use null for the whole summary when the statement prints no totals.
- Card or line of credit summary: money_in_total is everything added to the balance (purchases, cash advances, interest and fees together). purchases_total (purchases and debits), cash_advances_total, interest_total and fees_total: each as printed in the summary box, on its own. Use null for one not printed, and always null on a bank statement.

Lines:
- Every transaction line of the account, on every page, in the order printed. Long statements can have hundreds of lines: include all of them. Do not include balance-forward, subtotal or total rows as lines.
- date: YYYY-MM-DD. When the statement prints no year, take it from the statement period (a period from December to January spans two years). Card or line of credit: the transaction (purchase) date.
- posted_date: card or line of credit only: the posting date, when the statement prints it as well as the transaction date, as YYYY-MM-DD. Null when only one date is printed, and always null on a bank statement.
- description: the description as printed, on one line. Join a description that wraps onto a second printed line (for example a foreign currency note) with a space.
- amount: the amount as printed, as a positive number with 2 decimals and no $ or commas, for example "1234.50".
- direction: "in" when the line raises the balance as printed, "out" when it lowers it. Bank: deposits and credits are "in"; withdrawals, cheques, payments and fees are "out". Card or line of credit: purchases, charges, fees and interest are "in"; payments, refunds and credits are "out".
- balance: the running balance printed after this line, with the same sign rule as the opening balance. Null when no balance is printed on that line.
- page: the page of the file the line is on, starting at 1.
- card_kind: card or line of credit only: how the summary box groups the line. "purchase" (purchases and debits), "cash_advance", "interest", "fee", or "payment" (payments, refunds and other credits). Always null on a bank statement.
- cardholder_digits: card only: the last digits of the cardholder's card the line is printed under, when the statement has cardholder sections. Digits only. Empty otherwise.
- unsure: true when any part of the line is hard to read, cut off, smudged or ambiguous, with a short reason in unsure_reason (for example "last digit of the amount is cut off"). Otherwise false and an empty reason. Never guess a missing digit: copy what you can read and mark the line unsure.

Money is always a string with 2 decimals, for example "0.00", "-15.20", "1234.50".
bank: the bank or card issuer's name as printed. pages: the number of pages in the file.`;

const nullable = (t: Record<string, unknown>) => ({ anyOf: [t, { type: "null" }] });
const money = { type: "string", description: "Amount with 2 decimals, no $ or commas, minus sign when negative" };

// ReadResult minus the ids, keys and sources, which are set here.
export const READ_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["bank", "pages", "accounts"],
  properties: {
    bank: { type: "string" },
    pages: { type: "integer" },
    accounts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["last_digits", "name", "kind", "period_start", "period_end", "opening_balance", "closing_balance", "summary", "lines"],
        properties: {
          last_digits: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["bank", "card"] },
          period_start: { type: "string", format: "date" },
          period_end: { type: "string", format: "date" },
          opening_balance: money,
          closing_balance: money,
          summary: nullable({
            type: "object",
            additionalProperties: false,
            required: ["money_in_total", "money_in_count", "money_out_total", "money_out_count", "purchases_total", "cash_advances_total", "interest_total", "fees_total"],
            properties: {
              money_in_total: money,
              money_in_count: nullable({ type: "integer" }),
              money_out_total: money,
              money_out_count: nullable({ type: "integer" }),
              purchases_total: nullable(money),
              cash_advances_total: nullable(money),
              interest_total: nullable(money),
              fees_total: nullable(money),
            },
          }),
          lines: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["date", "posted_date", "description", "amount", "direction", "balance", "page", "card_kind", "cardholder_digits", "unsure", "unsure_reason"],
              properties: {
                date: { type: "string" },
                posted_date: nullable({ type: "string" }),
                description: { type: "string" },
                amount: money,
                direction: { type: "string", enum: ["in", "out"] },
                balance: nullable(money),
                page: { type: "integer" },
                card_kind: nullable({ type: "string", enum: ["purchase", "payment", "cash_advance", "interest", "fee"] }),
                cardholder_digits: { type: "string" },
                unsure: { type: "boolean" },
                unsure_reason: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
} as const;

export type ReaderInput = { bytes: Uint8Array; mediaType: "application/pdf" | "image/jpeg" | "image/png"; pages: number };
export type ReadUsage = { model: string; inputTokens: number; outputTokens: number; costUsd: number };
export type ReadOutput = ReadUsage & { result: ReadResult };

export type ReaderErrorCode = "out_of_credits" | "not_set_up" | "refused" | "too_long" | "unreadable" | "busy";
// A failed read. retry: a passing problem, worth another try. usage: what the failed read still cost.
export class ReaderError extends Error {
  code: ReaderErrorCode;
  retry: boolean;
  usage: ReadUsage | null;
  constructor(code: ReaderErrorCode, message: string, retry: boolean, usage: ReadUsage | null = null) {
    super(message);
    this.code = code; this.retry = retry; this.usage = usage;
  }
}

// The request body, exactly as sent (the unit test checks it).
export function buildRequest(input: ReaderInput) {
  const data = Buffer.from(input.bytes.buffer, input.bytes.byteOffset, input.bytes.byteLength).toString("base64");
  const file: Anthropic.Beta.BetaContentBlockParam = input.mediaType === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data } }
    : { type: "image", source: { type: "base64", media_type: input.mediaType, data } };
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    betas: [FALLBACK_BETA],
    fallbacks: "default" as const,
    inference_geo: "us",
    // Reading is copying, not reasoning: medium effort keeps a long statement inside the runner's time.
    output_config: { effort: "medium" as const, format: { type: "json_schema" as const, schema: READ_SCHEMA as unknown as Record<string, unknown> } },
    system: INSTRUCTION,
    messages: [{ role: "user" as const, content: [file, { type: "text" as const, text: "Read this statement." }] }],
  } satisfies Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
}

// What the SDK client needs to offer (the test passes a stand-in).
export type StreamClient = {
  beta: { messages: { stream: (body: ReturnType<typeof buildRequest>, opts?: { timeout?: number; signal?: AbortSignal }) => { finalMessage: () => Promise<Anthropic.Beta.BetaMessage> } } };
};

export function usageOf(msg: Pick<Anthropic.Beta.BetaMessage, "model" | "usage">): ReadUsage {
  const u = msg.usage;
  const geo = u.inference_geo && u.inference_geo !== "us" ? "global" : "us";
  const usage = { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0 };
  return { model: msg.model, inputTokens: usage.input + usage.cacheWrite + usage.cacheRead, outputTokens: usage.output, costUsd: costUsd(msg.model, usage, geo) };
}

// The API's error, in the reader's terms. Out of credits: a billing error (402), or the organization's
// monthly spend limit.
export function readerErrorFrom(e: unknown): ReaderError {
  if (e instanceof ReaderError) return e;
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402 || e.type === "billing_error" || e.errorCode === "enforced_spend_limit_reached") return new ReaderError("out_of_credits", OUT_OF_CREDITS, false);
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return new ReaderError("not_set_up", NOT_SET_UP, false);
    if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e.status === 408 || e.status === 409 || e.status === 529) {
      return new ReaderError("busy", "The reader was busy or could not be reached. It tries again by itself.", true);
    }
    if (e.status === 413) return new ReaderError("unreadable", "The file is too large for the reader. Split it and upload the parts.", false);
    if (e instanceof Anthropic.BadRequestError) return new ReaderError("unreadable", "The reader could not open this file. Try a clearer copy, or upload a CSV instead.", false);
  }
  return new ReaderError("unreadable", "The statement could not be read. It tries again by itself.", true);
}

export async function readStatement(input: ReaderInput, client: StreamClient, opts: { timeoutMs?: number } = {}): Promise<ReadOutput> {
  let msg: Anthropic.Beta.BetaMessage;
  try {
    msg = await client.beta.messages.stream(buildRequest(input), opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined).finalMessage();
  } catch (e) {
    throw readerErrorFrom(e);
  }
  const usage = usageOf(msg);
  if (msg.stop_reason === "refusal") throw new ReaderError("refused", "The reader declined this file. Upload a CSV instead.", false, usage);
  if (msg.stop_reason === "max_tokens") throw new ReaderError("too_long", "The statement is too long to read in one go. Split the PDF into smaller files and upload them.", false, usage);
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new ReaderError("unreadable", "The reader's answer could not be used. It tries again by itself.", true, usage); }
  return { ...usage, result: fromWire(raw, input.pages) };
}

// The SDK client with the server's key. Retries: the SDK's own (2) for passing problems.
export function apiClient(apiKey: string): StreamClient {
  return new Anthropic({ apiKey, maxRetries: 2 }) as unknown as StreamClient;
}

// ---------- The answer into a ReadResult

// "1,234.50", "$1234.5", "(15.20)", "-15.20", "15.20 CR" -> cents. Null when it cannot be read.
export function moneyCents(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  if (typeof v !== "string") return null;
  let s = v.trim().replace(/[$\s,]/g, "");
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/CR$/i.test(s)) { neg = !neg; s = s.slice(0, -2); } else if (/DR$/i.test(s)) s = s.slice(0, -2);
  if (s.endsWith("-")) { neg = !neg; s = s.slice(0, -1); }
  if (s.startsWith("-")) { neg = !neg; s = s.slice(1); }
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const c = Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
  return neg && c ? -c : c;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: unknown): d is string => {
  if (typeof d !== "string" || !DATE.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) ? v : null);

type WireLine = { date?: unknown; posted_date?: unknown; description?: unknown; amount?: unknown; direction?: unknown; balance?: unknown; page?: unknown; unsure?: unknown; unsure_reason?: unknown;
  card_kind?: unknown; cardholder_digits?: unknown };

// Round 26: a date with no printed year takes it from the period; a date a year off the statement period (a
// December line given January's year, or the reverse) is that same day in the period's other year. Only a year
// is changed, and only when the result falls inside the period (with 40 days for a card's earlier purchase date).
export function yearFixed(d: string, start: string, end: string): string {
  if (!DATE.test(d) || !DATE.test(start) || !DATE.test(end)) return d;
  const near = (x: string) => x >= shiftDays(start, -40) && x <= end;
  if (near(d)) return d;
  for (const k of [-1, 1]) {
    const y = String(+d.slice(0, 4) + k).padStart(4, "0") + d.slice(4);
    if (validDate(y) && near(y)) return y;
  }
  return d;
}
const shiftDays = (s: string, n: number) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) + n)).toISOString().slice(0, 10);
const KINDS = new Set(["purchase", "payment", "cash_advance", "interest", "fee"]);
type WireAccount = { last_digits?: unknown; name?: unknown; kind?: unknown; period_start?: unknown; period_end?: unknown; opening_balance?: unknown; closing_balance?: unknown; summary?: unknown; lines?: unknown };

export function fromWire(raw: unknown, pages: number): ReadResult {
  const w = (raw ?? {}) as { bank?: unknown; accounts?: unknown };
  let n = 0;
  const accounts: StatementAccount[] = (Array.isArray(w.accounts) ? (w.accounts as WireAccount[]) : []).map((a, i) => {
    const lines: StatementLine[] = (Array.isArray(a.lines) ? (a.lines as WireLine[]) : []).map((l) => {
      const why: string[] = [];
      const cents = moneyCents(l.amount);
      if (cents === null) why.push("the amount could not be read");
      const bal = l.balance === null || l.balance === undefined || l.balance === "" ? null : moneyCents(l.balance);
      if (bal === null && l.balance !== null && l.balance !== undefined && l.balance !== "") why.push("the balance could not be read");
      if (!validDate(l.date)) why.push("the date could not be read");
      const reason = [str(l.unsure_reason).trim(), ...why].filter(Boolean).join("; ");
      return {
        id: `l${++n}`,
        date: validDate(l.date) ? l.date : "",
        // Round 22 (decision 1): a card's posting date beside its transaction date; the year cut-off uses the transaction date.
        postedDate: a.kind === "card" && validDate(l.posted_date) ? l.posted_date : null,
        cardKind: a.kind === "card" && typeof l.card_kind === "string" && KINDS.has(l.card_kind) ? (l.card_kind as StatementLine["cardKind"]) : null,
        holder: a.kind === "card" ? str(l.cardholder_digits).replace(/\D/g, "").slice(-8) || null : null,
        description: str(l.description).replace(/\s+/g, " ").trim(),
        amountCents: Math.abs(cents ?? 0),
        dir: l.direction === "out" ? "out" : "in",
        balanceCents: bal,
        page: Math.max(1, Math.min(int(l.page) ?? 1, Math.max(pages, 1))),
        unsure: l.unsure === true || why.length > 0,
        unsureReason: l.unsure === true || why.length > 0 ? reason || "not sure" : "",
        source: "read",
      };
    });
    const dates = lines.map((l) => l.date).filter(Boolean).sort();
    const periodStart = validDate(a.period_start) ? a.period_start : dates[0] ?? "";
    const periodEnd = validDate(a.period_end) ? a.period_end : dates[dates.length - 1] ?? "";
    for (const l of lines) {
      if (!l.date) l.date = periodStart; // kept in For review by its reason
      l.date = yearFixed(l.date, periodStart, periodEnd);
      if (l.postedDate) l.postedDate = yearFixed(l.postedDate, periodStart, periodEnd);
    }
    const s = a.summary as { money_in_total?: unknown; money_in_count?: unknown; money_out_total?: unknown; money_out_count?: unknown; interest_total?: unknown; fees_total?: unknown;
      purchases_total?: unknown; cash_advances_total?: unknown } | null;
    const sIn = s ? moneyCents(s.money_in_total) : null, sOut = s ? moneyCents(s.money_out_total) : null;
    const opt = (v: unknown) => (a.kind === "card" && v !== null && v !== undefined && v !== "" ? moneyCents(v) : null);
    const sInt = s ? opt(s.interest_total) : null, sFee = s ? opt(s.fees_total) : null, sPur = s ? opt(s.purchases_total) : null, sCash = s ? opt(s.cash_advances_total) : null;
    return {
      key: `a${i + 1}`,
      last4: str(a.last_digits).replace(/\D/g, "").slice(-8),
      name: str(a.name).trim(),
      kind: a.kind === "card" ? "card" : "bank",
      periodStart, periodEnd,
      opening: moneyCents(a.opening_balance) ?? 0,
      closing: moneyCents(a.closing_balance) ?? 0,
      summary: s && sIn !== null && sOut !== null ? { inTotal: Math.abs(sIn), inCount: int(s.money_in_count), outTotal: Math.abs(sOut), outCount: int(s.money_out_count),
        interest: sInt === null ? null : Math.abs(sInt), fees: sFee === null ? null : Math.abs(sFee),
        purchases: sPur === null ? null : Math.abs(sPur), cashAdvances: sCash === null ? null : Math.abs(sCash) } : null,
      lines,
    };
  });
  return { bank: str(w.bank).trim(), pages, accounts };
}
