DRAFT FOR REVIEW. Not filed in Notion. Hashim reviews it, then files it as a new page in the Notion SOP Library,
Firm SOPs. No Notion change is made from here.

Source: docs/BRIEF.md, "Piece R2" (Hashim, Nov 19, 2026, version 4), merged Nov 19, 2026 (PR #105). Started from
docs/sop-drafts/piece-r2.md on branch claude/r3a-roles.

---

# Year-end on a trial balance file in Closebook

Status: In Review

SOP number: next free number in Firm SOPs (to be set when filed)

## Purpose

How to do a year-end in Closebook when the file starts from the client's trial balance.

## Applies to

- Trial balance files: files that start from a trial balance. These are Concept's monthly QuickBooks clients, clients who
  keep their own books, and bookkeepers' files.
- Not bank-statement files. Their steps do not change.

## Before you start

- Step 4 is "Assign mapping". You put each client account on a master account (the firm's standard chart). You do not pick
  a GIFI line in step 4.
- GIFI is matched and checked in step 8 only.
- Year-end entries (AJE, RJE and TJE) are made in Closebook on every trial balance file, monthly files too. They go back to
  the client's QuickBooks through the client entry list.
- New file does not yet offer "Our QuickBooks file (monthly client)". If you need a new file for a monthly client, ask
  Hashim.

## Steps

1. Step 2: type last year's closing retained earnings exactly as printed on last year's T2, line 3849. Type a deficit as a
   negative amount; it shows in brackets. Press Enter or leave the box to save.
2. Step 3: import the trial balance. For QuickBooks clients, also upload the Account List, so the account types and the
   accounts with no balance come in.
3. Step 4: assign each account that has a balance (this year or last year) or an entry to a master account.
   1. Click "Accept last year's matches" first, if it shows.
   2. Check every "Name changed" suggestion before you accept it.
   3. Tick the accounts, then click Assign on the master account, or drag them onto it.
   4. If Closebook warns that the account types differ, confirm only if you are sure. The account then goes to the
      reviewer in step 8.
   5. Use Undo straight after a wrong Assign.
4. Assign these to 10900 Clearing: payment app clearing (CAD and USD), Undeposited Funds, commission cheque clearing and
   QuickBooks Opening Balance Equity.
5. Where several client accounts sit on one master account, you can pick in the master account window which one takes
   entries. If you leave it blank, the entry window asks.
6. Sign step 4 once nothing is left unassigned. To change a mapping after that, take back the sign-off first.
7. Clear Opening Balance Equity with one RJE to retained earnings, dated the first day of the year.
8. If QuickBooks still carries last year's dividends or prior period adjustments, move each one to retained earnings with
   one RJE, dated the first day of the year, for exactly last year's balance. Closebook refuses an amount that does not
   tie to step 2 and names both figures.
9. Make the year-end AJE, RJE and TJE in Closebook.
10. Step 6: retained earnings at the start of the year must equal the step 2 figure, and every Clearing account must be
    nil. If the tie fails, step 6 names the accounts still carrying last year's balance.
11. Download the client entry list (PDF or Excel). On monthly files it is titled "Entries to record in QuickBooks". If it
    says accounts are not yet assigned, finish step 4 first: net income is not final.
12. Record the entries in the client's QuickBooks. Then mark each reviewed entry "Booked in QuickBooks" in Closebook.
13. Do not import the trial balance again once an entry is marked booked. Closebook refuses it.
14. Step 8: match accounts to GIFI and clear the reviewer's list, including any "Line changed from last year".

## When to ask Hashim

- An account the bookkeeper already closed in QuickBooks with a day 1 entry still blocks the other opening RJEs. Until
  piece R5 adds the "Already closed in QuickBooks" mark, ask Hashim.
- A new file is needed for a monthly QuickBooks client (see "Before you start").
