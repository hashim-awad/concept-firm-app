// Screening engine: checks answers and turns them into priced lines.
// Pure functions, no framework imports, so the admin "Try it" page, the public form and the
// tests all use exactly the same logic. See tests/screening-engine.test.ts.

export type AnswerType = "yes_no" | "number" | "single_choice" | "province" | "text" | "email" | "phone";
export type Op = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "answered" | "not_answered" | "gt_question";
export type Condition = { question: string; op: Op; value?: unknown };

export type Question = {
  key: string;
  section: string;
  prompt: string;
  help_text: string;
  answer_type: AnswerType;
  options: { value: string; label: string }[];
  required: boolean;
  per_person: boolean;
  min_value: number | null;
  max_value: number | null;
  show_if: Condition | null;
  sort_order: number;
};

export type Rule = {
  kind: "add_item" | "out_of_scope" | "check";
  conditions: Condition[];
  item_code: string | null;
  quantity_question_key: string | null;
  message: string;
  sort_order: number;
};

export type Questionnaire = {
  couple_question_key: string | null;
  couple_value: string | null;
  questions: Question[];
  rules: Rule[];
};

export type PricedItem = { code: string; name: string; unit_label: string; amount_cents: number };

export type Answer = string | number | null | undefined;
export type Answers = { household: Record<string, Answer>; people: Record<string, Answer>[] };

export type Line = {
  code: string;
  name: string;
  unit_label: string;
  person: number | null; // 0 = first person, 1 = spouse, null = household
  quantity: number;
  unit_cents: number;
  total_cents: number;
};

export type Result = {
  personCount: number;
  errors: { key: string; person: number | null; message: string }[];
  outOfScope: { reason: string; person: number | null }[];
  lines: Line[];
  subtotal_cents: number;
};

export const PROVINCES: { value: string; label: string }[] = [
  { value: "AB", label: "Alberta" },
  { value: "BC", label: "British Columbia" },
  { value: "MB", label: "Manitoba" },
  { value: "NB", label: "New Brunswick" },
  { value: "NL", label: "Newfoundland and Labrador" },
  { value: "NS", label: "Nova Scotia" },
  { value: "NT", label: "Northwest Territories" },
  { value: "NU", label: "Nunavut" },
  { value: "ON", label: "Ontario" },
  { value: "PE", label: "Prince Edward Island" },
  { value: "QC", label: "Quebec" },
  { value: "SK", label: "Saskatchewan" },
  { value: "YT", label: "Yukon" },
];

export function isAnswered(v: Answer): boolean {
  return v !== null && v !== undefined && String(v).trim() !== "";
}

export function personCount(q: Pick<Questionnaire, "couple_question_key" | "couple_value">, household: Record<string, Answer>) {
  if (!q.couple_question_key) return 1;
  return String(household[q.couple_question_key] ?? "") === q.couple_value ? 2 : 1;
}

function scopeFor(answers: Answers, person: number | null): Record<string, Answer> {
  return person === null ? { ...answers.household } : { ...answers.household, ...(answers.people[person] ?? {}) };
}

export function conditionHolds(c: Condition, scope: Record<string, Answer>): boolean {
  const a = scope[c.question];
  switch (c.op) {
    case "answered":
      return isAnswered(a);
    case "not_answered":
      return !isAnswered(a);
    case "eq":
      return isAnswered(a) && String(a) === String(c.value);
    case "neq":
      return !isAnswered(a) || String(a) !== String(c.value);
    case "in":
      return isAnswered(a) && Array.isArray(c.value) && c.value.map(String).includes(String(a));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (!isAnswered(a)) return false;
      const x = Number(a);
      const y = Number(c.value);
      if (Number.isNaN(x) || Number.isNaN(y)) return false;
      return c.op === "gt" ? x > y : c.op === "gte" ? x >= y : c.op === "lt" ? x < y : x <= y;
    }
    case "gt_question": {
      const b = scope[String(c.value)];
      if (!isAnswered(a) || !isAnswered(b)) return false;
      return Number(a) > Number(b);
    }
    default:
      return false;
  }
}

// A question is shown when it has no condition, or its condition holds.
export function isVisible(q: Question, scope: Record<string, Answer>) {
  return !q.show_if || conditionHolds(q.show_if, scope);
}

// Drops answers to questions that are hidden or not part of this questionnaire,
// and trims the people list to the number of people filing.
export function cleanAnswers(qn: Questionnaire, raw: Answers): Answers {
  const sorted = [...qn.questions].sort((a, b) => a.sort_order - b.sort_order);
  const household: Record<string, Answer> = {};
  for (const q of sorted.filter((q) => !q.per_person)) {
    if (isVisible(q, household)) household[q.key] = normalise(q, raw.household[q.key]);
  }
  const count = personCount(qn, household);
  const people: Record<string, Answer>[] = [];
  for (let i = 0; i < count; i++) {
    const p: Record<string, Answer> = {};
    for (const q of sorted.filter((q) => q.per_person)) {
      if (isVisible(q, { ...household, ...p })) p[q.key] = normalise(q, raw.people[i]?.[q.key]);
    }
    people.push(p);
  }
  return { household, people };
}

function normalise(q: Question, v: Answer): Answer {
  if (!isAnswered(v)) return null;
  if (q.answer_type === "number") {
    const n = Number(v);
    return Number.isNaN(n) ? String(v) : n;
  }
  return String(v).trim();
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateOne(q: Question, v: Answer): string | null {
  if (!isAnswered(v)) return q.required ? "Please answer this question." : null;
  switch (q.answer_type) {
    case "yes_no":
      return v === "yes" || v === "no" ? null : "Choose yes or no.";
    case "number": {
      if (typeof v !== "number" || !Number.isInteger(v)) return "Enter a whole number.";
      if (q.min_value !== null && v < q.min_value) return `Enter ${q.min_value} or more.`;
      if (q.max_value !== null && v > q.max_value) return `Enter ${q.max_value} or less.`;
      return null;
    }
    case "single_choice":
      return q.options.some((o) => o.value === v) ? null : "Choose one of the options.";
    case "province":
      return PROVINCES.some((p) => p.value === v) ? null : "Choose a province or territory.";
    case "email":
      return EMAIL.test(String(v)) ? null : "Enter a valid email address.";
    case "phone":
      return String(v).replace(/\D/g, "").length >= 10 ? null : "Enter a phone number with area code.";
    default:
      return String(v).length <= 500 ? null : "Keep this under 500 characters.";
  }
}

function usesPerPerson(rule: Rule, perPersonKeys: Set<string>) {
  return rule.conditions.some((c) => perPersonKeys.has(c.question))
    || (rule.quantity_question_key !== null && perPersonKeys.has(rule.quantity_question_key));
}

export function evaluate(qn: Questionnaire, raw: Answers, items: PricedItem[]): Result {
  const answers = cleanAnswers(qn, raw);
  const count = answers.people.length;
  const sorted = [...qn.questions].sort((a, b) => a.sort_order - b.sort_order);
  const perPersonKeys = new Set(qn.questions.filter((q) => q.per_person).map((q) => q.key));
  const result: Result = { personCount: count, errors: [], outOfScope: [], lines: [], subtotal_cents: 0 };

  // 1. Each shown question answered and valid.
  for (const q of sorted) {
    const targets: (number | null)[] = q.per_person ? [...Array(count).keys()] : [null];
    for (const person of targets) {
      const scope = scopeFor(answers, person);
      if (!isVisible(q, scope)) continue;
      const msg = validateOne(q, scope[q.key]);
      if (msg) result.errors.push({ key: q.key, person, message: msg });
    }
  }
  if (result.errors.length > 0) return result;

  const rules = [...qn.rules].sort((a, b) => a.sort_order - b.sort_order);
  const targetsFor = (r: Rule): (number | null)[] => (usesPerPerson(r, perPersonKeys) ? [...Array(count).keys()] : [null]);

  // 2. Checks that compare answers.
  for (const r of rules.filter((r) => r.kind === "check")) {
    for (const person of targetsFor(r)) {
      if (r.conditions.length > 0 && r.conditions.every((c) => conditionHolds(c, scopeFor(answers, person)))) {
        result.errors.push({ key: r.conditions[0].question, person, message: r.message });
      }
    }
  }
  if (result.errors.length > 0) return result;

  // 3. Out of scope.
  for (const r of rules.filter((r) => r.kind === "out_of_scope")) {
    for (const person of targetsFor(r)) {
      if (r.conditions.length > 0 && r.conditions.every((c) => conditionHolds(c, scopeFor(answers, person)))) {
        result.outOfScope.push({ reason: r.message, person });
      }
    }
  }
  if (result.outOfScope.length > 0) return result;

  // 4. Priced lines.
  const byCode = new Map(items.map((i) => [i.code, i]));
  for (const r of rules.filter((r) => r.kind === "add_item")) {
    for (const person of targetsFor(r)) {
      const scope = scopeFor(answers, person);
      if (r.conditions.length === 0 || !r.conditions.every((c) => conditionHolds(c, scope))) continue;
      const item = byCode.get(r.item_code ?? "");
      if (!item) throw new Error(`Price book has no current price for ${r.item_code}.`);
      const quantity = r.quantity_question_key ? Number(scope[r.quantity_question_key] ?? 0) : 1;
      if (!(quantity > 0)) continue;
      result.lines.push({
        code: item.code,
        name: item.name,
        unit_label: item.unit_label,
        person,
        quantity,
        unit_cents: item.amount_cents,
        total_cents: item.amount_cents * quantity,
      });
    }
  }
  result.subtotal_cents = result.lines.reduce((s, l) => s + l.total_cents, 0);
  return result;
}

export function formatCents(cents: number) {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}
