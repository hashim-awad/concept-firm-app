# CB2-0 PR 1: click paths before and after

Rule 14.6: flows as clicks. "Before" is main as of Nov 21, 2026 (read from the code). "After" was measured in the app on the
Birch dummy file (Playwright, 1440 x 900). A click is a press or a choice from a list; typing is not counted.

| # | Flow | Before | After | Preparer | Reviewer |
|---|---|---|---|---|---|
| 1 | An AJE is added after the steps are reviewed | Steps 5 to 8 lose their sign-offs; the MAL is withdrawn. Preparer signs 4 steps again (4), reviewer signs 4 steps again (4), MAL sent again (2) | Nothing is cleared. One History row. The reviewer looks when they choose: History › Changed after sign-off (2), a row opens the entry (1) | −6 | −4 (−1 if they open the entry) |
| 2 | See one entry's history | Not available | Entry ⋯ › History, side panel (2) | +0 (new) | +0 (new) |
| 3 | Sign a step as preparer | Sign (1), page jumps to the next step; back to the step (1) | Sign (1), stays on the step | −1 | 0 |
| 4 | Sign a step with open problems | Refused. Fix or ask someone, then sign (1+) | Sign (1). The open items are kept in the sign-off's History row | −1 or more | −1 or more |
| 5 | Step 8: save the ProFile figures | Form shows only after the final GIFI export; all four figures required; Save (1) lands on the Match paper; back to T2 tie-out (1); on an error what was typed is lost | Form always shows. Save (1) saves what is filled in, stays on the paper, keeps what was typed | −1 | 0 |
| 6 | Step 8: any GST/HST action (prepare, accept, count an instalment, drill) | Action (1) lands on the Match paper; back to GST/HST return (1) | Action (1), stays on GST/HST return | −1 per action | −1 per action |
| 7 | Step 6: explain year-over-year changes | Every line over $5,000 and 20%: reason (1) and note (typing) before sign-off | Every line listed; reason and note optional; sort by $ change or % change (1) | −1 per flagged line | 0 |
| 8 | Step 4: change the account on a posted bank line | Undo (1), Pending tab (1), find the line, account (2), Post (1) = 5 | Posted tab (1), account in place (2) = 3 | −2 | −2 |
| 9 | Send the MAL before step 9 is reviewed | Refused. Reviewer opens step 9 and signs (2), preparer sends (1) | Send (1) with a warning | 0 | −2 |
| 10 | Record the delivery before step 10 is reviewed | Refused. Reviewer signs step 10 (2), then record (1) | Record (1) with a warning | 0 | −2 |
| 11 | Lock a file with an unsigned step | Refused. Sign the missing steps first | Lock (1) with a warning | −1 or more | −1 or more |
| 12 | Step 5 entries the reviewer looks at | Entries tab, "For the reviewer" filter (1), each "To look at" tag | Removed. The reviewer uses History › Changed after sign-off (2) | 0 | +1 |
| 13 | Step 5 sign-off by the person who prepared it | Refused while entries waited to be looked at | Sign (1) | 0 | −1 |
| 14 | Mapping after step 4 is signed | Take back the sign-off (1), change (2), sign again (1) | Change (2) | −2 | 0 |
| 15 | Expenses paid personally: a line over $5,000 | Refused until a receipt is attached (2) | Saves; attach a receipt if wanted | −2 | 0 |
| 16 | Revenue or GST/HST difference over $5,000 | Preparer explains; reviewer must accept (2) before step 8 can be signed | Preparer explains (typing). The reviewer may accept; nothing waits | 0 | −2 |
| 17 | Pair two transfer lines 6 to 7 days apart (cb_accept_transfer) / 8+ days (post) | Refused | Pairs | −1 or more | 0 |
| 18 | Name the line that cleared an outstanding item after day 90 | Not offered; needed an entry | Offered in the list (1) | −2 | 0 |
| 19 | Settings › Closebook rules › Thresholds | 8 amounts | 3 (T2 rounding, instalment amount in the client email, shareholder loan window) | 0 | 0 |

Totals for a typical file with one late AJE, 3 flagged lines and 2 GST/HST actions (flows 1, 3 × 8 steps, 5, 6 × 2, 7 × 3):
preparer −6 −8 −1 −2 −3 = **−20 clicks**; reviewer −4 −0 −0 −2 −0 = **−6 clicks** (−3 if they open the changed entry from History).

## Measured after (Birch dummy, all pass, no page errors)
- P1 step 6: 39 lines, no flag text; "$ change" re-sorts in 1 click; "% change" in 1 click.
- P2 trial balance: 0 "Flagged" labels.
- P3 lead sheets view: no flag badges or "Flagged only".
- P4 step 8: one ProFile figure typed, Save: same URL (T2 tie-out), the typed value kept, "ProFile figures saved."
- P5 GST/HST: every link keeps the GST/HST paper.
- P6 Settings › Thresholds: three amounts.
- P7 Entries: no "To look at", no "For the reviewer".
- P8 Journal entry form: no review-threshold line.
