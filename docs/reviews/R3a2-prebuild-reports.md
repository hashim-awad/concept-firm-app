# Piece R3a-2: reviewer reports (unedited)

Copied word for word by script from the session record. Order: when each report came in. Dummy data only.

---

## 1. workpaper-reviewer (Closebook vs CaseWare Cloud)

## R3a-2 pre-build review: file team and sign-offs (read-only, branch claude/r3a2)

I read docs/BRIEF.md lines 1003-1070 (R3a-2), the R3a-1 rules (lines 187-205 and 556-575), the five 1280 mocks, and the lock, reopen and MAL code in supabase/migrations/20261201010000_round12_deliver_and_lock.sql and 20261130000000_round11_statements.sql. I changed nothing and did not open caseware.com. Every point I make about CaseWare below comes from my own knowledge and is marked confirm or unsure.

The design is sound. It needs Hashim on two points before the build:
- **Is CaseWare really silent on one person signing two roles?** If it is not, Hashim's rule says follow CaseWare.
- **When must the step 1 partner circle be signed?** CSRS 4200 asks for acceptance before the work starts.

The build plan also leaves out one function that would make the partner record unreliable if it is built as written (finding 1).

### The CaseWare basis in the brief
- **Team per engagement, only assigned staff open it:** I confirm the general model. CaseWare Cloud assigns staff per entity and engagement, and engagement content opens only to assigned users who also have entity access. Unsure: I believe a firm can set this to restricted or open to all staff, so Q1 A matches the restricted setting, not the only setting.
- **Partner as an extra sign-off role added for chosen documents, Preparer and Reviewer by default:** I confirm this. Firms add roles such as Partner or a quality reviewer and assign them per document.
- **Role dependencies set the order:** Unsure. I cannot confirm that CaseWare Cloud enforces an order between roles. Check the Working Papers page.
- **Removing others' sign-offs is its own permission:** Unsure. It is plausible and I cannot contradict it.
- **Silent on one person signing two roles:** Contradiction risk. As I recall, CaseWare (at least Working Papers desktop) has a sign-off setting on whether one user may sign more than one role. I am not certain it exists in Cloud, so the page must be checked. If it does, follow its behaviour: the setting is per firm or template, and allowed double sign-offs show in the record.
- **Not in the brief:** CaseWare marks a sign-off as out of date when the document changes after it was signed. Closebook clears the step instead, which is stricter and acceptable. The partner circle must follow the same rule (finding 1).

### 1. Q1 to Q7
- **Q1 A (only the team opens the file):** Matches CaseWare's restricted mode. Sound.
  - Gap: Admins who are not on the team open the file to manage the team, but item 5 hides History from them. The panel then says "Changes are recorded in History", which they cannot read. Either let Admins with Closebook Edit read History, or change the panel text.
  - Q1 A puts the team check in every Closebook read rule. That is the largest database risk in the piece, so a read test is needed per table.
- **Q2 A (who can be on the team):** CaseWare is silent here. Sound.
  - Add: a lead cannot be removed until another lead is picked.
  - Add: someone switched off stays on the team, shown as "(inactive)", and cannot sign.
- **Q3 A (partner circle opens after the reviewer signs):** Sound whether or not CaseWare enforces order.
  - Add the reverse: taking back or removing the reviewer sign-off also clears the partner circle.
- **Q4 A (lock waits for the partner circles):** CaseWare is silent as far as I know. Sound.
  - The gate is not retroactive. Files already locked on Live are not touched, but a reopen and relock will need all three partner circles. Say so in the Live report.
- **Q5 A (a partner who prepared or reviewed may sign the partner circle):** CaseWare is silent. Sound for a firm with one partner, but it must be visible (see section 3).
- **Q6 A (sign-offs stay when someone leaves the team):** I believe this matches CaseWare: a sign-off keeps the signer's name whatever the team is later. Sound.
- **Q7 A (lock, remove sign-offs and review notes also need the team):** Matches CaseWare, where engagement actions need engagement access. Sound.

### 2. Partner circle on steps 1, 9 and 10
- **The steps are right for CSRS 4200.** Step 1 is acceptance and the agreed terms. Step 9 is the statements, the MAL and the dated compilation report. Step 10 is release.
- **Steps 7 and 8 do not need one.** CSRS 4200 has no partner review requirement. A partner approving the T2 before EFILE would be firm policy, not the standard. Recommend no, Hashim's choice.
- **Order and gate:** after the reviewer, with the lock gate, is right.
- **Step 1 timing gap:** Q4 lets the step 1 partner circle be signed at the very end, which records acceptance after the work. Options:
  - A (Recommended): the step 1 partner circle must be signed before any sign-off on step 2 or later.
  - B: allow it, with an amber line "Acceptance signed after work started" and a History entry.
- **Step 9 timing:** the MAL goes out after the reviewer signs step 9. State the rule: the partner circle on step 9 opens only once the MAL is signed, and the report is dated no earlier than the MAL signature. The mock does not show this.

### 3. The same-person rule and the Partner exception
- **Sound** for a small firm whose only partner may do all the work.
- **Record the basis when signing.** Store the reason ("Partner sign-off") on the sign-off row when it is signed. Do not work it out later from the person's current role. Otherwise the mock's line "Allowed because Pat Partner has Partner sign-off" changes if the role changes.
- **Older sign-offs** (same person, no Partner switch, allowed under R3a-1 decision 7A) must say "Signed before the same-person rule", not claim a Partner basis.
- **Extend the line under Q5:** "Prepared, reviewed and signed as partner by the same person". History records it.
- **The rule also covers the step 3 sub-steps** (database and amber line), as UI1 Q3 already does for the line.
- **Suggestion:** the step 10 lock list shows "n steps prepared and reviewed by the same person", so the partner sees it before locking.

### 4. Team and leads
- The model is sound: the team decides access, and the leads decide My files and the work queue.
- There is no named engagement partner per file. With one partner today that is fine. Any team member with the switch may sign as partner. Revisit when there is a second partner.

### 5. The mocks
- **step9-partner:** the left list shows step 9 as green "Reviewed" while the partner has not signed, and COMPLETION says "0 of 2 reviewed". Decide what a step waiting for the partner shows (suggest blue "Partner to sign") and whether module counts include the partner circle.
- **not-on-team:** the step 9 header shows "Not reviewed" but the left list shows "Reviewed". The mock data contradicts itself.
- **people-panel:** "Remove" is live beside both leads, which Q2 does not allow. Dana's Lead reviewer option is greyed with no reason given (needs "Needs the Review switch").
- **same-person:** clear. The basis must be stored (see section 3).

### Missing from the build plan
cb_clear_step (whenever a step reopens or changes after signing), the step 9 package-change reopen with the MAL withdrawal, cb_reopen_file and cb_unsign_step must all clear partner_by and partner_at. The plan lists partner columns and team checks but not this clearing. If it is left out, a partner sign-off survives a change to the statements, and the record shows approval of content the partner never saw.

The Live check query does not count step 3 sub-step sign-offs by the same person. It also does not show whether each same-person signer has Partner sign-off. Both matter for the backfill wording.

AGENT: workpaper-reviewer (Closebook vs CaseWare Cloud)
PIECE: Piece R3a-2 file team and sign-offs, version 1 (docs/BRIEF.md line 1003, mocks 1280-*.png), pre-build
RESULT: NEEDS HASHIM
FOUND:
1. Where: docs/BRIEF.md line 1050 (build plan); supabase/migrations/20261201010000_round12_deliver_and_lock.sql line 393 (cb_clear_step in cb_reopen_file); round11_statements.sql lines 112 and 169 (step 9 reopen, MAL withdrawal). What: the plan does not say that reopening or clearing a step, or taking back the reviewer sign-off, clears partner_by and partner_at. Why: a partner sign-off would stand on changed statements, so the record would be unreliable. Fix: add cb_clear_step, cb_reopen_file, the step 9 reopen and cb_unsign_step to the plan, with database tests. Benchmark: CaseWare marks a sign-off out of date when the document changes; Closebook's own rule is to clear on change.
2. Where: BRIEF line 1027 ("Silent: the same person signing two roles"). What: CaseWare may document a setting on whether one user can sign more than one role (I recall it in Working Papers; not confirmed for Cloud). Why: Hashim's rule is to follow CaseWare where it covers the point. Fix: open the CaseWare Cloud sign-off settings page before the build. If the setting exists, copy it: a per-firm setting, with double sign-offs shown. Benchmark: CaseWare sign-off roles settings (unsure, to confirm).
3. Where: Q4 (BRIEF line 1039) and step 1. What: the step 1 partner circle can be signed after all the work. Why: CSRS 4200 requires acceptance and agreed terms before the engagement work. Fix: A (Recommended): it must be signed before any sign-off on step 2 or later. B: an amber "Acceptance signed after work started" line and a History entry. Benchmark: CSRS 4200 acceptance requirements; CaseWare silent.
4. Where: build plan and mock same-person. What: the "Allowed because ... Partner sign-off" basis appears to be worked out from the current role. Why: the record would change when a role changes. Fix: store the basis on the sign-off row when it is signed; older 7A rows say "Signed before the same-person rule"; under Q5 the line extends to the partner circle; the rule applies to step 3 sub-steps. Benchmark: Hashim item 4; CaseWare silent or unsure.
5. Where: step 9 and the MAL (BRIEF line 321, round11 line 12). What: the order of the partner circle against the MAL signature and the report date is not stated. Why: the compilation report must not be dated before management's acknowledgment. Fix: the step 9 partner circle opens only once the MAL is signed; the report date is not before the MAL date. Benchmark: CSRS 4200 management acknowledgment and report dating.
6. Where: mock 1280-step9-partner.png (left list) and 1280-not-on-team.png. What: step 9 shows "Reviewed" in the list while the header shows "Partner not signed" or "Not reviewed", and COMPLETION shows "0 of 2 reviewed". Why: a partner or reviewer would misread the step's state. Fix: a "Partner to sign" status for the list; decide whether the counts include the partner circle; make the mock data consistent. Benchmark: UI1 D3 and D4.
7. Where: mock 1280-people-panel.png. What: "Remove" is live beside the leads, and the greyed Lead reviewer option gives no reason. Why: it invites an action Q2 forbids. Fix: disable Remove for leads ("Pick another lead first") and give the reason "Needs the Review switch". Benchmark: Q2 A.
8. Where: Q1 A and item 5. What: an Admin who is not on the team manages the team but cannot read History, yet the panel says "Changes are recorded in History". Fix: let Admins with Closebook Edit read History, or change the text. Benchmark: CaseWare silent.
9. Where: Live check SQL (BRIEF lines 1058-1069). What: no count of same-person sub-step sign-offs, and no flag for whether the signer has Partner sign-off. Fix: add both, so the backfill wording is right. Benchmark: brief item 6.
CHECKED:
- CaseWare basis, team per engagement and restricted access: confirmed in general; unsure whether restriction is a firm setting.
- CaseWare basis, Partner as an added sign-off role: confirmed.
- CaseWare basis, role dependencies set the order: unsure.
- CaseWare basis, removing others' sign-offs is a permission: unsure, not contradicted.
- CaseWare basis, silent on same-person sign-off: possibly wrong (finding 2).
- Q1 A: sound, History gap (finding 8). Q2 A: sound, needs lead and inactive rules. Q3 A: sound, add clearing on unsign. Q4 A: sound, step 1 timing (finding 3). Q5 A: sound if recorded (finding 4). Q6 A: sound. Q7 A: sound.
- Partner circle on steps 1, 9 and 10 for CSRS 4200: right; none needed on steps 7 or 8.
- Same-person rule and Partner exception: sound; basis must be stored (finding 4).
- Team vs leads: sound.
- Mocks (5 at 1280): two status contradictions and one panel issue (findings 6 and 7).
- Build plan vs existing lock, reopen and step-clearing code: partner clearing missing (finding 1).
- Live check SQL: read-only, file id and initials only; two counts missing (finding 9).

---

## 2. ui-reviewer

## Piece R3a-2 pre-build mock review (ui-reviewer)

Result: **FAIL**, fix the mocks and take new screenshots. The look matches UI1 well: top bar, client header, tag style, colours, square corners and font all agree with the built app. No em dashes anywhere.

The FAIL comes from two kinds of problem:
- **The mocks contradict themselves**, so the builder would be copying wrong states.
- **Three accessibility defects in the Team panel** would get built as drawn.

All of them are small fixes.

Sources:
- Mocks: /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/r3a2mock/ (gen.py and the 5 HTML files).
- I took two screenshots of the built app at 1280: /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/built-step9.png and /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/built-people.png. The `?step=9` link landed on Step 1, so I compared header, tags and chip there.
- Built code: /home/user/concept-firm-app/src/app/(app)/closebook/[id]/shell/shell.tsx

Answers to the two questions:
- **Is the Partner tag distinct enough from Reviewed?** Only by its first word. `.ptag` uses the same green on the same background as Reviewed (#046A38 on #E3F1E8). Green is right, because a partner sign-off means done. But two green tags side by side read as the same thing at a glance. Add a small mark before "Partner" (hidden from screen readers), so it is told apart by shape, not by colour or by reading. See item 9.
- **Are the two refusal options clear?** Mostly. Option A (the closed page, which names the leads) is clear. Option B does not name the leads and says "under Team". Neither mock shows how All files marks a file you cannot work in. See items 10 and 11.

AGENT: ui-reviewer
PIECE: R3a-2 mocks v1 (r3a2mock/gen.py: people-panel, step9-partner, not-on-team, not-on-team-closed, same-person at 1280x720, scale 2)
RESULT: FAIL
FOUND:
1. **Team panel radios do not say who they are for.** Where: people-panel.html, gen.py lines 22-23 (the TEAM row template). Screen readers hear "Lead preparer, radio, 1 of 3" three times, with no person's name. The groups are named lp/lr across rows with no fieldset or legend. Why it matters: a screen reader user cannot tell whom they are making the lead (WCAG 1.3.1 and 4.1.2). Fix: give each radio a name such as "Dana Staff as lead preparer" (aria-label), or lay the panel out with two named columns using fieldset and legend ("Lead preparer", "Lead reviewer"). Benchmark: WCAG 2.2 AA; CaseWare Cloud Manage Team.
2. **Remove looks the same for leads, but it is disabled and the reason is in a tooltip only.** Where: people-panel screen (Remove next to Dana Staff and Morgan Manager); gen.py line 23 (`disabled title='A lead stays on the team'`). Why it matters: it looks clickable but does nothing. A disabled button cannot be reached with Tab, so keyboard and screen reader users never get the tooltip. This breaks rule 6 (keyboard use) and BRIEF Q2 A ("a lead stays on the team while they are a lead"). Fix: for a lead, replace Remove with grey text "Lead, stays on team" (#63666A). Or keep the button working and show one line in the panel when it is used: "Choose another lead preparer first." Benchmark: WCAG 2.2 AA 1.3.1 and 2.1.1; QBO disabled-action pattern.
3. **The "Add to team" box border is too faint.** Where: people-panel, gen.py line 25 (select border uses var(--line), #D0D0CE, on white). Measured contrast is 1.54 to 1; WCAG 1.4.11 needs 3 to 1 for a field edge. The built People panel's selects have a darker border. Why it matters: the field edge is hard to see on a laptop screen. Fix: use the built app's select style, not an inline style. Benchmark: WCAG 2.2 AA 1.4.11; the built UI1 People chip.
4. **The grey "Partner not signed" tag is plain text, not a button.** Where: step9-partner and not-on-team (gen.py lines 32 and 39, `<span class="tag t-grey">`). In the built app, every unsigned tag ("Not prepared", "Not reviewed") is a button that opens the sign-off box (shell.tsx, the SignCircles Popover). Why it matters: one tag in the row that does nothing breaks the D4 pattern, and a keyboard user cannot reach the partner sign-off box (its rights message and "After the reviewer"). Fix: build it with the same tag() helper. Name read aloud: "Partner not signed. Partner sign-off opens after the reviewer, open sign-off." Benchmark: UI1 D4; the built shell.tsx.
5. **The step list contradicts the step header.** Where: all four file screens.
   - Completion says "0 of 2 reviewed", but step 9 shows green "Reviewed" and its mark is not filled green.
   - On not-on-team, the header says "Not reviewed" but the list says "Reviewed".
   - Why it matters: staff and the builder will copy a wrong state. UI1 Q4 says "n of m reviewed" counts reviewed steps and a reviewed step gets a green mark.
   - Fix: in sl() (gen.py line 15), make step 9 match each screen. Use "1 of 2 reviewed" and a filled mark with the current-step ring where step 9 is reviewed. Use a blue "Prepared" tag in the list on not-on-team.
   - Benchmark: UI1 D3/Q4.
6. **Same-person screen highlights the wrong step.** Where: same-person.png. The main pane shows Step 2 · Opening balances, but the step list highlights 9 Statements as the active step (gen.py line 18, `page()` always calls sl(9)). Why it matters: it breaks "the step list marks the active step" (UI1 keyboard fix). Fix: pass the active step into page() and use sl(2) for this screen. Benchmark: UI1 D3.
7. **Not-on-team (option B) still shows the History button.** Where: not-on-team.png, History button top right. The note under the mock says "the History button is hidden". Why it matters: the mock contradicts the rule it shows (BRIEF item 5, History is read by the team). Fix: remove the History button from head() for this screen. While there, show the person icon as Riley's initials, not HA: HA is an Admin, who would be able to open the file. Benchmark: BRIEF R3a-2 item 5.
8. **Built parts missing from the mocks.** Where: step9-partner and same-person title rows, and the header.
   - The title row lacks Issues, Add review note, Export, Help and the step menu.
   - The header lacks "My files". All of these are in the built app (built-step9.png).
   - Why it matters: the UI1 parity rule is "restyle, do not drop". A mock without them may lead the builder to drop them or to place the Sign as partner button where they sit.
   - Fix: draw them on the step 9 row. Check the row still fits at 1280 with three tags plus "Sign as partner"; it is about 1,300 px at scale 2 before the icons are added.
   - Benchmark: UI1 build notes (Parity).
9. **The Partner tag can be told apart from Reviewed only by reading it.** Where: step9-partner.png, second row; gen.py `.ptag` (same as t-ok). Why it matters: two green tags with the same look side by side are hard to tell apart at a glance. Fix: keep green, because partner sign-off means done. Add a small mark before "Partner" (hidden from screen readers), for example a seal or shield icon, the same size as the Issues triangle. Do not add an outline: D10 says tags are filled with no outline. Benchmark: UI1 D2/D10; CaseWare sign-off roles.
10. **Option B refusal: the wording is weaker than option A.** Where: not-on-team.png box: "To join, ask an Admin to add you under Team." Why it matters: "under Team" is jargon, and it names nobody, unlike the option A page. Fix: "You are not on this file's team. You can read it, but only the team signs it and reads its History. Lead preparer: Dana Staff. Lead reviewer: Morgan Manager. Ask an Admin to add you." Also label this mock "Option B" (the closed page already says "Option A"), so Hashim can compare the two directly. Benchmark: Studio rule 2 (plain words); CaseWare assigned staff.
11. **Neither option shows how All files marks a file you cannot work in.** Where: not on any screen (Q1 A and B). Why it matters: under option A, staff click into a dead end. Fix: mock one All files row with a grey "Not on team" tag (and a lock icon under option A). The person's own team files keep their normal status tags. Benchmark: TaxDome lists; UI1 Q9 grey = closed.
12. **Panel wording.** Where: people-panel intro text and person lines.
    - "sign the circles their role allows" uses an old word: the built app uses tags and sign-offs.
    - "Leads decide My files and the work queue" is unclear.
    - Role lines like "Accountant · Prepare" and "Partner · Prepare · Review · Partner sign-off" (which wraps onto a third line) are cryptic.
    - Why it matters: grade 7 plain words, and rule 5 (no clipped names).
    - Fix, intro: "The team can work on this file. Each person signs what their role allows. The lead preparer and lead reviewer get this file in My files and the work queue."
    - Fix, role lines: "Accountant. Can prepare." and "Partner. Can prepare, review and sign as partner."
    - Benchmark: Studio rule 2; Ignition/TaxDome plain labels.
13. **Disabled "Lead reviewer" radio for Dana has no reason shown.** Where: people-panel, Dana Staff row (a lighter radio). Why it matters: staff cannot tell why it is greyed out. Fix: drop the radio for someone who cannot hold that lead, and show grey text "Cannot review" in its place. Or keep it disabled and add that text under it, read aloud with aria-describedby. Benchmark: WCAG 3.3.2; QBO.
14. **Header chip and panel heading differ from the built chip.** Where: the header chip on all four file screens (shows "Team DS MM PP"); people-panel heading "TEAM ON THIS FILE".
    - The built chip shows initials only below 1440 ("DS · DO"), and its panel heading is "People" in sentence case. Small capitals are used only for section headings on the page.
    - Why it matters: it should be consistent with the UI1 build note on the header below 1440.
    - Fix: keep the word "Team" (it is the new name and helps), but check the header still fits at 1280 with "Not final" showing. Use a sentence-case panel heading, "Team on this file".
    - For people who are not on the team (option B), either keep the chevron and open the read-only list, or make the chip plain text. Today it is a button that says it opens a dialog but shows no chevron.
    - Benchmark: the built shell.tsx PeopleChip; UI1 build notes.
15. **The dialog's keyboard behaviour is not stated.** Where: people-panel (role="dialog" without aria-modal; nothing says what happens to focus). Why it matters: rule 6. Fix: state it in the build notes:
    - focus goes to the first radio when the panel opens;
    - Tab stays inside the panel;
    - Esc acts as Cancel and puts focus back on the Team chip;
    - Add moves the new person into the list and puts focus on their row;
    - after Save, a short message is read aloud ("Team saved").
    - Also say on screen that Add only lists the person until Save: "Added people join when you click Save."
    - Benchmark: WAI-ARIA dialog pattern; WCAG 2.4.3.
16. **Gap for Hashim: the step list and a partner sign-off that is still open.** Where: step9-partner list (step 9 shows only "Reviewed"). Why it matters: under Q4 A the file cannot be locked until the partner tags on steps 1, 9 and 10 are signed. A green "Reviewed" in the list hides that. Options:
    - A (Recommended): the list tag stays "Reviewed". The step 10 lock message names the steps still waiting: "Partner sign-off still needed on steps 1 and 9."
    - B: the list shows a blue "Partner next" tag until the partner signs.
    - Benchmark: CaseWare role dependencies; UI1 Q9.
CHECKED:
- Header, top bar, tabs and progress strip against the built app at 1280: match (apart from items 8 and 14).
- Status colours: blue Prepared and In progress, green Reviewed and Partner, grey not signed and Open, amber same-person line, red notes count: match the Q9 rule.
- Contrast: amber 8A4B00 on FFF1D6 is 6.09; green 046A38 on E3F1E8 is 5.77; blue 005587 on E0F2FE is 6.91; grey 3F4246 on EEEFF0 is 8.77; muted 63666A on F6F7F8 is 5.38; refusal text is 14.15: all pass AA. Select border D0D0CE is 1.54: fails 1.4.11 (item 3).
- Keyboard and screen reader, Team panel: fails (items 1, 2, 15).
- Keyboard and screen reader, tags: Prepared, Reviewed and Partner tags are buttons with full names read aloud, which passes. "Partner not signed" is not a button, which fails (item 4).
- "Sign as partner": a real button, words match "Sign as preparer" and "Sign as reviewer": pass.
- Plain words and no em dashes: no em dashes in the 5 HTML files or gen.py; wording fixes in items 10 and 12.
- Mocks agree with themselves: fail (items 5, 6, 7).
- Partner tag distinct from Reviewed: by its word only; fix in item 9.
- Refusal options clear: A clear; B needs the leads named and a label (items 10 and 11).
- Width: no sideways scroll at 1280 (shoot.cjs reports scrollWidth); the step 9 row with the parity icons is not drawn yet (item 8).
- Brief R3a-2 items 1 to 5 and Q1 to Q7 against the mocks: covered apart from Q4 in the step list (item 16) and New file picking the team (no mock; the brief says New file picks the team, so a mock is worth asking for).

---

## 3. security-risk

## Security review of Piece R3a-2 (file team and sign-offs) before the build

**Result: FAIL.** The plan has one High gap, and the fix is a change to the brief, not to code. If the build plan is followed as written, the team check under Q1 A goes into the sign-off functions and the read rules only. Every other way to read or change a file would still let in anyone with Closebook rights, whether they are on the team or not. The rest of the plan holds up once the items below go into the brief.

I changed nothing. I read docs/BRIEF.md lines 1003 to 1070, the R3a-1 migration and the live local database (read-only catalogue queries). The one query that touched data was the brief's own Live check SQL, run inside `begin transaction read only` and rolled back.

### Answers to your six questions

**1. Where the team check must live.**
- It must be in the database. Every Closebook table can only be read through its RLS policy; there are no write policies. All writes go through `security definer` functions, and the publishable key and the user's sign-in token are in the browser, so anyone signed in can call those functions directly. A check that exists only on screen or in a server action does nothing.
- Read policies that need the team check: every table with a `file_id` (about 50, for example cb_entries, cb_bank_lines, cb_step_signoffs, cb_review_notes, cb_file_history). Also the tables that reach the file through a parent row: cb_entry_lines (through the entry), cb_review_note_replies (through the note) and cb_reclass_items (through the batch).
- Tables the brief must decide on: the client-level tables (cb_client_mappings, cb_vendor_rules, cb_bank_rules, cb_client_chart_picks, cb_client_fs_fields, cb_client_tax_settings, cb_review_treatments). Firm reference tables (GIFI, master lines, rates) need no team check.
- cb_files cannot get the team check if All files must still list the file for non-members. That is why the opening PDF route becomes a bypass (finding 1c).
- Server paths that use the service role key:
  - They download from or upload to storage after reading a path with the user's own access: `src/app/(app)/closebook/[id]/opening-pdf/route.ts:9-11`, `statement-pdf/route.ts`, `package/route.ts` (through `deliveredFile`), `close/route.ts`, `feed-actions.ts:152-154`, `banking-actions.ts:141-146`, `step3-actions.ts:188-192`, `statements/actions.ts:44-46` and `:82-87`.
  - `src/lib/export/full.ts` is the Admin export and reads everything, which is expected.
  - `src/lib/closebook/client-questions-server.ts` is the client link that works by token, which is fine.

**2. Who can change the team.**
- `cb_set_team` must check Admin plus Closebook Edit inside the database function.
- It must refuse to remove a lead unless the same call names a new lead. The new lead preparer needs Prepare and the new lead reviewer needs Review.
- It must refuse to leave the team with no one who can sign the Partner circle while Q4 A is in force (finding 6).
- Adding yourself is allowed by the design, but History should say "added themselves".
- The non-Admin route is `cb_create_file`. Today any Closebook Edit user can create a file and choose its people (finding 2).
- Members can only be added or removed through `cb_set_team`. Grant no write access on cb_file_team.
- History must record, with who did it and when:
  - each person added or removed, by name;
  - the leads before and after;
  - that removed sign-offs stay (Q6 A);
  - one row per file for the backfill.

**3. The same-person rule and the Partner exception.**
- The rule must live in `cb_sign_step` and `cb_sign_substep`, and be checked after the file row is locked (`for update`, as both already do).
- Running two requests at once is safe if `cb_set_team` takes the same lock.
- Taking back a sign-off and signing again does not get round the rule. Review always comes after prepare, and taking back the preparer sign-off needs the review cleared first.
- Gaps:
  - `cb_sign_opening` can be called directly with no Prepare check (finding 3).
  - The Partner circle is not cleared when the reviewer takes back their sign-off (finding 4).
  - Step 3 is built from its sub-steps and its summary row can show a false "same person" (finding 7).

**4. Removing someone from the team (Q6).**
- Every action is checked in the database on each request, so access ends at the next request. Nothing is held in the sign-in token, and the app does not use Supabase Realtime.
- What remains with the person: any page already open (until refreshed), files already downloaded, and any signed link to a line attachment (up to 10 minutes, finding 9).
- Their review notes stay. Under Q7 A they can no longer reply, and another reviewer on the team clears them.

**5. The Live check SQL.** It is read-only: one select with subqueries. It shows the file id, staff initials, a locked yes/no and counts only. It shows no client name, number or amount. It ran cleanly here. Two Low notes are in finding 8.

**6. The backfill.** It gives no one extra rights: it adds only each file's current lead preparer and reviewer. Risks:
- People who worked on a file but are not its preparer or reviewer lose access as soon as it runs.
- On a locked file the backfill may hit the lock guard.
- A file whose preparer and reviewer are the same person ends up with a team of one.

Details in finding 5.

---

AGENT: security-risk
PIECE: Piece R3a-2 file team and sign-offs, version 1 (brief only, commit 5efbd8a on claude/r3a2), pre-build plan review
RESULT: FAIL
FOUND:
1. High. Where: docs/BRIEF.md line 1049-1052 (build plan). What: under Q1 A the team check is planned only for cb_sign_step, cb_sign_substep, cb_sign_opening, cb_unsign_step, cb_unsign_substep, cb_lock_file, review notes and the Closebook read rules. Everything else is left out:
   (a) Write functions. 184 public cb_ functions run as `security definer` and any signed-in user can call them. Only 25 go through private.cb_file_open; the rest check only can_edit('closebook'). There are also 17 statement_* functions (statement_create_job, statement_begin_upload, statement_save_edits and others) that take a file.
   (b) Read functions that return client figures and skip RLS: cb_step_status, cb_close_status, cb_t2_status, cb_sh_status, cb_fs_status, cb_revenue_status, cb_match_state, cb_duplicate_lines, cb_file_duplicates, cb_entry_last_change, and cb_sh_due_list (across files, with client legal names and amounts).
   (c) The opening PDF. cb_files must stay readable for All files, but opening-pdf/route.ts:9-11 takes cb_files.opening_pdf and downloads it with the service role key. Anyone with Closebook View could open any file's prior T2 or CRA assessment.
   (d) Storage. The statement-uploads policy (storage.objects "Closebook reads statement uploads") lets any Closebook viewer list and download file/<fileId>/ paths.
   Why: a person not on the team could still edit, sign or read the file through the API, which defeats Q1 A. Fix: amend the brief.
   - Put private.cb_on_team(file) into private.cb_file_open and into every public cb_ and statement_ function that takes a file, a note, a line, an entry or a statement.
   - Add a database test that lists every security definer function taking a file and proves a non-member is refused.
   - Add the team check to the read functions, to the storage policy (split_part(name,'/',2)::uuid) and to the opening PDF route: move opening_pdf to a team-checked table, or check the team before the service-role download.
   - State that cb_files keeps the plain can_view policy only for the All files header, and which columns that list shows.
   Benchmark: CPA Ontario confidentiality (client data used only by those working on the file); OWASP ASVS V4.1.1 (access checked at a trusted service layer); Supabase guide "security definer functions bypass RLS".
2. Medium. Where: public.cb_create_file (R3a-1 migration; requires only can_edit('closebook')) and item 1 "Admin with Closebook Edit sets it, on New file". What: a non-Admin with Closebook Edit can create a file and choose its preparer, reviewer and, after R3a-2, its team, putting themselves on it. Why: it gets round the rule that only an Admin sets the team. Fix: either cb_create_file accepts a team only from an Admin with Closebook Edit, or a non-Admin's new file gets only the creator plus the leads, with the team logged. Say which in the brief. Benchmark: ASVS V4.2 (no privilege escalation through a second path).
3. Medium. Where: public.cb_sign_opening (called by closebook/actions.ts:360 and by cb_sign_step). What: it checks only can_edit('closebook'). It has no Prepare check, no "already signed" check, and on conflict it overwrites another person's prepared_by and clears the review. It can be called directly. Why: it gets round the Prepare switch and Remove others' sign-offs (Q7), and replaces a sign-off without the "Removed the preparer sign-off of" History line. Fix: in R3a-2, give it the same checks as the prepared branch of cb_sign_step (team, Prepare, prepared_at is null, books in statements or paper), or make it private and call it only from cb_sign_step. Benchmark: ASVS V4.1.3 (least privilege); item 2 of the brief.
4. Medium. Where: build plan, partner_by and partner_at on cb_step_signoffs; cb_unsign_step reviewed branch (UPDATE, not DELETE). What: when the reviewer takes back a sign-off on step 1, 9 or 10, the row is updated, not deleted, so the Partner circle stays signed on a step that is no longer reviewed. Under Q3 A the Partner circle rests on the review. Also there is no plan to take back the Partner circle itself (own or others' under Q7). Why: the lock gate (Q4 A) could pass on a Partner sign-off made before the step changed. Fix: clear partner_by and partner_at whenever reviewed_by is cleared, and log it. Add cb_unsign_step(p_role 'partner') with the team and Remove others' sign-offs checks. cb_clear_step already deletes the whole row, so it is fine. Benchmark: CaseWare role dependencies (brief Q3); CAS 220.
5. Low. Where: build plan "Backfill". What:
   (a) Staff who signed steps, signed the opening or wrote notes but are not the lead preparer or reviewer lose access on Live the moment the migration runs.
   (b) If the builder adds cb_locked_guard to cb_file_team, the backfill fails on locked files, or a later run sets cb.unlock wider than needed.
   (c) The backfill must be safe to run twice (on conflict do nothing, keyed on file and person) and must not re-add people removed after the first run.
   (d) The History rows the backfill writes are a data change on Live and the brief should say so.
   (e) A file whose preparer and reviewer are the same person (two here in dummy data) gets a team of one, which cannot sign Reviewed unless that person has Partner.
   Why: lost access and unclear Live changes. Fix: add to the Live check a count per file of other people who signed or wrote notes; state the backfill History row; insert before any lock guard is attached; use on conflict do nothing. No privilege is gained: only existing leads are added. Benchmark: firm rule "no data change on Live unless the piece says so".
6. Medium (NEEDS HASHIM option). Where: Q2 A together with Q4 A. What: nothing requires the team to include someone with the Partner switch, but Q4 A blocks locking until the Partner circles are signed. Why: a file could become impossible to lock. Fix (pick one): A (Recommended) cb_set_team refuses a team with no active Partner-switch holder, and the backfill adds none (Hashim adds one per file); B an Admin with Closebook Edit and Partner may sign without being on the team, logged; C Q4 B. Benchmark: brief Q4.
7. Low. Where: private.cb_records_follow and Live check line 1065. What: step 3's summary row takes the latest sub-step preparer and the latest sub-step reviewer. They can be the same person even though no sub-step was signed twice by one person, so the amber line and same_person_steps could show a false positive. A real case inside one sub-step would show only through that sub-step. Fix: apply the rule and the amber line per sub-step for statements and paper files, leave the summary row out of the rule, and count cb_substep_signoffs in the Live check. Benchmark: item 4 of the brief.
8. Low. Where: docs/BRIEF.md 1057-1070 (Live check). What: it is read-only and shows only file id, initials, a locked yes/no and counts, so it passes. Notes: add `begin transaction read only; ... rollback;` around it as a guard. same_person_steps counts the step 3 summary row (finding 7). It does not show partner columns, which is right because none exist yet. Fix: the two small edits. Benchmark: firm rule "Agents never touch Live"; Hashim runs it.
9. Low. Where: feed-actions.ts:154 (createSignedUrl, 600 seconds). What: a person removed from the team keeps a signed link already issued, up to 10 minutes. Pages already rendered and files already downloaded also stay with them. Why: some access continues after removal. Fix: accept and state it in the SOP, or shorten the link to 60 seconds. Benchmark: ASVS V3.3 (access ends on removal).
10. Low. Where: build plan "cb_set_people becomes cb_set_team"; round16-actions.ts:67 calls cb_set_people. What: dropping cb_set_people breaks the firm's "nothing dropped" migration rule, and leaving it unchanged leaves a second way to change the leads with no team check. Fix: keep cb_set_people as a thin wrapper that calls cb_set_team's checks, or revoke execute from authenticated, and move the app call in the same PR. Benchmark: firm migration rule 5.
11. Low. Where: build plan, private.cb_on_team. What: the helper must be security definer with search_path set to empty, must take only the file (using auth.uid() inside), must check staff.is_active, and must live in private (not exposed through the API, per config.toml schemas). In RLS, write the check as `file_id in (select file_id from cb_file_team where staff_id = (select auth.uid()))` so it does not run once per row. cb_is_reviewer, cb_sh_due_list and the work queue use preparer_id or reviewer_id and must be moved to the team. Why: probing other people's membership, inactive members, speed. Fix: state these in the brief. Benchmark: Supabase RLS performance guidance.
12. Low. Where: items 2 and 4 with Q5 A. What: someone with the Partner switch can sign Prepared, Reviewed and Partner on steps 1, 9 and 10 alone, and an Admin can give a role the Partner switch. This is the design, but History must name it each time and changes to role switches must already be in History (from R3a-1). Fix: confirm in tests that the amber line and History row are written on every one-person step, including steps where the person signed all three circles. Benchmark: CPA Ontario quality management (engagement review independence), firm rule 6.
CHECKED:
- Brief section read (docs/BRIEF.md 1003-1070), commit 5efbd8a changes only docs/BRIEF.md: done
- RLS on Closebook tables (pg_policies, local): all SELECT-only, can_view('closebook'); History uses cb_can('review'): team check needed in about 55 policies, finding 1
- Security definer functions: 184 public cb_ functions callable by authenticated, 0 by anon; 25 use cb_file_open; 17 statement_* functions: finding 1
- Service role key use in Closebook paths (grep createAdminClient): 13 files; opening-pdf route is a bypass under Q1 A: finding 1c; others read through RLS first
- Storage policies: statement-uploads read open to all Closebook viewers: finding 1d
- Sign-off writers (cb_sign_step, cb_sign_substep, cb_sign_opening, cb_unsign_step, cb_unsign_substep, cb_records_follow): findings 3, 4, 7
- Two requests at once: sign and unsign functions lock the cb_files row (for update); cb_set_team must take the same lock: covered in Q3 and Q4 answers
- Team change escalation (cb_set_people, cb_create_file, cb_file_people trigger): findings 2, 6, 10
- Removal effects (no Realtime publication, no team in the sign-in token, signed link 600 s): finding 9
- Review notes (cb_add_note, cb_clear_note, cb_reply_note) take a note id, so the team check comes through the note's file: covered in finding 1a
- Live check SQL run locally in a read-only transaction: read-only, no client data, PASS with notes, finding 8
- Backfill plan: no privilege gained; access loss and Live data change not stated: finding 5
- scripts/checks/name-check.sh: no business number or client name found (CLIENT_NAMES not set locally, so client names were not checked)
- Secrets in the R3a-2 commit: none found
- Migration rules (nothing dropped, safe to run twice): plan-level notes, findings 5 and 10; no migration exists yet

---

## 4. spec-checker

## Spec check: Piece R3a-2 (file team and sign-offs, version 1), pre-build

**Result: NEEDS HASHIM.** The brief's own figures and the Live check SQL are right. But the build plan misses about 20 database functions and several screens that read the file's preparer and reviewer. It approves no test changes, though at least 5 tests change. Two flows need Hashim to decide:
- A locked file can get stuck locked for good.
- Under Q4 A the partner signs after the client already has the documents.

Two mock figures are wrong.

I changed nothing. I ran the Live check SQL on the local dummy database inside a read-only transaction. Function bodies come from the local database, which has the R3a-1 migration (20261212380000) applied. Branch claude/r3a2, head 5efbd8a, docs only.

## 1. Where the file's people and switches are read or enforced (latest definitions)

**Database, sign and lock functions (in the build plan):**
- `cb_sign_step`, `cb_sign_substep`: the Prepare and Review switches only. No team check, no partner role.
- `cb_unsign_step`, `cb_unsign_substep`: own sign-off, or the Remove others' sign-offs switch.
- `cb_lock_file`, `cb_reopen_file`: the Lock and unlock switch only.
- `cb_add_note`, `cb_clear_note`: Closebook Edit and the Review switch.
- `cb_set_people`: Admin and Closebook Edit. It refuses locked files.
- `cb_create_file`: 8 arguments (preparer, reviewer). The `cb_file_people` trigger checks that the preparer has Prepare and Closebook Edit, and the reviewer has Review.

**Database functions not in the build plan, which must change for the team model:**
- `cb_sign_opening`: checks only Closebook Edit, **no Prepare check**. This is an existing R3a-1 gap. It is the path behind step 2's "Sign with the schedule below" (`signOpeningInline`, actions.ts:360) and step 2 on bank files.
- `cb_reply_note`: the preparer's reply to a review note. Not named under Q7.
- `private.cb_is_reviewer`: "the file's reviewer OR the Review switch". It is used by `cb_assign`, `cb_keep_line_move`, `cb_review_account`, `cb_review_lines`, `cb_unreview_lines` and `cb_set_gifi_override`. A person with Review who is not on the team counts as reviewer.
- Lead reviewer only (`reviewer_id`): `cb_confirm_type`, `cb_review_entry` ("Only the file's reviewer approves entries"), `cb_set_tax_code`, and the reviewer test in `cb_map_account`. Other team members with Review cannot do these. A decision is needed: lead reviewer only, or any team member with Review.
- `reviewer_id` or the Review switch: `cb_code_lines`, `cb_post_lines`, `cb_excluded_reviewed`, `cb_save_schedule_entry`, `private.cb_substep_guard`.
- Review switch only: `cb_accept_gst_check`, `cb_accept_revenue_difference`, `cb_accept_sh_flag`, `cb_accept_t2_difference`, `cb_confirm_sh_repaid`, `cb_confirm_side`, `cb_note_sh_due`, `cb_review_new_account`, `cb_review_year_change`, `cb_set_book_amortization`, `cb_set_review_treatment`.
- `private.cb_changed`: uses the Review switch to decide that "a reviewer's decision keeps the sign-off". It must become "on the team and has Review".
- `cb_sh_due_list`: a list across all files, filtered by `preparer_id` or the Review switch.
- `cb_question_link_error`: emails `preparer_id` and `reviewer_id`. Keeping it on the two leads is fine, but say so.
- History read policy on `cb_file_history`: `private.cb_can('review')`. It must become the team rule.

**App:**
- `src/app/(app)/closebook/[id]/page.tsx`
  - 147 to 155: `isReviewer` and `preparerRole` come from `reviewer_id` and `preparer_id`.
  - 217 and 878: History is shown only with the Review switch.
  - 472: `feedLock` uses `reviewer_id`.
  - 853: people props.
  - 134 to 141: rebuilds the step 3 roll-up.
- `src/app/(app)/closebook/[id]/shell/shell.tsx:57`: the People form, which calls `setPeople`.
- `shell.tsx` 180 to 260: the sign boxes (no partner circle) and the plain grey line "Prepared and reviewed by the same person."
- `src/app/(app)/closebook/round16-actions.ts:62`: `setPeople`, which calls `cb_set_people`.
- `src/app/(app)/closebook/actions.ts:44`: New file sends `p_preparer` and `p_reviewer`. Page: `src/app/(app)/closebook/new/page.tsx`.
- `src/lib/closebook/server.ts:34-35`: `loadFileList`. "Mine" means preparer or reviewer.
- `src/app/(app)/closebook/page.tsx:21`: My files, Preparer and Reviewer filter.
- `src/app/(app)/closebook/file-list.tsx:21,33`: the work queue.
- `src/app/(app)/clients/[id]/closebook.ts:17,29`: the client page list.
- `src/lib/closebook/vehicle-save.ts:32`: reads `reviewer_id`.
- `src/lib/closebook/banking-server.ts:57`: reads `cb_file_history` for the sign-off pill. Today this fails silently for a preparer without Review; the team rule fixes it.
- `src/app/(app)/admin/roles/rights.ts:5`: the `later` tag. Also `src/app/(app)/admin/roles/[id]/page.tsx:104`.

**Exports that print preparer and reviewer.** All of these print "Prepared by" as the **lead preparer** (`file.preparer_id`), not the person who signed:
- `src/app/(app)/closebook/[id]/report-export/route.ts:46,56`. The Shareholder loans "Reviewed by" is the step 7 reviewer.
- `src/app/(app)/closebook/[id]/gst-workpaper/route.ts:54`
- `src/app/(app)/closebook/[id]/tax-workpaper/route.ts:45`
- `src/lib/closebook/wp-build.ts:40`

With a team, the lead is often not the signer, and the brief says nothing about this.

## 2. Sign-off paths: team check and same-person rule

- **`cb_sign_step`**
  - Team check: needed.
  - Same-person rule, reviewed role: refuse when `r.prepared_by` is the caller, unless the caller has Partner sign-off.
  - Partner role: new, steps 1, 9 and 10. Under Q3 A it needs `reviewed_at` set.
  - Step 7 has no preparer circle, so there is no conflict there.
  - The History text is `'Prepared and reviewed by the same person'`. The same-person mock changes it to "... (Partner sign-off)".
- **`cb_sign_opening`**
  - Needs the team check and the Prepare check, which is missing today.
  - On a repeat signing it already clears the reviewer, so there is no same-person conflict.
  - The step 2 reviewer still goes through `cb_sign_step`, where the rule applies.
- **`cb_sign_substep` (3.1 to 3.3)**
  - Needs the team check and the same-person rule on each sub-step.
- **Step 3 roll-up: conflict.** `private.cb_records_follow` and page.tsx 134 to 141 set step 3 "Prepared by" to the latest sub-step preparer and "Reviewed by" to the latest sub-step reviewer.
  - Example: A prepares 3.1 and 3.2, B prepares 3.3 last. A reviews 3.3, then B reviews 3.1 last. The roll-up then reads prepared B, reviewed B, although no sub-step broke the rule.
  - If the rule is a table trigger or constraint on `cb_step_signoffs`, the roll-up write is refused.
  - If it is only a display rule, step 3 shows a false amber line, and the Live SQL `same_person_steps` counts the step.
  - Fix: enforce the rule in the sign functions, not as a table rule. Take step 3's line from its sub-steps.
- **`cb_unsign_step`**
  - Needs a partner role.
  - Taking back the reviewer sign-off leaves `partner_by` in place. Under Q3 A it must clear the partner sign-off or refuse. The brief says nothing.
  - Note: `cb_clear_step` deletes the whole row, so the partner sign-off clears when a step reopens. That is good.
- **`cb_unsign_substep` and `cb_substep_guard`**: team check, and replace the `reviewer_id` test.
- **`cb_lock_file` and `cb_reopen_file`**: team check under Q7 A. Under Q4 A, `cb_lock_problems` needs the partner checks.
- **`admin_lock`**: this is `pg_advisory_xact_lock` for the last-Admin rule. It has nothing to do with the file lock and needs no change. Naming it with step 10 in the brief is a mix-up.
- **Review notes**: `cb_add_note` and `cb_clear_note` need the team check. `cb_reply_note` is not named.
- **Other writers of "who reviewed"**: `cb_review_entry`, `cb_excluded_reviewed`, `cb_review_new_account`, `cb_review_year_change`, `cb_confirm_type`, `cb_review_lines`, and others. These are reviewer actions on single items, not circles. They need the team check. The same-person rule does not apply to them.
- **R3a-1 decision 7A** is replaced, as item 4 says.

## 3. Q1 option A (only the team opens the file) against option B

**Tables.** 83 Closebook tables have read policies. All are "Closebook viewers read" (`can_view('closebook')`), except:
- `cb_file_history`: Review switch.
- `cb_master_line_log`: Admin.
- `cb_saved_questions`: own rows.
- `cb_statement_imports`: has a file or own rows.

There are no write policies; every write goes through a database function.

**What A touches:**
- **51 tables with `file_id`.** Each needs `private.cb_on_team(file_id)` in its read rule: `cb_acceptance`, `cb_accounts`, `cb_assign_actions`, all `cb_bank_*` tables, `cb_documents`, `cb_entries`, `cb_file_close`, `cb_gst_returns`, all `cb_sh_*` tables, `cb_step_signoffs`, `cb_substep_signoffs`, and the rest.
- **3 child tables without `file_id`:** `cb_entry_lines`, `cb_reclass_items`, `cb_review_note_replies`.
- **`cb_files` must stay readable** so All files can list it. Its `setup`, `opening_pdf` and opening figures then stay open to everyone through the Data API.
- **14 read functions that bypass RLS** (stable, security definer) and check only `can_view`: `cb_step_status`, `cb_substep_status`, `cb_close_status`, `cb_t2_status`, `cb_fs_status`, `cb_sh_status`, `cb_sh_due_list`, `cb_revenue_status`, `cb_match_state`, `cb_duplicate_lines`, `cb_file_duplicates`, `cb_entry_last_change`, `cb_excluded_key_of`, `cb_quick_rate`.
- **Service-role reads:**
  - `src/app/(app)/closebook/[id]/opening-pdf/route.ts`: reads `cb_files.opening_pdf`, which stays readable, then downloads it with the admin client. Under A this still gives the PDF to people outside the team. It needs an explicit team check.
  - `statement-pdf/route.ts`: becomes a 404 through RLS.
  - `src/lib/closebook/close-server.ts:111`, `deliveredZip`.
  - Storage policy "Closebook reads statement uploads" checks only the `file/` prefix, with no file id, so it is not team-scoped.
- **File lists.** `loadFileList` (All files, My files) and `clients/[id]/closebook.ts` pull `cb_documents`, `cb_bank_statements`, `cb_imports`, `cb_accounts`, `cb_entries`, `cb_step_signoffs` and `cb_review_notes` inside the file query. Under A, files outside the team would show empty progress and a wrong "Next:" line. A summary function that bypasses RLS, or blank columns for those files, is needed.
- **Export routes** (report-export, package, gst-workpaper, tax-workpaper, client-entries, gifi, close) would return empty documents instead of a refusal. Each needs a not-on-team check.

**Both A and B: "only the team works in it".** Neither option is in the build plan. There are 174 volatile `public.cb_*` functions, 97 of them taking `p_file`, and they check only Closebook Edit. The cheapest single point is `private.cb_locked_guard`, which already runs on 40 tables. It would need exemptions for:
- `cb.unlock`
- calls with no signed-in user (client question links run with the service key)
- the Admin team changes

**Size:**
- B: one migration of about 600 to 900 lines, about 35 function rewrites. App: Team panel, New file, partner circle, not-on-team line, History gating.
- A: about 2 to 3 times B in the database (54 policies, 14 read functions, the storage policy, the `cb_files` exposure), plus about 8 app routes, the list summary, and the not-on-team page.

## 4. Tests

**Existing tests that break.** The piece approves none of these changes.
- `supabase/tests/roles_rights_piece_r3a1_test.sql`
  - 117, "an Accountant cannot read file History": C is the preparer, so on the team.
  - 121 and 123: B is not on the team. The refusal text changes if the team check runs first.
  - 125: A, a Partner and Admin not on the team, removes C's sign-off. Under Q7 A this is refused.
- `supabase/tests/closebook_review_test.sql`
  - 188, "the preparer cannot read the file history": C is on the team.
  - 158: exact match on `'Prepared and reviewed by the same person'`. It breaks if the text gains "(Partner sign-off)", as in the mock.
- `supabase/tests/closebook_readiness_test.sql` 71 to 77: calls `cb_set_people`. It breaks if the function is dropped or renamed.
- `scripts/checks/drift-check.sql`
  - 1469 expects `cb_set_people`.
  - The new table, columns and functions are not listed.
- `scripts/checks/closebook-function-parity.mjs`
  - The `setPeople` action goes away.
  - The dummy staff user is not on the 3 files where DO is both preparer and reviewer, so the before-and-after comparison will differ by design.
- Any change to the 8-argument `cb_create_file` signature breaks about 40 calls across most Closebook tests. Keep it working with defaults, or overload it.

**What survives.** Every test file creates its files through `cb_create_file`, usually with C as preparer and A as reviewer. Every same-person signing in the tests is by A, the Partner, who is exempt. So most signing tests survive, provided `cb_create_file` puts both leads on the team.

**New tests needed:**
- refusals for people not on the team: every sign and unsign function, `cb_sign_opening`, lock and reopen, add, reply and clear note
- the same-person rule on steps and on 3.1 to 3.3, with and without Partner sign-off
- the partner circle: order (Q3), the lock gate (Q4), taking it back, cleared when the step reopens
- History readable by the team only
- `cb_set_team`: Admin only, a lead cannot be removed, add and remove recorded in History, locked file
- the backfill
- under A: each read policy and each read function above

## 5. Conflicts and gaps in the brief

**a. Step 10 partner circle against the lock flow (Q3 and Q4).** The step 10 reviewer sign-off is what finalises the email ("until then the email is a draft", close-actions.ts:71). After it, the delivery is recorded and the EFILE number entered. Under Q3 A and Q4 A the partner circles on steps 9 and 10 open after the reviewer and gate only the lock. So the client gets the package, and the MAL is sent and signed, before any partner sign-off. Step 1 has the same issue: the partner's acceptance gates nothing until the lock. NEEDS HASHIM.

**b. A locked file can get stuck.** Under Q7 A reopening needs team membership, and `cb_set_people` refuses locked files. If nobody on a locked file's team has Lock and unlock, nobody can reopen it.

**c. Q1 A wording.** "Admins with Closebook Edit ... open the file and work in it" conflicts with item 2 ("People not on the team cannot sign") and with Q7 A.

**d. Leads.**
- The people-panel mock shows Remove on the lead preparer and the lead reviewer. Q2 A says a lead stays on the team while they are a lead.
- A lead can lose the switch later: `cb_file_people` checks only when the lead is set, not when a role changes.
- Team members who lose Closebook Edit or are switched off are not covered.
- Whether the lead preparer and lead reviewer may be the same person is not said. Three dummy files and several tests have one person in both. Without Partner sign-off, a team of one cannot finish a file under item 4.

**e. New file.** The `cb_create_file` signature and the auto-add of both leads are not specified.

**f. R3a-1 text to update:**
- the BRIEF "Roles and permissions" switch text (lines 198 to 200)
- decision 4A (History), 6B (Remove others' sign-offs now covers the partner circle), 7A, 8A
- line 581, "Next: R3a-2 ... Preparer, Reviewer, Partner per file; only the named people sign". This differs from the piece, which has no per-file partner: any team member with the switch signs.
- rights.ts hints: Review "add review notes" and Remove others' sign-offs may need "on the file's team". The current wording is Hashim-approved, so it needs his approval.

**g. Lead-reviewer-only functions** (`cb_review_entry`, `cb_set_tax_code`, `cb_confirm_type`): not decided whether they stay lead-only or open to any team member with Review.

**h. Exports print the lead** as "Prepared by", not the signer (item 1).

**i. Build plan wording.** "append rows to cb_log": there is no `cb_log` table. History is `cb_file_history`, written through `private.cb_log()`.

**j. "Five sign-off gaps from Round A".** The RULES block says they wait for their own round. R3a-2 rewrites the sign-off functions, and the gaps are not written down anywhere in docs/, so I cannot check for overlap. The brief should say whether R3a-2 is that round.

## 6. One migration

Yes, one migration is enough. R3a-1 was a single 2,643-line migration.
- Number it after 20261212380000.
- Do not drop `preparer_id` or `reviewer_id`; they become the leads.
- Keep `cb_set_people` as a wrapper over `cb_set_team`, so drift-check and the readiness test keep working.
- Put the backfill in the same migration, so there is no window where a file has no team.

Under A, the migration is still one file but about 2 to 3 times larger.

## REPORT

AGENT: spec-checker
PIECE: Piece R3a-2, file team and sign-offs, version 1 (docs/BRIEF.md lines 1003 to 1070; mocks people-panel, step9-partner, not-on-team, not-on-team-closed, same-person), branch claude/r3a2 at 5efbd8a
RESULT: NEEDS HASHIM
FOUND:
1. docs/BRIEF.md 1037-1039 (Q3, Q4) against src/app/(app)/closebook/close-actions.ts:71 and private.cb_lock_problems. The step 9 and 10 partner circles open after the reviewer and gate only the lock. The package is delivered and the MAL signed after the step 10 reviewer signs, so the partner signs after the client already has the documents. Step 1's partner acceptance gates no work. Why it matters: the partner sign-off cannot stop a release. Fix, options for Hashim: (A, Recommended) the step 9 partner circle gates sending the MAL and the step 10 partner circle gates recording the delivery, with step 1 gating step 2; (B) as written, lock only. Benchmark: CaseWare Cloud sign-off roles and dependencies, cited in the brief.
2. BRIEF 1044-1045 (Q7 A) with public.cb_reopen_file and public.cb_set_people (refuses locked files). If no team member has Lock and unlock, a locked file can never be reopened. Fix: let an Admin with Closebook Edit change the team on a locked file (logged in History), or let reopening need only the switch. Source: function bodies in the local database.
3. BRIEF 1047-1052, build plan. It names only the sign, lock and note functions. Not named:
   - `cb_sign_opening`, which has no Prepare check today, a gap left from R3a-1, and is the step 2 "Sign with the schedule below" path
   - `cb_reply_note`
   - `private.cb_is_reviewer` and its 6 callers
   - the lead-reviewer-only functions `cb_review_entry`, `cb_set_tax_code`, `cb_confirm_type`, `cb_map_account`
   - `reviewer_id` or switch: `cb_code_lines`, `cb_post_lines`, `cb_excluded_reviewed`, `cb_save_schedule_entry`, `cb_substep_guard`
   - 11 reviewer functions checked by the Review switch only
   - `private.cb_changed`
   - `cb_sh_due_list`
   - "only the team works in it" across 174 write functions
   Why it matters: people outside the team keep reviewer powers, and a person without Prepare signs step 2. Fix: list them all. Use one team guard in `private.cb_locked_guard`, which runs on 40 tables, plus the functions on tables it does not cover. Source: pg_get_functiondef on the local database.
4. BRIEF 1014 (item 4) against private.cb_records_follow and page.tsx 134-141. The step 3 roll-up takes the latest sub-step preparer and the latest sub-step reviewer. It can show, or a table rule can refuse, "same person" when no sub-step broke the rule. The Live SQL `same_person_steps` counts such steps too. Fix: enforce the rule in the sign functions only, and take step 3's line from its sub-steps. Source: code.
5. BRIEF 1037 (Q3 A) and public.cb_unsign_step. Taking back the reviewer sign-off leaves `partner_by` set. Fix: clear the partner sign-off or refuse until it is taken back. Say who may take a partner sign-off back. Source: code.
6. BRIEF 1031-1034 (Q1 A). The text says Admins "work in it", against item 2 and Q7. Under A it also misses:
   - `cb_files` stays fully readable, including the opening PDF path. `opening-pdf/route.ts` hands the PDF over with the service key.
   - 14 read functions that bypass RLS.
   - the statement-uploads storage policy has no file id.
   - `loadFileList` and `clients/[id]/closebook.ts` pull child tables into the file query, so lists would show empty progress.
   - export routes return empty documents.
   Fix: if A, add these to the plan; size about 2 to 3 times B. Source: pg_policies and the files named.
7. BRIEF 1035-1036 (Q2) and the people-panel mock. The mock shows Remove on both leads. Not covered: a lead who loses the switch later; team members who lose Closebook Edit or are switched off; whether the lead preparer may also be the lead reviewer. Three dummy files and several tests do this, and without Partner sign-off such a file cannot be finished. Fix: hide Remove for leads and decide the three cases. Source: mock and the `cb_file_people` trigger.
8. Existing tests changed without approval in the piece (RULES block: "an existing test changes only where the piece approves it"):
   - roles_rights_piece_r3a1_test.sql 117, 121, 123, 125
   - closebook_review_test.sql 158, 188
   - closebook_readiness_test.sql 71-77, if `cb_set_people` goes
   - scripts/checks/drift-check.sql 1469
   - the closebook-function-parity expected differences
   - about 40 `cb_create_file` calls if its signature changes
   Fix: list each one in the piece with its new expectation. Keep `cb_set_people` as a wrapper and give the `cb_create_file` team list a default. Source: supabase/tests, scripts/checks.
9. Mocks, all five. "COMPLETION 0 of 2 reviewed" while step 9 shows Reviewed; it should read 1 of 2. Why it matters: a wrong figure in the piece. Fix: correct it. Source: the counts in the mock.
10. Mocks, all five. "FIELDWORK 4 of 4 reviewed · 2 notes" with Notes (2): step 7 cannot be reviewed while any note is open (`private.cb_review_problems`: "n review notes still open"). Fix: 3 of 4 reviewed, or 0 notes. Source: code.
11. Mock not-on-team (B). The caption says "the History button is hidden", but the header shows History. The step list shows step 9 Reviewed while the step header says "Not reviewed". Fix the mock. Source: screenshot.
12. Mocks step9-partner and not-on-team-closed. The signed-in avatar is HA (an Admin, not on the DS MM PP team), yet step9 shows "Sign as partner", and under A an Admin still opens the file. The caption on step9 says only team members see the button. Fix: state who is viewing, or use a team member's avatar. Source: screenshots.
13. Mock same-person. The History text becomes "Prepared and reviewed by the same person (Partner sign-off)", against the current `'Prepared and reviewed by the same person'` (closebook_review_test.sql:158 matches it exactly). Today's line is plain grey text in shell.tsx; item 4 says amber. The step 3 roll-up case is not shown. Fix: approve the new text and the test change. Source: shell.tsx and the test.
14. Exports (report-export, gst-workpaper, tax-workpaper, wp-build) print "Prepared by" as the lead preparer, not the person who signed. With a team they will often differ. Fix: Hashim to decide; either print the signer from the step sign-off or say out of scope. Source: code.
15. BRIEF text to update with the piece:
   - lines 198-200 (switch text)
   - line 581 ("Partner per file; only the named people sign"), which differs from the piece
   - R3a-1 decisions 4A, 6B, 7A, 8A
   - rights.ts hints, which are Hashim-approved wording
   Fix: rewrite them as part of the piece. Source: BRIEF and rights.ts.
16. RULES block (BRIEF 555). "Steps 1 to 4 untouched", "no data change to any Live file" and "the five sign-off gaps from Round A wait for their own round". This piece changes sign-off on steps 1 to 4 and backfills team rows on Live, and the five gaps are not written down in docs/. Fix: state the exceptions explicitly, and say whether R3a-2 is the sign-off-gaps round. Source: BRIEF 555.
17. BRIEF 1048: "append rows to cb_log". There is no such table. History is `cb_file_history`, written through `private.cb_log()`. Fix: correct the wording. Source: database.
CHECKED:
- The piece read in full (BRIEF 1003-1070), plus the R3a-1 sections (186-206, 556-581) and the RULES block (555): done.
- Every function the piece names exists. `admin_lock` is the Admin advisory lock, not a file lock: noted. `cb_set_team`, `cb_on_team` and `cb_file_team` do not exist yet, as expected.
- Latest definitions of every function that reads `preparer_id`, `reviewer_id`, the Closebook switches or `prepared_by` / `reviewed_by`, from the local database: 57 functions mapped, about 20 not in the plan.
- Read policies on the 83 Closebook tables and the storage policies: done. A needs 54 tables, 14 read functions and 1 storage policy.
- Service-key reads in Closebook: opening-pdf exposure found under A.
- App readers (page, shell, file lists, My files, work queue, client page, exports, rights.ts): done.
- Tests: scanned 95 database test files, the tests/ folder and scripts/checks. Breaks listed. A same-person scan found only the Partner (exempt) signing both.
- Mocks against the text, all 5 screenshots: 6 differences, items 7 and 9 to 13.
- Figures: T2 due Feb 28, 2027 for an Aug 31, 2026 year end (6 months): correct. History times and sign dates in order: correct. Completion count wrong (item 9). Fieldwork reviewed count with notes open is impossible (item 10). No amounts to recompute.
- Live check SQL run locally in a read-only transaction on dummy data: runs and gives initials only; same-person false-positive risk noted (item 4).
- One migration: enough. Keep `cb_set_people`, drop no columns, number it after 20261212380000.

---

## 5. ui-reviewer

R3a-2 mock review, round 2 (read-only). I changed nothing. All 11 round 1 items are fixed. The mocks have no overflow at 1280 or 1920, no em dashes, only dummy names and plain wording. I found 5 Medium items and 5 Low items. None of them needs a new mock or blocks the build, as long as the builder applies the five Medium fixes in the build. Each Medium item already has a matching part in the built app, or a line in the brief, that the builder can follow.

Round 1 items, PASS/FAIL each:
1. PASS. Both selects sit inside a label ("Lead preparer", "Lead reviewer"). The disabled option reads "Dana Staff (cannot review: no Review switch)".
2. PASS. Leads show "Lead preparer, stays on team" and "Lead reviewer, stays on team". Remove has aria-label "Remove Pat Partner from the team".
3. PASS. The select border is #8A8D91, about 3.4:1 on white, which meets the 3:1 rule for controls.
4. PASS. The grey "Partner not signed" tag is a button (aria-haspopup="dialog", seal icon). "Sign as partner" sits beside it, the same pattern as the built "Not prepared" tag with "Sign as preparer". The colour of the signed tag is a new problem, see Medium item 3.
5. PASS. Counts read Planning 1 of 1, Bookkeeping 3 of 3, Fieldwork 4 of 4 with no notes, Completion 1 of 2, and the strip matches. Step 9 shows amber "Partner next", which is Q14 A. There is a contrast problem on the open step's number, see Medium item 1.
6. PASS. Same-person page uses step 2. It has the "Cannot review: you prepared this step." box and the "Signed before the same-person rule (Nov 2026)." line.
7. PASS. not-on-team is labelled Option B. It has no History button and no Add review note, and it names both leads.
8. PASS. The title row has Issues, Add review note, Export, Help and Step menu. The Issues control differs from the built one, see Medium item 2.
9. PASS. The avatar is PP on the Pat Partner mocks and RS on the Riley Senior mocks.
10. PASS. The heading is "Team on this file" and the note states the keyboard behaviour (focus to first select, Tab stays inside, Esc or Cancel returns to the Team chip).
11. PASS. all-files has "Your access" with a lock on "Not on team". new-file has a team picker. Both have follow-ups, see Medium items 4 and 5.

New checks:
- Contrast: tags pass AA. Amber "Partner next" is 6.09:1, grey tag 8.77:1, navy tag 12.35:1, Reviewed 5.77:1, Prepared 6.91:1. The one failure is the open step's number, 2.20:1.
- Overflow: scrollWidth minus innerWidth is 0 on all 7 mocks at 1280 and at 1920.
- Step 9 title row: at 1280 the icon group wraps to a second line (top 216 against 178 for the tags). At 1920 it stays on one line. same-person and not-on-team fit at 1280.
- Wording is grade 7, there are no em dashes, and only dummy names appear (Birch, Cedar and Aspen Dummy; Dana Staff, Morgan Manager, Pat Partner, Riley Senior).

My working scripts are /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/r3a2rev/chk.cjs and /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/r3a2rev/built.cjs. The built-app screenshot is /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/r3a2rev/built-file.png.

AGENT: ui-reviewer
PIECE: R3a-2 mocks version 2 (brief commit f41f3cd, branch claude/r3a2), pre-build round 2 (last); mocks at /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/r3a2mock/*.html
RESULT: PASS
FOUND: (ranked by how often staff meet them)
1. [Medium] Where: step list, the open step's number. Seen on people-panel, step9-partner and not-on-team (the "9") and same-person (the "2"); generator gen.py line 28/33 gives a reviewed open step both "num done cur", and ui1.css `.num.cur` then sets the text navy. What is wrong: navy #012169 text on green #046A38 is 2.20:1, which fails WCAG AA. Why it matters: staff see it on every file page, and the builder may copy the mock. Fix: a reviewed step keeps white text on green when open. The built StepMark already does this (src/app/(app)/closebook/[id]/shell/shell.tsx:354, reviewed gives "bg-success text-white" whatever "on" is), so reuse StepMark. Benchmark: Studio rule 6 (WCAG AA) and the built UI1 shell.
2. [Medium] Where: the title row on step9-partner, not-on-team and same-person (button with aria-label "Issues, 0 open"). What is wrong: Issues shows as a white flag button with no count on steps that have nothing open. The built StepTitle shows Issues only when the count is above 0, as an amber chip with a triangle and the count (shell.tsx lines 281 to 299). Why it matters: it appears on every step and would add an empty control that the built app does not have. Fix: build from StepTitle. Show no Issues chip when there are 0 issues, and "Issues N" in amber otherwise. Benchmark: parity with the built UI1 step title row; Studio rule 3 (flags amber).
3. [Medium] Where: step9-partner, signed Partner tag "Partner PP, Nov 20, 2026" (class t-navy, #012169 on #E6EBF5); gen.py line 36/38. What is wrong: a signed state uses navy, which is not one of the fixed status colours (Signed green, Next blue, flags amber, notes red, Open grey). Why it matters: it adds a fourth sign-off colour on steps 1, 9 and 10, so staff must learn that navy also means signed. Fix: use the green signed tag with the seal icon. The seal and the word "Partner" already tell it apart from Reviewed. The grey unsigned tag and the "Sign as partner" button stay as they are. Benchmark: Studio rule 3; the built Tag uses blue for Prepared and green for Reviewed (shell.tsx line 168).
4. [Medium] Where: all-files table. What is wrong: the columns differ from the built list (src/app/(app)/closebook/file-list.tsx line 19: Client, Year-end, File by, My role, Step, Next job, Preparer / reviewer). The mock uses File, Year end, Leads (preparer / reviewer), Your access and Status. Leads show as initials ("DS / MM") where the built list shows full names. "On team" uses green, which the fixed colours keep for signed. "Your access" sits beside the built "My role" column, so there are two wordings for the same idea. Why it matters: All files is a daily screen, and the brief only adds an access column. Fix: keep the built columns and full names. Put access in the built "My role" column (for example Preparer, Reviewer, Team member, or a lock with "Not on team"), using the built navy-50 role chip or grey, not green. Benchmark: parity with the built file list; Studio rules 3 and 5; TaxDome lists.
5. [Medium] Where: new-file mock note. What is wrong: it says "A grey line under Team says when no one picked has Partner sign-off". Brief Q9 A says an amber line with the text "No one on the team has Partner sign-off. The file cannot be locked until someone with it joins." Why it matters: the builder gets two different instructions, and a warning must be amber. Fix: the note and the build use the Q9 A amber line and text, on New file and in the Team panel. Benchmark: BRIEF.md R3a-2 Q9 A; Studio rule 3.
6. [Low] Where: step9-partner title row at 1280. What is wrong: the Issues, Export, Help and Menu icons wrap to a second line (tops 216 against 178). At 1920 they stay on one line. Why it matters: it only happens on the three Partner steps, on a laptop screen. The built row uses flex-wrap and will wrap the same way. Fix: accept the wrap and keep the icons right-aligned on the second line, with the gate line below them. Do not shorten the tag dates, which would break the built convention. Benchmark: Studio rule 6 (works on a laptop screen).
7. [Low] Where: same-person step list. What is wrong: step 9 shows "Reviewed" there, but "Partner next" on the other three Birch Dummy mocks, and the note does not explain why. Why it matters: it confuses whoever reviews the mocks. It does not reach the app. Fix: show "Partner next", or say in the note that the partner has signed step 9 in this mock. Benchmark: Studio rule 3; consistency across mocks.
8. [Low] Where: file header on all file mocks. What is wrong: the built header has a "My files" link after History, and the mocks do not. Why it matters: it is a parity gap only. Fix: keep "My files" in the build. Benchmark: built shell.tsx line 103.
9. [Low] Where: not-on-team, the Team chip. What is wrong: it is a button with aria-haspopup="dialog" but has no caret. Its label does not say what opens, or whether someone off the team sees the read-only list. Why it matters: keyboard and screen-reader users cannot tell what the chip does. Fix: if it opens the read-only list, show the caret and end the label with "Open the team". If it opens nothing, make it plain text. Benchmark: Studio rule 6; the people-panel chip pattern.
10. [Low] Where: new-file, the locked lead checkboxes (checked and disabled). What is wrong: the browser's own disabled grey is very faint. WCAG exempts disabled controls, but the meaning rests on the small text under each name. Why it matters: it is a small readability issue on a screen used once per file. Fix: show a lock icon or a solid check with the small text, instead of the browser's faint disabled box. Benchmark: Studio rule 6; Dext and QBO form style.
CHECKED:
- Round 1 items 1 to 11: PASS (all 11), with follow-ups noted at 1, 2, 3, 4 and 5 above.
- Brief R3a-2 v2 compared with the mocks: Q9 wording conflict on new-file (item 5); Q1 A, Q1 B, Q2 A, Q11 A, Q13 A and Q14 A shown as written.
- Text contrast on all 7 mocks (Playwright, computed colours): one failure, the open step's number at 2.20:1. Every tag passes (amber 6.09, grey 8.77, navy 12.35, green 5.77, blue 6.91).
- Select and control borders: #8A8D91, about 3.4:1, PASS.
- Overflow (scrollWidth minus innerWidth) at 1280 and 1920: 0 on all 7 mocks, PASS.
- Step 9 title row wrap: wraps at 1280 (Low), one line at 1920.
- Clipped text: none outside the screen-reader-only spans, PASS.
- Em dashes and en dashes: 0 in all 7 files, PASS.
- Dummy names only: PASS.
- Grade 7 wording: PASS.
- Amounts with separators and two decimals ("29,000.00"): PASS.
- Viewer avatar matches the mock note (PP and RS): PASS.
- Accessibility attributes (dialog roles, aria-modal, labelled selects, Remove aria-labels, aria-current="step"): PASS, apart from the Team chip in item 9.
- Parity with the built app (localhost:3301, owner dummy login, file page screenshot plus shell.tsx and file-list.tsx): differences in items 1, 2, 4 and 8.
- Status colours against rule 3: navy signed tag (item 3) and green "On team" (item 4).
