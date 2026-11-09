# Concept Studio: status

Last updated: 2026-11-08. Branch `claude/modest-euler-ldxydw`. Decisions are in `docs/BRIEF.md`
(1 to 37); setup details in `docs/SETUP.md`; Studio move in `docs/STUDIO-MIGRATION.md`;
Phase 3 fit in `docs/PHASE3-FOUNDATION.md`.

## Where things run

- Everything runs on **Test** (Supabase "Concept Firm App - Test", Vercel branch preview).
- **Live is not set up yet.**
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
- Nov 9, 2026: GitHub lifted the suspension. Repository, branches and pull request #1 checked intact; held commits pushed. Go-live resumes at step 4 (merge pull request #1).

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
5. **Accounts:** Vercel Pro before Nov 22, 2026, and 2FA on Vercel, Supabase and GitHub.
6. **Later inputs:**
   - For Phase 2: the T2 price book and the current T1 engagement letter.
   - For Phase 3: the Compilation Workpaper (GIFI COA list).

## Phase 2 (Nov 9, 2026)

- Batch saved as `docs/PHASE2-BATCH.md`; brief updated to match (decisions 38 to 40, standing rules, Phase 2 summary, Phase 3 D note).
- Build plan sent to Hashim; waiting for approval.

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
