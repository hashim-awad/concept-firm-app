-- Step 6 follow-up: the T1 screening migration skipped publishing on Test without saying why.
-- Owners can now publish the batch section 4 questions from the Screening questions page. The same
-- checks run (price book matches section 4, no personal draft), and any problem is shown in full.
create or replace function public.publish_t1_screening_now()
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform private.require(private.is_owner(), 'Only an owner can publish the batch section 4 questions.');
  return private.publish_t1_screening();
end;
$$;
revoke all on function public.publish_t1_screening_now() from public, anon;
grant execute on function public.publish_t1_screening_now() to authenticated;
