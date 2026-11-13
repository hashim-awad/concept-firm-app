-- One-time sweep (Hashim's step 3 retest, Nov 13, 2026): lines coded to Meals and entertainment at a rate
-- that is not a meals code before the reviewer rule was fixed go back to the reviewer.
update public.cb_bank_lines
   set status = 'reviewer', reviewer_reason = 'Meals coded at the full rate: only 50% of the tax is claimable.'
 where status = 'done' and chart_account = '6020' and coalesce(tax_code, '') not like 'MEALS%';
