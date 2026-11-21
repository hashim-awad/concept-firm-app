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
31. A merge in Books points the account at the other one in Books' reports; the year files keep their own accounts, and
    today's screens still show both.
32. An entry dated where no year file exists is refused ("No year in Closebook covers ... Add the year first."). Starting a
    year from Books comes later.
33. Changing an entry's journal number alone is recorded on the entry, but its History row does not name the change.
34. Attachments on an entry are listed by name (as in today's window); opening them from the window comes later.
35. scripts/checks/drift-check.sql (manual audit) does not list the CB2-1 tables and functions yet.

## From the one spec-checker run on PR #117 (rule 16), outside the piece or for Hashim
37. Account numbers written in the new code (rule 12): 21500 and 21550 (sales tax lines, Overview tile), 31000 (retained
    earnings fallback). Clients who keep their own books use their own account numbers, so the code must not assume ours.
    Later, with markers on the chart template, when Closebook Settings becomes editable (Hashim, Nov 21, 2026).
38. The suggested journal number does not follow the date into another year.
39. Saving a schedule entry from Books drops its lines' schedule tags.
40. The Back link on reports and the bank transaction page follows any address given; limit it to /cb.
41. The opening entry's "not cleared" warning fires on any line to an Opening Balance Equity account.
42. Report subtotals, totals and $ change are not links (QBO links totals).
43. A worked-out entry's window title reads "Journal entry: Opening balances", not a number (it has none until saved).
44. Chart search box: the icon overlaps the placeholder.

## For the switch-over
45. A bank line dated outside its year posts on the year's first or last day (accepted for now, Hashim, Nov 21, 2026).
46. "No year in Closebook covers [date]. Add the year first." for an entry dated where no year file exists (accepted for now).
47. The opening balances, opening difference and trial balance import entries are view-only in Books ("Change this entry in
    the old Closebook until the switch-over."); at the switch-over they become ordinary entries Books saves and changes.

## From building PR B (Bank transactions, Upload, Rules, Reconcile)
48. Match finds journal entries of the same amount on the account within 60 days of the line, and lines in another of the
    client's accounts within 7 days in the same year. QBO also matches bills, invoices and payments; Closebook has none yet.
49. Categorized: change in place covers the account, tax code, split and memo. A transfer or a match is changed by Undo,
    then Confirm again.
50. A suggestion from the last similar line (same vendor) never confirms by itself. Only a rule set to "Automatically
    confirm" does, and only when a bank file is uploaded.
51. Upload adds lines only to bank and card accounts that exist in a year file. Adding a new bank or card account from Books
    comes later.
52. Balances typed on an upload are kept as typed. The old engine's statement opening and closing (which must tie) are filled
    only when the upload covers one year and ties; a file spanning two years keeps the typed balances on each year's part.
53. Reconcile lists Categorized lines only. Lines still For review are counted, with a link to confirm them first (they are
    not in the books yet). A journal entry posted to the bank account with no bank line is not listed.
54. Reconciliations in Books and the old Closebook's step 3 statement ties are kept apart until the switch-over.
55. Rules run in the order they were added. Changing the order (QBO lets you drag them) comes later.
56. Undo of a match to a journal entry (cb_books_unmatch_entry) does not check the year lock.
57. The bank account picker and Rules accept only accounts whose number is in the chart template, because the old posting
    engine needs it. Rule 12: clients who keep their own books bring their own numbers.
58. The old screens read a statement's opening and closing as nil when a Books upload left them empty (balances that did
    not tie), so step 3 shows 0.00 there.
59. Reconcile in the database accepts a line still For review (the screen lists Categorized lines only).
60. cb_bank_lines.rule_id holds a rule from either the old rules table or the Books one.
