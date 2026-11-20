# Piece S2: post-build reports

Unit tests stand in for test-runner (no migration). accounting-reviewer and security-risk ran once each; both PASS.
Fixed after the reviews: accounting-reviewer item 1 (client_software files never count a rounding). The other items are on
the clean-up list in docs/BRIEF.md.

## accounting-reviewer
RESULT: PASS. Sign logic checked against tb-build for bank (+0.40), card (0.08) and overdraft; dummy file recomputed
(3,510.32 - 3,510.00 = 0.32, ties; 1.32 with step 2 at 3,509.00 fails). Live: confirm the Rounding row reads (0.52).
FOUND: 1 fromStatements gate missing (fixed); 2 loadRounding diverges from the posting for summary line 1000, bank on a
liability line other than 2600, and no T2 line (clean-up); 3 net rounding of 1.00 or more fails (rule kept); 4 check 5
display wording (ui-reviewer); 5 read the posted rounding rows instead (clean-up).

## security-risk
RESULT: PASS. Export route unchanged; refusal list unchanged except check 5; loadRounding uses the user's session under
row-level security; no secrets, no client data, no migration. Note: cb_record_gifi_export trusts the app's ok flags
(already so before S2).
