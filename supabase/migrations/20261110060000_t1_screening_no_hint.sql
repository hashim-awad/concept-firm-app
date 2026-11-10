-- Step 6 redesign (Hashim, Nov 10): the repeated hint "If you are filing with your spouse or partner,
-- answer for both of you." is removed from every question. Same questions, prices and routing.
-- The publish function is re-created with the new wording (from src/lib/screening/t1-v2.ts).
create or replace function private.publish_t1_screening()
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_q uuid;
  v_version int;
  v_row record;
  v_bad text[] := '{}';
begin
  if exists (select 1 from public.questionnaires where route = 'personal' and status = 'draft') then
    raise exception 'T1 screening not published: a personal draft exists. Delete it on Screening questions, then deploy again.';
  end if;
  v_version := (select coalesce(max(version), 0) + 1 from public.questionnaires where route = 'personal');
-- BEGIN GENERATED (scripts/gen-t1-screening-sql.ts)
  -- The prices section 4 sets. Refuse to publish if the price book differs.
  for v_row in select e.code, e.cents, p.amount_cents from (values
      ('PTX-110', 29900),
      ('PTX-111', 34900),
      ('PTX-120', 24900),
      ('PTX-121', 49900),
      ('PTX-122', 15000),
      ('PTX-123', 15000),
      ('PTX-124', 14900),
      ('PTX-125', 9900),
      ('PTX-126', 9900),
      ('PTX-127', 24900),
      ('PTX-128', 14900),
      ('PTX-129', 29900),
      ('PTX-130', 14900),
      ('PTX-131', 14900),
      ('PTX-132', 14900),
      ('PTX-133', 24900),
      ('PTX-134', 14900),
      ('PTX-135', 79900),
      ('PTX-136', 24900)
    ) as e(code, cents)
    left join public.catalogue_items i on i.code = e.code
    left join public.current_item_prices p on p.item_id = i.id
  loop
    if v_row.amount_cents is distinct from v_row.cents then
      v_bad := v_bad || format('%s: price book %s, batch %s', v_row.code, coalesce((v_row.amount_cents / 100.0)::text, 'missing'), v_row.cents / 100.0);
    end if;
  end loop;
  if array_length(v_bad, 1) > 0 then
    raise exception 'T1 screening not published. The price book differs from Phase 2 batch section 4: %', array_to_string(v_bad, '; ');
  end if;

  insert into public.questionnaires (route, version, status, title, intro, couple_question_key, couple_value)
  values ('personal', v_version, 'draft', 'Your personal tax return', 'Answer a few questions. We use your answers to prepare your quote. There is no SIN and no document upload at this stage.', 'filing_type', 'couple')
  returning id into v_q;

  insert into public.questions (questionnaire_id, key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order) values
  (v_q, 'lived_in_canada', 'Quick checks', 'Did you live in Canada for the whole year?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 10),
  (v_q, 'us_citizen', 'Quick checks', 'Are you a US citizen or green card holder?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 20),
  (v_q, 'deceased_or_trust', 'Quick checks', 'Is this return for someone who passed away, or for a trust?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 30),
  (v_q, 'earlier_year', 'Quick checks', 'Do you need a return for an earlier year, or a change to one already filed?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 40),
  (v_q, 'cra_review', 'Quick checks', 'Is CRA reviewing or auditing any of your returns right now?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 50),
  (v_q, 'filing_type', 'Who is filing', 'Who is filing?', '', 'single_choice', '[{"value":"single","label":"Just me"},{"value":"couple","label":"Me and my spouse or partner, living together"}]'::jsonb, true, false, null, null, null, 60),
  (v_q, 'spouse_first_name', 'Who is filing', 'Your spouse or partner''s first name', '', 'text', '[]'::jsonb, true, false, null, null, '{"question":"filing_type","op":"eq","value":"couple"}'::jsonb, 70),
  (v_q, 'spouse_last_name', 'Who is filing', 'Your spouse or partner''s last name', '', 'text', '[]'::jsonb, true, false, null, null, '{"question":"filing_type","op":"eq","value":"couple"}'::jsonb, 72),
  (v_q, 'spouse_email', 'Who is filing', 'Your spouse or partner''s email', 'We send them their own link to sign.', 'email', '[]'::jsonb, true, false, null, null, '{"question":"filing_type","op":"eq","value":"couple"}'::jsonb, 74),
  (v_q, 'self_employed', 'Your income and claims', 'Did you have self-employment or commission income, not through a corporation?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 100),
  (v_q, 'business_count', 'Your income and claims', 'How many businesses?', 'Count all businesses in your household once.', 'number', '[]'::jsonb, true, false, 1, 10, '{"question":"self_employed","op":"eq","value":"yes"}'::jsonb, 110),
  (v_q, 'business_totals', 'Your income and claims', 'Can you give us total income and expenses for each business?', '', 'yes_no', '[]'::jsonb, true, false, null, null, '{"question":"self_employed","op":"eq","value":"yes"}'::jsonb, 120),
  (v_q, 'vehicle_count', 'Your income and claims', 'How many vehicles did you use for the business?', 'Enter 0 if none.', 'number', '[]'::jsonb, true, false, 0, 10, '{"question":"self_employed","op":"eq","value":"yes"}'::jsonb, 130),
  (v_q, 'home_office_count', 'Your income and claims', 'For how many businesses did you work from home?', 'Enter 0 if none.', 'number', '[]'::jsonb, true, false, 0, 10, '{"question":"self_employed","op":"eq","value":"yes"}'::jsonb, 140),
  (v_q, 'gst_registered', 'Your income and claims', 'Is the business registered for GST/HST?', '', 'yes_no', '[]'::jsonb, true, false, null, null, '{"question":"self_employed","op":"eq","value":"yes"}'::jsonb, 150),
  (v_q, 'gst_frequency', 'Your income and claims', 'How often do you file GST/HST returns?', '', 'single_choice', '[{"value":"1","label":"Once a year"},{"value":"4","label":"Every 3 months"},{"value":"12","label":"Every month"}]'::jsonb, true, false, null, null, '{"question":"gst_registered","op":"eq","value":"yes"}'::jsonb, 160),
  (v_q, 'rental', 'Your income and claims', 'Did you have rental income, including Airbnb or a rented basement?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 200),
  (v_q, 'rental_count', 'Your income and claims', 'How many rental addresses?', 'A property you own with your spouse or partner counts once. Short-term rentals count too.', 'number', '[]'::jsonb, true, false, 1, 20, '{"question":"rental","op":"eq","value":"yes"}'::jsonb, 210),
  (v_q, 'sold_property', 'Your income and claims', 'Did you sell a property this year?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 300),
  (v_q, 'sold_home', 'Your income and claims', 'Did you sell your home, the place you lived in?', '', 'yes_no', '[]'::jsonb, true, false, null, null, '{"question":"sold_property","op":"eq","value":"yes"}'::jsonb, 310),
  (v_q, 'property_sale_count', 'Your income and claims', 'How many other properties did you sell?', 'Rentals, investment properties, properties owned under 12 months, and assignments. Enter 0 if none.', 'number', '[]'::jsonb, true, false, 0, 20, '{"question":"sold_property","op":"eq","value":"yes"}'::jsonb, 320),
  (v_q, 'assignment', 'Your income and claims', 'Was any of these an assignment sale?', '', 'yes_no', '[]'::jsonb, true, false, null, null, '{"question":"property_sale_count","op":"gt","value":0}'::jsonb, 330),
  (v_q, 'assignment_gst', 'Your income and claims', 'Was GST/HST handled at closing?', '', 'single_choice', '[{"value":"yes","label":"Yes"},{"value":"no","label":"No"},{"value":"not_sure","label":"Not sure"}]'::jsonb, true, false, null, null, '{"question":"assignment","op":"eq","value":"yes"}'::jsonb, 340),
  (v_q, 'investment_sales', 'Your income and claims', 'Did you sell stocks, ETFs or mutual funds outside an RRSP or TFSA?', '', 'yes_no', '[]'::jsonb, true, true, null, null, null, 400),
  (v_q, 'crypto', 'Your income and claims', 'Did you trade crypto or options?', '', 'yes_no', '[]'::jsonb, true, true, null, null, null, 410),
  (v_q, 'crypto_report', 'Your income and claims', 'Do you have a gains report from your exchange or crypto software?', '', 'yes_no', '[]'::jsonb, true, true, null, null, '{"question":"crypto","op":"eq","value":"yes"}'::jsonb, 420),
  (v_q, 'foreign_property', 'Your income and claims', 'Did you own foreign property (accounts, shares, property abroad) that cost more than {t1135_simple_over} in total at any time in the year?', 'Use what it cost you, not what it is worth.', 'yes_no', '[]'::jsonb, true, true, null, null, null, 430),
  (v_q, 'foreign_property_high', 'Your income and claims', 'Did it cost {t1135_detailed_from} or more at any time in the year?', '', 'yes_no', '[]'::jsonb, true, true, null, null, '{"question":"foreign_property","op":"eq","value":"yes"}'::jsonb, 440),
  (v_q, 'foreign_income', 'Your income and claims', 'Did you have income from outside Canada with no Canadian slip?', 'For example a foreign pension, a job or bank interest.', 'yes_no', '[]'::jsonb, true, true, null, null, null, 450),
  (v_q, 'foreign_return', 'Your income and claims', 'Do you need a tax return filed in another country?', '', 'yes_no', '[]'::jsonb, true, true, null, null, null, 460),
  (v_q, 'foreign_return_country', 'Your income and claims', 'Which country?', '', 'single_choice', '[{"value":"us","label":"The United States"},{"value":"other","label":"Another country"}]'::jsonb, true, true, null, null, '{"question":"foreign_return","op":"eq","value":"yes"}'::jsonb, 470),
  (v_q, 'us_state_count', 'Your income and claims', 'How many US state returns?', 'Enter 0 if none.', 'number', '[]'::jsonb, true, true, 0, 10, '{"question":"foreign_return_country","op":"eq","value":"us"}'::jsonb, 480),
  (v_q, 't5013', 'Your income and claims', 'Did you get a T5013 slip from a partnership?', '', 'yes_no', '[]'::jsonb, true, false, null, null, null, 500),
  (v_q, 't5013_count', 'Your income and claims', 'How many partnerships?', '', 'number', '[]'::jsonb, true, false, 1, 10, '{"question":"t5013","op":"eq","value":"yes"}'::jsonb, 510),
  (v_q, 't2200', 'Your income and claims', 'Did you get a signed T2200 from your employer?', '', 'yes_no', '[]'::jsonb, true, true, null, null, null, 520),
  (v_q, 'moving', 'Your income and claims', 'Did you move at least {moving_km} km closer to a new job, business or full-time school?', '', 'yes_no', '[]'::jsonb, true, true, null, null, null, 530),
  (v_q, 'anything_else', 'Your income and claims', 'Anything else we should know?', '', 'text', '[]'::jsonb, false, false, null, null, null, 600);

  insert into public.rules (questionnaire_id, kind, conditions, item_code, quantity_question_key, message, sort_order) values
  (v_q, 'out_of_scope', '[{"question":"lived_in_canada","op":"eq","value":"no"}]'::jsonb, null, null, 'Did not live in Canada for the whole year', 10),
  (v_q, 'out_of_scope', '[{"question":"us_citizen","op":"eq","value":"yes"}]'::jsonb, null, null, 'US citizen or green card holder', 20),
  (v_q, 'out_of_scope', '[{"question":"deceased_or_trust","op":"eq","value":"yes"}]'::jsonb, null, null, 'Return for someone who passed away, or for a trust', 30),
  (v_q, 'out_of_scope', '[{"question":"earlier_year","op":"eq","value":"yes"}]'::jsonb, null, null, 'Earlier year, or a change to a filed return', 40),
  (v_q, 'out_of_scope', '[{"question":"cra_review","op":"eq","value":"yes"}]'::jsonb, null, null, 'CRA review or audit underway', 50),
  (v_q, 'out_of_scope', '[{"question":"business_totals","op":"eq","value":"no"}]'::jsonb, null, null, 'Cannot give total income and expenses for each business', 60),
  (v_q, 'out_of_scope', '[{"question":"assignment_gst","op":"in","value":["no","not_sure"]}]'::jsonb, null, null, 'Assignment sale: GST/HST not handled at closing, or not sure', 70),
  (v_q, 'out_of_scope', '[{"question":"crypto_report","op":"eq","value":"no"}]'::jsonb, null, null, 'Crypto or options: no gains report', 80),
  (v_q, 'out_of_scope', '[{"question":"foreign_return_country","op":"eq","value":"other"}]'::jsonb, null, null, 'Tax return needed in a country other than the US', 90),
  (v_q, 'check', '[{"question":"home_office_count","op":"gt_question","value":"business_count"}]'::jsonb, null, null, 'This cannot be more than the number of businesses.', 100),
  (v_q, 'check', '[{"question":"sold_home","op":"eq","value":"no"},{"question":"property_sale_count","op":"lte","value":0}]'::jsonb, null, null, 'You said you sold a property. Tell us if it was your home, or how many other properties.', 110),
  (v_q, 'add_item', '[{"question":"filing_type","op":"eq","value":"single"}]'::jsonb, 'PTX-110', null, '', 200),
  (v_q, 'add_item', '[{"question":"filing_type","op":"eq","value":"couple"}]'::jsonb, 'PTX-111', null, '', 210),
  (v_q, 'add_item', '[{"question":"business_count","op":"gt","value":0}]'::jsonb, 'PTX-121', 'business_count', '', 220),
  (v_q, 'add_item', '[{"question":"vehicle_count","op":"gt","value":0}]'::jsonb, 'PTX-122', 'vehicle_count', '', 230),
  (v_q, 'add_item', '[{"question":"home_office_count","op":"gt","value":0}]'::jsonb, 'PTX-123', 'home_office_count', '', 240),
  (v_q, 'add_item', '[{"question":"gst_frequency","op":"answered"}]'::jsonb, 'PTX-124', 'gst_frequency', '', 250),
  (v_q, 'add_item', '[{"question":"rental_count","op":"gt","value":0}]'::jsonb, 'PTX-120', 'rental_count', '', 260),
  (v_q, 'add_item', '[{"question":"sold_home","op":"eq","value":"yes"}]'::jsonb, 'PTX-126', null, '', 270),
  (v_q, 'add_item', '[{"question":"property_sale_count","op":"gt","value":0}]'::jsonb, 'PTX-127', 'property_sale_count', '', 280),
  (v_q, 'add_item', '[{"question":"investment_sales","op":"eq","value":"yes"}]'::jsonb, 'PTX-125', null, '', 290),
  (v_q, 'add_item', '[{"question":"crypto","op":"eq","value":"yes"}]'::jsonb, 'PTX-133', null, '', 300),
  (v_q, 'add_item', '[{"question":"foreign_property","op":"eq","value":"yes"},{"question":"foreign_property_high","op":"eq","value":"no"}]'::jsonb, 'PTX-128', null, '', 310),
  (v_q, 'add_item', '[{"question":"foreign_property_high","op":"eq","value":"yes"}]'::jsonb, 'PTX-129', null, '', 320),
  (v_q, 'add_item', '[{"question":"foreign_income","op":"eq","value":"yes"}]'::jsonb, 'PTX-130', null, '', 330),
  (v_q, 'add_item', '[{"question":"foreign_return_country","op":"eq","value":"us"}]'::jsonb, 'PTX-135', null, '', 340),
  (v_q, 'add_item', '[{"question":"us_state_count","op":"gt","value":0}]'::jsonb, 'PTX-136', 'us_state_count', '', 350),
  (v_q, 'add_item', '[{"question":"t5013_count","op":"gt","value":0}]'::jsonb, 'PTX-134', 't5013_count', '', 360),
  (v_q, 'add_item', '[{"question":"t2200","op":"eq","value":"yes"}]'::jsonb, 'PTX-131', null, '', 370),
  (v_q, 'add_item', '[{"question":"moving","op":"eq","value":"yes"}]'::jsonb, 'PTX-132', null, '', 380);
-- END GENERATED
  update public.questionnaires set status = 'retired' where route = 'personal' and status = 'published';
  update public.questionnaires set status = 'published', published_at = now() where id = v_q;
  return v_q;
end;
$$;
revoke all on function private.publish_t1_screening() from public, anon, authenticated;

-- Publish again only where the live personal version still has the hint and no draft is open.
do $$
begin
  if exists (
    select 1 from public.questions q join public.questionnaires v on v.id = q.questionnaire_id
    where v.route = 'personal' and v.status = 'published' and q.help_text like '%answer for both of you%'
  ) and not exists (select 1 from public.questionnaires where route = 'personal' and status = 'draft') then
    perform private.publish_t1_screening();
  end if;
end;
$$;
