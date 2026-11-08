-- Client wording change approved by Hashim (2026-11-08): remove "It takes about 3 minutes."
-- Published versions are never edited, so this publishes a new version (questions and rules
-- unchanged) and retires the old one. If a draft is open, the draft's intro is fixed instead.
do $$
declare
  v_src public.questionnaires;
  v_new uuid;
  v_intro constant text := 'Answer a few questions. We use your answers to prepare your quote.';
begin
  if exists (select 1 from public.questionnaires where route = 'personal' and status = 'draft') then
    update public.questionnaires set intro = v_intro where route = 'personal' and status = 'draft';
    return;
  end if;
  select * into v_src from public.questionnaires where route = 'personal' and status = 'published';
  if v_src.id is null or v_src.intro = v_intro then
    return;
  end if;
  insert into public.questionnaires (route, version, title, intro, couple_question_key, couple_value)
  values ('personal', (select max(version) + 1 from public.questionnaires where route = 'personal'),
          v_src.title, v_intro, v_src.couple_question_key, v_src.couple_value)
  returning id into v_new;
  insert into public.questions (questionnaire_id, key, section, prompt, help_text, answer_type, options, required,
    per_person, min_value, max_value, show_if, sort_order)
  select v_new, key, section, prompt, help_text, answer_type, options, required, per_person, min_value, max_value, show_if, sort_order
  from public.questions where questionnaire_id = v_src.id;
  insert into public.rules (questionnaire_id, kind, conditions, item_code, quantity_question_key, message, sort_order)
  select v_new, kind, conditions, item_code, quantity_question_key, message, sort_order
  from public.rules where questionnaire_id = v_src.id;
  update public.questionnaires set status = 'retired' where id = v_src.id;
  update public.questionnaires set status = 'published', published_at = now() where id = v_new;
end;
$$;
