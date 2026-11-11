# Concept Studio: status report, end of Phase 2

Prepared Nov 10, 2026, for the review before Phase 3. Sources: docs/STATUS.md, docs/BRIEF.md (decisions 1 to 56), docs/SETUP.md, docs/PHASE2-BATCH.md, and the GitHub deploy history. No client data in this report.

## 1. Summary

- Phase 1 and all 12 Phase 2 steps are live at https://studio.conceptaccounting.ca.
- All 29 database changes are applied on Live. No Live database deploy has failed.
- 16 pull requests merged (Nov 9 to Nov 10, 2026), each tested on Test first and approved by Hashim.
- Checks passing on the last merge: 135 app tests, 18 database test files (329 checks), 11 screen parity cases, production build.
- Open before Phase 3: three parked items, a few housekeeping items and one Phase 3 input (section 7). The Live smoke test passed Nov 10, 2026 (section 6).

## 2. Where things run

| | Test | Live |
|---|---|---|
| App | https://concept-firm-app-git-claude-affection-694391-concept-accounting.vercel.app (Vercel sign-in first) | https://studio.conceptaccounting.ca |
| Database | Supabase "Concept Firm App - Test" | Supabase "Concept Firm App", Canada (Central) |
| Data | Dummy data only (real data cleared Nov 9) | Real firm data |
| How changes arrive | Every push to the work branch | Merge a pull request, then approve "Database deploy - Live" (only when there is a database change) |

## 3. Phase 1 (live Nov 9, 2026)

- Letters and proposals with Studio's EL v3.31 wording: Corporate letter, T1 letter, Proposal, T1 pricing. Final rules (owner only, review box, AB/BC confirmation, verified client name, approved GST/HST rate for proposals).
- Document vault: every download filed as a permanent version.
- Clients, engagements, proposals with results.
- Price book: catalogue, packages and floors; clean-up redone on Live; PTX-129 present.
- Templates: click to edit, Review and publish, history with Restore.
- GST/HST rates: 13 loaded and approved on Live.
- Studio import redone on Live from fresh Notion CSVs: 8 clients, 5 engagements, 0 proposals, 43 items, 9 packages and floors.
- Go-live checklist (decision 35) steps 1 to 8 done: Live database, domain, sign-in, the Microsoft 365 email hook, setup redone, real data cleared from Test.
- Backup restore test passed Nov 9, 2026. Next one due within a year.

## 4. Phase 2, step by step (all live)

| Step | What it does | PR | Database change |
|---|---|---|---|
| 1 | Pricing permission on every screen and in the database; change log page | #2 | 20261109000000 |
| 2 | T2 deadlines from the TaxDome CSV on My day; balance-due period, exclude switch, missing year-end flags. Real import on Live: 38 T2 companies | #2, #3, #4 | 20261109010000 |
| 3 | Settings for business hours, booking link and T1 rule values; staff phone | #5 | 20261109020000 |
| 4 | Public start page (owner opens it), leads, spam limits, Leads list, daily deletion of closed leads after retention | #6 | 20261110000000 |
| - | Settings reworked: own menu with search, one page per setting, locks from real permissions, only owners change roles | #7 | 20261110010000 |
| 5 | Lead alerts: email to everyone with Pricing, business-hours timer, 45-minute reminder, check every 5 minutes | #8 | 20261110020000, 030000 |
| 6 | T1 screening questions (section 4) as steps; quote worked out on the server; out-of-scope stop; PTX-100 invoice-only item | #9 | 20261110040000, 050000, 060000 |
| 7 | T1 quote and engagement letter (Appendix A) and the two quote emails, editable on Templates; Mark as sent; 21-day expiry | #10 | 20261110070000 |
| 8 | Online signing by private link, couples (waiting and same device), signed PDF with signing record, download and portal buttons, PTX-100 invoice line | #11 | 20261110080000 |
| 9 | Corporate form (section 10), routing, items YE-110/111/112/120/121 and GST-110, corporate quote (Appendix C, master letter, signing), deposit and balance, first-year checklist; review fixes | #12 | 20261110090000, 100000 |
| 10 | Monthly company leads: package suggestion for real estate, client type on the lead, Create proposal pre-fills the proposal builder | #13 | 20261110110000 |
| - | Live fix: server key permissions, and the start page shows staff the reason when questions cannot load | #14 | 20261110120000 |
| 11 | Download full export: every table and every stored file, manifest, README; last export shown, warning after 31 days | #15 | 20261110130000 |
| 12 | Menu fits a laptop without scrolling; readable dates in the letters' footer and the activity log | #16 | none |

Batch sections also covered: 1 (standing rules in the brief), 5 (renames and PTX-100), 14 (import fixes), 15 (Phase 3 text in the brief, not built), 16 (settings entered on Live).

## 5. Decisions recorded in the brief during Phase 2

Decisions 38 to 56 in docs/BRIEF.md. Key ones for Phase 3 readers:
- 41: monthly real estate package bands (corrected Nov 9).
- 50 and 51: T1 screening questions, then the step layout.
- 52 and 53: T1 quote, emails and signing.
- 54: corporate route, plus the table "Corporate quote: changes from the corporate master letter". Two changes come from section 11; the rest are from Hashim's Nov 10 review: exclusions wording, annual GST/HST return only, "Please sign this letter below", Appendix A payment timing, "plus GST/HST" everywhere, TaxDome sentence removed, accounts listed on the bookkeeping line, signer's title, no same-device line for one signer.
- 55: monthly leads and Create proposal.
- 56: full export.

## 6. Checked on Live, and what still needs a Live check

**Checked on Live**
- Sign-in, password reset email from "Concept Studio".
- Studio import, rates, price book clean-up, signature.
- TaxDome T2 import (38 companies).
- Business hours, booking link and phone entered.
- The personal start form loads (after the server key fix, Nov 10).
- All 29 database changes applied.

**Live smoke test: passed Nov 10, 2026**
- Personal lead, alert email, quote email, signing on the new layout, signed PDF with the complete letter and signing record.
- Company lead with alert ($3,199.00).
- Full export: 30 tables, 1,269 rows, 4 files.
- Found and fixed during the test: the base-fee line on the T1 form (decision 57), and the engagement letter standing on its own plus the sign panel (decision 58).

## 7. Open items

**Parked by Hashim**
- Two-step sign-in (2FA) on Vercel, Supabase and GitHub: after everything is done.
- Login emails show app@conceptaccounting.ca instead of studio@. Next check: MAIL_FROM in Vercel Production and the Exchange message trace.
- "Refresh from TaxDome" button: waits for TaxDome's public API to reach the firm. The CSV import stays meanwhile.

**Housekeeping**
- Hashim is reviewing the 72 T2 deadlines on My day before marking them done.
- Screening questions page on Live:
  - It still shows an old unused "Corporate tax" draft (version 1). The company form does not use it. Delete it, or I can hide it.
  - Its labels now match the start page: "My personal tax return" and "My company" (PR #17, Nov 10).
- docs/STATUS.md:
  - The header date and the "In progress", "Waiting on Hashim" and "Next steps" sections are out of date.
  - The Phase 2 section is current.
  - This report replaces the stale parts. Tidy STATUS before Phase 3.
- GitHub Actions warning: supabase/setup-cli@v1 runs on a deprecated Node version. Update the action at the next workflow change. No effect today.
- Start page: if the personal questions ever fail to load, clients see "Please call us" and signed-in staff see the reason.

**Waiting on Hashim (older items, still open)**
- Templates: one small change, publish, then check it in a draft Corporate letter.
- Trial templates: mark ready the ones approved in Studio.
- Quality log: in Phase 3, or dropped?

**Inputs needed for Phase 3**
- The Compilation Workpaper (GIFI chart of accounts list).
- The T2 price book and the current T1 engagement letter were listed as Phase 2 inputs. They are covered by section 11 (year-end items) and Appendix A. Confirm nothing else is expected from them.

## 8. Standing rules in force

- No price breakdown to clients anywhere. Only staff with Pricing see line prices.
- Every change goes to Test first. Hashim approves before Live (merge, then approve the Live database run).
- The brief is updated first. Tests grow with each feature. The change log is in plain words (Settings, Change log).
- Backups: daily Supabase backups (database only). The monthly full export adds stored files. Restore test once a year.
- Test holds dummy data only. No client data in chat, the repository or marketing.

## 9. Ready for Phase 3?

Yes, once the Phase 3 input (the Compilation Workpaper) is in hand. The Live smoke test passed on Nov 10, 2026.

Phase 3 (Year-End) is defined in docs/BRIEF.md (Appendix B text): gates, ledger, schedules, binder, GIFI export, T2 package.
