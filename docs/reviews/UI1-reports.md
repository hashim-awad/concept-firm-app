# Piece UI1: reviewer reports (unedited)

Copied word for word by script from the session record. Order: when each report came in. Dummy data only.

---

## accounting-reviewer

## Accounting review: Piece UI1 (display only), branch claude/ui1

UI1 passes. It shows the figures correctly and does not change any posting or calculation. Nothing below blocks the PR. Two points are worth a follow-up piece: findings 1 and 2.

**Your question about the footer**

Checking Prelim, Adjust, Reclass, Final and Prior for nil is right for this trial balance (debits positive, credits negative, all postings double entry). No column can properly fail to net to nil, so the footer should not give a false "out of balance":

- **Adjust and Reclass:** the database refuses an entry that does not balance (`private.require(v_sum = 0, …)`, latest in `supabase/migrations/20261212370000_piece_r2_assign_mapping.sql:1070`). AJE and TJE make up Adjust, and RJE is Reclass, so each nets to nil by construction. A query across the whole local database found 0 entries that do not balance.
- **Prelim:**
  - On a trial balance file, the import refuses a trial balance that does not balance (`tb-import.ts`, and the `closebook_files` migration line 277).
  - On a bank-statement file, `tb-build.ts:222` puts any opening difference in a visible row, "Opening balances to enter", so the column still nets to nil.
- **Final** = Prelim + Adjust + Reclass, so it nets to nil when they do.
- **Prior:** `reports.ts:60-61` adds a balancing row, "Net income last year (from the T2)", equal to minus the column's sum. Prior is therefore always nil. That check can never fail (finding 1).

The footer can only fire on a real integrity break, which is the right result. Example: `report-data.ts:69` silently drops an entry line whose account is not in the file. The footer sums all rows before filters (`all = groups.flatMap`), so hidden columns and filters do not affect it.

**Figures on the screenshot, recomputed** (dummy file 2df089a3)

| Line | Check | Result |
|---|---|---|
| Chequing | 88,300.00 + 40.00 = 88,340.00; 88,340.00 − 50,000.00 = 38,340.00; 38,340 / 50,000 = 76.68% | 76.7% ✓ |
| Receivables | 3,000 / 9,000 | 33.3% ✓ |
| Computer equipment | no change | 0.0% ✓ |
| Accumulated amortization | (1,200) + (1,200) = (2,400); change on the size of the balance: (2,400 − 1,200) / 1,200 | 100.0% ✓ |
| Total capital assets | Prelim 6,000 − 1,200 = 4,800; Final 3,600; Prior 4,800; change (1,200); (3,600 − 4,800) / 4,800 = −25.0% | shown as (25.0%) ✓ |

Column sums for this file, from the local database:
- Imported this year 0.00 and last year 0.00.
- Entries: AJE 0.00 (7 entries), RJE 0.00 (1), TJE 0.00 (1).

The footer would read "0.00 · Debits equal credits", which is correct.

**Items 2 to 4**

- **Item 2, report-view % column:** `report-view.tsx:84` and `:109` only wrap the screen text in `pctShow`. `pctShow` (`src/lib/closebook/pct-show.ts`) changes only a string that starts with "-" and a digit; "n/a", "n/m" and "–" pass through unchanged. The PDF and Excel exports do not import it.
- **Item 3, header net income and step counts:**
  - The net income figure is the same calculation as before: `statements().pl.net.now` = revenue − expenses, `page.tsx:725`. Only the look changed.
  - The "n of m reviewed" count and the 4-part strip count `reviewed_at` over the 10 steps (1 + 3 + 4 + 2 = 10, `steps.ts:62-68`).
  - On a bank file, step 3 shows as reviewed only when 3.1, 3.2 and 3.3 are all reviewed (`page.tsx:135-142`), which is correct.
- **Item 4, quotes:**
  - `quoteTotal` and `plusTax` are used only on `quotes/page.tsx`, behind the Pricing right. The text is a fee before tax with no tax worked out.
  - "GST/HST" is the right general wording for clients across provinces. Client documents keep their own wording (`corporate/render.ts`).

AGENT: accounting-reviewer
PIECE: Piece UI1, branch claude/ui1 (commits cc771ab, e1d0735), display only
RESULT: PASS
FOUND:
1. Where: `src/lib/closebook/reports.ts:60-61` together with `src/app/(app)/closebook/[id]/areas/tb-table.tsx:75-76`.
   What is wrong: the Prior column always nets to nil because of the "Net income last year (from the T2)" balancing row, which is minus the column's sum. That row is not actually read from the T2. The new footer now includes Prior in "Debits equal credits", but this check can never fail. A mistyped prior-year column would sit inside that row unseen. The same applies to a bank-statement file, where the opening difference sits in "Opening balances to enter" (`tb-build.ts:222`), although that row is visible and flagged for the reviewer.
   Why it matters: false comfort on the comparatives. The statements' prior-year figures and the step 6 comparison depend on them.
   Fix (follow-up piece, not UI1): when last year's T2 net income (GIFI 9999) is on file, compare the balancing row to it and name any difference in the footer. Otherwise label the row "Balancing figure, last year" and leave Prior out of the footer's claim.
   Source: the purpose of a trial balance check under CSRS 4200, where the practitioner considers whether the information looks plausible. Pre-existing design, not a UI1 regression. Low to medium risk.
2. Where: `tb-table.tsx:71` and `:208`.
   What is wrong: group totals add up only the rows that pass the filters (`filtered`), but the line still says "Total <group>". With an amount filter or "Flagged only" on, the total is a part-total. UI1 makes this more visible because a folded group now shows that figure on its own line. There is also an edge case with "Suppress zero balances": an account posted and then reclassed out (Prelim, Final and Prior all nil) drops out, so the group's Adjust and Reclass totals change.
   Why it matters: a preparer may read a part-total as the lead sheet total.
   Fix: work out `tot` from the group's rows before filters (as `tbByGroup` already does), or call the row "Total shown" while a filter is on.
   Source: CaseWare Data page practice, where group totals are not affected by display filters. Pre-existing, low risk.
3. Where: `tb-table.tsx:27`.
   What is wrong: `pctOf` is a second copy of `pctChange` (`reports.ts:68-72`). The comment at `reports.ts:65-67` says there is "the one calculation for every change %". The two agree today.
   Why it matters: they could drift apart later.
   Fix: import `pctChange`.
   Source: the project's own rule in `reports.ts`. Low risk.
4. Where: `pct-show.ts:3`.
   What is wrong: a very small decrease formats as "-0.0%" and becomes "(0.0%)". There is also no unit test for `pctShow`, `plusTax`, or which columns the footer names.
   Why it matters: cosmetic, plus a gap in tests.
   Fix: optionally show "0.0%" when the rounded value is 0. Add small tests: "-25.0%" becomes "(25.0%)"; "n/m", "n/a" and "–" stay unchanged; `plusTax(245000)` gives "$2,450.00 plus GST/HST". This is for test-runner.
   Source: none needed (presentation). Low risk.
CHECKED:
- Footer column check (Prelim, Adjust, Reclass, Final, Prior): correct. No case found where it would wrongly say "out of balance". Prior can never fail (finding 1).
- Database enforces balanced entries (r2 migration :1070) and a balanced import (tb-import, migration :277): confirmed.
- Local database: dummy file this year 0.00, last year 0.00; AJE, RJE and TJE each 0.00; 0 entries out of balance across the database: PASS.
- Screenshot figures recomputed (Chequing, Receivables, Capital assets lines and totals, all % values): PASS.
- Group total rows under open groups; folded group or "Accounts" off shows totals on the group line: PASS (filter caveat, finding 2).
- Negative % in brackets on screen only (tb-table, report-view); PDF and Excel untouched: PASS.
- "Change from prior" heading spans $ and %: PASS.
- Header net income or net loss: same calculation as before, display only: PASS.
- "n of m reviewed" count and 4-part strip from `reviewed_at`; step 3 rolls up 3.1 to 3.3: PASS.
- `quoteTotal` and `plusTax`: staff Pricing screen only, before tax, no tax worked out, GST/HST wording: PASS.
- No posting, no migration and no rate change in the UI1 files reviewed: PASS.

---

## ui-reviewer

## ui-reviewer: Piece UI1 (C3 staff theme) post-build review, branch claude/ui1 (HEAD e1d0735)

**Verdict: FAIL.** Most of the build matches the mocks closely: the top bar, the file header and tabs, the step list modules, the colour rule, the font and the Settings left menu. Contrast passes everywhere I measured. The builder's parity script still passes (1667 functions before, 1670 after).

Six things stop the PR:
1. Focus rings are white on white inside every top-bar drop-down.
2. The "Skip to steps" and "Skip to working paper" links were not built.
3. An unsigned step has no Sign button beside its tag.
4. The Trial balance left panel still lists Reports.
5. The Quotes list still has a Source column.
6. The Sales menu "n waiting" count never counts monthly quotes.

The trial balance also scrolls sideways at 1280 and its out-of-balance footer is below the fold at every size.

### Deliberate choices, judged
- **"n of m reviewed" in module headers.** Accept. It is the true count under Q4, and "signed" would mislead because a prepared step is also signed. D3 and Q4 in docs/BRIEF.md still say "signed", so the brief needs a docs-keeper line once Hashim agrees.
- **Amber dot with words for screen readers below 1440 px.** Accept with a fix (finding 16). At 1280, the most common laptop size, a sighted keyboard user sees a dot with no meaning. The words appear only in a mouse-hover title.
- **Trial balance scrolls in its own box.** Accept the idea; it matches the approved 1024 mock. The height sum is about 74 px short, so the footer is never on screen without a page scroll (finding 7).
- **Settings list folds behind "All settings" below 1024 px.** Accept. It works with Enter and has aria-expanded.
- **Status colour rule (New amber, Expired amber, Declined grey).** Accept. Leads, Quotes and Letters follow it. The Letters tab words do not (finding 11).

### Contrast (all pass)
- Navigation text: 11.6:1.
- Find box border: 4.62:1. Find text: 8.65:1.
- Tags: blue 6.91:1, green 5.77:1, amber 6.09:1, grey 8.77:1.
- Grey text #63666A on white: 5.77:1. On the page background: 5.38:1.
- "Flagged": 6.80:1.
- Grey step ring: 3.24:1. Progress strip fill on its track: 4.94:1.
- Navy focus ring on white and white ring on navy: 14.8:1.

The only contrast failure is the white focus ring inside the white drop-downs (finding 1).

AGENT: ui-reviewer
PIECE: Piece UI1 (C3 staff theme), branch claude/ui1 at e1d0735; production build on localhost:3301; Playwright scripts in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/ui1rev/
RESULT: FAIL
FOUND:
1. Where: src/app/globals.css line 216 (`body:has([data-ui1]) [data-bar] :focus-visible { outline-color: #fff; }`).
   - What's wrong: the rule also reaches the white drop-downs, because they sit inside the bar's header: the Sales menu, the Menu panel, + New, the gear, the bell and the account menu. Their focus ring is white on white. Seen on "Leads" in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/ui1rev/sales-open.png and "Engagements" in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/ui1rev/panel-1024.png.
   - Why it matters: keyboard users cannot see where they are in any top-bar menu. This fails WCAG 2.4.7 and the brief's rule "navy on white".
   - Fix: limit the white ring to controls drawn on navy (for example `[data-bar] > :focus-visible, [data-bar] nav[aria-label=Main]:not([hidden]) > :focus-visible`), or set the panels back to `outline-color: #012169` (`[data-bar] .bg-white :focus-visible`).
   - Benchmark: WCAG 2.2 AA 2.4.7; UI1 fixes ("Focus ring ... navy on white").
2. Where: src/app/(app)/layout.tsx line 65 and src/app/(app)/closebook/[id]/shell/shell.tsx (FileShell, lines 115-118).
   - What's wrong: only "Skip to main content" exists. "Skip to steps" and "Skip to working paper" inside a file were not built. The step panel and the paper also have no ids to target. The Tab walk confirms it: from the skip link it takes 25 Tab presses to reach the first step.
   - Why it matters: this is a required UI1 fix. Keyboard staff tab through 24 bar, header and tab controls on every file screen.
   - Fix: on file pages, add two more links to `.skips`, with `id="steps"` on the LeftPanel aside and `id="paper"` (tabIndex -1) on the content div.
   - Benchmark: brief, UI1 "Fixes that come with UI1", Keyboard; WCAG 2.4.1.
3. Where: src/app/(app)/closebook/[id]/shell/shell.tsx lines 245-251 (SignCircles, size "lg").
   - What's wrong: unsigned steps show only the grey "Not prepared" / "Not reviewed" tags. There is no Sign button beside them for someone with the right. Signing needs a click on the tag first. Mock 1280-banking-states shows "Sign as reviewer" beside the grey tag; the build (step 3.1 and step 7, owner login) shows none.
   - Why it matters: D4 approved it. Signing is the most frequent action on a step, and it is now hidden behind a tag that looks like a status.
   - Fix: when `!prepared && editable && canPrepare && !p.subsOf && !p.preparerElsewhere`, render the existing `signForm("prepared", "Sign")` beside the tag. Do the same for the reviewer under the existing conditions. Keep the box for details.
   - Benchmark: D4; mock 1280-banking-states; CaseWare Cloud sign-off.
4. Where: src/app/(app)/closebook/[id]/page.tsx lines 798-799.
   - What's wrong: the Trial balance left panel still shows "REPORTS: Balance sheet, Income statement, General ledger, Journal". Seen in the build shots at 1280 and 1024; the mocks show only Views.
   - Why it matters: D5 says Reports has one home, its tab. Two homes for the same reports is the inconsistency D5 removed.
   - Fix: delete the Reports PanelHead and its links from `tbLeft`. The Reports tab already opens them, and old ?report= links already land on Reports (checked).
   - Benchmark: D5; mock 1280-tb.
5. Where: src/app/(app)/quotes/page.tsx lines 72 and 77 (column), line 67 (filter).
   - What's wrong: the Source column is still in the table and is blank in the dummy data. The Source filter only shows when there are 2 or more sources.
   - Why it matters: this is a listed UI1 fix ("Source moved from a column to a filter"). An empty column wastes width at 1024.
   - Fix: remove the th and td. Show the Source filter always, as in the mock ("Any source").
   - Benchmark: brief, UI1 fixes, "Quotes list"; mock 1280-quotes; TaxDome lists.
6. Where: src/app/(app)/layout.tsx line 39 (`waiting(["t1", "corporate", "proposal"], false)`).
   - What's wrong: letter_list() leaves out unsigned monthly quotes (supabase/migrations/20261208000000_round19_front_office.sql, the studio CTE where clause). So the Sales menu "n waiting" never counts monthly quotes. With the dummy data, My day shows 1 monthly quote waiting for signature, but the Sales menu shows nothing beside Quotes.
   - Why it matters: Q8 says quotes waiting for signature show in the Sales menu. Two screens give different counts for the same thing.
   - Fix: count from the quotes table, or from the same source My day uses (status sent or viewed, valid_until on or after today, all three kinds). Add a unit test.
   - Benchmark: Q8.
7. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx line 190 (`max-h-[calc(100vh-var(--top,56px)-118px)]`) and line 229.
   - What's wrong: the box height misses the title row and padding above the toolbar. The page still scrolls 73 to 74 px, and the "Out of balance" footer is below the fold on load at 1024x768, 1280x720, 1280x800 and 1920x1080 (measured). Staff get two scrollbars to find the balance check.
   - Why it matters: D6 asks for a fixed footer row. The out-of-balance warning is the one line that must always be visible.
   - Fix: measure the box's own top (getBoundingClientRect) and the footer height in the existing TopSync effect, and set max-height from them. Or make the section a flex column with the footer `sticky bottom-0`.
   - Benchmark: D6; mocks 1280-tb and 1024-tb (footer visible); CaseWare Cloud grid.
8. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx line 201 (row-icon column) with the Trial balance tab's 200 px left panel.
   - What's wrong: at 1280 the table box scrolls sideways by 56 px. The row icons (new entry, review note, send to reviewer) start off screen at the right edge; only a clipped "+" shows in the build shot. At 1024 it scrolls 312 px, which the 1024 mock accepts, but the mock's hint "Scroll sideways for more columns. No. and Account stay in place." is missing.
   - Why it matters: D9 says it fits at 1280 with no sideways scroll, and the row icons are parity functions.
   - Fix: show row icons on row hover and focus inside the Account cell, or narrow the left panel on this tab. Add the mock's scroll hint below 1280.
   - Benchmark: D9; Q5; mock 1280-tb.
9. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx lines 231-232.
   - What's wrong: the footer reads "Prelim 2026 is out by 25.00; ... Debits and credits differ. Find the entry before signing." The approved wording is "Prelim out by 25.00: check the import" and "Final out by 25.00: find the entry". The tick on 0.00 is also missing.
   - Why it matters: approved wording in the build notes. Prelim and Final call for different actions.
   - Fix: map prelim to "check the import" and the other columns to "find the entry", in the approved form. Add a Check icon to the balanced state.
   - Benchmark: build notes, Trial balance.
10. Where: square corners not applied outside the tokens. There are 116 hard-coded `rounded-[Npx]` classes; on mocked screens:
    - src/app/(app)/closebook/[id]/step3/banking-page.tsx lines 218, 220 and 245 (`rounded-[14px]`)
    - close-step.tsx line 21 and statements-step.tsx line 13 (`rounded-[10px]`)
    - review-notes.tsx line 42
    - shell/ui.tsx line 71 (Popover `rounded-lg` is token-driven and fine)
    - filter pills `rounded-full` in quotes/page.tsx line 52 and leads/page.tsx line 43
    - What's wrong: the zero-radius tokens cannot reach these. Measured: step 3.1 has 2 x 14 px and 2 x 10 px corners; step 7 has 3 x 10 px. The Quotes and Leads type filters are rounded pills, where the mock shows a square segmented row.
    - Why it matters: D10 (square containers and buttons). This is the most visible mock difference on the Banking screen.
    - Fix: replace `rounded-[10px]` and `rounded-[14px]` with `rounded-[var(--radius-ds)]` across the 116 uses (one sed). Make filter links square, as in the mock.
    - Benchmark: D10; mocks 1280-banking and 1280-quotes.
11. Where: src/app/(app)/engagements/page.tsx line 25.
    - What's wrong: the Letters tab still says "Waiting for signature" for sent and viewed letters.
    - Why it matters: Q9 says Quotes and the Letters tab use the same words (Sent, Viewed, Withdrawn). It is not in FO1's list, so nothing else will pick it up.
    - Fix: use "Sent" and "Viewed" (blue) and "Withdrawn" (grey). Keep the tab filter name "Waiting for signature".
    - Benchmark: Q9.
12. Where: src/app/(app)/top-bar.tsx lines 78 and 140-147 (Sales) and lines 110-126 (Menu panel).
    - What's wrong:
      - Escape closes the menu but leaves focus on a hidden link (it drops to body; tested).
      - Tabbing past the Sales menu leaves it open over the page.
      - The Sales menu says role="menu" but ArrowDown does nothing, while the Tools menu has arrow keys.
    - Why it matters: keyboard users lose their place after every Escape. Two menus on the same screen behave differently.
    - Fix: on Escape, return focus to the button that opened the menu. Close on focusout outside. Either add ArrowUp/ArrowDown like ToolsMenu (shell/ui.tsx) or drop role="menu" and role="menuitem" and keep plain links.
    - Benchmark: WCAG 2.4.3; WAI-ARIA menu button pattern; ToolsMenu in the same build.
13. Where: src/app/(app)/closebook/[id]/shell/ui.tsx line 68 (Popover summary aria-label) and shell.tsx lines 41-43 and 226-227.
    - What's wrong: the accessible name replaces the visible words:
      - visible "Not prepared" is announced as "Preparer: not signed, open sign-off"
      - visible "Prepared HA, Nov 19, 2026" is announced as "Prepared by Hashim Awad, ..."
      - the visible People chip is announced as "People"
    - Why it matters: voice-control users say what they see, and it does not match (WCAG 2.5.3).
    - Fix: start each label with the visible words, for example "Not prepared. Preparer not signed, open sign-off".
    - Benchmark: WCAG 2.2 AA 2.5.3.
14. Where: src/app/(app)/closebook/[id]/shell/shell.tsx lines 210, 219, 226 and 227.
    - What's wrong: the sign-off box and the tag labels use formatDate, with no time. The mock box shows "Nov 18, 2026, 4:12 PM", and the build notes ask for "full name with date and time read aloud".
    - Why it matters: parity list item. The time matters when two sign-offs happen on the same day.
    - Fix: use formatDateTime in the box lines and in pLabel and rLabel.
    - Benchmark: build notes, parity; mock 1280-banking-states.
15. Where: src/app/(app)/top-bar.tsx line 194.
    - What's wrong: the gear shows no active state on Settings pages. navOwner returns "gear", but the button ignores it. The mock 1280-settings shows the green line under the gear.
    - Why it matters: staff lose "where am I" on every Settings page.
    - Fix: add `owner === "gear"` styling (bg-navy-600 with a #86BC25 bottom line) and aria-current.
    - Benchmark: mock 1280-settings; D7.
16. Where: src/app/(app)/closebook/[id]/shell/shell.tsx line 97 (net-note dot below 1440).
    - What's wrong: at 1280 a sighted keyboard or touch user sees an unexplained amber dot. The words appear only in a hover title.
    - Why it matters: the note warns that net income is incomplete, and it is invisible in meaning on most laptops.
    - Fix: keep the dot and add a visible tooltip on focus and hover, or a 2-word visible label such as "Not final". Keep the full words for screen readers.
    - Benchmark: Studio rule 5 (say the concrete thing); QuickBooks Online status hints.
17. Where: shell.tsx lines 86-101 (header row) on the trial balance file at 1280.
    - What's wrong: the header wraps to two rows ("Net income ... History My files" drops to a second line). The mock fits one row, and about 37 px of table height is lost. The bank file at 1280 fits one row.
    - Why it matters: it costs table height on the screen that needs it most.
    - Fix: below 1440, shorten the People chip to initials only ("DO · DO", with the full names kept in its label) or move "My files" into the header's left side.
    - Benchmark: mock 1280-tb.
18. Pre-existing, not UI1 (listed so they are not blamed on this piece):
    - /clients and /closebook scroll sideways at 390 px by 139 and 555 px. An sr-only span with absolute position escapes the `overflow-x-auto` card (clients/page.tsx line 97, closebook/file-list.tsx line 17). Fix: add `relative` to those scrolling sections.
    - The step 3 bank card header ("Bank accounts" / "OPENING · DEC 31, 2025") overlaps at 390 because the grid columns are fixed (banking-page.tsx line 221).
    - Team and roles at 1280: the "Phone and email signature" inputs are clipped ("226-'", "Title, "), against Studio rule 5.
    - The Business hours grid at /admin/firm, already known.
CHECKED:
- Mock vs build, Banking 3.1 at 1280, 1024, 1920 and 390: differences are findings 3, 10, 14 and 17. Bar, header, tabs, strip and step list match.
- Mock vs build, trial balance at 1280 and 1024: differences are findings 4, 7, 8, 9 and 17. The Change from prior heading, bracketed negative % and Flagged words match.
- Mock vs build, Quotes at 1280: differences are findings 5 and 10. The "1 option" wording, the "–" placeholder with its hidden label, and the Sent/Signed colours match.
- Mock vs build, Settings Team and roles at 1280: four groups and Search settings match. The gear active state is missing (finding 15).
- Leads, My day and locked file: locked tag, lock line and read-only tags shown; no other differences.
- Sideways page scroll at 390, 1024, 1119, 1280, 1439 and 1920 on 13 pages: none on UI1 screens. /clients and /closebook at 390 are pre-existing (finding 18).
- Contrast, 25 colour pairs (text 4.5:1, non-text 3:1): all pass, apart from the white-on-white focus ring (finding 1).
- Tab order on a file page: skip link first, then bar, header, tabs, Tools and step list, all with a visible ring. Pass, except findings 1 and 2.
- Sales menu by keyboard: opens with Enter, Tab reaches its items. FAIL on the ring, Escape, arrow keys and staying open (findings 1 and 12).
- Menu panel at 1024: opens with Enter and lists the six items, Sales and Help. FAIL on the ring and Escape (findings 1 and 12).
- Tools menu: Enter and ArrowDown move through items; Escape returns focus to Tools. Pass.
- Sign-off tags: reachable by Tab, Enter opens the box, the Sign button inside has a navy ring. The Sign button beside the tag is missing (finding 3). The name does not match the visible words (finding 13). Escape loses focus (the popover itself is pre-existing).
- Step list: modules are details/summary, so Enter folds them and open or folded state is exposed. The current step and sub-step have aria-current. Pass.
- Auto-fold below 1440 on step 7 (rail of numbers with the pin locked): pass.
- Settings below 1024: "All settings" opens with Enter and aria-expanded. Pass.
- Old ?report= links open the Reports tab: pass.
- History hidden for staff without the Review right: pass.
- Staff top-bar items follow rights: pass.
- Builder's parity scripts: 1667 functions before, 1670 after, every old address opens. Pass. The manual parity list holds, except the time in the sign-off box (finding 14) and the row icons off screen at 1280 (finding 8).
- Counts: Engagements 4 matches My day's letters. Sales "waiting" misses the monthly quote (finding 6).
- Alexandria and tabular figures applied on staff screens only (data-ui1): pass.

---

## test-runner

**UI1 test run, branch claude/ui1 at e1d0735: FAIL. One spec gap: the Quotes list still has a Source column.**

Every suite passes and none got worse against origin/main (627b006). The only real failure is in the app flow, check Q2 below. Everything ran on local dummy data only, and I changed no code.

**Runs, main compared with the branch**

| Check | origin/main | claude/ui1 | Notes |
|---|---|---|---|
| `npm test` | 592/592 | 592/592 | No new failures. The only changed test file is tests/closebook-assign.test.ts (T8, approved). |
| `npx tsc --noEmit -p .` | 0 errors | 0 errors | Main first showed TS2304 PageProps/LayoutProps errors. That was the fresh checkout missing Next's generated route types; it was clean after `npx next typegen`. |
| `npx eslint src` | 0 errors, 1 warning | 0 errors, same warning | The warning is in review-lines.tsx:303, which this branch does not touch. |
| `npm run build` | OK, 134 route lines | OK, 134 route lines | Built in clean worktrees, so the .next folder used by the 3301 server was not touched. |
| `npm run test:parity` | 17/17 | 17/17 | |
| `npm run test:screens` | not run | 11/11 | Main was blocked by a leftover server on port 3100 (finding 2). The screens test files are the same on both. |
| Database suite (92 files) | not run separately | 92/92 files, 2,033 checks, 0 failures | Nothing under supabase/ differs from main and there is no migration, so main's inputs are identical. This was the one run allowed under the usage rule. |

- **How the database suite ran:** I used a copy of supabase/tests/run_local.sh that does not stop at the first failure. Each file got a fresh database, one at a time, on 127.0.0.1:54322. Local Supabase was already up, so no restart was needed.
- **Changed test and check files compared with main:** tests/closebook-assign.test.ts (T8, approved) and scripts/checks/closebook-function-parity.mjs (adds PARITY_FILES and renames the step "mapping" to "compare").

**App flow** (3301 build, dummy owner and staff, opening pages and popovers only, nothing submitted). The 3301 build includes e1d0735's code; I checked for its classes in .next.

| # | Check | Expected | Actual | Result |
|---|---|---|---|---|
| A1 | Top bar colour | #012169 | rgb(1,33,105) | PASS |
| A2 | Main items | My day, Clients, Closebook, Engagements, Documents, Sales | Same, in order | PASS (rerun) |
| A2b | Active item | Lighter navy, #86BC25 line | Line rgb(134,188,37), background rgb(18,53,125) | PASS (rerun) |
| A3, A4 | Font | Alexandria, self-hosted | Alexandria loaded, no Google font calls | PASS |
| A5 | First Tab | "Skip to main content" | "Skip to main content" | PASS |
| A6 | Sales menu | Leads, Quotes | Leads, Quotes | PASS |
| A7 | Icon buttons | Named, at least 24x24 | 36x36, all named | PASS |
| A8 | My day sideways scroll at 1280, 1920, 1024, 390 | None | 0 at all four | PASS |
| A9 | Below 1120 px | Menu button; panel has six items and Help | Yes | PASS |
| A10 | Find a client | Compact button below 1366; 300 px box at 1440 | Same | PASS |
| S1 | Settings left menu | Your firm, Lists, Templates, Tools, plus Search settings | All present | PASS (rerun) |
| S2 | Lock marks in Settings menu | None | 0 | PASS (rerun) |
| S3 | Search settings "tax" | Only matching items | Sales tax rates, Import TaxDome export | PASS |
| C1 | Trial balance file, module 2 | "BOOKS" | "BOOKS" | PASS |
| C2 | Statements file, module 2 | "Bookkeeping" | Found | PASS |
| C3 | File tabs | Steps, Trial balance, Entries, Reports, Notes, Statements, Tools | Exact | PASS |
| C4 | Header | Client link, History, My files | All present | PASS |
| C5 | 1280 header | History and My files inside the screen | History right edge 1191, My files 1256 | PASS |
| C6, C7 | Step tags | "Prepared XX, date" blue, "Reviewed XX, date" green | "Prepared DS, Nov 14, 2026" #005587 on #E0F2FE; "Reviewed DO, Nov 14, 2026" #046A38 | PASS (rerun) |
| C8 | Click Prepared tag | Sign-off box opens | Opens, "Prepared by Dummy Staff Nov 14, 2026" | PASS (rerun) |
| C9 | Same-person line | Absent when two people signed | Absent | PASS |
| C10 | Step 3, sub-steps prepared | Step 3 tags | Prepared tag and grey "Not reviewed" shown | PASS (rerun) |
| C11 | Step 3 box in step list | No Sign button; "Still to review" with links | "Still to review: 3.1, 3.2, 3.3", no Sign | PASS (rerun) |
| C12 | Locked file | Locked line, no Sign buttons | "This file is locked…", 0 Sign buttons | PASS (rerun) |
| C13 | Trial balance footer | "Out of balance", "Change from prior" heading | "Out of balance 0.00 · Debits equal credits"; heading present | PASS |
| C14 | Trial balance rows | 28 px | Body rows 28 px | PASS |
| C15 | Negative % | No "-x%" on screen | 0 found | PASS |
| C16, C20 | Trial balance and step 4 at 1280 | No sideways scroll | 0 | PASS |
| C17 | Old `?report=bs` link | Opens Reports | Goes to area=reporting, Reports current | PASS |
| C18 | Module counts | n of m per module | "1 of 1 reviewed, 3 of 3, 3 of 4, 1 of 2" | PASS (rerun) |
| C19 | Staff without Review right | No History button | 0 | PASS |
| Q1 | Quote amounts | "n options"; no "In the quote" or "+ HST" | "2 options", no old wording | PASS |
| Q2 | Source | Filter, not a column | **Source column still in the table** | **FAIL** |
| Q3 | Quote status colours | Sent #005587, Signed #046A38 | Same | PASS |
| Q4 | Empty cells | Dash with hidden label | "–" with sr-only "None" | PASS |
| E1 to E3 | Engagements, Leads, Design pages | Load | HTTP 200 | PASS |
| E4 | /start | No staff bar | No bar | PASS |
| E5 | Staff top bar | Only permitted items | Shown | PASS |

- **Server errors:** none, no page errors and no HTTP 5xx.
- **Rerun checks:** the checks marked "(rerun)" failed on the first pass only because of my harness. They passed on a clean rerun.
  - A2: my count included the hidden screen-reader text.
  - A2b: my selector first hit the hidden Menu panel.
  - S1 and S2: I used /admin, which has no page.
  - C6 and C7: I read the small step-list tags.
  - C8: I used `button:has()`, but the tag sits in a `<details><summary>`. Also, "Take back" correctly does not show on a step that is already reviewed (shell.tsx:215).
  - C10 and C11: I picked sub-step 3.1's own tags.
  - C12: I looked for the words "File locked"; the app says "This file is locked".
  - C18: I expected "signed"; the app says "reviewed", which matches Q4.
- **Helpers checked by hand:** `quoteTotal(245000)` gives "$2,450.00 plus GST/HST". `pctShow("-25.0%")` gives "(25.0%)"; "n/a" and "-" are unchanged.

**Uncommitted changes appeared during the run.** At 02:07:40, 44 files appeared in /home/user/concept-firm-app that I did not make: modified src files, plus new skip-links.tsx, src/lib/closebook/tb-footer.ts and tests/ui1-display.test.ts. All my runs used e1d0735:
- type-check, lint and unit tests finished before 02:04;
- the build and screens ran in a clean worktree;
- the database suite reads only supabase/, which those changes do not touch;
- the 3301 build is from 01:51.

These new changes have not been tested.

**Clean-up left for you:**
- A leftover server (PID 6694) is still on port 3100. Stopping it was refused.
- The scratch worktree at /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/wt-ui1 is that server's working folder, so I left it. Remove it with `git worktree remove --force` once the server is stopped. I already removed the main worktree.
- The app-flow scripts and results are in the same scratchpad: flow.mjs, flow2.mjs, probe.mjs, probe2.mjs, flow-out.json and db-results.txt.

AGENT: test-runner
PIECE: Piece UI1 (C3 staff theme), branch claude/ui1 at e1d0735, compared with origin/main 627b006
RESULT: FAIL
FOUND:
1. Where: src/app/(app)/quotes/page.tsx:72 (`<th>Source</th>`) and :77 (`<td>{r.source}</td>`); Quotes screen at 1280. What: the Source column is still in the table. The new Source filter was added (line 67), but it only shows when there is more than one source, so on the dummy data neither a filter nor a removed column is seen. Why it matters: this is one of the fixes Hashim approved for UI1, and the extra column uses width at 1280. Fix: remove the Source `th` and `td` and keep the filter. Builder to decide whether the filter should also show when there is only one source. Source: docs/BRIEF.md:1022, "Source moved from a column to a filter".
2. Where: scripts/run-screen-parity.sh:7-8 (test harness, not this branch). What: the `trap` kills `npx` but not the `next-server` child, so a server stays on port 3100 after the run (PID 6694 now). The next `npm run test:screens` fails with "Port 3100 is already in use". Why it matters: it blocks later screen runs and made a main baseline impossible here. Fix: someone with permission stops PID 6694. Later, the script could kill the process group or run `node node_modules/next/dist/bin/next start` directly. Source: this run, /proc/6694 (cwd wt-ui1, STUDIO_HARNESS=1).
3. Where: src/app/(app)/closebook/[id]/page.tsx:419 (SaveForm "Setup questions"), from commit 52fbfd47, Nov 15. Not caused by this branch. What: on a locked dummy file (336ec460…) the Setup questions Save button is shown and enabled. Server refusal was not tested, because nothing was submitted. Why it matters: the build notes say a locked file is read-only. Fix: gate the form on `file.phase !== "locked"`, in a later piece. Source: docs/BRIEF.md:1043 and the locked line's own text ("Everything is read-only").
4. Where: tests/ (none at e1d0735). What: no unit test covers `quoteTotal`/`plusTax` (src/lib/quotes.ts) or `pctShow` (src/lib/closebook/pct-show.ts). The dummy data also has no T1 quote with an amount, so "plus GST/HST" was never seen on screen. Why it matters: the decision 54 wording is only checked by hand. Fix: add tests; the uncommitted tests/ui1-display.test.ts may already do this. Source: docs/BRIEF.md:1022 and 1045.
5. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx:231. What: the out-of-balance wording reads "Prelim is out by X. Debits and credits differ. Find the entry before signing." The build note asks for "Prelim out by 25.00: check the import" or "Final out by 25.00: find the entry". I could not trigger this on dummy data. Why it matters: the wording differs from the build note. Fix: ui-reviewer to confirm; the uncommitted tb-footer.ts may change it. Source: docs/BRIEF.md:1042.
CHECKED:
- Local DB 127.0.0.1:54322 was up (PostgreSQL 17.11); no restart needed.
- Database suite, one file at a time: 92/92 files PASS, 2,033 checks, 0 failures. Main inputs are identical (no supabase/ changes).
- npm test: 592/592 on branch, 592/592 on main.
- tsc: 0 errors on branch; 0 errors on main after `next typegen`.
- eslint src: 0 errors and 1 old warning on both (review-lines.tsx:303).
- npm run build: OK on branch and main, 134 route lines each.
- npm run test:parity: 17/17 on branch and main.
- npm run test:screens: 11/11 on branch; main not run (port 3100 held, finding 2).
- App flow on 3301: 39 of 40 PASS; Q2 FAIL (finding 1). The checks marked "(rerun)" failed first because of my harness and passed on a clean rerun.
- No server 5xx and no page errors during the app flow.
- Uncommitted changes from 02:07:40 were not tested; all results are for e1d0735.

---

## ui-reviewer

Second post-build review of Piece UI1 at 22eae56. The work was read-only. I checked a production build at http://localhost:3301 at 1280 px with deviceScaleFactor 1, and at 390, 1024, 1119, 1439, 1440 and 1920 px where it mattered.

**Result: FAIL.** 13 of the 17 findings are fixed. Findings 7, 10, 13 and 16 are only partly fixed. Findings 8 and 12 also have small new issues. Two issues are real defects at 1280 px or for screen readers: column headings hidden on the Trial balance (item 1 below) and a link name that leaves out its visible words (item 3).

**Status of findings 1 to 17**
- **1 Fixed.** White menus that open from the bar now show the navy focus ring (New, Settings, Sales, avatar, Menu panel at 1024). Buttons on the bar keep the white ring.
- **2 Fixed.** Inside a file the Tab order is: Skip to main content, Skip to steps, Skip to working paper. "Skip to working paper" moves focus to #paper. "Skip to steps" works: the next Tab lands on the first step-list item. But #steps has no tabIndex={-1}, so focus stays on the page body.
- **3 Fixed.** "Sign as preparer" and "Sign step 7 as reviewer" sit beside the unsigned tags. They are hidden for staff without the right.
- **4 Fixed.** The Trial balance left panel shows only Views: Groups and Accounts.
- **5 Fixed.** The Quotes columns are Client, Type, Amount, Sent, Expires, Status.
- **6 Fixed.** Sales shows "1 waiting", and My day lists the same 1 monthly quote.
- **7 Partly fixed.** The footer is now in view at every size. But the page still scrolls 105 to 134 px. See item 1.
- **8 Fixed at 1280.** The table box has no sideways scroll and the row icons are inside it. New issue: see item 2.
- **9 Fixed.** The wording "Out of balance 0.00 ✓ Debits equal credits" matches D6.
- **10 Partly fixed.** No `rounded-[10px]` or `rounded-[14px]` is left. Pill filters remain: see item 4.
- **11 Fixed.** The Letters tab shows "Sent" and "Viewed", the same words as Quotes.
- **12 Fixed.** The Sales menu has no menu role and uses aria-controls="sales-menu". Escape returns focus to the button for both keyboard and mouse. Small leftover: see item 5.
- **13 Mostly fixed.** The sign-off tag names start with the visible words, and so does the People chip at 1440 px and above. The not-final note link does not: see item 3.
- **14 Fixed.** The sign-off names and boxes show date and time ("Nov 13, 2026, 7:42 PM").
- **15 Fixed.** The gear has aria-current="page" on Admin and the same active style as the other bar items (navy-600 background, 3 px lime underline, 56 px high).
- **16 Fixed at 1280.** The visible words "Not final" follow the dot. Problems at 1439 px and for screen readers: see items 3 and 6.
- **17 Fixed at 1280.** The client header is one line and the chip reads "DO · DO". At 1439 to 1440 px, on a file with the not-final note, the header wraps to two lines. Wrapping has been allowed since e1d0735, so I did not report it.

**Regression checks**
- 595 of 595 tests pass with `node --test 'tests/*.test.ts'`.
- `tsc --noEmit` and eslint on the changed files show no errors.
- No page scrolls sideways at 390, 1024, 1119, 1280, 1439 or 1920 on 13 screens.

New screenshots are in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/ui1rev2/. The key ones:
- wheel-1280x720.png: Trial balance column headings hidden
- tb-1280-scroll100000.png: scroll hint with nothing to scroll
- hdr-net-1439.png: "Not final15 accounts not yet assigned"
- s3.png: Sign button beside the tag

AGENT: ui-reviewer
PIECE: Piece UI1, fix round, branch claude/ui1 at 22eae56 (second and last post-build review)
RESULT: FAIL
FOUND:
1. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx:193 (and :234). Screen: Trial balance at 1280x720 and 1280x800.
   What is wrong: finding 7's cause is still there. The box height `max-h-[calc(100vh-var(--top,56px)-118px)]` does not allow for the section heading, the new scroll-hint row (31 px) and the footer. So the page scrolls 105 to 134 px. When a user scrolls the table to the end, the page scrolls too. The column headings (NO., ACCOUNT, PRELIM 2026 and the rest) end up under the sticky toolbar. At the headings' position, elementFromPoint returns the toolbar. The bottom rows then show numbers with no column names. The new hint row adds 31 px to the problem. At 1920 the headings stay visible.
   Why it matters: this is the most-used working paper, and 1280 is the main laptop size. Staff cannot tell Prelim from Final or Prior at the bottom of the TB. D6 requires "sticky column headers under the fixed bars".
   Fix: size the box so the page does not scroll. Subtract the real offsets: heading, toolbar, hint and footer. You can measure the box top with the existing wrapRef and set max-height to innerHeight minus top minus the hint and footer heights. Or put the hint inside the footer row. Check that window.scrollY stays 0 after wheeling to the end at 1280x720.
   Benchmark: CaseWare Cloud Data page; BRIEF D6.
2. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx:234.
   What is wrong: "Scroll sideways for more columns. No. and Account stay in place." shows at every width from 1280 to 1439 px. At those widths the table has no sideways scroll (measured: 0 px, both pin states, Groups and Accounts views). The hint is only true at 1024, or at 1280 with "Split adjustments into AJE and TJE" turned on (81 px).
   Why it matters: an instruction that is false at the main laptop size. It breaks the rule to say the concrete thing, and it takes a row of height that causes item 1.
   Fix: show the hint only when wrapRef.scrollWidth > clientWidth, using a ResizeObserver, instead of a fixed 1440 breakpoint.
   Benchmark: Studio rule 2 (plain words); QBO tables show no scroll hint.
3. Where: src/app/(app)/closebook/[id]/shell/shell.tsx:99. Screen: client header below 1440 px.
   What is wrong: the visible "Not final" span has aria-hidden. The link's accessible name is therefore "15 accounts not yet assigned" (ariaSnapshot). It does not contain the visible words "Not final".
   Why it matters: WCAG 2.5.3 Label in Name, which was finding 13 itself. A voice-control user who says "click Not final" gets nothing.
   Fix: drop aria-hidden from the "Not final" span and make the screen-reader text ", {netNote}". The dot stays aria-hidden.
   Benchmark: WCAG 2.1 SC 2.5.3.
4. Where: src/app/(app)/documents/page.tsx:27, src/app/(app)/closebook/[id]/review-step.tsx:116, src/app/(app)/closebook/[id]/areas/entries-area.tsx:60.
   What is wrong: three filter chip sets still use `rounded-full`, measured as pills on Documents (All, Corporate letter, T1 letter, Monthly quote) and on step 7. Quotes uses the same chip and is now square. Tailwind v4 `rounded-full` does not read the zeroed --radius-* variables.
   Why it matters: the rest of finding 10 is not done. Two filter styles now appear on neighbouring Sales and Documents screens.
   Fix: use the square class from the Quotes chip (quotes/page.tsx:52) in all three places, or share one chip component.
   Benchmark: Studio rule 3 (fixed look); TaxDome list filters.
5. Where: src/app/(app)/top-bar.tsx:109 (header onBlur).
   What is wrong: the Sales menu closes only when focus leaves the whole bar. If a user tabs past its links to Search, New, Help or Settings, the menu stays open (measured: focus on Settings, menu open). This is minor and not part of the FAIL.
   Why it matters: an open menu sits over the page while the user works elsewhere in the bar.
   Fix: in onBlur, close when relatedTarget is outside the open menu's wrapper, not outside the header.
   Benchmark: TaxDome menus close when focus leaves the menu.
6. Where: src/app/(app)/closebook/[id]/shell/shell.tsx:43, 92 and 99.
   What is wrong: Tailwind v4 `max-[1439px]` means width < 1439, so at exactly 1439 px both states show. The header reads "Not final15 accounts not yet assigned" with no space (hdr-net-1439.png), and the People chip shows the full words. This is minor and the pattern at line 92 was already there.
   Why it matters: the text runs together on a narrow band of widths.
   Fix: use `max-[1440px]:` so it pairs with `min-[1440px]:`.
   Benchmark: Studio rule 6 (laptop and large monitor).
CHECKED:
- Finding 1, focus ring in the bar's white menus: PASS (navy #012169 in New, Settings, Sales, avatar, 1024 Menu panel)
- Finding 2, skip links in a file: PASS (three links in order; #paper takes focus; #steps not focusable but next Tab lands in the step list)
- Finding 3, Sign button beside unsigned tags: PASS (owner and staff; hidden without the right)
- Finding 4, Reports removed from the TB left panel: PASS
- Finding 5, Source column removed from Quotes: PASS
- Finding 6, Sales "n waiting" matches My day: PASS (1 and 1)
- Finding 7, TB footer in view: PARTLY (footer in view at all sizes; page still scrolls 105 to 134 px at 1280 and hides headings, FOUND 1)
- Finding 8, TB sideways scroll at 1280: PASS (0 px, icons inside the box); hint wrong (FOUND 2)
- Finding 9, footer wording against D6: PASS
- Finding 10, radii and pills: PARTLY (no [10px] or [14px] left; pills remain, FOUND 4)
- Finding 11, Letters tab words: PASS (Sent, Viewed)
- Finding 12, Escape, focus leaving, Sales menu role: PASS (Escape returns focus for keyboard and mouse; minor FOUND 5)
- Finding 13, accessible names: PARTLY (sign tags and People chip PASS; net-note link FAIL, FOUND 3)
- Finding 14, time in sign-off box: PASS
- Finding 15, gear active state: PASS
- Finding 16, net-note dot meaning at 1280: PASS visually; FOUND 3 and 6
- Finding 17, header wrap at 1280: PASS (one line at 1280)
- Page sideways overflow, 13 screens at 390 to 1920: PASS (none)
- `node --test 'tests/*.test.ts'`: PASS (595 of 595)
- `tsc --noEmit`: PASS
- eslint on changed shell, top-bar, skip-links and tb-table files: PASS

---

## test-runner

Fix-round test run for Piece UI1 (claude/ui1 at 22eae56). The Quotes Source column, the reason for the last FAIL, is gone. All the checks you asked for pass. Each check was run once and was clean the first time, so no rerun was needed. I have five minor findings. None of them blocks the PR.

What I ran: type-check, lint, npm test, the screens suite once, and the app flow on the running build at http://localhost:3301 at 1280x720, as owner and as staff. I did not rerun the database suite, as you said. Nothing under supabase/ changed between e1d0735 and 22eae56. I did not rerun closebook parity or frame parity because they were not in this round's list, so the builder's parity figures are not confirmed or contradicted.

Builder's claims:
- **npm test 595/595:** confirmed. The new tests/ui1-display.test.ts adds 3 tests. It is the only test file changed since e1d0735. No new failures.
- **Closebook parity 1667 → 1670 and frame parity staff 5/5, owner 40/40:** not rerun.

App flow:
- **Q2, Quotes (owner and staff):** the column headers are now CLIENT, TYPE, AMOUNT, SENT, EXPIRES, STATUS, with no Source. PASS for the column. The Source filter does not show on the dummy data: both quotes have no lead, so their source is blank and the filter has no choices. Opening /quotes?source=Phone and ?source=Website both give "No quotes match.", so the filter itself works. See finding 3.
- **Finding 3 from the first run, locked file 336ec460 Setup questions:** no Save or Discard button (owner and staff). PASS. See finding 2 for what is left.
- **Sales menu against My day:** the menu shows "Quotes 1 waiting" and the My day card shows 1, for owner and staff. PASS. See finding 5 for a timing gap.
- **Trial balance on 2df089a3 at 1280x720:** the footer reads "Out of balance 0.00 Debits equal credits" and sits at the bottom of the screen without scrolling (top 684, bottom 720). The table box scrolls 0 px sideways and the page scrolls 0 px sideways. Same result at 1280x800 and 1440x900. PASS.
- **Sign button:** on 2df089a3, owner sees "Sign as preparer" next to "Not prepared" on Setup, and "Sign as reviewer" next to "Not reviewed" on step 8. Both are on the same row, 6 px from the tag. Staff sees "Sign as preparer" on Setup and no reviewer button on step 8, which matches what their rights allow. The locked file shows no Sign button on Setup, Opening balances or Records for either user. PASS.

The screens suite passed 11/11. It left its server running on port 3100 afterwards, which I stopped (finding 1).

Dummy data: in one probe I clicked Save on the locked file to see if the database would refuse it. It did: before and after, the file's setup answers and updated_at (2026-11-15 00:03:01) are the same. Nothing else was written.

AGENT: test-runner
PIECE: Piece UI1 fix round, branch claude/ui1 at 22eae56 (tsc, eslint src, npm test, npm run test:screens, app flow on the build at http://localhost:3301)
RESULT: PASS
FOUND:
1. Where: /home/user/concept-firm-app/scripts/run-screen-parity.sh, the `trap 'kill $APP_PID ...'` line. What: the trap stops only the npx process. The next-server child it starts keeps running on port 3100 after the suite ends. After this run, PID 7039 (STUDIO_HARNESS=1, folder /home/user/concept-firm-app) still answered on port 3100 with 307. I stopped it, and port 3100 now gives no answer. Why it matters: this is a test harness fault, not an app fault. It is the cause of the leftover port-3100 server. The next run then fails with "Port 3100 is already in use", and the leftover server can serve an old build. Fix: start the server in its own process group with setsid and stop the whole group (kill -- -$PGID), or also stop its children (pkill -P). Source: ps and /proc/7039/environ after the suite finished.
2. Where: closebook file 336ec460-a43e-470f-b0cb-3701b746f697?step=setup, Setup questions form (src/app/(app)/closebook/[id]/page.tsx about lines 420-455). What: the Save button is gone, but on the locked file all 20 inputs can still be changed. After a change, leaving the page opens "Save your changes? ... Stay / Discard / Save". Pressing Save shows "This file is locked." The database refused the change and the data did not change. Why it matters: the page says the file is read-only but still lets you edit and offers Save. This is minor, and no data is at risk. Fix: when the file is locked, disable the inputs (for example a disabled fieldset), or tell SaveForm the form is read-only so it does not ask on leaving. Source: the UI1 locked-line wording "Everything is read-only until ..."; Playwright probe d.cjs.
3. Where: /quotes, src/app/(app)/quotes/page.tsx line 32, and the quote_list function (source is '' when a quote has no lead). What: the Source filter shows only when at least one quote has a lead. On the dummy data no quote has one, so the filter does not show and could not be checked on screen. Quotes with no lead have no Source choice, so they can never be picked out by Source. Why it matters: the column half of Q2 is proved. The filter half is proved only through the URL and by reading the code. Fix: give quotes with no lead a source label (for example "Direct") in quote_list, or add a dummy quote with a lead and recheck the filter on screen. Source: Q2 spec ("Source is a filter, not a column"); quote_list definition in the local database.
4. Where: src/app/(app)/closebook/[id]/areas/tb-table.tsx about line 76, the "Scroll sideways for more columns..." line (min-[1440px]:hidden). What: at 1280 wide this line shows (display block) even though the table box scrolls 0 px sideways with the default columns. It also sits below the fold behind the sticky footer. Why it matters: it tells people to do something that does nothing. This is minor wording accuracy. Fix: show the line only when the box can scroll sideways (scrollWidth > clientWidth). Source: Playwright measurement, sideways=0 and hint=block at 1280x720 and 1280x800.
5. Where: src/app/(app)/layout.tsx about lines 233-240, the Quotes waiting count. What: the menu now counts every sent or viewed quote from quote_list. It no longer checks valid_until and does not run expire_quotes first. The My day page and the Quotes page run expire_quotes before they count, and the layout and the page load at the same time. Why it matters: on the first page load after a quote passes its expiry date, the menu can show one more waiting than My day, until the next page load. Not seen on the dummy data: 1 sent proposal, 0 past expiry. Fix: add `.gte("valid_until", today)` to the layout count, as the old query did, or run expire_quotes before counting. Source: expire_quotes in supabase/migrations/20261111050000_quotes_one_record.sql (lines 210-219); src/app/(app)/page.tsx line 57.
CHECKED:
- npx tsc --noEmit -p .: exit 0, no errors.
- npx eslint src: exit 0, 0 errors, 1 warning. The warning is at review-lines.tsx line 303 (window.location.href). It is already on main (line 300) and is not new.
- npm test: 595/595 pass, 0 fail. Matches the builder. The only test file changed since e1d0735 is tests/ui1-display.test.ts (3 tests added).
- Test files changed against main: 14 files (git diff --stat main...22eae56 -- tests). No new failures.
- supabase/ unchanged between e1d0735 and 22eae56: confirmed, so the database suite was not rerun as instructed.
- npm run test:screens: 11/11 pass. Its next-server was left running on port 3100 (PID 7039); I stopped it and port 3100 is now free (finding 1).
- Closebook parity and frame parity: not rerun (not in this round's list). Builder's figures not confirmed.
- Q2, Quotes has no Source column (owner and staff): PASS.
- Q2, Source filter on dummy data: not shown (no quote has a lead). ?source=Phone and ?source=Website filter to "No quotes match": PASS through the URL only (finding 3).
- Finding 3, locked 336ec460 Setup questions has no Save or Discard button (owner and staff): PASS. Inputs can still be changed and the leave dialog offers Save, which the database refuses (finding 2).
- Sales menu "Quotes 1 waiting" against My day "Quotes waiting for signature 1" (owner and staff): PASS.
- TB 2df089a3 at 1280x720, footer in view without scrolling (684-720): PASS. Also PASS at 1280x800 and 1440x900.
- TB table box at 1280: sideways scroll 0 px, page sideways scroll 0 px: PASS.
- Sign button beside an unsigned tag: owner "Sign as preparer" (Setup) and "Sign as reviewer" (step 8), staff "Sign as preparer" only: PASS.
- No Sign button on locked 336ec460 (Setup, Opening, Records; owner and staff): PASS.
- Locked file database check after the Save probe: setup and updated_at unchanged: PASS.
- Servers after the run: port 3301 still up (not touched), port 3100 stopped, no rebuild in the repo folder.

Evidence: scripts and screenshots are in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/trui1fix/ (a.cjs, b.cjs, c.cjs, d.cjs, owner-tb-1280x720.png, owner-2df089a3-t2-top.png, locked-after-save.png). Lint output is in /tmp/claude-0/-home-user-concept-firm-app/712d69b6-9ad0-564e-bb71-26cec3677cdc/scratchpad/eslint.txt.

---

## security-risk

I found nothing that blocks the PR for Piece UI1 at f7c77cc. I read `git diff origin/main...f7c77cc` (73 files). The diff has no migration, no SQL, no new route, and no server action or RPC was changed. Every access check that was removed went with code that was also removed (`signoff-bar.tsx`, `app-sidebar.tsx`), and the same check exists again in its place. I did not test against the local build on :3301; this is a code review only. Nothing was changed.

**Top-bar counts** (`src/app/(app)/layout.tsx` lines 225-235)
- Sales count: shown only with View on Leads, read through the signed-in person's own Supabase client, so the leads table's row-level security still applies.
- Engagements count: comes from `letter_list()`, gated on Documents or Leads. That matches the function's own check (`can_view('documents') or can_view('leads')`), and the function also filters by letter type (`can_letter('t1'/'corporate')`).
- Quotes count: comes from `quote_list()`, gated on Leads, which matches the function's own check (`can_view('leads')`).
- All three use `count: 'exact', head: true`, so PostgREST returns only a number, never rows. The only value placed into the `.or()` filter is `today`, which the server works out from the date, so no user text reaches it.
- No count goes beyond what the person can already see on `/leads`, `/engagements` or `/quotes`.

**Top bar** (`src/app/(app)/top-bar.tsx`): the menu flags match the old sidebar rules exactly, and each page still checks again on the server:
- `/quotes`: `requireAccess("leads")`
- `/engagements`: Documents or Leads
- `/documents`: Documents or Vault, otherwise it redirects

**Settings menu** (`src/app/(app)/admin/layout.tsx`, `settings-nav.tsx`)
- The menu is built on the server from `gearMenu(access)`, the same source the gear uses, so it lists only pages the person can open.
- `requireAccess()` with no area only asks for a signed-in staff member, the same as the parent `(app)/layout.tsx`. It does not change who can reach `/admin` pages; each page keeps its own check.
- The draft count is loaded only for an Admin with View on `engagement_terms`, as before.

**Closebook file page** (`src/app/(app)/closebook/[id]/page.tsx`)
- Redirect for old `?report=` links: the address is always `/closebook/${id}?…`. The id must match the UUID pattern (line 91, otherwise 404), and the query is rebuilt with `URLSearchParams`, which encodes every value. There is no open redirect and no way to inject headers.
- The History button shows only when `history={rv}` (the Review right), as before.
- Locked files: the Setup inputs are disabled and Save is hidden; the database still refuses changes.

**Sign buttons** (`src/app/(app)/closebook/[id]/shell/shell.tsx` lines 259-265)
- `canSignP` and `canSignR` use the same conditions as the sign forms inside the popover (`editable`, `canPrepare`/`canReview`, not prepared or reviewed yet, not a step signed in parts, not "preparer elsewhere").
- Take-back still needs your own sign-off or the right to remove others' sign-offs (`canUndo`).
- The server is unchanged:
  - `signStep` and `signSubstep` call the `cb_sign_step` / `cb_sign_substep` RPCs, which refuse locked files.
  - Only an owner can sign as reviewer, and the preparer must sign first.
  - Each sign-off is written to the file history (`cb_log`).
  - The `back` address is limited to `/closebook/${id}?`.

**Quotes list** (`src/app/(app)/quotes/page.tsx`)
- `sp.source` is only compared with values in memory, and React escapes it on screen.
- Amounts show only with Pricing, and `quote_list` already returns null amounts without Pricing.
- The new "n options" text is a count, not a price.

**Test harness** (`src/app/studio-harness/[screen]/harness.tsx`): it is still only reachable when `STUDIO_HARNESS=1`; otherwise the page in the unchanged `page.tsx` returns 404. It shows only made-up props ("Test User").

**Secrets and fonts**
- `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` appears nowhere at f7c77cc, and `.env.example` is the only env file in git and is not changed.
- No service role key, token or password was added. `dummy-pass-123` was already in `closebook-function-parity.mjs` and is a test login.
- `@fontsource/alexandria` 5.3.0 comes from registry.npmjs.org with an integrity hash and the OFL-1.1 licence. It is self-hosted, so the app makes no call to Google.

**Client data**: the brief, changelog, tests and commit messages use only made-up figures and the firm's own initials ("HA"). `name-check.sh` passed for business numbers, but `CLIENT_NAMES` is not set locally, so client names were not checked here. The CI job "name-check" covers that.

AGENT: security-risk
PIECE: Piece UI1 (C3 staff theme), branch claude/ui1 at f7c77cc, git diff origin/main...f7c77cc
RESULT: PASS
FOUND: None
CHECKED:
1. Access, row-level security: no new tables or policies in the diff. PASS
2. Access, top-bar counts: each is gated to match the RPC's own check (letter_list: Documents or Leads; quote_list: Leads); the leads count is subject to row-level security; head:true returns counts only. PASS
3. Access, top-bar items: flags match the old sidebar; /quotes, /engagements and /documents check again on the server. PASS
4. Access, Settings left menu: built on the server from gearMenu(access); requireAccess() in the admin layout matches the parent layout and does not change who reaches /admin pages. PASS
5. Access, Closebook: History shown only with Review; Sign buttons use the same conditions as the popover forms; signStep/signSubstep and the cb_sign_* RPCs are unchanged and enforce locked, preparer-first and reviewer-is-owner; no server action changed. PASS
6. Access, locked files: inputs disabled and Save hidden; the database refuses changes. PASS
7. Access, removed checks: every check removed went with removed code and has the same check in its place. PASS
8. Redirect for ?report= links: UUID-checked id, fixed path, values encoded by URLSearchParams; no open redirect or header injection. PASS
9. Secrets: no keys, tokens or passwords added; NEXT_SERVER_ACTIONS_ENCRYPTION_KEY not in the repo; no env file changed; no service role use in the diff. PASS
10. Client data: scripts/checks/name-check.sh found no business number or client name, but CLIENT_NAMES was unset locally so names were not checked (CI covers it); manual read of the brief, changelog, tests and commit titles found dummy data only. PASS
11. Input: no SQL built from text (the .or() filter uses a server date); the quotes source filter is compared in memory and escaped by React; no new dangerouslySetInnerHTML, uploads, PDFs or emails. PASS
12. Migrations: none in the diff; no change to data on Live. PASS
13. Audit history: no change to client figures, sign-offs, tax codes, fees or permissions logic; sign-offs still write to History through cb_log. PASS
14. Test harness: still only reachable with STUDIO_HARNESS=1 (404 otherwise); made-up props only. PASS
15. Dependency: @fontsource/alexandria 5.3.0 from the npm registry with an integrity hash, OFL-1.1, self-hosted. PASS
16. Parity script: PARITY_FILES only narrows a local crawl; no secrets; dummy accounts only. PASS
17. Live test on localhost:3301: not run (code review only). NOT RUN

Files reviewed: /home/user/concept-firm-app/src/app/(app)/layout.tsx, /home/user/concept-firm-app/src/app/(app)/top-bar.tsx, /home/user/concept-firm-app/src/app/(app)/admin/layout.tsx, /home/user/concept-firm-app/src/app/(app)/admin/settings-nav.tsx, /home/user/concept-firm-app/src/app/(app)/admin/settings-menu.ts, /home/user/concept-firm-app/src/app/(app)/closebook/[id]/page.tsx, /home/user/concept-firm-app/src/app/(app)/closebook/[id]/shell/shell.tsx, /home/user/concept-firm-app/src/app/(app)/closebook/actions.ts, /home/user/concept-firm-app/src/app/(app)/closebook/banking-actions.ts, /home/user/concept-firm-app/src/app/(app)/quotes/page.tsx, /home/user/concept-firm-app/src/app/studio-harness/[screen]/page.tsx, /home/user/concept-firm-app/src/app/studio-harness/[screen]/harness.tsx, /home/user/concept-firm-app/scripts/checks/closebook-function-parity.mjs, /home/user/concept-firm-app/supabase/migrations/20261208000000_round19_front_office.sql (letter_list), /home/user/concept-firm-app/supabase/migrations/20261112000000_engagement_letters.sql (quote_list).

---

## ui-reviewer

ui-reviewer, third run on Piece UI1 (claude/ui1 at f7c77cc). I limited it to the six items.

**I could not run the browser checks.** Nothing was listening on http://localhost:3301, or on 3000 or 3300. The local Supabase at 127.0.0.1:54321 was also down, and the Docker daemon was not running. Starting Docker and a database is more than a read-only review should do, so I didn't. There is a production build in /home/user/concept-firm-app/.next (BUILD_ID vwTcxVcYWPr0hXZGcDIhdFri, built at 02:47, one minute before the commit). Its compiled files include the new data-menu code and the footer hint. Because nothing ran, every result below comes from reading the code and the compiled CSS. The live measurements still need doing: wheel and scrollY, elementFromPoint, Tab and Escape, and the screenshots at 1439.

**The one real defect is item 4, step 7.** The two count chips at the top of ?step=review are still fully round. They sit in the same row as the square "Not reviewed" and "Issues 4" tags. My second run's shape check (ui1rev2/q.cjs, ui1rev2/s7.png) measured these chips on step=review. The fix commit squared the chips in `HistoryView` (review-step.tsx:116) instead. That component draws the File history page (?history=1), not step 7. That change is fine, but the step 7 chips are untouched.

Item 1 looks right in code, but there is a possible loop that needs a check while the app is running. It is a risk, not a proven defect.

AGENT: ui-reviewer
PIECE: Piece UI1, third run, claude/ui1 at f7c77cc (`git show f7c77cc`), six items only
RESULT: FAIL
FOUND:
1. Where: /home/user/concept-firm-app/src/app/(app)/closebook/[id]/review-chip.tsx line 13 and /home/user/concept-firm-app/src/app/(app)/closebook/[id]/review-step.tsx line 27. Screen: step 7 ?step=review, "Counts" row ("3 with the reviewer", "0 notes open"). What is wrong: both chips still use `rounded-full`. The fix squared the History page chips (review-step.tsx:116, File history, ?history=1) instead of step 7. Why it matters: item 4 is not fixed on step 7. The two round chips sit beside the square "Not reviewed" and "Issues 4" tags, so one row mixes two chip shapes on a screen reviewers use on every file. Fix: remove `rounded-full` from both spans and keep the padding, matching the square TAG style in shell.tsx. Leave the History page change in place. Benchmark: Studio rule 3 (fixed status look); QuickBooks Online and TaxDome list chips; my second-run finding.
2. Risk, not a FAIL; check while the app is running. Where: /home/user/concept-firm-app/src/app/(app)/closebook/[id]/areas/tb-table.tsx lines 66-84. What could go wrong: the ResizeObserver watches the table box. Each time it runs, `fit()` first sets the box height to `first` and then, one frame later, to `first - over`. If `first` makes the page overflow (padding under the footer more than the 50 px allowance), each height change makes the observer run `fit()` again. The height would then flip between `first` and `first - over` every frame: the page keeps re-rendering and the footer flickers. A single 0 px reading can't rule this out. Why it matters: CPU use and a footer that jumps. Check: at each of the four sizes, count React renders, or log the box `style.maxHeight` over 2 seconds; it should settle on one value. If it flips, fix: keep the correction (the `over` amount) in a ref and use it in `first`, or stop the observer acting on the box's own height change. Source: React state and ResizeObserver feedback-loop behaviour.
CHECKED:
- Environment: localhost:3301, 3000 and 3300 not running; Supabase 127.0.0.1:54321 down; Docker daemon down. No browser runs possible; all checks below are from code and the compiled CSS.
- Build matches the fix: .next built 02:47 (commit 02:48:24); its compiled files contain "Scroll sideways for more columns" (server chunk) and `data-menu` (client chunks). PASS as far as files show.
- Item 1 (trial balance page does not scroll; headings stay visible): code sizes the box from its real top, then removes any page overflow when scrollY is 0; thead stays `sticky top-0` inside the box; FileShell is now min-h calc(100vh-56px). Logic sound; the four-size wheel test and elementFromPoint NOT RUN; loop risk in FOUND 2.
- Item 2 (sideways hint): the hint is in the footer, shown only when `wide` (scrollWidth > clientWidth + 1). Measured again on window resize and on box, table and footer resize, so the Compact button updates it. PASS in code; "shown at 1024 only" NOT RUN.
- Item 3 (net-note name below 1440): name built from "Not final" plus sr-only ", {netNote}". The ≥1440 long-text span is display:none below 1440, the dot is aria-hidden, so the name is "Not final, 15 accounts not yet assigned" and contains the visible words (WCAG 2.5.3). At ≥1440 the name is the visible note only. PASS in code.
- Item 4 (square chips): /documents chip square (documents/page.tsx:27) PASS; Entries area chips square (entries-area.tsx:60), no rounded chips left there or in entries-tab.tsx, PASS; step 7 ?step=review count chips still round, FAIL (FOUND 1).
- Item 5 (Sales menu): header focusout closes the open menu when focus goes to anything outside `[data-menu=<open>]`. Every toggle key (panel, sales, bell, help, gear, new, me) has a matching data-menu wrapper. Find buttons are outside every wrapper, so Tab from the Sales links to Find, Help, Settings or New closes it. Escape handler unchanged (closes, focuses opener). PASS in code; keyboard run NOT RUN.
- Item 6 (1439 px): compiled CSS shows `max-[1440px]` as `@media not all and (min-width:1440px)` and `min-[1440px]` as `(min-width:1440px)`, so no overlap or gap at 1439 or 1440. No `max-[1439px]` left under src/app/(app). Net note, People chip words (Preparer/Reviewer) and source text all use the pair. PASS in code; screenshot at 1439 NOT RUN.
- Earlier passes on these screens: top-bar diff adds only data-menu attributes and the onBlur rule (focus-ring classes unchanged); skip-link target nav#steps now tabIndex -1 (focus target, outline-none acceptable for a programmatic target); Sign buttons untouched; footer still ends "% change is worked out on the size of the balance." No break found in code; live NOT RUN.
