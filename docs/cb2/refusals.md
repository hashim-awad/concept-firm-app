# CloseBook2 refusals (CB2-0, PR 1)

Every refusal in the Closebook database functions after steps 2 to 5 of CB2-0, and the ones removed. Built from the local
database on Nov 21, 2026 (functions named cb_*). Rule 13: only four hard stops. Rule 7: no thresholds. Rule 14: a sign-off
is a person's act.

Marks: **Removed** (the refusal is gone), **Warning** (gone as a refusal; the step's problems list still names it),
**Kept** (hard stop, access, input, or integrity of a record), **Deferred** (PR 2), **To decide** (a business rule still
refusing: Hashim decides; a recommendation is given).

## Removed or Warning (steps 2 to 5)

| Function | Was refused | Now |
|---|---|---|
| Sign-offs (step 2) | Any change cleared, stamped or reopened sign-offs; MAL withdrawn on change | Removed. Sign-offs stay as signed; one History row per action |
| cb_save_opening, cb_set_first_year | Saving step 2 cleared "opening signed" | Removed |
| cb_unsign_step | Unsigning a step cleared later steps' review | Removed |
| cb_save_t2_tieout (step 3) | Needed the final GIFI export, all four figures and the PDF | Removed. Saves what is filled in |
| cb_sign_step, cb_sign_substep, cb_sign_opening | Open problems, Not yet lists, preparer first, step 5 same-person rule | Warning. Open items go into the sign-off's History row |
| cb_lock_file | Unsigned steps | Warning |
| cb_send_mal | Step 9 reviewed; date after year end | Warning |
| cb_record_delivery | Step 10 reviewed | Warning |
| cb_mark_booked, cb_booked_guard, cb_edit_entry, cb_delete_entry | Booked entries could not change | Warning (History records it) |
| cb_assign, cb_undo_assign | Step 4 signed; account waits for the reviewer | Removed |
| cb_map_account, cb_set_gifi_override | Waits for the reviewer; type mismatch; retained earnings lines | Warning |
| cb_clear_typed_step | Step signed; MAL out | Removed |
| cb_accept_t2_difference | Stale export | Removed |
| cb_record_gifi_export | Failed checks; unmatched accounts | Warning. Kept: no trial balance, trial balance out |
| cb_require_gst_answers | GST/HST answers before coding | Removed |
| cb_set_tax_code, cb_save_schedule_entry (Claim the ITC), cb_confirm_type | Reviewer only | Removed. Anyone with Edit |
| cb_entry_write_lines | Retained earnings / 31500 needs prior period reason; PPA needs a 31500 line; PPA never reverses | Removed |
| cb_save_checklist | MAL signed first; a No needs a note | Removed |
| cb_answer_year_change | A yes needs a note | Warning |
| cb_accept_revenue_difference, cb_review_new_account | Preparer first | Removed |
| cb_set_book_amortization | Amortization = CCA | Removed. The function says it is retired |
| bank feed (cb_recode_lines) | A posted line could not change in place | Removed. Change in place |
| step 6 flags (step 5) | $5,000 and 20% change flag | Removed |
| cb_add_entry, cb_add_personal_expenses | $5,000 entry review amount | Removed |
| cb_add_personal_expenses | Over $5,000 needs receipts | Removed |
| revenue, T4A, GST/HST checks | Review threshold: reviewer must accept | Removed. Every difference is explained in one line; the reviewer may accept |
| cb_gst_problems (21500) | Over the threshold the reviewer accepts; under it a note | One rule: a note or the reviewer's acceptance, any size (warning) |
| cb_post_lines, cb_accept_transfer | Transfer dates within 7 or 5 days | Removed. Suggestions still look within 7 days |
| step 3 outstanding items picker | First 90 days of the year only | Removed |
| Settings | Outstanding items $5,000, flag $5,000 / 20%, entry review $5,000, capital invoice $5,000 | Removed from Settings. Columns kept, not read |

## Kept: hard stop (unbalanced entry) (4)

| Function | Message |
|---|---|
| private.cb_entry_write_lines | The entry does not balance: it is out by %s. |
| public.cb_build_tb | The built trial balance does not balance (out by %s). |
| public.cb_import_tb | The trial balance does not balance: debits %s, credits %s, difference %s. |
| public.cb_record_gifi_export | Export refused. The trial balance is out by %s. |

## Kept: hard stop (total line) (3)

| Function | Message |
|---|---|
| private.cb_entry_write_lines | Entries cannot post to a total line. |
| public.cb_save_opening | %s is a total: it calculates by itself. |
| public.cb_update_master_line | A total line is calculated: only its name and note can change. |

## Kept: hard stop (locked file or period) (99)

The compilation report has no date until the MAL is signed (the report date is the MAL's signing date), so the fourth hard stop is built into the report, not a refusal.

| Function | Message |
|---|---|
| private.cb_add_statement | This file is locked. |
| private.cb_entry_head_check | This file is locked. |
| private.cb_entry_write_lines | This line is locked because it has sub-lines. Choose one of its sub-lines. |
| private.cb_file_open | This file is locked or missing. |
| private.cb_locked_guard | This file is locked. Someone with the Lock and unlock right can reopen it. |
| public.cb_accept_gst_check | This file is locked or missing. |
| public.cb_accept_sh_flag | This file is locked or missing. |
| public.cb_accept_transfer | This file is locked or missing. |
| public.cb_acceptance_confirm_client | This file is locked or missing. |
| public.cb_acceptance_same_as_last | This file is locked. |
| public.cb_add_note | This file is locked or missing. |
| public.cb_add_outstanding | This file is locked. |
| public.cb_add_personal_expenses | This file is locked or missing. |
| public.cb_add_revenue_check | This file is locked or missing. |
| public.cb_add_revenue_source | This file is locked or missing. |
| public.cb_answer_sh_flag | This file is locked or missing. |
| public.cb_answer_year_change | This file is locked or missing. |
| public.cb_apply_matching | This file is locked. |
| public.cb_ask_client | This file is locked. |
| public.cb_assign | This file is locked. |
| public.cb_build_tb | This file is locked or missing. |
| public.cb_clear_typed_step | This file is locked. Nothing was cleared. |
| public.cb_code_lines | This file is locked or missing. |
| public.cb_confirm_gst_entry | This file is locked or missing. |
| public.cb_confirm_new_account | This file is locked or missing. |
| public.cb_confirm_sh_repaid | This file is locked or missing. |
| public.cb_confirm_side | This file is locked or the account is gone. |
| public.cb_confirm_type | This file is locked. |
| public.cb_delete_entry | This file is locked. Reopen it to delete entries. |
| public.cb_edit_entry | This file is locked. Reopen it to change entries. |
| public.cb_exclude_statement | This file is locked. |
| public.cb_explain_flag | This file is locked. |
| public.cb_feed_unlock | This file is locked. |
| public.cb_import_account_list | This file is locked. |
| public.cb_import_tb | This file is locked. |
| public.cb_keep_line_move | This file is locked. |
| public.cb_lock_file | This file is already locked. |
| public.cb_map_account | This file is locked. |
| public.cb_map_account | This line is locked because it has sub-lines. Choose one of its sub-lines. |
| public.cb_mark_booked | This file is locked. Reopen it to change entries. |
| public.cb_note_sh_due | This file is locked or missing. |
| public.cb_pick_chart_account | This file is locked. |
| public.cb_prepare_gst_return | This file is locked or missing. |
| public.cb_prepare_sh_schedule | This file is locked or missing. |
| public.cb_purge_statement | This file is locked. |
| public.cb_record_delivery | This file is locked or missing. |
| public.cb_record_gifi_export | This file is locked or missing. |
| public.cb_remove_bank_account | This file is locked. |
| public.cb_remove_outstanding | This file is locked. |
| public.cb_remove_revenue_source | This file is locked or the source is gone. |
| public.cb_reopen_file | This file is not locked. |
| public.cb_reopen_file | You need the Lock and unlock right to reopen a locked file. |
| public.cb_replace_statement_file | This file is locked. |
| public.cb_restore_statement | This file is locked. |
| public.cb_review_new_account | This file is locked or missing. |
| public.cb_review_year_change | This file is locked or missing. |
| public.cb_save_acceptance | This file is locked or missing. |
| public.cb_save_bank_account | This file is locked. |
| public.cb_save_checklist | This file is locked or missing. |
| public.cb_save_close_fields | This file is locked or missing. |
| public.cb_save_expense_line_account | This file is locked or missing. |
| public.cb_save_filing_record | This file is locked or missing. |
| public.cb_save_fs_fields | This file is locked or missing. |
| public.cb_save_gst_check | This file is locked or missing. |
| public.cb_save_gst_filing | This file is locked or missing. |
| public.cb_save_gst_revenue_note | This file is locked or missing. |
| public.cb_save_opening | This file is locked or missing. |
| public.cb_save_opening_s125 | This file is locked or missing. |
| public.cb_save_revenue_check | This file is locked or missing. |
| public.cb_save_setup | This file is locked. |
| public.cb_save_t2_tieout | This file is locked or missing. |
| public.cb_save_tb_opening_re | This file is locked. |
| public.cb_seen_unused | This file is locked or missing. |
| public.cb_send_mal | This file is locked or missing. |
| public.cb_send_to_reviewer | This file is locked. |
| public.cb_set_bank_coverage | This file is locked. |
| public.cb_set_first_year | This file is locked or missing. |
| public.cb_set_gifi_override | This file is locked. |
| public.cb_set_gifi_override | This line is locked because it has sub-lines. Choose one of its sub-lines. |
| public.cb_set_line_date | This file is locked. |
| public.cb_set_line_locked | Only a line with sub-lines can be locked: staff need a sub-line to choose instead. |
| public.cb_set_line_memo | This file is locked. |
| public.cb_set_not_ours | This file is locked. |
| public.cb_set_opening | This file is locked or missing. |
| public.cb_set_people | This file is locked or missing. |
| public.cb_set_sh_name | This file is locked or missing. |
| public.cb_set_sh_owner | This file is locked or missing. |
| public.cb_set_tax_code | This file is locked. |
| public.cb_sign_opening | This file is locked or missing. |
| public.cb_sign_step | This file is locked or missing. |
| public.cb_sign_substep | This file is locked or missing. |
| public.cb_skip_statement | This file is locked. |
| public.cb_unassign_all | This file is locked. |
| public.cb_uncode_lines | This file is locked. |
| public.cb_undo_assign | This file is locked. |
| public.cb_undo_transfer | This file is locked. |
| public.cb_unsign_step | This file is locked or missing. |
| public.cb_unsign_substep | This file is locked or missing. |
| public.cb_upload_bank | This file is locked. |

## Deferred to PR 2 (step 6) (5)

| Function | Message | Recommendation |
|---|---|---|
| private.cb_entry_write_lines | %s: last year's balance is already moved to retained earnings by another entry. | Becomes a warning with the Reclass checkbox work. |
| private.cb_entry_write_lines | A reclassifying entry (RJE) cannot change the result. Use an AJE. | The Reclass checkbox replaces RJE rules; no rule depends on it (rule 5). |
| private.cb_entry_write_lines | After this entry, retained earnings at the start must equal last year's closing retained earnings in step 2: %s and %s. | Becomes a warning with the Reclass checkbox work. |
| private.cb_entry_write_lines | The entry must clear Opening Balance Equity to nil. | Becomes a warning with the Reclass checkbox work. |
| private.cb_entry_write_lines | The entry must move %s's balance from last year exactly: last year %s, this entry %s. | Becomes a warning with the Reclass checkbox work. |

## To decide (6)

| Function | Message | Recommendation |
|---|---|---|
| private.cb_add_statement | This statement is outside the year: it is not needed. | Recommended: warning. The user may want the statement on file. |
| private.cb_entry_head_check | Only an accrual reverses next year. | Recommended: remove. QBO lets any journal entry reverse. |
| private.cb_entry_write_lines | Post to a sub-account, not to its parent. | Recommended: remove. QBO lets you post to a parent account. |
| public.cb_add_outstanding | Rounding is only for a difference left under 1.00. | Recommended: remove (rule 7, a threshold). |
| public.cb_keep_line_move | The reviewer decides. | Recommended: remove (reviewer-only rule missed in step 4). |
| public.cb_save_checklist | Question 9 cannot be Not applicable: step 1 says we are not independent of the client. | Recommended: keep. CSRS 4200 independence: the answer must match step 1. |

## Kept: access (160)

Rights (Edit on Closebook, the Review right, Admin). A reviewer's own act (accept a difference, mark reviewed, a review note, sign as reviewer) stays with the person who has the Review right, as a sign-off does (rule 14.3).

| Function | Message |
|---|---|
| private.cb_file_open | You need Edit on Closebook to code transactions. |
| private.cb_file_people | The preparer needs Closebook Edit and the Prepare right (Settings, Team and roles). |
| private.cb_file_people | The reviewer needs the Review right (Settings, Team and roles). |
| private.cb_q_unsent | You need Edit on Closebook. |
| private.cb_quick_rate_guard | Only an Admin can approve or retire a quick method rate. |
| public.cb_accept_gst_check | Only the reviewer accepts a GST/HST difference. Reviewers need the Review right. |
| public.cb_accept_revenue_difference | Only the reviewer accepts a revenue difference. Reviewers need the Review right. |
| public.cb_accept_sh_flag | Only the reviewer accepts a shareholder loan flag. Reviewers need the Review right. |
| public.cb_accept_t2_difference | Only the reviewer accepts a difference. Reviewers need the Review right. |
| public.cb_accept_transfer | You need Edit on Closebook to code transactions. |
| public.cb_acceptance_confirm_client | You need Edit on Closebook. |
| public.cb_acceptance_same_as_last | You need Edit on Closebook. |
| public.cb_add_entry | You need Edit on Closebook to add entries. |
| public.cb_add_note | Only the reviewer adds review notes. Reviewers need the Review right. |
| public.cb_add_outstanding | You need Edit on Closebook. |
| public.cb_add_personal_expenses | You need Edit on Closebook. |
| public.cb_add_quick_province | Only an Admin adds a province. |
| public.cb_add_quick_rates | Only an Admin adds quick method rates. |
| public.cb_add_revenue_check | You need Edit on Closebook. |
| public.cb_add_revenue_source | You need Edit on Closebook. |
| public.cb_add_sub_line | Only an Admin can add GIFI lines. |
| public.cb_answer_sh_flag | You need Edit on Closebook. |
| public.cb_answer_year_change | You need Edit on Closebook. |
| public.cb_apply_matching | You need Edit on Closebook to match accounts. |
| public.cb_approve_quick_rates | Only an Admin can approve quick method rates. |
| public.cb_ask_client | You need Edit on Closebook. |
| public.cb_assign | You need Edit on Closebook to assign accounts. |
| public.cb_build_tb | You need Edit on Closebook. |
| public.cb_clear_note | Only the reviewer clears or reopens a review note. |
| public.cb_clear_typed_step | You need Edit on Closebook. |
| public.cb_close_status | You need Closebook access. |
| public.cb_code_lines | You need Edit on Closebook to code transactions. |
| public.cb_confirm_gst_entry | You need Edit on Closebook. |
| public.cb_confirm_new_account | You need Edit on Closebook. |
| public.cb_confirm_sh_repaid | Only the reviewer confirms "Repaid by". Reviewers need the Review right. |
| public.cb_confirm_side | Only the reviewer keeps a balance on this side. Reviewers need the Review right. |
| public.cb_confirm_type | You need Edit on Closebook. |
| public.cb_create_file | You need Edit on Closebook to start a file. |
| public.cb_decide_quick_credit | Only an Admin can approve the quick method credit. |
| public.cb_delete_entry | You need Edit on Closebook. |
| public.cb_delete_firm_vendor_rule | Only an Admin can change firm vendor rules. |
| public.cb_delete_standard_entry | Only an Admin can change standard entries. |
| public.cb_drop_imported_rows | You need Edit on Closebook. |
| public.cb_edit_entry | You need Edit on Closebook. |
| public.cb_entry_last_change | You need View on Closebook. |
| public.cb_exclude_statement | You need Edit on Closebook. |
| public.cb_excluded_key_of | You need Closebook. |
| public.cb_excluded_reviewed | Only the reviewer ticks this. |
| public.cb_explain_flag | You need Edit on Closebook. |
| public.cb_feed_unlock | You need Edit on Closebook. |
| public.cb_flag_uploaded_duplicates | You need Edit on Closebook. |
| public.cb_fs_status | You need Closebook access. |
| public.cb_import_account_list | You need Edit on Closebook to import. |
| public.cb_import_csv | You need Edit on Closebook. |
| public.cb_import_tb | You need Edit on Closebook to import. |
| public.cb_keep_line_move | You need Edit on Closebook. |
| public.cb_lock_file | You need the Lock and unlock right to lock a file. |
| public.cb_map_account | You need Edit on Closebook to match accounts. |
| public.cb_mark_booked | You need Edit on Closebook. |
| public.cb_mark_replacement | You need Edit on Closebook. |
| public.cb_match_state | You need Closebook access. |
| public.cb_my_saved_questions | You need Closebook. |
| public.cb_note_sh_due | Only the reviewer notes the repay-by date. Reviewers need the Review right. |
| public.cb_pick_chart_account | You need Edit on Closebook. |
| public.cb_prepare_gst_return | You need Edit on Closebook. |
| public.cb_prepare_sh_schedule | You need Edit on Closebook. |
| public.cb_purge_statement | Only an Admin can purge. |
| public.cb_recode_lines | You need Edit on Closebook. |
| public.cb_record_delivery | You need Edit on Closebook. |
| public.cb_record_gifi_export | You need Edit on Closebook. |
| public.cb_remove_bank_account | You need Edit on Closebook. |
| public.cb_remove_outstanding | You need Edit on Closebook. |
| public.cb_remove_revenue_source | You need Edit on Closebook. |
| public.cb_replace_statement_file | This file doesn't match the imported statement. To change its lines, exclude it and upload the right one. |
| public.cb_replace_statement_file | You need Edit on Closebook. |
| public.cb_reply_note | You need Edit on Closebook. |
| public.cb_resplit_line | You need Edit on Closebook. |
| public.cb_restore_statement | Not restored: %s (%s to %s) is now imported for this period. Exclude it first if this one is right. |
| public.cb_restore_statement | You need Edit on Closebook. |
| public.cb_revenue_status | You need Closebook access. |
| public.cb_review_account | Only the file's reviewer or someone with the Review right marks an account reviewed. |
| public.cb_review_account | You need Edit on Closebook. |
| public.cb_review_lines | Only the file's reviewer or someone with the Review right marks a line reviewed. |
| public.cb_review_lines | You need Edit on Closebook. |
| public.cb_review_new_account | Only the reviewer marks it reviewed. Reviewers need the Review right. |
| public.cb_review_year_change | Only the reviewer marks it reviewed. Reviewers need the Review right. |
| public.cb_save_acceptance | You need Edit on Closebook. |
| public.cb_save_bank_account | You need Edit on Closebook. |
| public.cb_save_checklist | You need Edit on Closebook. |
| public.cb_save_close_fields | You need Edit on Closebook. |
| public.cb_save_expense_line_account | You need Edit on Closebook. |
| public.cb_save_filing_record | You need Edit on Closebook. |
| public.cb_save_firm_vendor_rule | Only an Admin can change firm vendor rules. |
| public.cb_save_fs_fields | You need Edit on Closebook. |
| public.cb_save_gst_check | You need Edit on Closebook. |
| public.cb_save_gst_filing | You need Edit on Closebook. |
| public.cb_save_gst_revenue_note | You need Edit on Closebook. |
| public.cb_save_itc_factor | Only an Admin can change the CRA rates. |
| public.cb_save_km_rates | Only an Admin can change the CRA rates. |
| public.cb_save_opening | You need Edit on Closebook. |
| public.cb_save_opening_s125 | You need Edit on Closebook. |
| public.cb_save_revenue_check | You need Edit on Closebook. |
| public.cb_save_schedule_entry | You need Edit on Closebook to add entries. |
| public.cb_save_setup | You need Edit on Closebook. |
| public.cb_save_standard_entry | Only an Admin can change standard entries. |
| public.cb_save_standard_entry_line | Only Admins change standard entries. |
| public.cb_save_t2_tieout | You need Edit on Closebook. |
| public.cb_save_tb_opening_re | You need Edit on Closebook. |
| public.cb_save_vendor_rule | You need Edit on Closebook. |
| public.cb_saved_question_add | You need Closebook. |
| public.cb_schedule_printed | You need View on Closebook. |
| public.cb_seen_unused | You need Edit on Closebook. |
| public.cb_send_mal | You need Edit on Closebook. |
| public.cb_send_to_reviewer | You need Edit on Closebook. |
| public.cb_set_bank_chart_account | You need Edit on Closebook. |
| public.cb_set_bank_coverage | You need Edit on Closebook. |
| public.cb_set_first_year | You need Edit on Closebook. |
| public.cb_set_gifi_override | You need Edit on Closebook. |
| public.cb_set_line_date | You need Edit on Closebook. |
| public.cb_set_line_locked | Only an Admin can change GIFI lines. |
| public.cb_set_line_memo | You need Edit on Closebook. |
| public.cb_set_not_ours | You need Edit on Closebook. |
| public.cb_set_opening | You need Edit on Closebook. |
| public.cb_set_opening_pdf | You need Edit on Closebook. |
| public.cb_set_people | %s does not have the Review right. |
| public.cb_set_people | Only an Admin changes the preparer and reviewer. |
| public.cb_set_quick_credit | Only an Admin changes the quick method credit. |
| public.cb_set_quick_rate_status | Only an Admin can approve or retire a quick method rate. |
| public.cb_set_review_treatment | Only the reviewer sets the treatment. Reviewers need the Review right. |
| public.cb_set_sh_name | You need Edit on Closebook. |
| public.cb_set_sh_owner | You need Edit on Closebook. |
| public.cb_set_tax_code | You need Edit on Closebook. |
| public.cb_sh_status | You need View on Closebook. |
| public.cb_sign_opening | You need Edit on Closebook. |
| public.cb_sign_step | You need Edit on Closebook. |
| public.cb_sign_step | You need the Prepare right to sign as preparer. |
| public.cb_sign_step | You need the Review right to sign as reviewer. |
| public.cb_sign_substep | You need Edit on Closebook. |
| public.cb_sign_substep | You need the Prepare right to sign as preparer. |
| public.cb_sign_substep | You need the Review right to sign as reviewer. |
| public.cb_skip_statement | You need Edit on Closebook. |
| public.cb_statement_target | You need Edit on Closebook. |
| public.cb_step_status | You need Closebook access. |
| public.cb_substep_status | You need Closebook access. |
| public.cb_t2_status | You need Closebook access. |
| public.cb_unassign_all | You need Edit on Closebook to assign accounts. |
| public.cb_uncode_lines | You need Edit on Closebook. |
| public.cb_undo_assign | You need Edit on Closebook to assign accounts. |
| public.cb_undo_transfer | You need Edit on Closebook. |
| public.cb_unreview_lines | Only the file's reviewer or someone with the Review right puts the flag back. |
| public.cb_unreview_lines | You need Edit on Closebook. |
| public.cb_unsign_step | You need Edit on Closebook. |
| public.cb_unsign_substep | You need Edit on Closebook. |
| public.cb_update_gst_settings | Only an Admin changes the GST/HST settings. |
| public.cb_update_instalment_threshold | Only an Admin changes thresholds. |
| public.cb_update_master_line | Only an Admin can change GIFI lines. |
| public.cb_update_settings | Only an Admin can change Closebook settings. |
| public.cb_update_sh_window | Only an Admin changes thresholds. |
| public.cb_update_t2_rounding | Only an Admin changes thresholds. |
| public.cb_upload_bank | You need Edit on Closebook to upload. |

## Kept: input (234)

Input that cannot be read or is missing. Sorted by a word search.

| Function | Message |
|---|---|
| private.cb_add_statement | Choose an account on this file. |
| private.cb_add_statement | Enter the statement period: the first and last day the statement covers. |
| private.cb_add_statement | Enter the statement's opening and closing balances. |
| private.cb_add_statement | File not found. |
| private.cb_add_statement | The statement has no lines, or too many. |
| private.cb_entry_head_check | An entry needs at least two lines. |
| private.cb_entry_head_check | The entry date must fall in the file's year. |
| private.cb_entry_head_check | Up to 10 attachments. |
| private.cb_entry_write_lines | Choose an account from the standard chart. |
| private.cb_entry_write_lines | Choose one of the client's accounts, or name a new account for their books. |
| private.cb_entry_write_lines | Choose the master account for the new account. |
| private.cb_entry_write_lines | Choose the new account's QuickBooks account type. |
| private.cb_entry_write_lines | Enter last year's closing retained earnings in step 2 first. |
| private.cb_entry_write_lines | Name the new account in plain words, for example "Amortization expense". |
| private.cb_entry_write_lines | Several of the client's accounts are on master account %s %s: choose the one entries take (step 4, open the master account). |
| private.cb_line_readonly | The bank's own data on a line (date, description, amount) cannot change after import. |
| private.cb_q_unsent | Question not found. |
| private.cb_question_link_go | Link not found. |
| private.cb_quick_rate_guard | An approved rate cannot be changed. Add a new rate and retire this one. |
| public.cb_accept_gst_check | There is no GST/HST difference to accept. |
| public.cb_accept_revenue_difference | Nothing to accept: there is no difference. |
| public.cb_accept_sh_flag | Pick the year the amount is included in the shareholder's income. |
| public.cb_accept_sh_flag | Say why the amount is not included. |
| public.cb_accept_sh_flag | Say why the flag is accepted. |
| public.cb_accept_sh_flag | There is no such flag. Click Update first. |
| public.cb_accept_t2_difference | Nothing to accept on this line. |
| public.cb_accept_transfer | Choose two lines. |
| public.cb_accept_transfer | Line not found. |
| public.cb_accept_transfer | One line must be money out and the other money in. |
| public.cb_accept_transfer | The two amounts must be the same to the cent. |
| public.cb_add_entry | Entry number %s-%s is taken. Choose another. |
| public.cb_add_entry | That standard entry is gone. Choose another. |
| public.cb_add_line_file | Line not found. |
| public.cb_add_line_file | Up to 10 files on a line. |
| public.cb_add_note | Unknown note target. |
| public.cb_add_outstanding | Account not found. |
| public.cb_add_outstanding | Enter the amount as a positive number with up to 2 decimals. |
| public.cb_add_outstanding | Enter the date of the item. |
| public.cb_add_outstanding | The line that cleared it must be for the same amount. |
| public.cb_add_outstanding | The line that cleared it must be on this account. |
| public.cb_add_personal_expenses | %s: add a note saying what it is. |
| public.cb_add_personal_expenses | %s: choose one of %s. |
| public.cb_add_personal_expenses | %s: choose the account. |
| public.cb_add_personal_expenses | Attach the client's sheet as the source. |
| public.cb_add_personal_expenses | The "Expenses paid personally" standard entry is missing. |
| public.cb_add_personal_expenses | The lines add up to %s, not the Summary total of %s. Check the amounts typed. |
| public.cb_add_personal_expenses | Type the amounts from the Summary. |
| public.cb_add_quick_rates | %s: enter the services rate, the goods for resale rate, or both. |
| public.cb_add_quick_rates | Enter the date you read the rates on the CRA page (today or before). |
| public.cb_add_revenue_source | Type the total from the report. |
| public.cb_add_sub_line | Choose a line staff can map to. |
| public.cb_answer_year_change | Keep the note to 300 characters. |
| public.cb_ask_questions | Choose the lines. |
| public.cb_ask_questions | Type the question: 400 characters at most. |
| public.cb_assign | Choose a master account. |
| public.cb_assign | Choose at least one account. |
| public.cb_assign | File not found. |
| public.cb_build_tb | Rows are missing. |
| public.cb_clear_note | Say what is still needed. |
| public.cb_clear_note | This note is cleared or missing. |
| public.cb_clear_splits | Line not found. |
| public.cb_clear_typed_step | File not found. |
| public.cb_clear_typed_step | Unknown step. |
| public.cb_client_answer | This question is already answered. |
| public.cb_code_lines | Choose a sales tax code for every line. Nothing was saved. |
| public.cb_code_lines | Choose an account from the standard chart. |
| public.cb_code_lines | Line not found. |
| public.cb_code_lines | Nothing to code. |
| public.cb_code_lines | Unknown sales tax code. |
| public.cb_confirm_new_account | Choose a group for the account first. |
| public.cb_confirm_sh_repaid | The books changed. Click Update first. |
| public.cb_confirm_sh_repaid | There is no balance owed at the start of the year to confirm. |
| public.cb_confirm_type | Account not found. |
| public.cb_confirm_type | Keep the reason to 300 characters. |
| public.cb_confirm_type | This account's type matches its GIFI line: there is nothing to confirm. |
| public.cb_confirm_type | Type the reason for keeping this account on a line of another type. |
| public.cb_create_file | Choose a company from the client list. |
| public.cb_create_file | Choose an active preparer and reviewer. |
| public.cb_delete_entry | Entry not found. |
| public.cb_edit_entry | Entry not found. |
| public.cb_edit_entry | Entry number %s-%s is taken. Choose another. |
| public.cb_exclude_statement | Statement not found, or already excluded. |
| public.cb_explain_flag | Account not found. |
| public.cb_fill_lines | Choose an account from the chart. |
| public.cb_fill_lines | Choose another of this file's accounts. |
| public.cb_fill_lines | Line not found. |
| public.cb_fill_lines | Nothing to save. |
| public.cb_fill_lines | Unknown sales tax code. |
| public.cb_import_account_list | File not found. |
| public.cb_import_account_list | The Account List has no accounts, or too many. |
| public.cb_import_csv | File not found. |
| public.cb_import_statement | Choose an account for at least one statement. |
| public.cb_import_tb | File not found. |
| public.cb_import_tb | The file has no accounts, or too many. |
| public.cb_keep_line_move | Account not found. |
| public.cb_lock_file | This file is missing. |
| public.cb_map_account | Account not found. |
| public.cb_map_account | Choose a GIFI line staff can match to (totals are calculated). |
| public.cb_mark_booked | Entry not found. |
| public.cb_mark_questions_sent | Enter the date they were sent. |
| public.cb_mark_replacement | Statement not found. |
| public.cb_note_sh_due | The books changed. Click Update first. |
| public.cb_pair_choice | Line not found. |
| public.cb_pick_chart_account | Choose a client account on that master account. |
| public.cb_pick_chart_account | Choose a sub-account, not its parent. |
| public.cb_post_lines | Choose a sales tax code for every line. Nothing was posted. |
| public.cb_post_lines | Choose an account for every line. Nothing was posted. |
| public.cb_post_lines | Choose another of this file's accounts. |
| public.cb_post_lines | Line not found. |
| public.cb_post_lines | Nothing to post. |
| public.cb_post_lines | One line must be money out and the other money in. |
| public.cb_post_lines | The other line was not found. |
| public.cb_post_lines | The split rows must add up to the line. Nothing was posted. |
| public.cb_post_lines | The two amounts must be the same to the cent. |
| public.cb_post_lines | Unknown action. |
| public.cb_prepare_gst_return | Instalments paid: type the amount from the CRA account, 0 or more. |
| public.cb_prepare_gst_return | The return could not be worked out. |
| public.cb_prepare_sh_schedule | Decided amounts, last year's part and this year's part add up to the balance owed at year end. |
| public.cb_prepare_sh_schedule | The schedule could not be worked out. |
| public.cb_purge_statement | Excluded statement not found. |
| public.cb_question_edit | Type the question: 400 characters at most. |
| public.cb_question_link_cancel | Link not found. |
| public.cb_question_link_create | Enter the reply-by date. |
| public.cb_question_link_create | No open questions to send. |
| public.cb_question_link_create | Up to 10 contacts. |
| public.cb_question_link_failed | Link not found. |
| public.cb_reclassify | Choose a sales tax code from the list. |
| public.cb_reclassify | Choose an account from the chart. |
| public.cb_reclassify | Choose an account, a sales tax code, or both. |
| public.cb_reclassify | Choose one of this file's accounts. |
| public.cb_reclassify | Entry line not found. Nothing was changed. |
| public.cb_reclassify | Line not found. |
| public.cb_reclassify | Line not found. Nothing was changed. |
| public.cb_reclassify | Nothing to change: the ticked lines already have this account and sales tax. |
| public.cb_reclassify_undo | Not found. |
| public.cb_recode_lines | Choose a sales tax code for every line. Nothing was changed. |
| public.cb_recode_lines | Choose an account for every line. Nothing was changed. |
| public.cb_recode_lines | Choose the lines. |
| public.cb_recode_lines | Line not found. |
| public.cb_remove_bank_account | Account not found. |
| public.cb_remove_outstanding | Item not found. |
| public.cb_replace_statement_file | Statement not found. |
| public.cb_reply_note | This note is cleared or missing. |
| public.cb_resplit_line | Line %s: choose a sales tax code. |
| public.cb_resplit_line | Line %s: choose an account. |
| public.cb_resplit_line | Line %s: enter an amount. |
| public.cb_resplit_line | Line not found. |
| public.cb_restore_statement | Excluded statement not found. |
| public.cb_review_account | Account not found. |
| public.cb_review_year_change | Only a "yes" answer is marked reviewed. |
| public.cb_rule_action | Rule not found. |
| public.cb_rule_action | Unknown action. |
| public.cb_save_bank_account | Account not found. |
| public.cb_save_bank_account | Choose last year's T2 line from the balance sheet lines in step 2. |
| public.cb_save_bank_account | Choose the type: chequing, savings, credit card, line of credit or loan. |
| public.cb_save_bank_account | Enter the balance as a positive number with up to 2 decimals. |
| public.cb_save_bank_account | Enter the bank, for example RBC. |
| public.cb_save_bank_account | Enter the last digits of the account or card, as printed on the statement. |
| public.cb_save_bank_account | File not found. |
| public.cb_save_checklist | Answers are missing. |
| public.cb_save_checklist | Unknown checklist question. |
| public.cb_save_expense_line_account | Choose an account from the standard chart. |
| public.cb_save_expense_line_account | Choose one of the client's accounts. |
| public.cb_save_expense_line_account | Unknown line. |
| public.cb_save_filing_record | The T183CORP signed date cannot be in the future. |
| public.cb_save_firm_vendor_rule | Choose an account from the standard chart. |
| public.cb_save_gst_filing | The filing date cannot be in the future. |
| public.cb_save_gst_revenue_note | Keep the note to one line (200 characters). |
| public.cb_save_itc_factor | The top number must be more than 0 and smaller than the bottom number, for example 13/113. |
| public.cb_save_itc_factor | Type the factor as two whole numbers with a slash, for example 13/113. |
| public.cb_save_km_rates | %s is not in the table. Add it first. |
| public.cb_save_km_rates | Fill in all four rates. |
| public.cb_save_km_rates | Type the year as four digits, for example 2026. |
| public.cb_save_opening | Lines are missing. |
| public.cb_save_opening_s125 | Nothing to save. |
| public.cb_save_rule | Add one to five conditions. |
| public.cb_save_rule | Choose an account from the chart. |
| public.cb_save_rule | Choose the sales tax. |
| public.cb_save_rule | Rule not found. |
| public.cb_save_schedule_entry | Entry not found. |
| public.cb_save_schedule_entry | File not found. |
| public.cb_save_setup | Answers are missing. |
| public.cb_save_setup | File not found. |
| public.cb_save_setup | Unknown question %s. |
| public.cb_save_splits | Line %s: choose a sales tax code. |
| public.cb_save_splits | Line %s: choose an account. |
| public.cb_save_splits | Line %s: enter an amount. |
| public.cb_save_splits | Line not found. |
| public.cb_save_standard_entry | Choose two different accounts. |
| public.cb_save_standard_entry_line | Choose one of %s. |
| public.cb_save_standard_entry_line | Unknown line. |
| public.cb_save_tb_opening_re | Type the amount as printed on the T2. |
| public.cb_save_vendor_rule | Choose an account from the standard chart. |
| public.cb_save_vendor_rule | File not found. |
| public.cb_schedule_printed | Schedule not found. |
| public.cb_set_bank_coverage | Account not found. |
| public.cb_set_bank_coverage | The closing date must be inside the year. |
| public.cb_set_bank_coverage | The opening date must be inside the year. |
| public.cb_set_client_answer | Line not found. |
| public.cb_set_gifi_override | Account not found. |
| public.cb_set_gifi_override | Choose a GIFI line staff can match to (totals are calculated). |
| public.cb_set_line_date | Line not found. |
| public.cb_set_line_locked | Line not found. |
| public.cb_set_line_memo | Keep the internal note under 2,000 characters. |
| public.cb_set_line_memo | Line not found. |
| public.cb_set_opening | Enter last year's retained earnings at the end of the year (GIFI 3849, from last year's T2). |
| public.cb_set_people | Choose an active staff member as preparer. |
| public.cb_set_quick_credit | Enter the date you read the credit on the CRA page (today or before). |
| public.cb_set_quick_rate_status | Rate not found. |
| public.cb_set_review_treatment | File not found. |
| public.cb_set_sh_name | Keep the name to 120 characters. |
| public.cb_set_sh_owner | Pick shareholder 1 to 9. |
| public.cb_set_tax_code | Account not found. |
| public.cb_set_tax_code | Unknown tax code. |
| public.cb_skip_statement | Statement not found. |
| public.cb_statement_target | Choose an account on this file. |
| public.cb_undo_assign | Nothing to undo. |
| public.cb_unsign_step | There is no preparer sign-off of yours to take back. |
| public.cb_unsign_step | There is no reviewer sign-off of yours to take back. |
| public.cb_unsign_substep | There is no preparer sign-off of yours to take back. |
| public.cb_unsign_substep | There is no reviewer sign-off of yours to take back. |
| public.cb_update_gst_settings | Due dates: a number of months from 1 to 12. |
| public.cb_update_instalment_threshold | Instalment threshold: a number from 0 to 1,000,000. |
| public.cb_update_master_line | Line not found. |
| public.cb_update_sh_window | Shareholder loan repayment window: a number of days from 1 to 365. |
| public.cb_update_t2_rounding | Rounding allowed in the T2 tie-out: a number from 0 to 1,000. |
| public.cb_upload_bank | An account with that name is already on this file. Choose it from the list. |
| public.cb_upload_bank | Choose an account on this file. |
| public.cb_upload_bank | Enter the statement period: the first and last day the statement covers. |
| public.cb_upload_bank | Enter the statement's opening and closing balances. |
| public.cb_upload_bank | File not found. |
| public.cb_upload_bank | Monthly files confirm bank and cards in QuickBooks; there is nothing to upload. |
| public.cb_upload_bank | Name the account (for example "TD chequing 1234"). |
| public.cb_upload_bank | The file has no transactions, or too many. |

## Kept: integrity or state (150)

The record stays true: imported bank data, an append-only History, something already done or not there, a double count. Not a business rule. Sorted by a word search, so some may be misplaced; the reviews check them.

| Function | Message |
|---|---|
| private.cb_add_statement | Every amount has at most 2 decimals. |
| private.cb_add_statement | The statement does not balance. Opening %s + lines %s = %s, but the closing balance is %s. |
| private.cb_add_statement | This period (%s to %s) overlaps a statement already imported for %s (%s to %s). Undo that import first if this replaces it. |
| private.cb_add_statement | This statement is already imported: the same file is in this file. |
| private.cb_chart_sync | On a trial balance file the group follows the master account: assign a master account in step 4. |
| private.cb_entry_write_lines | An account is not in this file. |
| private.cb_entry_write_lines | Every line needs an amount. |
| private.cb_feed_no_delete | Statements and their lines are not deleted. Exclude the statement instead (View statements). |
| private.cb_history_append_only | The file history cannot be changed or deleted. |
| private.cb_keep_lines_entry | The "Expenses paid personally" entry is set by its lines. Change a line instead. |
| private.cb_line_readonly | Outside the year. Use an entry to move it to another year. |
| private.cb_q_unsent | This line is excluded. |
| private.cb_q_unsent | This question was closed when the line was posted. |
| private.cb_q_unsent | This question was sent to the client, so it can't be changed. Ask a follow-up instead. |
| private.cb_quick_rate_guard | A retired rate stays retired; an approved rate can only be retired. |
| private.cb_quick_rate_guard | New rates start as pending. An Admin approves them. |
| private.cb_quick_rate_guard | Quick method rates are kept as a record. Retire a rate instead of deleting it. |
| private.cb_statement_readonly | An imported statement's period, balances and lines cannot change. |
| private.cb_transfer_guard | Only a transfer match marks a line as matched. |
| private.cb_transfer_guard | This line is part of a transfer. Undo the transfer first. |
| private.cb_transfer_one_each | This line is already in a transfer. |
| public.cb_accept_transfer | A transfer is between two different accounts. |
| public.cb_accept_transfer | Both lines must still be to code. Undo the other line first. |
| public.cb_acceptance_same_as_last | There is no earlier file with an acceptance record. |
| public.cb_add_line_file | Wrong place for the file. |
| public.cb_add_note | That item is not in this file. |
| public.cb_add_outstanding | Only an item at the start of the year is cleared by a line in the year. |
| public.cb_add_outstanding | That line already clears an outstanding item. |
| public.cb_add_outstanding | That line is matched as a transfer. Unmatch it first. |
| public.cb_add_personal_expenses | A line is not on the standard entry. |
| public.cb_add_personal_expenses | Vehicle lines need the total km and the business km for the year. |
| public.cb_add_quick_rates | %s already has rates waiting for approval%s. Reject them first. |
| public.cb_add_quick_rates | A quick method rate is from 0 to 100%. |
| public.cb_add_revenue_check | Monthly files have no revenue check. |
| public.cb_add_sub_line | This GIFI code already has nine sub-lines. |
| public.cb_answer_sh_flag | Prepare the schedule first. |
| public.cb_ask_client_lines | Only Pending lines go on the client's list. |
| public.cb_ask_questions | An excluded line cannot be asked about. |
| public.cb_assign | An account is not in this file. |
| public.cb_clear_splits | Undo the posted line first. |
| public.cb_clear_typed_step | Nothing is typed on step %s. Imports and uploads are removed where they are listed. |
| public.cb_client_answer | This link is no longer active. |
| public.cb_client_answer | Wrong place for the file. |
| public.cb_confirm_gst_entry | That entry is not in this file. |
| public.cb_confirm_gst_entry | This file has no GST/HST return built in Closebook. |
| public.cb_confirm_new_account | This account is not new this year. |
| public.cb_confirm_side | This balance is not on the wrong side of its line. |
| public.cb_create_file | The year must end after it starts and be no longer than 53 weeks. |
| public.cb_create_file | This client already has a file for that year-end. |
| public.cb_decide_quick_credit | No credit is waiting for approval. |
| public.cb_delete_bank_statement | Statements are not deleted. Exclude it instead, in View statements. |
| public.cb_exclude_lines | Only Pending lines can be excluded. Undo a posted line first. |
| public.cb_fill_lines | This line is posted or excluded. Undo it first. |
| public.cb_import_account_list | Import the trial balance first, then the Account List. |
| public.cb_import_csv | The CSV has no lines. |
| public.cb_import_statement | This file was uploaded to replace a statement's file, not to import. |
| public.cb_import_statement | This statement does not belong to a file. |
| public.cb_import_tb | Some entries are marked Booked in QuickBooks: a new trial balance already holds them, so they would count twice. Unmark and delete those entries first, then import. |
| public.cb_keep_line_move | This account's line did not change from last year. |
| public.cb_mark_questions_sent | None of these questions is open. |
| public.cb_note_sh_due | This account is not owed by the shareholder at year-end. |
| public.cb_pair_choice | Undo the posted line first. |
| public.cb_post_lines | Split the line first. |
| public.cb_post_lines | The other line is posted or excluded. |
| public.cb_post_lines | These two lines were unpaired. |
| public.cb_post_lines | This line is already in a transfer. |
| public.cb_prepare_gst_return | That period is not in the fiscal year. |
| public.cb_prepare_gst_return | This file has no GST/HST return built in Closebook. |
| public.cb_purge_statement | Only a statement excluded as Wrong client can be purged. |
| public.cb_question_link_create | Bad link. |
| public.cb_question_to_note | The internal note would be over 2,000 characters. Shorten the note first. |
| public.cb_reclassify | %s is a transfer: change it in step 4. Nothing was changed. |
| public.cb_reclassify | %s is split: change it with Split. Nothing was changed. |
| public.cb_reclassify | %s: only a posted line changes here. Post it in step 4 first. Nothing was changed. |
| public.cb_reclassify | Bank, card and loan accounts change in step 3 and step 4, not here. |
| public.cb_reclassify | Entry %s comes from a working paper: change it there. Nothing was changed. |
| public.cb_reclassify | Entry %s: a sales tax line follows its entry. Change the entry in step 5. Nothing was changed. |
| public.cb_reclassify | Tick the lines to reclassify. |
| public.cb_reclassify_undo | This was already undone. |
| public.cb_recode_lines | This line is split. Use Split to change it. |
| public.cb_record_delivery | The documents are already recorded as delivered. |
| public.cb_record_gifi_export | Monthly files have no T2 tie-out. |
| public.cb_record_gifi_export | The checks did not run. Nothing was exported. |
| public.cb_record_gifi_export | The file is not a GIFI file. |
| public.cb_remove_bank_account | This account has statements (imported or excluded). It can't be deleted. |
| public.cb_replace_statement_file | The new file has no lines. |
| public.cb_reply_note | This note is already marked fixed. |
| public.cb_resplit_line | A split has two lines or more. |
| public.cb_resplit_line | Left to split: %s. Nothing was saved. |
| public.cb_review_account | This account is not waiting for the reviewer. |
| public.cb_review_account | Write the decision: 500 characters at most. |
| public.cb_review_entry | Entry approval was retired. Sign step 5 instead. |
| public.cb_review_new_account | This account is not new this year. |
| public.cb_save_bank_account | %s is already on this file. |
| public.cb_save_bank_account | This account has statements. It can't change between a bank account and a card, line of credit or loan. |
| public.cb_save_checklist | Question %s cannot be Not applicable: only questions 8 and 9 can. |
| public.cb_save_close_fields | The email was sent: its figures are kept as sent. |
| public.cb_save_expense_line_account | This line's account is picked on the entry itself. |
| public.cb_save_gst_check | This file has no GST/HST return built in Closebook. |
| public.cb_save_gst_filing | Prepare the return first (step 8). |
| public.cb_save_itc_factor | Nothing changed. |
| public.cb_save_km_rates | %s is already in the table. Change its rates instead. |
| public.cb_save_km_rates | Each rate is dollars per km, for example 0.73. |
| public.cb_save_km_rates | Nothing changed. |
| public.cb_save_km_rates | Rates have at most two decimals, for example 0.73. |
| public.cb_save_opening | Account %s is not on GIFI line %s. |
| public.cb_save_opening | GIFI %s is not a code Closebook can use. |
| public.cb_save_opening | That bank account is not on GIFI line %s. |
| public.cb_save_opening_s125 | GIFI %s is not a Schedule 125 line. |
| public.cb_save_rule | An amount condition needs an amount, for example 6.00. |
| public.cb_save_schedule_entry | Change this amount in its schedule: click the Schedule tag. |
| public.cb_save_schedule_entry | Open the schedule and put it in the entry. |
| public.cb_save_schedule_entry | This entry holds another schedule. |
| public.cb_save_splits | A split has two lines or more. |
| public.cb_save_splits | Left to split: %s. Nothing was saved. |
| public.cb_save_splits | Undo the posted line first. |
| public.cb_seen_unused | No account is unused this year. |
| public.cb_send_mal | The MAL is already out for signing. |
| public.cb_set_bank_coverage | The account cannot close before it opened. |
| public.cb_set_book_amortization | Retired: amortization is whatever entry is posted; CCA is not compared (CloseBook2, Nov 21, 2026). |
| public.cb_set_first_year | There is an earlier Closebook file for this client: it is not a first year. |
| public.cb_set_first_year | This file has last year's amounts: it is not a first year. |
| public.cb_set_line_date | Outside the year. Use an entry to move it to another year. |
| public.cb_set_line_locked | Nothing changed. |
| public.cb_set_opening | GIFI %s cannot be used here. |
| public.cb_set_opening | GIFI %s is not a known code. |
| public.cb_set_opening | There are no GIFI lines. |
| public.cb_set_opening_pdf | Unexpected file path. |
| public.cb_set_quick_credit | The credit is a rate from 0 to 100%. |
| public.cb_set_quick_credit | The credit limit is an amount, 0 or more. |
| public.cb_set_quick_rate_status | Only a pending rate can be approved. |
| public.cb_set_quick_rate_status | This rate is already retired. |
| public.cb_set_review_treatment | This line is not a REVIEW line. |
| public.cb_sign_step | Step 7 is the reviewer's: it has no preparer sign-off. |
| public.cb_sign_step | This step is already reviewed. |
| public.cb_sign_step | This step is already signed as prepared. |
| public.cb_sign_substep | This sub-step is already reviewed. |
| public.cb_sign_substep | This sub-step is already signed as prepared. |
| public.cb_skip_statement | This statement is not skipped. |
| public.cb_statement_note | This statement does not belong to a file. |
| public.cb_unassign_all | No account is assigned. |
| public.cb_undo_assign | Cannot undo: changed since by another action: %s. |
| public.cb_undo_assign | This action is already undone. |
| public.cb_undo_transfer | This line is not part of a transfer. |
| public.cb_unsign_step | The step is reviewed: the reviewer takes back their sign-off first. |
| public.cb_unsign_substep | The sub-step is reviewed: the reviewer takes back their sign-off first. |
| public.cb_update_master_line | Nothing changed. |
| public.cb_upload_bank | Balances have at most 2 decimals. |
| public.cb_upload_bank | Every amount has at most 2 decimals. |
| public.cb_upload_bank | One upload covers at most a year. |
