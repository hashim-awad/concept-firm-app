# Concept constants in the Closebook engine (CB2-0 version 7, Part 4 item 7)

List only, no changes (Hashim, Nov 21, 2026). Rule 12: no Concept constant in code; firm details, provinces, tax rates and
tax software become data or settings in a later phase. Found by searching src/lib/closebook, the Closebook pages and the
database functions on Nov 21, 2026. Comments that only credit a decision ("Hashim, Nov 16") are not listed.

## 1. Firm name, address, contact and signer
| What | Where |
|---|---|
| Firm name "Concept Accounting & Advisory Professional Corporation", footer "Registered with CPA Ontario" | src/lib/closebook/fs-text.ts:6, :7; fs-pdf.ts:7, :19; fs-docx.ts:6; wp-doc.ts:19, :217 |
| Firm address "675 Riverbend Dr., Kitchener, ON" and "Kitchener, Ontario" on the report | fs-text.ts:63; fs-pdf.ts:108, :109, :127, :128; fs-docx.ts:92, :93, :96 |
| Firm email and phone in the minute book letter and client email | fs-pdf.ts:151; fs-docx.ts:116; fs-email.ts:150, :177; client-wording.ts:66 |
| Signer "Hashim Awad, CPA" (minute book letter, client email, step 9 signer line) | fs-pdf.ts:151; fs-docx.ts:141; fs-email.ts:150, :177; src/app/(app)/closebook/[id]/statements-step.tsx:52, :54 |
| Firm wording in client question emails and links | questions-server.ts:4, :84, :90; client-questions-server.ts:25; src/app/(app)/closebook/question-actions.ts:17, :114, :173 |
| "Firm" vendor rules and standard entries named as Concept's | vendor.ts:8; src/app/(app)/admin/closebook/vendor-rules/view.tsx:6, :31, :32, :42; standard-entries/view.tsx:6, :36 |
| Report wording (CSRS 4200 compilation report, MAL, Note 1 "amortization equal to CCA") | fs-text.ts:18 to :60, :88; settings.ts:7 (NOTE1) |
| GIFI file header (preparer firm) | gifi.ts:106 |
| Package route letterhead | src/app/(app)/closebook/[id]/package/route.ts:58; close-server.ts:92, :97 |

## 2. Software Concept uses (tax software and practice tool as settings, rule 12)
| What | Where |
|---|---|
| ProFile (T2 tie-out wording, rounding to whole dollars, tax workpaper) | t2-step.tsx:66, :134 to :174; t2-actions.ts:30, :43; tax-workpaper/route.ts:58; steps.ts:98, :131; fs-email.ts:6; shell/help.tsx:30 to :33; shell.tsx:96; statements-area.tsx:95; entry-dialog.tsx:33; journal-form.tsx:35 (TJE "from ProFile") |
| TaxDome (delivery zip name, upload wording, new file import, history label) | close-server.ts:35; close-step.tsx:146 to :161; close/route.ts:15; close-actions.ts:65, :80; new/page.tsx:54, :70 to :72; fs-email.ts:146; history.ts:58; feed/notify-window.tsx:62, :98; shell/help.tsx:22, :23, :36 |
| QuickBooks Online account types and "Entries to record in QuickBooks" (client books) | wp-build.ts:38; entry-form-server.ts (QBO types); src/app/(app)/closebook/[id]/journal-form.tsx (QBO_TYPES) |

## 3. Standard chart account numbers in code (should come from the chart's own markers)
| Account | Where |
|---|---|
| 10900 Clearing | tb-build.ts:250, :255; database private.cb_clearing |
| 21500 GST/HST payable | gst-return.ts:162, :234; gst-server.ts:78, :88, :89; sales-tax.ts:49 |
| 21510 GST/HST instalments paid (marked in the chart; the code also names it) | gst-return.ts (GST_INSTALMENTS_ACCOUNT) |
| 23000, 23050 Due to shareholder | expenses.ts:95, :109; expenses-server.ts:89; fs-server.ts:83, :87 |
| 42400 quick method gain | gst-server.ts:12 |
| 60200 meals, 65100 office, 70600 vehicle (schedule defaults) | expenses-schedule.ts:9; home-office.ts:9; vehicle-schedule.ts:46, :48, :112; entry-form.ts:18, :86; entry-form-server.ts:45 |
| Report groupings by account | reports.ts:95, :170, :171; assign.ts:77, :80 |
| GIFI lines 3600, 3620, 3660, 3680, 3720, 3849, 2599, 9999 and the 36xx retained earnings logic | database private.cb_entry_write_lines, cb_obe, cb_save_opening, cb_set_opening, cb_step_problems; fs-model.ts:27 |

## 4. Province, sales tax codes and rates
| What | Where |
|---|---|
| Ontario as the default province, HST_ON and MEALS_HST_50 codes named in code | sales-tax.ts:49, :50; tb-build-server.ts:55, :142; feed-server.ts:138; expenses-schedule.ts:13; home-office.ts:27; vehicle-save.ts:33; cra-rates.ts:20 |
| Province lists and quick method provinces in database functions | cb_add_quick_province, cb_add_quick_rates, cb_save_itc_factor |
| Time zone America/Toronto (report and MAL dates, due dates) | fs-server.ts:19; close-server.ts:44, :53; wp-pdf.ts:22; database cb_send_mal, cb_mark_questions_sent, cb_question_link_*, cb_save_filing_record, cb_save_gst_filing, cb_open_checklist |

## 5. Figures set in code or in Settings
| What | Where |
|---|---|
| Instalment amount in the client email ($3,000 default; CRA's figure) | settings.ts:6, :13; close-server.ts (threshold) |
| Shareholder loan "repaid near year end" window (30 days default) | settings.ts:6, :13; sh-loans.ts:29; sh-server.ts:26, :45 |
| GST/HST due months (annual 3, period 1) | gst-server.ts (cb_settings gst_due_months_annual, gst_due_months_period) |
| Opening rounding under 1.00 (check 5, piece S2) | t2.ts:16, :50 |
| A year longer than 53 weeks refused | database cb_create_file |
| Vehicle per-km and ITC defaults read from the CRA rates tables (data, not code) | vehicle-server.ts:28; expenses.ts:23 |

## 6. Roles and wording tied to Concept's way of working
| What | Where |
|---|---|
| "Partner sign-off", "Review right", preparer and reviewer as Concept's roles | database cb_sign_step and the R3a-1 rights |
| Step names and the ten-step order (frozen, rule 15) | steps.ts |
