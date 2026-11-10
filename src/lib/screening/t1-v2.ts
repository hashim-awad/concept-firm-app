// Personal tax (T1) screening, version 2: Phase 2 batch, section 4, word for word where the batch
// gives wording. This file is the source for the migration that publishes it
// (latest: supabase/migrations/20261110060000_t1_screening_no_hint.sql, made by scripts/gen-t1-screening-sql.ts) and
// for the tests. After it is published, owners change it on the Screening questions page (a new
// draft); this file is not used by the app at run time.
//
// {moving_km}, {t1135_simple_over} and {t1135_detailed_from} are filled from Settings, T1 rule values,
// when the question is shown, so a CRA change needs no code (batch section 4, "Rules checked").
import type { Condition, Op, Question, Rule } from "./engine.ts";

export const T1_V2_TITLE = "Your personal tax return";
export const T1_V2_INTRO = "Answer a few questions. We use your answers to prepare your quote. There is no SIN and no document upload at this stage.";
export const T1_V2_COUPLE = { key: "filing_type", value: "couple" };

const YN = "yes_no" as const;
type Q = Omit<Question, "options" | "required" | "per_person" | "min_value" | "max_value" | "show_if" | "help_text"> & Partial<Question>;
const q = (x: Q): Question => ({ options: [], required: true, per_person: false, min_value: null, max_value: null, show_if: null, help_text: "", ...x });
const when = (question: string, op: Op, value?: unknown): Condition => ({ question, op, value });

const CHECKS = "Quick checks";
const WHO = "Who is filing";
const INCOME = "Your income and claims";

export const T1_V2_QUESTIONS: Question[] = [
  // Section 2: fit check. Out-of-scope answers come early, so clients who don't fit stop quickly.
  q({ key: "lived_in_canada", section: CHECKS, prompt: "Did you live in Canada for the whole year?", answer_type: YN, sort_order: 10 }),
  q({ key: "us_citizen", section: CHECKS, prompt: "Are you a US citizen or green card holder?", answer_type: YN, sort_order: 20 }),
  q({ key: "deceased_or_trust", section: CHECKS, prompt: "Is this return for someone who passed away, or for a trust?", answer_type: YN, sort_order: 30 }),
  q({ key: "earlier_year", section: CHECKS, prompt: "Do you need a return for an earlier year, or a change to one already filed?", answer_type: YN, sort_order: 40 }),
  q({ key: "cra_review", section: CHECKS, prompt: "Is CRA reviewing or auditing any of your returns right now?", answer_type: YN, sort_order: 50 }),

  // Section 3: who is filing.
  q({ key: "filing_type", section: WHO, prompt: "Who is filing?", answer_type: "single_choice", sort_order: 60,
    options: [{ value: "single", label: "Just me" }, { value: "couple", label: "Me and my spouse or partner, living together" }] }),
  q({ key: "spouse_first_name", section: WHO, prompt: "Your spouse or partner's first name", answer_type: "text", sort_order: 70, show_if: when("filing_type", "eq", "couple") }),
  q({ key: "spouse_last_name", section: WHO, prompt: "Your spouse or partner's last name", answer_type: "text", sort_order: 72, show_if: when("filing_type", "eq", "couple") }),
  q({ key: "spouse_email", section: WHO, prompt: "Your spouse or partner's email", help_text: "We send them their own link to sign.", answer_type: "email", sort_order: 74, show_if: when("filing_type", "eq", "couple") }),

  // Section 4: income and claims. Per-property and per-business items are once per household;
  // per-return items are asked for each person (couples answer Me, Spouse or Both).
  q({ key: "self_employed", section: INCOME, prompt: "Did you have self-employment or commission income, not through a corporation?", answer_type: YN, sort_order: 100 }),
  q({ key: "business_count", section: INCOME, prompt: "How many businesses?", help_text: "Count all businesses in your household once.", answer_type: "number", min_value: 1, max_value: 10, sort_order: 110, show_if: when("self_employed", "eq", "yes") }),
  q({ key: "business_totals", section: INCOME, prompt: "Can you give us total income and expenses for each business?", answer_type: YN, sort_order: 120, show_if: when("self_employed", "eq", "yes") }),
  q({ key: "vehicle_count", section: INCOME, prompt: "How many vehicles did you use for the business?", help_text: "Enter 0 if none.", answer_type: "number", min_value: 0, max_value: 10, sort_order: 130, show_if: when("self_employed", "eq", "yes") }),
  q({ key: "home_office_count", section: INCOME, prompt: "For how many businesses did you work from home?", help_text: "Enter 0 if none.", answer_type: "number", min_value: 0, max_value: 10, sort_order: 140, show_if: when("self_employed", "eq", "yes") }),
  q({ key: "gst_registered", section: INCOME, prompt: "Is the business registered for GST/HST?", answer_type: YN, sort_order: 150, show_if: when("self_employed", "eq", "yes") }),
  q({ key: "gst_frequency", section: INCOME, prompt: "How often do you file GST/HST returns?", answer_type: "single_choice", sort_order: 160, show_if: when("gst_registered", "eq", "yes"),
    options: [{ value: "1", label: "Once a year" }, { value: "4", label: "Every 3 months" }, { value: "12", label: "Every month" }] }),

  q({ key: "rental", section: INCOME, prompt: "Did you have rental income, including Airbnb or a rented basement?", answer_type: YN, sort_order: 200 }),
  q({ key: "rental_count", section: INCOME, prompt: "How many rental addresses?", help_text: "A property you own with your spouse or partner counts once. Short-term rentals count too.", answer_type: "number", min_value: 1, max_value: 20, sort_order: 210, show_if: when("rental", "eq", "yes") }),

  q({ key: "sold_property", section: INCOME, prompt: "Did you sell a property this year?", answer_type: YN, sort_order: 300 }),
  q({ key: "sold_home", section: INCOME, prompt: "Did you sell your home, the place you lived in?", answer_type: YN, sort_order: 310, show_if: when("sold_property", "eq", "yes") }),
  q({ key: "property_sale_count", section: INCOME, prompt: "How many other properties did you sell?", help_text: "Rentals, investment properties, properties owned under 12 months, and assignments. Enter 0 if none.", answer_type: "number", min_value: 0, max_value: 20, sort_order: 320, show_if: when("sold_property", "eq", "yes") }),
  q({ key: "assignment", section: INCOME, prompt: "Was any of these an assignment sale?", answer_type: YN, sort_order: 330, show_if: when("property_sale_count", "gt", 0) }),
  q({ key: "assignment_gst", section: INCOME, prompt: "Was GST/HST handled at closing?", answer_type: "single_choice", sort_order: 340, show_if: when("assignment", "eq", "yes"),
    options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }, { value: "not_sure", label: "Not sure" }] }),

  q({ key: "investment_sales", section: INCOME, prompt: "Did you sell stocks, ETFs or mutual funds outside an RRSP or TFSA?", answer_type: YN, per_person: true, sort_order: 400 }),
  q({ key: "crypto", section: INCOME, prompt: "Did you trade crypto or options?", answer_type: YN, per_person: true, sort_order: 410 }),
  q({ key: "crypto_report", section: INCOME, prompt: "Do you have a gains report from your exchange or crypto software?", answer_type: YN, per_person: true, sort_order: 420, show_if: when("crypto", "eq", "yes") }),
  q({ key: "foreign_property", section: INCOME, prompt: "Did you own foreign property (accounts, shares, property abroad) that cost more than {t1135_simple_over} in total at any time in the year?", help_text: "Use what it cost you, not what it is worth.", answer_type: YN, per_person: true, sort_order: 430 }),
  q({ key: "foreign_property_high", section: INCOME, prompt: "Did it cost {t1135_detailed_from} or more at any time in the year?", answer_type: YN, per_person: true, sort_order: 440, show_if: when("foreign_property", "eq", "yes") }),
  q({ key: "foreign_income", section: INCOME, prompt: "Did you have income from outside Canada with no Canadian slip?", help_text: "For example a foreign pension, a job or bank interest.", answer_type: YN, per_person: true, sort_order: 450 }),
  q({ key: "foreign_return", section: INCOME, prompt: "Do you need a tax return filed in another country?", answer_type: YN, per_person: true, sort_order: 460 }),
  q({ key: "foreign_return_country", section: INCOME, prompt: "Which country?", answer_type: "single_choice", per_person: true, sort_order: 470, show_if: when("foreign_return", "eq", "yes"),
    options: [{ value: "us", label: "The United States" }, { value: "other", label: "Another country" }] }),
  q({ key: "us_state_count", section: INCOME, prompt: "How many US state returns?", help_text: "Enter 0 if none.", answer_type: "number", min_value: 0, max_value: 10, per_person: true, sort_order: 480, show_if: when("foreign_return_country", "eq", "us") }),

  q({ key: "t5013", section: INCOME, prompt: "Did you get a T5013 slip from a partnership?", answer_type: YN, sort_order: 500 }),
  q({ key: "t5013_count", section: INCOME, prompt: "How many partnerships?", answer_type: "number", min_value: 1, max_value: 10, sort_order: 510, show_if: when("t5013", "eq", "yes") }),
  q({ key: "t2200", section: INCOME, prompt: "Did you get a signed T2200 from your employer?", answer_type: YN, per_person: true, sort_order: 520 }),
  q({ key: "moving", section: INCOME, prompt: "Did you move at least {moving_km} km closer to a new job, business or full-time school?", answer_type: YN, per_person: true, sort_order: 530 }),
  q({ key: "anything_else", section: INCOME, prompt: "Anything else we should know?", answer_type: "text", required: false, sort_order: 600 }),
];

const oos = (sort_order: number, message: string, ...conditions: Rule["conditions"]): Rule => ({ kind: "out_of_scope", conditions, item_code: null, quantity_question_key: null, message, sort_order });
const check = (sort_order: number, message: string, ...conditions: Rule["conditions"]): Rule => ({ kind: "check", conditions, item_code: null, quantity_question_key: null, message, sort_order });
const add = (sort_order: number, item_code: string, quantity_question_key: string | null, ...conditions: Rule["conditions"]): Rule => ({ kind: "add_item", conditions, item_code, quantity_question_key, message: "", sort_order });
const c = (question: string, op: Op, value?: unknown): Condition => (value === undefined ? { question, op } : { question, op, value });

export const T1_V2_RULES: Rule[] = [
  // Out of scope: polite message, lead flagged, no quote. The message is for staff.
  oos(10, "Did not live in Canada for the whole year", c("lived_in_canada", "eq", "no")),
  oos(20, "US citizen or green card holder", c("us_citizen", "eq", "yes")),
  oos(30, "Return for someone who passed away, or for a trust", c("deceased_or_trust", "eq", "yes")),
  oos(40, "Earlier year, or a change to a filed return", c("earlier_year", "eq", "yes")),
  oos(50, "CRA review or audit underway", c("cra_review", "eq", "yes")),
  oos(60, "Cannot give total income and expenses for each business", c("business_totals", "eq", "no")),
  oos(70, "Assignment sale: GST/HST not handled at closing, or not sure", c("assignment_gst", "in", ["no", "not_sure"])),
  oos(80, "Crypto or options: no gains report", c("crypto_report", "eq", "no")),
  oos(90, "Tax return needed in a country other than the US", c("foreign_return_country", "eq", "other")),
  // Checks: the answers do not add up.
  check(100, "This cannot be more than the number of businesses.", c("home_office_count", "gt_question", "business_count")),
  check(110, "You said you sold a property. Tell us if it was your home, or how many other properties.", c("sold_home", "eq", "no"), c("property_sale_count", "lte", 0)),
  // Prices (section 4).
  add(200, "PTX-110", null, c("filing_type", "eq", "single")),
  add(210, "PTX-111", null, c("filing_type", "eq", "couple")),
  add(220, "PTX-121", "business_count", c("business_count", "gt", 0)),
  add(230, "PTX-122", "vehicle_count", c("vehicle_count", "gt", 0)),
  add(240, "PTX-123", "home_office_count", c("home_office_count", "gt", 0)),
  add(250, "PTX-124", "gst_frequency", c("gst_frequency", "answered")),
  add(260, "PTX-120", "rental_count", c("rental_count", "gt", 0)),
  add(270, "PTX-126", null, c("sold_home", "eq", "yes")),
  add(280, "PTX-127", "property_sale_count", c("property_sale_count", "gt", 0)),
  add(290, "PTX-125", null, c("investment_sales", "eq", "yes")),
  add(300, "PTX-133", null, c("crypto", "eq", "yes")),
  add(310, "PTX-128", null, c("foreign_property", "eq", "yes"), c("foreign_property_high", "eq", "no")),
  add(320, "PTX-129", null, c("foreign_property_high", "eq", "yes")),
  add(330, "PTX-130", null, c("foreign_income", "eq", "yes")),
  add(340, "PTX-135", null, c("foreign_return_country", "eq", "us")),
  add(350, "PTX-136", "us_state_count", c("us_state_count", "gt", 0)),
  add(360, "PTX-134", "t5013_count", c("t5013_count", "gt", 0)),
  add(370, "PTX-131", null, c("t2200", "eq", "yes")),
  add(380, "PTX-132", null, c("moving", "eq", "yes")),
];

// The prices section 4 sets, in cents. The migration refuses to publish if the price book differs,
// so a quote never goes out at a price nobody decided.
export const T1_V2_PRICES: Record<string, number> = {
  "PTX-110": 29900, "PTX-111": 34900, "PTX-120": 24900, "PTX-121": 49900, "PTX-122": 15000, "PTX-123": 15000, "PTX-124": 14900,
  "PTX-125": 9900, "PTX-126": 9900, "PTX-127": 24900, "PTX-128": 14900, "PTX-129": 29900, "PTX-130": 14900, "PTX-131": 14900,
  "PTX-132": 14900, "PTX-133": 24900, "PTX-134": 14900, "PTX-135": 79900, "PTX-136": 24900,
};

// Fill the rule values from Settings into a prompt or help text.
export type T1Rules = { moving_km?: number | string; t1135_simple_over?: number | string; t1135_detailed_from?: number | string };
const dollars = (v: number | string | undefined) => (v === undefined || v === "" ? "?" : `$${Number(v).toLocaleString("en-CA")}`);
export function fillRuleValues(text: string, r: T1Rules): string {
  return text
    .replaceAll("{moving_km}", r.moving_km === undefined || r.moving_km === "" ? "?" : String(r.moving_km))
    .replaceAll("{t1135_simple_over}", dollars(r.t1135_simple_over))
    .replaceAll("{t1135_detailed_from}", dollars(r.t1135_detailed_from));
}
