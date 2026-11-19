# Change log entry for piece R2 (draft for the builder)

The app's change log is `src/lib/changelog.ts` (Settings, Change log). The docs keeper writes only in docs/, so the
builder pastes this entry at the top of `CHANGELOG` (newest first). Merged Nov 19, 2026 (PR #105, 2ba1c2d).

```ts
  {
    date: "2026-11-19",
    title: "Trial balance files: Assign mapping, and entries in Closebook",
    points: [
      "Files that start from a trial balance are now called Trial balance files. Files built from bank and card statements are Bank-statement files.",
      "The steps are grouped under four headings: Planning, Trial balance (or Bookkeeping on bank-statement files), Fieldwork and Completion. Step numbers do not change.",
      "On trial balance files, step 3 is Import trial balance and step 4 is Assign mapping. Each client account is assigned to a master account. The client's own numbers and names stay on every report.",
      "Assign mapping shows the client's accounts on the left, with QuickBooks sub-accounts under their parent, and the master chart on the right. Tick accounts, then Assign, or drag them onto a master account. Suggestions come from last year, then the QuickBooks account type, then the name. Nothing is assigned until you click.",
      "Accept last year's matches assigns last year's matches in one click. Undo reverses your last action. Unassign all starts again; the trial balance stays as imported.",
      "Step 4 cannot be signed while an account with a balance (this year or last year) or an entry is unassigned. Once it is signed, take back the sign-off to change a mapping.",
      "There are no GIFI codes before step 8 on trial balance files. GIFI is matched and checked in step 8, as on bank-statement files.",
      "Payment app clearing, Undeposited Funds, commission cheque clearing and QuickBooks Opening Balance Equity go to 10900 Clearing. They show under Clearing accounts (must be nil at year end) and step 6 waits while they have a balance.",
      "Step 2 on a trial balance file asks for last year's closing retained earnings from the T2 (line 3849). Step 6 checks retained earnings at the start of the year against it.",
      "Opening Balance Equity, and dividends or prior period adjustments carried from last year in QuickBooks, are moved to retained earnings with one RJE each, dated the first day of the year. The amount must match exactly.",
      "Monthly QuickBooks files now take AJE, RJE and TJE in Closebook. The client entry list (PDF and Excel) lists them; on monthly files it is titled Entries to record in QuickBooks.",
      "Mark an entry Booked in QuickBooks once it is reviewed and recorded there. A trial balance cannot be imported again while an entry is marked booked.",
    ],
  },
```
