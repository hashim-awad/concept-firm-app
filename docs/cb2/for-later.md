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
15. (Done in this PR: the "Reclass entry" box is saved inside the entry's own save, one History row.) The revenue check's
    "Fix with an entry" still saves an AJE with the box unticked.
16. On a bank-statement file the GIFI reads each account's stored balance while the trial balance reads postings; they
    agree whenever the trial balance is rebuilt (the normal path). The Birch fixture had a hand-added account that broke
    this; the answer keys' bug check now catches it.
17. The old GST/HST screen still says line 110 is "pre-filled with the payments coded to GST/HST" (frozen screen, rule 15);
    the engine reads the instalments account (21510).
18. cb_client_tax_settings (book amortization) is no longer read; kept as a record.

## From the one spec-checker run (rule 16), outside the piece
19. The old T2 help text still describes a rounding allowance and a blocking tie-out (shell/help.tsx; frozen screen).
20. docs/cb2/refusals.md still lists "Rounding is only for a difference left under 1.00" under To decide; v7 removed it.
21. The engine names 21510 in code instead of reading the chart marker is_gst_instalments (rule 12).
22. Database tests to add: a change of sales tax only; a change to a line that cleared an outstanding item.
23. tests/answer-keys/file-b/known-differences.json is now [] and could be deleted.
24. The Live check marks "a 21500 payment" from bank lines only, not journal entries (can only give a false fail).
25. The spec-checker agent's body still says "before anything is built"; only its description follows rule 16.
26. reports.ts comment still says a reclass "cannot change the result".

## From CB2-1 (Books, PR A)
27. Journal entry window: Make recurring and Create amortization (QBO), not built (Hashim, Nov 21, 2026).
28. Dark mode: Closebook is light only, like Studio (Hashim, Nov 21, 2026).
29. Settings in Books shows the chart template and the tax codes and rates read only. Today's Closebook screens read the
    same template and rates, so they are still changed where they are kept today until those screens retire.
30. An entry Books saves for a year's opening balances, opening difference or trial balance import is read by Books only;
    today's screens keep working them out from the stored figures (so a change made in Books does not show there).
31. A merge in Books points the account at the other one in Books' reports; the year files keep their own accounts, and
    today's screens still show both.
32. An entry dated where no year file exists is refused ("No year in Closebook covers ... Add the year first."). Starting a
    year from Books comes later.
33. Changing an entry's journal number alone is recorded on the entry, but its History row does not name the change.
34. Attachments on an entry are listed by name (as in today's window); opening them from the window comes later.
35. scripts/checks/drift-check.sql (manual audit) does not list the CB2-1 tables and functions yet.

## From the one spec-checker run on PR #117 (rule 16), outside the piece or for Hashim
36. Tax codes and the chart template carry a firm ID, but their keys are global (code, number): a second firm cannot hold
    its own HST_ON or 21500, and sees no codes. Needs keys per firm and a starting set per firm (Hashim to decide).
37. Account numbers written in the new code (rule 12): 21500 and 21550 (sales tax lines, Overview tile), 31000 (retained
    earnings fallback). To come from markers on the firm's chart template, as item 21 proposes for 21510 (Hashim to decide).
38. The suggested journal number does not follow the date into another year.
39. Saving a schedule entry from Books drops its lines' schedule tags.
40. The Back link on reports and the bank transaction page follows any address given; limit it to /cb.
41. The opening entry's "not cleared" warning fires on any line to an Opening Balance Equity account.
42. Report subtotals, totals and $ change are not links (QBO links totals).
43. A worked-out entry's window title reads "Journal entry: Opening balances", not a number (it has none until saved).
44. Chart search box: the icon overlaps the placeholder.
