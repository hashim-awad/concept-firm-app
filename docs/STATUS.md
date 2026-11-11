# Concept Studio: status

Last updated: 2026-11-08. Branch `claude/modest-euler-ldxydw`. Decisions are in `docs/BRIEF.md`
(1 to 37); setup details in `docs/SETUP.md`; Studio move in `docs/STUDIO-MIGRATION.md`;
Phase 3 fit in `docs/PHASE3-FOUNDATION.md`.

## Where things run

- **Test app:** https://concept-firm-app-git-claude-affection-694391-concept-accounting.vercel.app (Supabase "Concept Firm App - Test"; Vercel asks you to sign in to Vercel first).
- **Live app:** https://studio.conceptaccounting.ca
- Every request to Hashim includes the full link to open (Hashim, Nov 10, 2026).
- Real client data cleared from Test on Nov 9, 2026 (counts in docs/SETUP.md). Test holds no real client data. The Studio import is redone in Live after the merge.

## Done (Phase 1)

**Letters and proposals**
- Corporate letter, T1 letter, Proposal and T1 pricing, with Studio's EL v3.31 wording and checks.
- Full-width two-pane screens: the form and preview scroll separately, and the divider can be dragged.
- Every download is filed in the document vault as a permanent new version.
- A Final letter records the engagement as "EL sent"; a Final proposal is recorded as "Sent".
- Final rules: owner only, review box, AB/BC confirmation, verified client name. A Final proposal also needs an approved GST/HST rate.

**Records**
- **Clients:** list, Companies/Individuals filter, edit, legal name check.
- **Documents:** engagements with status, proposals with results, and the vault with versions.

**Price book**
- Catalogue, packages and floors, T1 rows.
- Clean-up applied on Test (decision 33): 51 changes, then PTX-135 and PTX-136 set to each spouse, then PTX-101, 110 and 111 renamed with the PTX-101 note (4 changes), then Studio's T1 rows removed (1 change); the Catalogue is the one T1 price list (Hashim, 2026-11-08). Redo in Live. Package coverage labels from ticked services; Mapping confirmed (ACC-101 for monthly packages, pnl included in ACC-101).

**Templates (decisions 30 and 34)**
- Open a template, click text, change it, then Review and publish.
- History with Restore.
- Fill-ins shown by name.

**Admin**
- **GST/HST rates:** 13 loaded and approved (decision 32).
- **Settings:** signer names and signature (uploaded).
- **Import from Studio:** choose a file, check it, import. Price Floors, Service Catalog, Clients and Engagements are imported; Proposals had none; 1 past letter regenerated; floor corrections applied (decision 26).
- **Name:** "Concept Studio" with the Studio logo on every staff screen and email (decision 31).

**Tests (all passing)**
- **Engine parity:** 17 tests against Studio's page.
- **Screen parity:** 11 cases, Studio's forms against the app's screens, plus a production PDF build.
- **Unit tests:** 46.
- **Database tests:** every rule, wording versions, the clean-up, rates.

**Menu (decision 37)**
- New menu: Home, Sales, Clients, Work, Documents, Quality, Firm setup, Admin. Soon items greyed out. Folding groups with badges, Ctrl+K client search, client page with tabs, My day with signatures waiting and T2 filing deadlines, Team and roles merged.

## Resolved: GitHub account suspended (Nov 8 to Nov 9, 2026)

- GitHub suspended the account hashim-awad on Nov 8, 2026 (most likely an automatic abuse flag on a new account with heavy automated activity; GitHub has not said). Sign-in, the repository, pull request #1 and pushes are blocked (403).
- Appeal sent: GitHub Support ticket 4973605 (Nov 8, 2026, 3:23 PM).
- Code backed up: full copy of the current code and the change list sent to Hashim on Nov 8, 2026, saved in the firm records folder.
- Go-live paused at step 4 (merge pull request #1 into main). Live database untouched and empty. The Test app keeps running on its existing Vercel builds.
- Do not open a second GitHub account to get around the suspension.
- Nov 9, 2026: GitHub lifted the suspension. Repository, branches and pull request #1 checked intact; held commits pushed. Go-live resumed: pull request #1 merged and the live database deployed on Nov 9, 2026.

## Parked (low priority)

- "Refresh from TaxDome" button instead of the CSV export (Hashim, Nov 9, 2026). Needs TaxDome's public API (announced Oct 28, 2026, rolling out to firms); not yet in the firm's TaxDome (Settings > Integrations shows no API, Nov 9). When it appears: read-only key in Vercel, same preview and Save, CSV upload kept as a fallback. Zapier not used: it would route client data through a US third party.

- Two-step sign-in (2FA) on Vercel, Supabase and GitHub (Hashim, Nov 9, 2026).

- Staff login emails show the sender address as app@conceptaccounting.ca instead of studio@, although the mailbox's primary address is studio@ and the display name "Concept Studio" is right. Not investigated further (Hashim, Nov 9, 2026). Next check when picked up: the MAIL_FROM value in Vercel Production, and the sender address in the Exchange message trace.

## In progress

- **Email sender:** moving from app@ to studio@conceptaccounting.ca.
  1. Done: primary address studio@, display name "Concept Studio", app@ kept as an alias.
  2. Done: sending lock moved (studio@ InScope True, hashim@ False). Command in
     `docs/SETUP.md`, "Move the lock to studio@". Run it right after step 1: once the primary
     address changes, the app cannot send until the scope and MAIL_FROM are updated.
  3. Update MAIL_FROM in Vercel.
  4. Test with a password reset.

## Bugs

| Bug | State |
|---|---|
| Service Catalog import, row 40: "invalid input syntax for type integer: 51.5" | **Fixed.** It was the Order column (sort order), not a price. Order is now a decimal. The other rows were saved; row 40 (PTX-129) was not. The clean-up screen shows whether PTX-129 is in now; if not, re-import the Service Catalog (it adds only that row). |
| Engagements import: "Linked client is not in the app yet" for every row | **Fixed.** Notion's Markdown & CSV export writes links as a name with a file path; the reader now handles every format and matches names ignoring case, spacing and quote styles. Re-import saved 5 of 5. |
| Import result said "done" next to "Write failed" | **Fixed.** It counts saved rows and says "nothing was saved" when none were. |
| Import: Check cleared the chosen file, so Import had none | **Fixed.** Choosing a file checks it at once; one Import button for the same file. |

No other known bugs.

## Waiting on Hashim

1. **Email:** Microsoft 365 step for studio@ (primary address and display name). Send a screenshot.
2. **Templates:** make one small change, Review and publish, then check it in a draft Corporate letter.
3. **Trial templates:** mark ready the ones you approved in Studio.
4. **Quality log:** in Phase 3, or dropped?
5. **Accounts:** Vercel Pro is charged automatically to the card on file (Hashim, Nov 9, 2026). 2FA parked as low priority.
6. **Later inputs:**
   - For Phase 2: the T2 price book and the current T1 engagement letter.
   - For Phase 3: the Compilation Workpaper (GIFI COA list).

## Backup restore test (Nov 9, 2026): passed

- Backup used: Test project ("Concept Firm App - Test"), scheduled physical backup of Nov 9, 2026, 06:29:11 UTC (taken before the real client data was cleared from Test).
- Restored with Supabase "Restore to new project" into a scratch project "RESTORE TEST - delete Nov 9", in the firm's own organization, region Canada (Central) ca-central-1. Nothing was downloaded.
- Result: passed. Restored counts matched Test before clearing: 8 clients, 5 engagements, 1 document, 1 document version, 43 price book items, 9 packages and floors; also 1 staff, 15 GST/HST rate rows, 12 of 12 database changes applied.
- Scratch project deleted by Hashim on Nov 9, 2026; confirmed gone at about 12:20 PM EST (Toronto) from the project list, which shows only "Concept Firm App" and "Concept Firm App - Test".
- Live backups confirmed: daily physical backups on the live project, latest Nov 9, 2026 10:03 UTC. Database backups do not include stored files (vault PDFs); the full export (decision 9) must include them.
- Next restore test: within a year (standing rule 1.2).

## Phase 2 (Nov 9, 2026)

- Batch saved as `docs/PHASE2-BATCH.md`; brief updated to match (decisions 38 to 40, standing rules, Phase 2 summary, Phase 3 D note).
- Build plan approved Nov 9, 2026 with additions (brief decisions 42 to 44). Each step: built and tested on Test with dummy data only, then Hashim approves it before it reaches Live (merge into main).
- Order: 1 Pricing permission and change log; 2 T2 deadlines from TaxDome (decision 43); 3 settings fields; 4 leads; 5 lead alerts; 6 T1 screening and PTX-100; 7 T1 quote and emails; 8 signing; 9 corporate form, items and quote; 10 monthly leads; 11 full export with files; 12 remaining design fixes (menu fits a laptop, two date formats).
- Step 1 built on Test (Nov 9): Pricing permission in the database and on every screen, database tests for it (staff without Pricing see no prices; owners see all), change log page under Admin. Checked by Hashim on Test; approved and live Nov 9, 2026 (pull request #2, live database deploy applied 20261109000000_pricing_permission).
- Step 2 built on Test (Nov 9): Import from TaxDome, per-client balance-due period and exclude switch, T2 deadlines card on My day with Done, missing year-end flags (decisions 43 and 45). Checked by Hashim on Test with the dummy file; approved and live Nov 9, 2026 (pull request #2, live deploy applied 20261109010000_taxdome_t2_deadlines). TaxDome link set on Live: https://portal.conceptaccounting.ca/app/clients/{id}. Real import saved on Live Nov 9, 2026: 38 T2 companies, 6 matched to existing Studio clients (3 by name, 3 chosen by Hashim where the names differ), 32 new, 1 Individual flagged. Follow-ups live: "Same as existing Studio client" choice (PR #3); tick several deadlines and mark done, uncropped dropdowns (PR #4). Step 2 complete. Hashim is reviewing the 72 listed deadlines before marking them done (some 2025 returns may not be filed yet).
- Step 3 built on Test (Nov 9): Settings sections for business hours, booking link and T1 rule values (40 km; T1135 $100,000 and $250,000, checked Nov 9, 2026); phone per staff member on Team and roles; database tests. Checked by Hashim on Test; approved and live Nov 9, 2026 (pull request #5, live deploy applied 20261109020000_phase2_settings). Hashim entered business hours, his phone and the booking link on Live.
- Step 4 built on Test (Nov 10): public start page (closed until an owner opens it), lead records, spam protection, Leads list and page, My day new leads, lead sources and start page switch in Settings, daily deletion of closed leads after retention (decision 46). Before Live: Hashim adds CRON_SECRET in Vercel (Production) for the daily job. Live Nov 10 (PR #6; migration 20261110000000_leads.sql applied).
- Settings reworked (Nov 10, decision 47), at Hashim's request: own left-hand menu with search, one page per item, admin pages moved out of the main menu into Settings, lock on owner-only pages. Fixes (decision 48): locks from the real permission rules (with an automatic test), Accounting group in Settings, only owners change roles (migration 20261110010000_owner_changes_roles.sql). Live Nov 10 (PR #7; migration 20261110010000_owner_changes_roles.sql applied).
- Step 5 built on Test (Nov 10, decision 49): lead alerts. Email to everyone with Pricing when a lead comes in; business-hours timer on My day, Leads and the lead page; reminder email after 45 business minutes; check every 5 minutes on Live (needs CRON_SECRET, already set). Migrations 20261110020000_lead_alerts.sql and 20261110030000_lead_alerts_server_read.sql (server read access to leads and settings, found on Test). Live Nov 10 (PR #8; both migrations applied). Owner tools: "Send alert email now" on a lead, "Check alerts now" on Leads.
- Step 6 built on Test (Nov 10, decision 50): T1 screening questions (batch section 4) on the public personal form, quote worked out on the server and stored for Pricing holders, out-of-scope stop, PTX-100 invoice-only item. Migrations 20261110040000_t1_screening.sql (publishes the new personal version where the price book matches section 4; Test published version 3) and 20261110050000_t1_screening_publish_button.sql (owner button on Screening questions if it did not publish). Checked by Hashim on Test: $697 example, couple lead with answers and quote, alert email. No consent checkbox; button "Get my quote". Redesigned as steps (Nov 10, decision 51): layout only; migration 20261110060000_t1_screening_no_hint.sql republishes without the repeated hint. Live Nov 10 (PR #9; migrations 040000, 050000 and 060000 applied without error).
- Step 7 built on Test (Nov 10, decision 52): T1 quote and engagement letter (Appendix A) and the two quote emails (section 8), editable on Templates; Prepare the quote, copy the email, Mark as sent (21 days); client page by private link (read-only until step 8). Migration 20261110070000_t1_quotes.sql. Live Nov 10 (PR #10; migration applied). Hashim checked the quote page loads on Test.
- Step 8 built on Test (Nov 10, decision 53): signing through each private link, signing record, couples (waiting and same-device), signed PDF with a signing-record page, download and portal button, staff PTX-100 invoice line. Migration 20261110080000_t1_signing.sql. Hashim signed a couple quote end to end on Test (both signatures, lead Signed, PDF). Letterhead and letter style added. Live Nov 10 (PR #11; migration applied).
- Step 9 live Nov 10 (PR #12; migrations 090000 and 100000 applied, no item code clash on Live) (decision 54): decision 54): corporate route form (section 10) with details saved first, routing, year-end items YE-110/111/112/120/121 and GST-110, the corporate quote (Appendix C Part A, master letter Part B with the two recorded changes, Part C signing), the quote email, deposit and balance, first-year checklist. Migration 20261110090000_corporate_route.sql.
- Step 9 review fixes (Nov 10): recorded wording changes to Part B (exclusions, annual GST/HST return, sign below, Appendix A payments, plus GST/HST, TaxDome sentence removed), the accounts listed on the bookkeeping line, the company signer's title, and no same-device line for one signer. Migration 20261110100000_corporate_quote_fixes.sql.
- Step 10 built on Test (Nov 10, decision 55): monthly lead card with the package suggestion, client type on the lead, Create proposal pre-fills the proposal builder. Migration 20261110110000_monthly_leads.sql.
- Live fix (Nov 10): the server key could not read the published questions on Live (permission denied for table questionnaires), so /start/personal showed "not ready yet". Migration 20261110120000_server_key_grants.sql grants again and stops the deploy if any grant does not hold. Signed-in staff now see the reason on the start page. Root cause: the Production SUPABASE_SECRET_KEY in Vercel was not a service_role key; Hashim replaced it with the Live secret key and redeployed (Nov 10). /start/personal works on Live.
- Step 11 live Nov 10 (PR #15; migration 20261110130000 applied on Live) ( decision 56): Download full export (owners), every table plus every stored file, manifest and README. Migration 20261110130000_full_export.sql.
- Step 12 live Nov 10 (PR #16; no database change) ( batch section 13): the menu fits a laptop without scrolling (groups whose pages are all "Soon" start folded and show "5 soon"; name and Sign out on one row; measured at 1280x720, 1366x768, 1440x900 and 1536x864). Dates: the letters' footer shows the template approval date as "Nov 8, 2026" (was 2026-11-08), and the activity log shows price start dates the same way. Items 1, 2, 5 and 6 of section 13 were already done. No database change.
- **Phase 2 complete (Nov 10, 2026):** steps 1 to 12 are live. Parked: 2FA (after everything is done), the app@ vs studio@ sender, TaxDome "Refresh" once their API reaches the firm.
- **Live smoke test passed (Nov 10, 2026, Hashim):** personal lead, alert email ($299.00), quote email with button, signing on the new layout, signed PDF with the complete letter (letterhead, date, addressee, Re line, firm signature image, Director) and signing record; company lead with alert ($3,199.00: $2,900 + $100 car loan + $199 GST/HST); full export (30 tables, 1,269 rows, 4 files). Fixes found and made during it: base-fee line on the T1 form (PR #19, decision 57); complete engagement letter and sign panel (PR #20, decision 58). Test leads to be marked Lost.

## Phase 3: Closebook (from Nov 11, 2026)

- Batch saved as `docs/PHASE3-BATCH.md` with appendices in `docs/phase3/`; brief updated (decisions 59 and 60). Build plan approved by Hashim Nov 11, 2026: steps 1 to 6 in the batch order; step 1 in three parts.
- Inputs still needed (files, not decisions): a ProFile GIFI file from a dummy company or ProFile's GIFI import format; a QuickBooks Trial Balance export (Excel and CSV) from the dormant sample company; Concept's standard chart of accounts; the bank format notes (or one dummy CSV per bank); later, the Notion SOP links for "How to do this".
- Step 1, part 1 live Nov 11 (PR #22; migration applied on Live): Closebook permission area, GIFI codes, tax codes, lead sheets and the 419 master lines loaded from the appendices, owner changes with reasons and a log, Settings, Closebook (GIFI lines, Tax codes, Lead sheets, Thresholds, Accounting policy), Closebook menu section (My files, All files, Review notes; empty until part 2). Migration 20261111000000_closebook_structure.sql.
- Step 1, part 2a live Nov 11 (PR #23; migration applied on Live): New file (client from the client database, year-end with a reason when not 12 months, monthly or full, how the books are kept, preparer and reviewer), the 18 core documents (17 for monthly, no entries document), My files and All files with the "Next:" line and File by date, the file page (header, Next bar with Open next, five tabs), trial balance import (CSV or Excel; QuickBooks, Xero or bookkeeper layouts; must balance; this year or last year's column; importing again replaces). Migration 20261111010000_closebook_files.sql. Not yet: sign-offs and document pages (step 3), matching and lead sheets (part 3), Transactions view (part 2b), roll forward (step 3).
- Step 1, part 3a live (Nov 11, PR #24 merged; Live applied migrations 20261111020000, 030000 and 040000): matching accounts to GIFI lines, run automatically on import; layout borrowed from QuickBooks tax mapping (Hashim, Nov 11): a card with the accounts needing a decision and their total, a By GIFI line view with a wrong-sign flag, and changes in a side panel opened by the pencil (client history first, then name suggestions from a reviewable word list in src/lib/closebook/matching.ts; unclear accounts go to "Needs reviewer decision"; the reviewer's decisions and tax codes are kept for the client's future files), opposite balances move to the paired line, type-mismatch flags, tax codes changed by the file's reviewer only, lead sheets as one table with Flagged only and an Explain panel for each flagged line (explanation and note, migration 20261111030000_closebook_flag_notes.sql) (blocked until every account is matched), entries AJE/RJE/TJE for full files (must balance, never to a total line, RJE cannot change the result, every free entry goes to the reviewer, approved entries cannot be deleted). Migration 20261111020000_closebook_mapping_entries.sql. Then (Nov 11, Hashim): main lines with sub-lines can be locked (shown with a lock, not selectable; 1301.00, 2781.00 and 3701.00 locked by default; owners lock others in Settings with a reason), the GIFI picker shows only lines on the account's balance side with "Show all lines", and the lead sheet Explain panel links to the matching panel ("Wrong GIFI line? Change it"). Migration 20261111040000_closebook_locked_parents.sql. Next, part 3b: GIFI totals and export, checked against a ProFile GIFI file.
- Already in place: standing rules in the brief; Phase 3 text (matches Appendix B) with the monthly-clients note; section 12 correction (decision 41); renames 5.1; import fixes 14.1 to 14.3.

## Next steps, in order

1. **Email:** finish the studio@ move (Hashim, then Claude).
2. **Go live** (decision 35), one step at a time with Hashim. Checklist in `docs/SETUP.md`. Live database deploy workflow written (`db-deploy-live.yml`, owner approval, main only):
   - live database deploy with owner approval
   - studio.conceptaccounting.ca on Vercel production
   - the live email hook
   - setup redone in Live (import, signature, rates, clean-up)
   - real data cleared from Test
3. **Use it alone:** Hashim uses Concept Studio alone for 1 to 2 weeks and reports anything wrong or awkward, then invites the team.
4. **Phase 2:** T1 workflow. Public start page, screening, leads, automatic quotes with GST/HST, online signing, TaxDome handoff.
5. **Phase 3:** Year-End, as in the brief (gates, ledger, schedules, binder, GIFI export, T2 package).
