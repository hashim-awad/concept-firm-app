# Piece S1: reviewer reports (unedited)

Copied word for word by script from the session record. Order: when each report came in. Dummy data only.

---

## 1. security-risk

Security and data-loss review of piece S1. I changed nothing. I ran the S1 tests and my extra probes on the local DB (127.0.0.1:54322) inside one transaction and rolled it back, then confirmed nothing was left behind.

**Answers to your questions**
- **Can a caller set `cb.schedule_save` themselves?** Not through the app. PostgREST only exposes the `public` and `graphql_public` schemas, so `set_config` cannot be called over /rpc. No public function sets a setting whose name comes from the caller. `authenticated` only has SELECT on `cb_entries`, `cb_schedules` and `cb_file_history`. The only place that sets it is `cb_save_schedule_entry`, and only when a schedule payload is passed. It is set for the current transaction only, used for the same `p_entry` (which must be in `p_file` with origin `schedule`), and cleared afterwards.
- **Non-schedule entries:** I set the value by hand in SQL and called `cb_edit_entry` on an approved plain entry. It was still refused. Through `cb_save_schedule_entry` the same entry gets "Entry not found."
- **Schedule save with no schedule:** refused (test S1-3).
- **What remains:** someone logged in to the database directly as `authenticated` could set the value for a schedule entry. That is not a client path.
- **Unintended changes in the function:** none. I compared it with the last migration that defined it (`20261212350000_piece10b_step6_reopens.sql` line 368). Note the migration comment says "piece R3a-1 state", but R3a-1 does not define this function. Exactly two hunks differ: the approval rule (migration lines 36-38) and the new History row (lines 80-84). The local DB already holds the S1 body, identical to the migration.
- **Locked and booked files:** a locked file is refused (test S1-4). A booked entry is refused by the `cb_booked_guard` trigger (my probe got "This entry is marked Booked in QuickBooks. Unmark it first.").
- **Who can take back an approval:** anyone with Closebook Edit. The brief does not say so. This is finding 2.

AGENT: security-risk
PIECE: Piece S1, change a saved schedule (branch claude/schedule-change at c0f32fb, git diff origin/main)
RESULT: NEEDS HASHIM
FOUND:
1. Medium. Where: /home/user/concept-firm-app/supabase/migrations/20261212390000_piece_s1_change_schedule.sql lines 36-38, against /home/user/concept-firm-app/docs/BRIEF.md (Piece S1: "Every other change, and deleting, an approved entry is still refused").
   - What is wrong: for an approved schedule entry, the schedule path lets every field change, not only the schedule amounts. Proven by probe: an approved AJE was saved through `cb_save_schedule_entry` and came back as type TJE, description "Totally new words", W/P ref "Other ref", date 2026-01-15 and number 77. The approval was taken back and History logged each change.
   - Why it matters: the approval rule is wider than the brief and Hashim's decision. An approved entry can change type (AJE to TJE), date or number without a correcting entry.
   - Fix: when `v_e.reviewed_at` is not null, also require that `p_kind`, `p_date`, `p_seq`, `p_note`, `p_wp_ref` and `p_reverse` are the same as on the entry. Otherwise refuse with "Only the schedule can change on an approved entry." Add a test for it.
   - Option: change the brief to say what may change. Recommended: the fix.
   - Source: Piece S1 brief; firm audit rule (approvals are a control); CaseWare-style review sign-off practice.
2. Medium. Where: same migration lines 36-38; /home/user/concept-firm-app/src/app/(app)/closebook/[id]/areas/entry-dialog.tsx line 81 (`canSched`); adjustments.tsx lines 58-65.
   - What is wrong: only the file's reviewer can approve an entry (`cb_review_entry` requires `auth.uid() = reviewer_id`). Now anyone with Closebook Edit, including staff not on the file, can take that approval back by saving the schedule again. The brief does not say who may do it.
   - Why it matters: it reverses the reviewer's control. It is logged, but nothing limits who can do it.
   - Options:
     - A: state in the brief that anyone with Closebook Edit can do it.
     - B (Recommended): limit it to the file's preparer, the file's reviewer, or someone with the Review right. Add `(select auth.uid()) in (v_file.preparer_id, v_file.reviewer_id) or private.cb_can('review')` to the S1 branch, apply the same rule to the app's `canSched`, and add a test.
   - Source: CPA Ontario quality management (review evidence); the app's roles (owner, reviewer, preparer).
3. Low. Where: migration lines 80-84.
   - What is wrong: saving the schedule again with nothing changed still takes back the approval. History then has only "Entry n: approval taken back because its schedule changed" and no other change row (probe P1).
   - Why it matters: the History reason is false, and the reviewer is asked to review again for no reason.
   - Fix: in `cb_save_schedule_entry`, when the entry is approved and the lines, header and schedule inputs are all the same, keep the approval and skip the row, or refuse with "Nothing changed." Add a test.
   - Source: audit trail accuracy (firm rule 6).
4. Low. Where: migration lines 81-83; /home/user/concept-firm-app/src/lib/closebook/history.ts (ACTION map).
   - What is wrong: the new row's old value is just "Approved". It does not say who approved it or when. `entry_approval_taken_back` has no label in ACTION (it falls back to "Entry approval taken back", which reads fine). Also, from before this piece: `cb_review_entry` writes no History row, so History shows the approval being taken back but never the approval itself.
   - Why it matters: History does not show the full approval trail.
   - Fix: put the reviewer's name and the approval date in the old value. Add the label. Log approvals in `cb_review_entry` in a later piece.
   - Source: firm rule 6 (sign-offs written to History).
5. Low. Where: /home/user/concept-firm-app/src/app/(app)/closebook/actions.ts lines 264-266 (`saveScheduleEntry`; not in the diff, but it is the screen S1 uses).
   - What is wrong: after the save the message is "Saved AJE 2026-00n". It does not say the approval was taken back.
   - Why it matters: the preparer may not know the entry went back to the reviewer.
   - Fix: when the entry had been approved, say "Saved. The approval was taken back: it goes to the reviewer again."
   - Source: Piece S1 brief.
6. Low. Where: /home/user/concept-firm-app/supabase/tests/change_schedule_piece_s1_test.sql.
   - What is wrong: there is no test for a booked entry, a save with nothing changed, header changes on an approved entry, or a staff member who is not on the file. The test also cannot run on a DB that already has an Admin (`bootstrap_owner` raises an error). To run it, I turned off the existing Admins and removed earlier copies of the test logins inside the rolled-back transaction.
   - Why it matters: the rules in findings 1 to 3 are not locked in by tests.
   - Fix: add those checks.
   - Source: firm test practice.
CHECKED:
- Diff scope: 5 files (BRIEF.md, adjustments.tsx, entry-dialog.tsx, one migration, one test). One commit, no client data in its message: PASS
- Function compared with its previous definition (piece10b, migration line 368): only the two intended changes. Local DB body is identical to the migration: PASS
- `cb.schedule_save` from the client: no exposed `set_config`, no public function sets a setting named by the caller, setting is transaction-only and cleared after use. Probe: value set by hand plus `cb_edit_entry` on an approved plain entry was refused: PASS
- `cb_save_schedule_entry` on a non-schedule entry: "Entry not found.": PASS
- Schedule save with no schedule on an approved entry: refused: PASS
- Locked file: refused (S1-4). Booked entry: refused by `cb_booked_guard` (probe): PASS
- Grants: `cb_edit_entry` and `cb_save_schedule_entry` executable by authenticated and service_role only, not anon or public (CREATE OR REPLACE keeps the grants). `authenticated` has SELECT only on `cb_entries`, `cb_schedules`, `cb_file_history`: PASS
- Server actions: use the signed-in user's client, and the database checks Closebook Edit. The app's `sched=1` edit path is not the only check, because the database refuses plain edits of approved entries: PASS
- Who can take back an approval: any Closebook Edit user. Brief does not say so: FOUND 2
- What changes on an approved entry through the schedule path: type, date, number, description and W/P ref all change: FOUND 1
- History: `entry_approval_taken_back` row written with action, detail, Approval, Approved to Needs review (S1-1 and probe). Wording is wrong when nothing changed: FOUND 3 and 4
- Secrets: none in the diff, tests or brief. Service role key not used in the diff: PASS
- Client data: `scripts/checks/name-check.sh` found no business number or client name, but CLIENT_NAMES was not set, so client names were not checked. By eye, the test uses "Birch Dummy Schedules Inc." and example.test emails, and the brief names no client: PASS (name list not set)
- Input: no SQL built from text in the diff. React escapes the new link labels. No change to uploads: PASS
- Migrations: nothing dropped, CREATE OR REPLACE is safe to run twice, no data change, `scripts/checks/migration-order.sh` passed. The only new call (`private.cb_log_event`) already exists on local. Test and Live were not checked: no access in this run: PASS
- Test file `change_schedule_piece_s1_test.sql`: 12 of 12 PASS, run in a rolled-back transaction. Gaps: FOUND 6

Files used: /home/user/concept-firm-app/supabase/migrations/20261212390000_piece_s1_change_schedule.sql, /home/user/concept-firm-app/supabase/migrations/20261212350000_piece10b_step6_reopens.sql, /home/user/concept-firm-app/supabase/migrations/20261212380000_piece_r3a1_roles_rights.sql, /home/user/concept-firm-app/src/app/(app)/closebook/actions.ts, /home/user/concept-firm-app/src/lib/closebook/history.ts. Probe script (rolled back): /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/run2.sql

---

## 2. ui-reviewer

**S1 post-build UI review: the controls work and nothing was dropped from the entry window, but one point needs your decision (NEEDS HASHIM).**

The schedule name in the Schedules table and the "Change schedule" button both open the right schedule window with its saved inputs, for all three kinds. They are labelled, take keyboard focus and keep the UI1 look. The point that needs a decision: opened this way, an approved entry's Description, date, number and attachments can also be changed and saved. The brief says every other change to an approved entry is still refused. I found that by reading the code; I did not save anything to test it.

I reviewed branch claude/schedule-change at c0f32fb against origin/main, the 7 screenshots, and the running app on http://localhost:3301 in a read-only headless browser. I saved nothing and changed no data. No mock, as agreed. I could not see the locked and booked cases live (no locked file or booked entry in the dummy data, and creating one would mean saving), so those were checked from the code only.

**Decision for Hashim (finding 1).** What should happen to the Description, date, number and attachments of an approved entry opened through Change schedule?
- A (Recommended): lock those fields in the form, with a note "Approved entry: only the schedule can change". The database also refuses any change to them when the entry was approved. This matches the brief.
- B: allow them, and log each change with the approval taken back. This means changing the brief.
- C: leave it as built. Not recommended: it does not match the brief, and an approved entry can change in more than its schedule.

**Findings, by severity**

*Medium (fix before merge)*
1. The approval is taken back without warning. The schedule window and the Edit window give no notice on an approved entry. After saving, the message only says "Saved AJE 2025-001". The fix: one line in the schedule window when the entry is approved ("This entry is approved. Saving takes the approval back and it goes to the reviewer again."), and add "Approval taken back." to the saved message.
2. Finding 1 above, the decision.
3. A booked entry can still be changed by URL. The controls are hidden when an entry is booked, but typing the address (`&edit=1&sched=1`) still opens the form. Neither the page that opens the form nor the database checks "booked". The brief says "not booked". This is older than S1 (the Edit link has the same gap), but S1 adds a new way in. Passed to security-risk.
4. Focus stays behind the window. After pressing Enter on the schedule name (or on Open), focus stays on the link in the page behind. Tab keeps moving through that page, not the window. Escape did not close the window. This is older than S1, but S1's new link has the same problem.

*Low (clean-up list)*
5. When the entry is not yet approved, the window shows both "Edit" and "Change schedule", and both open the same form. Either hide Edit for schedule entries, or rename it "Edit entry details".
6. "Change schedule" has no icon; the Edit button next to it has a pencil.
7. The schedule name link does not look like a change action, only like a link. Add a tooltip "Change the schedule".
8. Button wording differs: "Put it in the entry" (Vehicle) and "Put 162.51 in the entry" (Home office).
9. Window titles differ: "Expenses paid personally" has no "schedule"; the others say "Home office schedule" and "Vehicle schedule".
10. The Vehicle schedule shows its blocking messages in red. Studio's rules keep red for notes and amber for flags. The save button is greyed out with no reason next to it. This is older than S1.
11. The reopened Vehicle schedule works out to 7,486.66, but the saved entry is 7,700.00, and the window does not say so. This may just be the dummy data. Passed to accounting-reviewer.
12. The W/P ref is cut short ("Home office sche…") in the Entries list, even on a 1920-wide screen with room to spare. This is older than S1.
13. The wrong refusal message for an edit: it says "An approved entry cannot be deleted" when the user tried to change it. This is older than S1.

```
AGENT: ui-reviewer
PIECE: S1 change a saved schedule, branch claude/schedule-change @ c0f32fb (git diff origin/main; screenshots s1shots 1-7; live read-only browser run scratchpad/s1review/kb.mjs, kb2.mjs)
RESULT: NEEDS HASHIM
FOUND:
1. Where: src/app/(app)/closebook/[id]/areas/entry-dialog.tsx:162 and :166; supabase/migrations/20261212390000_piece_s1_change_schedule.sql:36-38. What: the approved-entry check allows any schedule save, and the form locks only Type. On an approved entry, Description, date, number (seq), W/P ref, attachments and "Reverse next year" can change and save through cb_save_schedule_entry with the schedule flag on. Why: the brief says "Every other change ... an approved entry is still refused"; the reviewer's approval can be bypassed for non-schedule fields (the History rows are logged). Fix: decision above, A Recommended (lock those fields in the form when reviewed_at is set; database refuses differences in head fields when v_e.reviewed_at is not null). Benchmark: CaseWare Cloud (signed-off content changes only through its own working paper). Severity: Medium, NEEDS HASHIM.
2. Where: screens 2-new and 4 (schedule window over an approved entry); src/app/(app)/closebook/actions.ts:262-263 (saved message). What: no warning before saving that the approval will be taken back; the saved message is only "Saved AJE 2025-001". Why: a preparer can undo a reviewer's approval without knowing it; Studio rule 2 (say the concrete thing). Fix: an amber line in the schedule window when the entry is approved; add "Approval taken back." to the saved message when it was approved. Benchmark: CaseWare Cloud warns that sign-offs will be removed before a signed document is changed. Severity: Medium.
3. Where: entry-dialog.tsx:155 and :162 (form page checks locked, not booked); the S1 migration has no booked_at check. What: a booked entry's schedule opens and saves by typing the URL ?open=<id>&edit=1&sched=1. Why: the brief says "not booked"; the controls are hidden but the action is still possible. Fix: in the form branch, return null when entry.booked_at is set; the database refuses edits of booked entries (or asks for "Unmark booked" first). Source: docs/BRIEF.md Piece S1. Severity: Medium, also for security-risk.
4. Where: step 5 Schedules table, schedule name link, and the entry window (live run). What: after Enter, focus stays on the background link (inDialog=false); Tab moves through the page behind the aria-modal window; Escape did not close the window (URL and 2 dialogs unchanged after 2 s). Why: Studio rule 6 (keyboard use); WCAG 2.4.3 focus order. Fix: move focus to the window's heading or first field on open, keep focus inside the window, Escape closes to closeHref, and return focus to the link that opened it. Benchmark: TaskDome/QBO modal behaviour; WCAG 2.4.3. Severity: Medium (older than S1, S1 adds a new way in).
5. Where: entry-dialog.tsx:101-102, entry window for a schedule entry not yet approved. What: "Edit" and "Change schedule" both appear and both open the same Edit journal entry form. Why: two names for one task (rule 2). Fix: hide Edit for origin "schedule", or rename it "Edit entry details". Benchmark: QBO, one action per task. Severity: Low.
6. Where: entry-dialog.tsx:102. What: "Change schedule" has no icon; the Edit button next to it has a pencil. Why: the button row looks uneven. Fix: add an icon (for example the Pencil or a FileText icon), or none on both. Benchmark: Dext action rows. Severity: Low.
7. Where: adjustments.tsx:65. What: the schedule name is a plain underlined link; only the aria-label says "Change". Why: sighted staff may not know the name opens the editable schedule rather than a view. Fix: add title="Change the {label} schedule". Benchmark: TaxDome lists (name opens the item, with a tooltip). Severity: Low.
8. Where: screen 7 compared with screens 2 and 6. What: the button reads "Put it in the entry" (Vehicle) and "Put 162.51 in the entry" (Home office) / "Put 1,641.30 in the entry" (Expenses). Why: inconsistent wording for one action. Fix: always "Put {amount} in the entry". Benchmark: Studio rule 2. Severity: Low.
9. Where: screen 6. What: the window title is "Expenses paid personally"; the others say "Home office schedule" and "Vehicle schedule". Fix: "Expenses paid personally schedule". Benchmark: Studio rule 2. Severity: Low.
10. Where: screen 7, Vehicle schedule. What: the blocking messages ("Add the signing officer to the client record first.") are red, and "Put it in the entry" is greyed out with no reason next to it. Why: rule 3 (flags amber, notes red). Fix: amber flag lines, and the disabled button's title names the reason. Benchmark: Studio rule 3. Severity: Low (older than S1).
11. Where: screen 7. What: the reopened Vehicle schedule shows 7,486.66, but the saved entry behind it is 7,700.00, with no note. Why: staff opening a saved schedule see a different figure without explanation (may be the dummy data). Fix: show "Saved amount 7,700.00" when the recalculated figure differs. Passed to accounting-reviewer. Severity: Low.
12. Where: Entries list W/P ref column (screens 1 and 5, live at 1920x1080). What: "Home office sche…" is cut short while the Description column has room. Why: rule 5 (never clipped). Fix: let the W/P ref wrap, or give it width from Description. Severity: Low (older than S1).
13. Where: S1 migration line 38 (text carried over from earlier pieces). What: an edit refused on an approved entry says "An approved entry cannot be deleted. Add a correcting entry instead." Why: wrong verb for an edit; rule 2. Fix: "An approved entry cannot be changed. Add a correcting entry instead." (separate message for edits and deletes). Severity: Low (older than S1).
CHECKED:
- Brief section Piece S1 read and compared with the diff: done; finding 1 does not match the brief.
- Schedules table name link, all 3 kinds (live): PASS, opens the schedule window over Edit journal entry with saved inputs (Home office 2,000/180 or 250; Expenses 5 lines; Vehicle 11,000/18,000 km).
- Accessible name (aria-label contains the visible text, WCAG 2.5.3): PASS.
- Keyboard: name link reached by Tab (34 presses) with a 2px navy outline: PASS. "Change schedule" reached by Tab, 2px outline: PASS.
- Focus moved into the window / Escape closes: FAIL (finding 4, older than S1).
- Entry window action parity with origin/main (Edit, Print schedule (PDF), Reverse, Delete, W/P ref link, Schedule tags, Approve, Add a review note, Close): PASS, nothing dropped; "Change schedule" added.
- Approved entry: Change schedule shows and Edit hides (screen 3): PASS.
- Locked file: name shows as plain text, button hidden, form branch returns null (code adjustments.tsx:43/65, entry-dialog.tsx:81/155): PASS (code only, no locked dummy file).
- Booked entry: controls hidden (code): PASS; typed URL blocked: FAIL (finding 3; code only).
- After save, step 5 sign-offs cleared and entry shows Needs review (screen 5): PASS.
- Warning or message that the approval is taken back: FAIL (finding 2).
- UI1 theme (navy links, btn-secondary btn-compact, sand table, status colours): PASS.
- Amounts: thousands separators and two decimals in the table, entry window and schedule boxes: PASS.
- Wording: plain; Low inconsistencies noted (findings 5, 8, 9, 13).
- Laptop 1280x800 and large monitor 1920x1080: PASS; W/P ref cut short (finding 12, older than S1).
- Nothing saved in the app; dummy data only: confirmed.
```

Files are in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/s1review:
- entry-window-unapproved.png
- large-table.png
- home-focus-name.png
- exp-focus-name.png
- veh-focus-name.png
- home-after-enter.png
- exp-after-enter.png
- veh-after-enter.png
- kb.mjs and kb2.mjs (the browser check scripts)

---

## 3. test-runner

I ran all four checks once on claude/schedule-change at c0f32fb. The database suite, unit tests and type-check all pass. Lint fails, but only on the 2 known errors in tests/import.test.ts. This used local dummy data only and never touched Live, and I changed no code.

**Results**
- **Database suite** (supabase/tests/run_local.sh against 127.0.0.1:54322, its own throwaway database): exit 0, "All database tests passed." 93 test files ran one at a time. 2,045 checks passed, 0 failed. Postgres 17.11 was already up, so no restart was needed.
- **New test file** supabase/tests/change_schedule_piece_s1_test.sql: 12 of 12 pass.
  - Setup: three schedule entries, all approved.
  - S1-1 (vehicle): same entry and number; the new amount (Dr 70600 9,100.00); the new saved inputs; the approval taken back; History says why.
  - S1-2: Home office and Expenses paid personally change on the same entry and lose their approval.
  - S1-3: an approved schedule entry still cannot be edited outside its schedule or deleted. A schedule save with no schedule does not get round this.
  - S1-4: a locked file refuses the change.
- **Unit tests** (npm test): 78 files, 595 tests, 595 pass, 0 fail.
- **Type-check** (npx tsc --noEmit): exit 0, no errors.
- **Lint** (npm run lint): exit 1, 2 errors and 5 warnings.
  - The 2 errors are both in tests/import.test.ts (47:46 and 74:31, `@typescript-eslint/no-explicit-any`). This branch does not change that file.
  - The 5 warnings are in review-lines.tsx and three fixture make.mjs files, none of which this piece touches.
  - The piece's two changed .tsx files have no lint problems.

**Compared to main 3e7cc71**
- Main was not rerun, because you asked for one run.
- The only changed test file is the new change_schedule_piece_s1_test.sql: 1 more database test file and 12 more checks.
- No existing test file changed, and no test failed, so there is no new failure.

**Not run:** parity, screens and the app flow on dummy files. You did not ask for these.

AGENT: test-runner
PIECE: S1 change a saved schedule, claude/schedule-change at c0f32fb (base origin/main 3e7cc71); commands: supabase/tests/run_local.sh, npm test, npm run lint, npx tsc --noEmit
RESULT: PASS
FOUND:
1. Where: supabase/migrations/20261212390000_piece_s1_change_schedule.sql line 38, checked by supabase/tests/change_schedule_piece_s1_test.sql S1-3. What: when someone tries to edit an approved entry, the refusal says "An approved entry cannot be deleted. Add a correcting entry instead." The message talks about deleting, but the action was an edit. The wording came from earlier pieces (piece 2 line 211, piece 10b line 392), and S1-3 now locks it in. Why it matters: staff who are refused an edit will read a message about deleting. Fix: builder gives cb_edit_entry its own message, for example "An approved entry cannot be changed. Change it through its schedule or add a correcting entry.", and updates the S1-3 check. Benchmark: firm writing standard (say the concrete thing). Does not block.
2. Where: supabase/tests/change_schedule_piece_s1_test.sql lines 1-3. What: the file header says saving also takes back the step 5 sign-offs, but no check covers that. Why it matters: the sign-off reset relies on existing entry triggers that this test never exercises, so a regression there would go unseen. Fix: builder adds a check that a step 5 sign-off made before the change is gone after it. Benchmark: the piece's own header and the migration comment (lines 4-5). Does not block.
3. Where: migration lines 35-38 and entry-dialog.tsx line 103. What: the screen hides "Change schedule" for a booked entry (`!entry.booked_at`), but the database function does not refuse a booked entry. Earlier pieces already allowed this for unapproved entries; this piece extends it to approved schedule entries. Why it matters: a direct call could change a schedule entry already posted to the client's books, and the screen is the only guard. Fix: for accounting-reviewer and security-risk to decide whether cb_edit_entry should also refuse when booked_at is set. Benchmark: firm rule that the server enforces what the screen hides. Does not block this test run.
CHECKED:
- Local Postgres 127.0.0.1:54322 up (pg_isready, PostgreSQL 17.11): OK, no restart needed
- Database suite run_local.sh: PASS, 93 files, 2,045 checks passed, 0 failed, exit 0
- change_schedule_piece_s1_test.sql: PASS, 12/12
- npm test: PASS, 78 files, 595/595 tests
- npx tsc --noEmit: PASS, 0 errors
- npm run lint: FAIL, only on the 2 known errors in tests/import.test.ts (47:46, 74:31), unchanged by this branch; 5 warnings, none in changed files
- Diff vs origin/main: 5 files; the only changed test file is the new change_schedule_piece_s1_test.sql; no existing test changed; no new failures
- Parity, screens, app flow on dummy files: not run (not in this brief)
