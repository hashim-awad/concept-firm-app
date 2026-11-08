# Concept Studio: status

Last updated: 2026-11-08. Branch `claude/modest-euler-ldxydw`. Decisions are in `docs/BRIEF.md`
(1 to 35); setup details in `docs/SETUP.md`; Studio move in `docs/STUDIO-MIGRATION.md`;
Phase 3 fit in `docs/PHASE3-FOUNDATION.md`.

## Where things run

- Everything runs on **Test** (Supabase "Concept Firm App - Test", Vercel branch preview).
- **Live is not set up yet.**
- Real client data from the Studio import is now in Test. That breaks the "Test is dummy data only" rule until Live is set up and Test is cleared (decision 35).

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
- Clean-up screen built (decision 33).

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

## In progress

- **Price book clean-up:** approved by Hashim 2026-11-08 with one change: PTX-135 (US 1040-NR, federal) and PTX-136 (US state return) charged for each spouse who needs it (decision 7). Change made; Hashim presses Apply on this branch's preview.
- **Email sender:** moving from app@ to studio@conceptaccounting.ca.
  1. Hashim: set the primary address and the display name "Concept Studio" in Microsoft 365.
  2. PowerShell command that moves the sending lock (Exchange RBAC scope): **ready** in
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

1. **Price book clean-up:** open Price book, then Price book clean-up. Check it (send a screenshot if anything looks off) and press Apply.
2. **Email:** Microsoft 365 step for studio@ (primary address and display name). Send a screenshot.
3. **Templates:** make one small change, Review and publish, then check it in a draft Corporate letter.
4. **Trial templates:** mark ready the ones you approved in Studio.
5. **Quality log:** in Phase 3, or dropped?
6. **Accounts:** Vercel Pro before Nov 22, 2026, and 2FA on Vercel, Supabase and GitHub.
7. **Later inputs:**
   - For Phase 2: the T2 price book and the current T1 engagement letter.
   - For Phase 3: the Compilation Workpaper (GIFI COA list).

## Next steps, in order

1. **Price book clean-up:** Apply (Hashim).
2. **Email:** finish the studio@ move (Hashim, then Claude).
3. **Go live** (decision 35), one step at a time with Hashim:
   - live database deploy with owner approval
   - studio.conceptaccounting.ca on Vercel production
   - the live email hook
   - setup redone in Live (import, signature, rates, clean-up)
   - real data cleared from Test
4. **Use it alone:** Hashim uses Concept Studio alone for 1 to 2 weeks and reports anything wrong or awkward, then invites the team.
5. **Phase 2:** T1 workflow. Public start page, screening, leads, automatic quotes with GST/HST, online signing, TaxDome handoff.
6. **Phase 3:** Year-End, as in the brief (gates, ledger, schedules, binder, GIFI export, T2 package).
