# Phase 3 (Year-End): how it fits the foundation

Status: design only, 2026-11-08. Nothing here is built. Requirements: `docs/BRIEF.md`, "Phase 3: Year-End".

## Verdict

The Phase 1 foundation takes Phase 3 without rework. Every Phase 3 piece is additive: new
tables keyed to an existing engagement, new permission areas as data, new document kinds.
No Phase 1 table needs to change shape before Phase 3 starts.

## What Phase 3 reuses as is

| Phase 3 need | Already built | Notes |
|---|---|---|
| One engagement per client per fiscal year (A) | `engagements` (client, type, fiscal year end, status, letter data) | The year-end file hangs off this row. Studio's engagement rows already come in through the import. |
| Signed engagement letter linked before work (C) | `documents` with `engagement_id`, permanent versions | Gate checks "a signed letter document exists for this engagement". |
| Gate reviewer permission (L, R) | `permission_areas` is a table; roles get a level per area | Add areas `year_end` and `gate_review` as rows. Owner role gets edit on new areas automatically. No code change to the permission system. |
| Activity log for gates, sign-offs, unlocks (Outputs) | `private.log_change` trigger on each table | Attach the same trigger to every Phase 3 table. |
| Binder files, statements, T2 package, minute book (K, T) | Vault: `documents` + permanent `document_versions` + private storage | Add document kinds (workpaper, schedule, statements, T2 package, minute book, T183, filed T2, year-end letter). Versions already never overwrite. |
| Client approval and T183 signing (N, Q) | Phase 2 signing record (planned) | Same signing record as quotes. Phase 2 must be built first, or Phase 3 waits for it. |
| PDF output with firm layout (M, T) | Server PDF (pdfmake, letterhead, fonts) | Statements and the package use the same renderer. |
| Notes library, compilation report wording (M) | Template library with owner approval and wording versions | Notes become templates with the same approval flow. |
| CSV import with check before saving (F) | Import screen pattern (check, problems by row, then write) | Bank register and TB uploads follow the same pattern, per engagement. |
| Clients, fiscal year end (A) | `clients.year_end_md`, province | Needs two new client fields (below). |
| Retention (Outputs) | Deletion job touches only lost and out-of-scope leads | Year-end data is never in scope of that job. |

## What Phase 3 adds (new, at Phase 3 start)

- **Client fields:** Business Number; tax payment deadline (2 or 3 months, set per corporation).
- **Chart of accounts:** firm GIFI master (code, name, BS/IS, group, sort, owner-edited), loaded from Hashim's Compilation Workpaper. Per-engagement accounts for renamed bank and card accounts.
- **Ledger:** journal entries and journal lines, double entry, amounts in whole cents (integers), so the trial balance nets to zero exactly. Every coded bank line, AJE and RJE is a balanced entry. A database check refuses any entry whose lines do not sum to zero.
- **Registers:** one per bank or card account per engagement; statement periods with opening and closing balances; continuity checked month to month. No row limits: screens page through rows (the database API returns at most 1,000 rows per request).
- **Client TB (Type 2):** imported lines and the client-account to GIFI mapping, saved per client so it rolls forward.
- **Vendor rules:** firm-wide (owner) and per client; they suggest, staff confirm.
- **Second-round request:** request items linked to transactions or balances, with answer date, explanation and disposition.
- **Schedules:** shareholder loan continuity per shareholder (with s.15(2) dates and calculated deadline), fixed assets and CCA continuity, HST reconciliation, accruals, prepaids, retained earnings.
- **Binder items:** section folder, preparer and reviewer sign-off, review notes; a change after reviewer sign-off sets a flag with who and when.
- **Gates A, B, C:** each gate is a record (who, when) plus the list of checks with pass, fail or explained. Gate B and C passes need `gate_review`.
- **Lockdown:** an engagement lock (who, when). A database rule refuses changes to any Phase 3 row of a locked engagement. Only an owner unlocks, with a reason, logged.
- **Filing record:** EFILE confirmation number and date, filed T2 PDF. Close is refused without them.
- **Roll forward:** creates the next engagement from a closed one and lists what came across.

## Points to settle before building

1. **GIFI file format (.GFI).** The record layout and sign rules must be taken from CRA's GIFI
   specification and ProFile's import notes, not from memory. The GIFI export test with
   Hashim (section O) is the acceptance test.
2. **s.15(2).** The app calculates the date and flags; it does not decide treatment. The
   exact deadline wording should be checked against the Income Tax Act and CRA guidance at
   build time.
3. **Payment deadline months** (2 or 3) is a setting per corporation chosen by staff; the
   app does not decide eligibility.
4. **Quality log.** Decision 29 said Studio's Quality log stays for Phase 3. The new Phase 3
   section does not name it. To confirm with Hashim: does the quality log come in with
   Phase 3 (and Studio's template approvals with it), or is it dropped?
5. **Signing.** Client approval and T183 CORP use the Phase 2 signing record, so Phase 2
   signing is a dependency.
6. **TaxDome.** No API link: staff record the organizer submission date by hand, as the brief says.
