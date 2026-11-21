# Answer key: Spruce Dummy Design Inc. (disguised real file)

A real Closebook file, disguised. Names, customers, payees, account numbers, card references and
e-transfer codes are replaced. Amounts, dates, accounts, GIFI lines and coding are unchanged.
Use it only as a test fixture. Do not copy figures into code, docs or screens.

Year: 2025-09-01 to 2026-08-31. Ontario. GST/HST annual, regular method.

## Files (inputs)
- client.json: setup, bank accounts, GST/HST filing.
- chart.csv: accounts with their current GIFI line (sub-lines such as 1301.10 roll up to 1301).
- opening_balances.csv: opening balances as booked (includes the 0.52 rounding to retained earnings).
- bank_lines.csv: one row per bank or card line that reached the ledger. Amount = the posting to the bank account (debit positive).
  Transfers between chequing, card and line of credit appear once, on the chequing line, coded to the other bank account.
- bank_line_coding.csv: how each line was coded (account, amount, tax code). Splits have several rows. GST/HST shows as its own row on 21500.
- entries.csv: every year-end entry. reclass_entry = yes for the old RJE, no for AJE and TJE.
- schedule_inputs.json: what was typed into the home office, expenses paid personally and vehicle schedules, with their expected results.
- prior_year_by_account.csv and prior_year_t2.json: last year as typed in step 2.

## answer_key.json (expected results)
- trial_balance: per account, prelim, adjusting, reclass, final (debit positive). Prelim = opening + bank lines.
- net_income: before entries 33,913.04; entries -31,305.36; after 2,607.68.
- gifi_lines: totals by GIFI code from chart.csv (debit positive).
- gst_hst_return: 101 55,085.00 · 103 7,161.05 · 106 4,993.95 · 109 2,167.10 · 110 0.00 · 113 2,167.10.

## Known facts kept as booked (do not "fix" in the fixture)
- Opening 21400 Income taxes payable 9,589.00 is really prior GST/HST owing. Kept as booked.
- The 404.94 GST/HST payment on 2025-11-10 is coded to 21500 and is not an instalment. Line 110 is 0.00.
- 23000 and 13000 net to zero after the reclass entry 2026-004.
