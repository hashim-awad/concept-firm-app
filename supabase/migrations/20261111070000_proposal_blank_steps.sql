-- Hashim, Nov 11, 2026: a proposal "Next steps" line may be published blank; the proposal then
-- leaves that step out. Only these five lines; every other piece of wording still needs text.
alter table public.wording_texts drop constraint wording_texts_text_check;
alter table public.wording_texts add constraint wording_texts_text_check check (
  length(text) <= 5000
  and (length(btrim(text)) > 0 or key in ('w047a905d6b', 'wa3ab7806ed', 'w5725499754', 'w134c9423c8', 'w7cce0d03ca'))
);
