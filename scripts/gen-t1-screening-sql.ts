// Prints the SQL that publishes T1 screening version 2, from src/lib/screening/t1-v2.ts.
// Run: node scripts/gen-t1-screening-sql.ts
// The output sits between the BEGIN/END GENERATED lines in
// supabase/migrations/20261110040000_t1_screening.sql; tests/t1-screening.test.ts checks they match.
import { T1_V2_COUPLE, T1_V2_INTRO, T1_V2_PRICES, T1_V2_QUESTIONS, T1_V2_RULES, T1_V2_TITLE } from "../src/lib/screening/t1-v2.ts";

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  return `'${String(v).replaceAll("'", "''")}'`;
};
const json = (v: unknown) => (v === null || v === undefined ? "null" : `${lit(JSON.stringify(v))}::jsonb`);

export function generate(): string {
  const out: string[] = [];
  out.push("  -- The prices section 4 sets. Refuse to publish if the price book differs.");
  out.push("  for v_row in select e.code, e.cents, p.amount_cents from (values");
  out.push(Object.entries(T1_V2_PRICES).map(([code, cents]) => `      (${lit(code)}, ${cents})`).join(",\n"));
  out.push("    ) as e(code, cents)");
  out.push("    left join public.catalogue_items i on i.code = e.code");
  out.push("    left join public.current_item_prices p on p.item_id = i.id");
  out.push("  loop");
  out.push("    if v_row.amount_cents is distinct from v_row.cents then");
  out.push("      v_bad := v_bad || format('%s: price book %s, batch %s', v_row.code, coalesce((v_row.amount_cents / 100.0)::text, 'missing'), v_row.cents / 100.0);");
  out.push("    end if;");
  out.push("  end loop;");
  out.push("  if array_length(v_bad, 1) > 0 then");
  out.push("    raise exception 'T1 screening not published. The price book differs from Phase 2 batch section 4: %', array_to_string(v_bad, '; ');");
  out.push("  end if;");
  out.push("");
  out.push("  insert into public.questionnaires (route, version, status, title, intro, couple_question_key, couple_value)");
  out.push(`  values ('personal', v_version, 'draft', ${lit(T1_V2_TITLE)}, ${lit(T1_V2_INTRO)}, ${lit(T1_V2_COUPLE.key)}, ${lit(T1_V2_COUPLE.value)})`);
  out.push("  returning id into v_q;");
  out.push("");
  out.push("  insert into public.questions (questionnaire_id, key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order) values");
  out.push(T1_V2_QUESTIONS.map((q) => `  (v_q, ${[q.key, q.section, q.prompt, q.help_text, q.answer_type].map(lit).join(", ")}, ${json(q.options)}, ${lit(q.required)}, ${lit(q.per_person)}, ${lit(q.min_value)}, ${lit(q.max_value)}, ${json(q.show_if)}, ${q.sort_order})`).join(",\n") + ";");
  out.push("");
  out.push("  insert into public.rules (questionnaire_id, kind, conditions, item_code, quantity_question_key, message, sort_order) values");
  out.push(T1_V2_RULES.map((r) => `  (v_q, ${lit(r.kind)}, ${json(r.conditions)}, ${lit(r.item_code)}, ${lit(r.quantity_question_key)}, ${lit(r.message)}, ${r.sort_order})`).join(",\n") + ";");
  return out.join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) process.stdout.write(generate() + "\n");
