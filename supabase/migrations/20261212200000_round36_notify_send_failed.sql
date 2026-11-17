-- Round 36 (Hashim, Nov 17, 2026): when Notify client cannot send, the person sees one plain sentence and History keeps
-- Microsoft 365's full reply. The pending link is removed as before (round 32 fix); no other link changes.
-- No data is changed. Never drops a table or column. Safe to run twice.
create or replace function public.cb_question_link_failed(p_link uuid, p_plain text, p_reply text) returns void
language plpgsql security definer set search_path = '' as $$
declare k public.cb_question_links; v_n int;
begin
  select * into k from public.cb_question_links where id = p_link;
  perform private.require(k.id is not null and k.created_by = (select auth.uid()) and not k.sent, 'Link not found.');
  v_n := coalesce(cardinality(k.line_ids), 0);
  -- Written directly (not through cb_log_event) so the reply is kept whole, up to 4,000 characters.
  insert into public.cb_file_history (file_id, actor_id, action, step, detail, ref_label, reason, old_value, new_value)
  values (k.file_id, (select auth.uid()), 'questions_send_failed', 'code', 'Email not sent',
          format('%s question%s to %s', v_n, case when v_n = 1 then '' else 's' end, array_to_string(k.to_emails || k.cc_emails, ', ')),
          left(coalesce(p_plain, ''), 300), '', left(coalesce(p_reply, ''), 4000));
  delete from public.cb_question_links where id = k.id;
end;
$$;
revoke all on function public.cb_question_link_failed(uuid, text, text) from public, anon;
grant execute on function public.cb_question_link_failed(uuid, text, text) to authenticated;
