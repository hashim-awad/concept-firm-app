# CloseBook2: for later

Items that still apply to the new pages or the engine, kept out of the engine PR (#116) on purpose (docs/CLOSEBOOK2.md
rules 15 and 16). Nothing here is built. Hashim decides each one when its piece comes.

## Dropped from CB2-0 version 7 (Part 5) that still apply to the new pages
1. Type over any worked-out figure, with a reason (the new pages' figures: GIFI lines, GST/HST lines, schedule results).
2. History view on the new pages: changes after a sign-off and after the MAL was signed, as a filter. The old screen's
   "Changed after sign-off" polish is dropped; the History rows it reads are kept (one row per action).
3. Sign-off rights: who may take back another person's sign-off (the "remove sign-offs" right; rule 14.3).
4. MAL tracking: what the signed MAL covered (the figures at signing) and changes made after it was signed.
5. Independence: the compilation report's sentence when the firm is not independent (CSRS 4200), from the acceptance
   record; checklist question 9 then becomes a warning.
6. Screens at phone width (the old step 6 and step 7 scroll sideways at 390 px).

## Accounting points raised on PR #116 (for Hashim)
7. A Final statements package with a failed tie-out (assets not equal to liabilities plus equity, 3640 not equal to 2599):
   a stop on Final output, or the failure printed on the PDF.
8. A MAL signed on or before the year end dates the report before the period it covers (recorded in History today).
9. Booked entries can now change; the change is recorded, but the books in QuickBooks no longer match until rebooked.
10. The step 5 same-person rule is gone; History shows both signers.
11. Refusals marked "To decide" in docs/cb2/refusals.md (sub-account not parent, only an accrual reverses, "the reviewer
    decides" on a line move, statement outside the year, checklist question 9).
12. The opening RJE rules still refuse (retained earnings at the start must tie to step 2; Opening Balance Equity must
    clear to nil; dividends moved once). They are business rules under rule 13.

## Engine notes
13. Thresholds left in Settings: the instalment amount in the client email (CRA's $3,000) and the shareholder loan
    "repaid near year end" window (30 days). Rule 7 says no thresholds; Hashim decides whether these two stay.
14. Firms (rule 12): people (staff) and clients are not yet per firm; one firm's preparer could be named on another
    firm's file. Settings (cb_settings) is one row; reference tables (chart, master lines, tax codes) carry Concept's firm
    and a second firm would need its own copies. Unique numbers (the chart) are not yet per firm.
15. The "Reclass entry" box is saved by its own call after the entry, so ticking it on a new entry writes a second History
    row ("Reclass entry ticked"). One row needs the box inside the entry's own save.
16. On a bank-statement file the GIFI reads each account's stored balance while the trial balance reads postings; they
    agree whenever the trial balance is rebuilt (the normal path). The Birch fixture had a hand-added account that broke
    this; the answer keys' bug check now catches it.
17. The old GST/HST screen still says line 110 is "pre-filled with the payments coded to GST/HST" (frozen screen, rule 15);
    the engine reads the instalments account (21510).
18. cb_client_tax_settings (book amortization) is no longer read; kept as a record.
