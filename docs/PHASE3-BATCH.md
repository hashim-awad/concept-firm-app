# Concept Studio: Phase 3 instruction batch (Closebook)

Prepared Nov 11, 2026 for Claude Code. Updated Nov 11, 2026 with the layout, standalone file creation, revenue check, Transactions view and expenses paid personally. Hashim Awad approved every item below in planning sessions. Every decision is final. Build it as written. Do not reopen decisions or ask Hashim to choose again. Ask only if something in the code makes an instruction impossible.

## How to use this batch

1. Save this file as `docs/PHASE3-BATCH.md`, and the attachments in `docs/phase3/`:
   - `GIFI-Concept-RC4088-Rev23.csv` (Appendix A)
   - `Closebook-master-lines-APPROVED.xlsx` (Appendix B)
   - `Year-end-package-standard.zip` (Appendix C)
   - `Closebook-screen-mockups.zip` (Appendix D)
2. Update `docs/BRIEF.md` first. This batch **replaces** the Phase 3 text (the A to W stages) now in the brief. Where the brief and this file disagree, this file wins.
3. Reply with a build plan in plain words: steps, order, tests, and anything in the code that makes an instruction impossible. Do not build until Hashim approves the plan.
4. Build and test on Test with dummy data only. Nothing reaches Live until Hashim approves each step.
5. Standing rules from Phase 2 still apply: no price breakdown to clients, brief first, tests grow with each step, plain-words change log.

---

## 1. Name, place in the app, and how files start

- The year-end product is called **Closebook**. Staff-facing only. Client documents carry the firm's name, never "Closebook".
- **Main menu:** a top-level section "Closebook" with three items: **My files** (work queue for the signed-in person), **All files** (whole firm), **Review notes** (all open notes). Remove "Year-End & T2 (Soon)" from Work.
- **Setup lives in Settings,** as a "Closebook" group in the Settings menu (section 7), owner-only with the lock shown. No setup section in the main menu.
- **Closebook is standalone.** It has no link to Studio quotes or engagement letters. Its only link to the rest of Studio is the **client database** (the client records kept current by the TaxDome import).
- **Every file starts with All files › New file:**
  1. Pick the client from the client database. Legal name, Business Number, year-end and TaxDome tags fill in.
  2. Confirm the year-end (changeable with a reason, for a short first year or a changed year-end).
  3. Choose the file type (monthly or full) and how the books are kept. Tags pre-select it (BK suggests monthly).
  4. Assign the preparer and reviewer.
  5. If last year's file exists, offer "Roll forward from last year" (setup answers, matches, vendor rules, closing balances). If not, the file starts fresh and the opening balance document is added.

## 2. The model: guided phases

One engagement file per client per year-end. Every file follows these rules:

1. **Three phases in a fixed order:** Planning, then Fieldwork, then Conclusion. A phase opens only when the one before is fully signed off.
2. **Inside a phase, documents can be worked in any order.**
3. **Setup answers only add documents.** The core documents (section 5) are always in every file. Setup answers (P1) add documents on top. No answer can remove a core document.
4. **No "N/A" button.** A document that does not apply is not in the file. Every document in the file must be signed.
5. **One "Next:" line per file**, in plain words, naming the action and the person, for example "Next: reconcile tax worksheet to P&L (Asmaa)" or "Next: reviewer, 2 review notes open".
6. **The system blocks the classic mistakes** (the checks listed per document in section 5). Numbers on statements always come from the trial balance, never typed.
7. **Review notes attach to one document.** Fixing it reopens only that document.
8. **Roll forward:** next year's file opens with this year's mapping, closing balances, setup answers, outstanding items, accrual reversals and s.15(2) deadlines, for confirmation.

**Screen layout (QuickBooks Online-like, the same on every Closebook page):** header (client, file type, year-end, deadline, preparer, reviewer), the "Next:" bar with one primary button **"Open next"**, tabs, then a table.

**Inside a file, five fixed tabs (follows CaseWare's engagement structure):**

| Tab | Content |
|---|---|
| Documents | The three phases with their documents, statuses and sign-offs. The "Next:" bar sits here. Documents show as a table: document, prepared by, reviewed by, status |
| Trial balance | Three views: **Accounts** (account, GIFI line, tax code, last year, this year before entries, entries, final, change), **Lead sheets** (grouped, with last year), and for full files **Transactions** (section 5.1, F1). Import, "Balanced" status, and the trial balance sign-off live here |
| Entries | AJE, RJE and TJE worksheet (full files). Monthly files: read-only, "Entries are made in QuickBooks" |
| Review notes | Every note in the file, open and cleared |
| Statements | Live preview of the year-end package, the "Before release" list, and the package documents. The package documents are also the Conclusion documents (C1, C2) |

**Screen rules:**
- Plain action names on screen, never codes or concepts: for example "Match accounts to GIFI", "Reconcile bank and cards" (full) or "Confirm bank and cards" (monthly), "Compare to last year". Codes like F3 stay in the build only.
- Fixed status words and colours: Signed (green), Next (blue), flags (amber), notes (red), Open (grey).
- A "How to do this" link on every document, opening its SOP steps.

**Built in from the start, for growth:**
- **Roles, not names, in sign-offs:** preparer, reviewer, partner. The sign-off scheme is a setting.
- **Firm work queue:** each person sees their files, oldest deadline first, with the "Next:" line. Owners see the whole firm: what is stuck, with whom, for how long. Deadlines come from the T2 deadlines already on My day.
- **Firm templates:** changing a firm template (checklist, standard entry, report wording) updates every file not yet locked. Locked files keep the version they were signed with.

## 3. Two file types, one trial balance engine

The trial balance engine is the core of Closebook. Every file uses it. The final product (statements, compilation report, MAL, GIFI) is identical for both file types.

| | Monthly file | Full file |
|---|---|---|
| For | Clients whose books Concept keeps in QuickBooks (TaxDome tag BK) | Year-end-only clients: bank statements, a bookkeeper's file, or paper |
| Trial balance | Imported from the QuickBooks "Trial Balance" report export (Excel or CSV) after Hashim's year-end entries are booked in QuickBooks. **Read-only in Closebook.** | Built in Closebook (section 5, F1) |
| Year-end entries | Made in QuickBooks (both kinds below). Closebook never edits these numbers | Made in Closebook (section 5, F4) |
| Mapping | Firm-level: Concept's standard chart is mapped to master lines once. Every monthly client inherits it. Only accounts beyond the standard chart need mapping | Per client, first year, then rolled forward |
| GIFI | Closebook produces its own GIFI from the imported trial balance and compares it with what ProFile filed (tie-out, C3) | Closebook exports GIFI to ProFile |
| Statements, compilation report, MAL | From Closebook | From Closebook |

**The two kinds of year-end entries (Hashim's process):**
- **Kind 1:** corrections from the books (reclassifications, accruals, home office, auto, tax worksheet fixes). Monthly: booked in QuickBooks before the trial balance is exported.
- **Kind 2:** from the finished return in ProFile (amortization equal to CCA, income tax). Monthly: booked in QuickBooks after the return. Full: entered in Closebook as tax entries (TJE).

**Monthly file rules:** no repeated bookkeeping. Bank reconciliations stay in QuickBooks (F3 is one confirmation). If a number is wrong, it is fixed in QuickBooks and the trial balance is re-imported.

## 4. Structure (follows CaseWare's model)

**4.1 Master lines (Appendix B, approved).** 419 lines: the 404 GIFI codes in Appendix A (line number = GIFI code + ".00") plus 15 sub-lines (".10", ".20") that share a GIFI code but need a different treatment or disclosure.
- Each line carries: GIFI code, section, type, lead sheet, statement line, default tax code, mappable flag, paired line for opposite balances, required-GIFI flag, note.
- 23 total lines are not mappable. The system calculates them.
- **Paired lines:** when an account's balance flips sign, it moves to its paired line automatically (for example due from shareholder 1301.10 and due to shareholder 2781.10; bank 1002.00 and overdraft 2600.00).
- Only owners can add, split or edit master lines, in Settings, Closebook. Every change is logged with a reason.

**4.2 GIFI reference (Appendix A).** 404 codes from CRA RC4088 Rev. 23 (Aug 23, 2023), filtered for Concept's clients. Required in every GIFI: 2599, 3499, 3620, 8299, 9368, 9999, and 3849 when retained earnings are reported. The GIFI export refuses to produce a file without them. A future CRA revision is loaded as a new version; mappings carry across.

**4.3 Tax codes (Appendix B, "Tax codes" sheet).** 11 codes: FULL, M50, NONDED, DON, AMORT, INCTAX, CAPGAIN, DIV112, UNREAL, BS, REVIEW.
- Each master line carries a default tax code. A client account takes the default automatically.
- Only the reviewer can change an account's tax code. Preparers never choose tax treatment.
- REVIEW means the reviewer decides for that client; the decision is saved and rolls forward.
- The tax workpaper (C3) builds the Schedule 1 add-backs from the tax codes, for entry in ProFile.

**4.4 Lead sheets (Appendix B, "Lead sheets" sheet).** 20 groups, CaseWare-style letters: A to H for assets, AA to GG for liabilities and equity, 10 to 50 for the income statement.

**4.5 Mapping rules.**
- Staff map client accounts to master lines. They never pick GIFI codes or tax codes.
- The system suggests a master line from the account name and from the same client's history. Last year's mapping is reused automatically.
- An account the system cannot match, or that matches two lines, goes to a **"Needs reviewer decision"** list. The reviewer decides once; it is saved for future years.
- An unmapped account blocks the lead sheets.
- A type mismatch (for example an asset account mapped to an expense line) is flagged before sign-off.
- The mapping sign-off screen shows only new or changed mappings since last year.

## 5. Documents

### 5.1 Core documents (every file)

**Planning**

| # | Document | What it does | System check |
|---|---|---|---|
| P1 | Engagement setup | Setup answers: file type, year-end, how the books are kept, flags (5.2). Answers add documents | Reviewer signs it, so a wrong answer is caught here |
| P2 | Acceptance or continuance | CSRS 4200 acceptance: independence, intended use, basis of accounting | Blocks Fieldwork until signed |
| P3 | Engagement letter status | Staff see one line only: "Engagement letter: signed" or "Engagement letter: waiting". No letter, no fee, no name, no link | Work continues while waiting. **The compilation report cannot be released and the return cannot be marked filed until it reads "signed"** |
| P4 | Client snapshot | Filled automatically from the client record, the TaxDome tags and last year's file. Nobody types | Reviewer confirms |
| P5 | Records received and CRA check | What came in through the organizer, plus the CRA account check: balances owing, instalments, GST/HST and payroll filings, notices | Missing records listed, never assumed |

**P3, owner-only part:** an owner-only screen lists every client. The owner sets "signed" or "waiting" for each, whatever the source of the letter (Closebook has no link to Studio letters). For continuing letters (monthly clients), one setting per client per season covers every file for that client that year. Staff never see this screen. Who set it and when is recorded in the owner-only audit record.

**Fieldwork**

| # | Document | What it does | System check |
|---|---|---|---|
| F1 | Build the trial balance | Route set by P1 (table below) | Must balance. Opening retained earnings must equal last year's closing |
| F2 | Mapping | Section 4.5 | Unmapped accounts block the lead sheets |
| F3 | Bank and card reconciliations | Section 5.3 | Unexplained difference of $0.01 blocks sign-off |
| F4 | Adjusting entries (full files only) | Section 5.4 | Must balance; cannot post to total lines |
| F5 | Lead sheets, year-over-year review, "What changed this year" | Section 5.5 | Flagged lines need an explanation |
| F7 | Revenue check | Section 5.7 | Difference over $5,000 goes to the reviewer |
| F6 | Core schedules | Section 5.6 | Each schedule ties to its trial balance line |

F1 routes:

| How the books are kept | Route |
|---|---|
| Monthly client, Concept's QuickBooks | Import the QuickBooks Trial Balance report export (final, after year-end entries) |
| Client's own QuickBooks or Xero | Import their trial balance export |
| A bookkeeper's file | Import their trial balance |
| Bank statements, or paper after data entry | Import bank and card CSV files, code them in the **Transactions** view, and Closebook builds the trial balance |

**Transactions view (full files, Trial balance tab):** like QuickBooks' bank feed. One row per bank or card line, with a GIFI line suggested by the vendor rules. The preparer confirms or changes each suggestion. Lines the preparer cannot identify go to the round-2 request list, sent to the client through TaxDome. New vendor rules created here are saved for the client's future years.

**Conclusion**

| # | Document | What it does | System check |
|---|---|---|---|
| C1 | Financial statements and compilation report | Generated from the final trial balance (section 6) | Must balance; numbers locked to the trial balance |
| C2 | Management acknowledgement (MAL) | Generated with the statements; client signs through Studio signing | Compilation report cannot be dated or released until signed |
| C3 | Tax and GIFI tie-out | Full: Closebook GIFI is the one in ProFile. Monthly: Closebook GIFI from the imported trial balance compared line by line with the filed GIFI. Schedule 1 add-backs from tax codes. T183CORP recorded as signed (signing stays in TaxDome or Adobe) | Any difference blocks lockdown. Required GIFI codes must be present |
| C4 | Completion checklist and final sign-off | CSRS 4200 completion questions; preparer, reviewer, partner sign-offs | Open review notes block it |
| C5 | Filing and delivery | EFILE confirmation number recorded. Client receives statements, compilation report, minute book letter. Full files where the client keeps their own books also receive the client entry list (5.4) | Cannot lock without the confirmation number |
| C6 | Lockdown and roll forward | File freezes. Next year's file opens as in section 2, rule 8 | Only when every document is signed |

### 5.2 Documents added by setup answers

| Setup answer | Documents added |
|---|---|
| Realtor or team (tags PREC, RE Team) | T4A check (the tax worksheet is the source for the revenue check, 5.7) |
| Expenses paid personally | "Expenses paid personally" (section 5.8) |
| Monthly client (tag BK) | Home office and auto adjustments confirmed; QuickBooks year closed |
| Books from bank statements | Statement import and build-up; round-2 request for unknown items |
| First year with Concept (tag 1st-yr client) | Opening balance sheet (prior accountant's statements, so year-over-year works from day one); prior-year T2 review; CRA access setup |
| Dividends paid | T5 slips and summary; eligible and non-eligible split |
| Payroll | T4 reconciliation to payroll records; remittances |
| Annual GST/HST filer (tag GST/HST Annual) | Annual return prepared and filed |
| Holdco or related companies | Investments, intercompany balances, related-party note |

"What changed this year" answers (5.5) also add documents: for example related-party transactions add the related-party note.

### 5.3 F3, bank and card reconciliations

- The system lists every account mapped to lead sheet A (cash and bank) or DD (bank debt): bank accounts, credit cards, lines of credit, loans. No limit on the number of accounts.
- **Monthly files:** one confirmation for the whole file, ticked by the preparer: "Bank and cards reconciled in QuickBooks through [year-end month]". No exports, no uploads. (Later, with a direct QuickBooks connection, this is read automatically; not in this batch.)
- **Full files, per account:** attach the year-end statement page, enter the closing balance; the system compares it to the trial balance. Any difference must be explained by outstanding items (uncashed cheques, deposits in transit), to the cent.
  - Books built from statements: an exact match is expected; a difference means an import or coding error.
  - Outstanding items over **$5,000 in total** require the next month's statement to show they cleared.
- **Loans and lines of credit:** lender's year-end balance, and a check that the year's interest is booked as interest, not principal.
- **Rules:** no statement attached, no sign-off. Outstanding items older than 90 days go to the reviewer. This year's outstanding items carry into next year's file, where they must be shown as cleared.

### 5.4 F4, adjusting entries (full files only)

- **Types:** AJE (adjusting, changes the result), RJE (reclassifying, no income effect), TJE (tax, from ProFile).
- **Each entry:** automatic number (AJE-1, RJE-1, TJE-1), lines, required reason from a list (accrual, reclassification, correction, tax) plus a note, optional attachment.
- **Sources:**
  1. Schedules create their own entries (CCA produces the amortization entry; the shareholder loan schedule produces its reclassification).
  2. Standard entries set by owners in Settings, Closebook: home office, auto, accounting fee accrual, tax provision. Staff pick one and enter the amount.
  3. Free entries, for anything else. Always go to the reviewer.
- **ProFile loop:** export GIFI before tax entries; prepare the return in ProFile; enter ProFile's results (CCA by class, federal and provincial tax); TJEs are created automatically; export the final GIFI and re-import it to ProFile; the tie-out (C3) confirms they match.
- **Rules:** must balance; cannot post to a total line; an entry after the reviewer signed reopens only the documents it affects; free entries and any entry over **$5,000** go to the reviewer; accruals are marked to reverse, and next year's file lists the reversals.
- **Client entry list:** for full-file clients who keep their own books (their own QuickBooks or Xero, or a bookkeeper), Closebook produces the list of entries to book, sent with the statements for approval.

### 5.5 F5, lead sheets, year-over-year review, "What changed this year"

- Lead sheets built automatically, one per group. Columns: account, last year, this year before entries, entries (AJE/RJE/TJE), this year final, change $, change %. Monthly files have no entries column; same layout otherwise.
- **Flag rule:** a line is flagged when it changed by more than **$5,000 and** more than **20%**. Both conditions. One setting each, in Settings, Closebook.
- For each flagged line the preparer picks an explanation (new asset, new loan, revenue grew, one-time expense, reclassified, error found and fixed) and adds a short note. The reviewer judges.
- **"What changed this year"** (after coding): yes/no questions answered from the books: assets bought or sold; loans taken or repaid; shareholders or share capital changed; related-party transactions (rent, management fees, loans); revenue from a new source or a source that stopped; negative equity at year-end. Any "yes" adds the matching schedule or note.

### 5.6 F6, core schedules

| Schedule | Content | Checks |
|---|---|---|
| Shareholder loans (one per shareholder) | Opening, advances, repayments, salary and dividends credited, closing | Debit balance at year-end: system sets the s.15(2) repayment deadline (one year after year-end) and puts it on My day. Repeated borrow-and-repay patterns go to the reviewer |
| Capital assets and CCA | Cost, additions, disposals, accumulated amortization, by class | Additions over **$5,000** need the invoice attached. Ties to the trial balance. Feeds the capital assets note |
| GST/HST | Collected and input tax credits per books vs returns filed | Differences go to the reviewer (uses the P5 CRA check) |
| Income tax | Balance owing or refundable, instalments, this year's tax | Ties to the CRA account balance (P5) and to ProFile's tax |
| Receivables and payables | Year-end listing | Ties to the trial balance. Items over 90 days go to the reviewer |
| Equity and dividends | Share capital, dividends declared, eligible vs non-eligible | Dividends tie to T5 slips and the minute book letter |

Monthly files take schedule figures from the imported trial balance. Staff add only what QuickBooks does not hold (for example a dividend resolution date). Nothing is re-booked.

**Firm accounting policy (Note 1 default):** amortization equal to CCA (tax basis). Per-client override for the rare client who needs book amortization, set by the reviewer.

### 5.7 F7, revenue check (every file)

Revenue in the trial balance is reconciled to its source, never to bank deposits. The source depends on setup:

| Business | Source |
|---|---|
| Realtor or team | The brokerage tax worksheet |
| Invoices its clients | The sales or invoice report |
| Paid by card or online | The payment processor's annual report |
| Paid on slips | T4A or T5018 slips received |
| Any GST/HST registrant | Also cross-checked to revenue on the year's GST/HST returns |

The preparer enters the source total and attaches the report. A difference over $5,000 goes to the reviewer. Fixes: QuickBooks for monthly files, an entry for full files.

### 5.8 Expenses paid personally (added by setup)

The preparer enters the owner's receipts by category, or imports the owner's summary. Closebook makes one entry: debit each expense line, credit due to shareholder. Meals go to the 50% line automatically. For GST/HST registrants the input tax credits are split out. Receipts over $5,000 need the image attached. The entry feeds the shareholder loan schedule.

## 6. The year-end package (C1, C2, C5)

Reproduce Concept's current year-end package **exactly**: design, layout, wording and rules, from Appendix C (the firm's existing package standard). Clients must see no change. The only change: figures come from Closebook's final trial balance through the master lines, not from a parsed ProFile PDF.

From Appendix C, keep:
- Documents: cover; CSRS 4200 compilation engagement report on letterhead; balance sheet; statement of earnings and retained earnings; notes; Management Responsibility Acknowledgement (MAL) on plain paper with the corporation's name and address, signed by the signing officer; minute book letter signed Hashim Awad, CPA.
- Tie-outs: assets = liabilities + equity; 3640 = 2599; 9999 = 3680; retained earnings end = start + net income − dividends + prior period adjustment (3720).
- Rules: "year ended" vs "period from X to Y" (under 358 days); drop the prior-year column when empty; merge cash 1000 to 1059 as "Cash and cash equivalents"; split HST out of taxes payable; caption overrides (`CAP` and `references/gifi_captions.md`), now held on the master lines' statement line; the report, MAL and minute book letter share one date, and the report cannot be dated before the MAL is signed.
- Notes generated only when they apply: basis of accounting, GST/HST, source deductions payable, prior period adjustment, due to shareholder. **Add** the notes the current package leaves to hand-editing, generated from the file: amortization at tax rates (from the Note 1 policy), related parties (from the related-party lines and "What changed this year"), income taxes recoverable from a loss carryback (from C3).
- The client email from `render_email.py`, using its fixed approved wording and block rules (corporate tax, GST/HST, instalments, how to pay, documents). Do not rewrite the wording.
- The CSRS 4200 report wording is never edited without Hashim.

Changes from Appendix C:
- The MAL is signed through Studio signing (the same signing engine as quotes), not printed.
- The intake questions in Appendix C become fields in the file (report date, HST amount, shareholder loan terms, related-party names, NOA penalty and interest, GST/HST return result, dividends), filled from the file where the data exists and asked only where it does not.

## 7. Settings, Closebook group

A "Closebook" group in the Settings menu, owner-only pages (lock icons from real permissions). Remove "Chart of accounts (Soon)" and "Vendor rules (Soon)" from the main menu:
- GIFI lines (the master lines)
- Tax codes
- Lead sheets
- Firm chart matching (Concept's standard chart to GIFI lines, used by every monthly file)
- Standard entries
- Vendor rules, used by the Transactions view
- Bank CSV formats (per bank; reuse the Rename Client Documents tool's lessons on bank formats)
- Thresholds: reconciliation outstanding items $5,000; review flag $5,000 and 20%; entry review $5,000; capital additions invoice $5,000
- Note 1 accounting policy: amortization equal to CCA
- GIFI version

## 8. Build order

1. **Trial balance engine:** New file from the client database; file page with the five tabs; phases; imports and the Transactions view (QuickBooks export, client trial balance, bank and card CSV with vendor rules); master lines, GIFI, tax codes, lead sheets (load Appendices A and B); mapping with suggestions and the reviewer list; firm chart mapping; entries (F4); lead sheets and the review flags; GIFI export with required codes.
2. **Year-end package** (section 6) generated from the engine, with the Appendix C tie-outs.
3. **Compilation shell:** Planning and Conclusion documents, setup answers, sign-off roles and schemes, review notes, completion checklist, lockdown, roll forward, "Next:" line, firm work queue, firm templates.
4. **Schedules (F6), the revenue check (F7)** and the setup-added documents (5.2, including expenses paid personally).
5. **Monthly file:** read-only import, F3 confirmation, GIFI tie-out against the filed GIFI.
6. **ProFile loop for full files:** TJE entry from ProFile results, final GIFI re-export, tie-out.

Each step: tests, a preview on dummy data, Hashim's approval, then Live.

## 9. Acceptance test with a real file

Hashim has a real client file ready to test Closebook end to end and to drive changes.
- **Test project:** dummy data only, as always. For each build step, build a dummy client that mirrors the real file's shape (same kinds of accounts and situations, invented names and numbers) and run the step on it.
- **Live:** once a step is approved and merged, Hashim runs the real file through it on Live. Real client data never goes into Test, the repository or this chat.
- Changes found during the real-file test come back as a short written list from Hashim. Treat each as a normal change: brief first, Test with the dummy mirror, then Live.
- Keep a test log in docs/phase3/TEST-LOG.md: step, what was tested, result, changes requested. No client names or figures in it.

## 10. Appendices

- **A.** `GIFI-Concept-RC4088-Rev23.csv`: 404 GIFI codes with name, section, generic flag, required flag, CRA description.
- **B.** `Closebook-master-lines-APPROVED.xlsx`: master lines (419), tax codes (11), lead sheets (20), approved decisions.
- **C.** `Year-end-package-standard.zip`: the firm's existing year-end package standard (SKILL.md, scripts, captions reference, letterhead). Use it as the specification for section 6.
- **D.** `Closebook-screen-mockups.zip`: seven approved screen mockups (My files; file Documents tab; a document page, the revenue check; Trial balance tab; Entries tab; Statements tab; Settings, Closebook, GIFI lines). They show layout, wording and placement in Studio's look. Sample figures only. Build the real screens with Studio's existing components and styles; match the mockups' structure, labels and order.
