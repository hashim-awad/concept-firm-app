# Build Brief: Concept Studio

Last updated: 2026-11-09 (Phase 2 batch adopted: docs/PHASE2-BATCH.md governs Phase 2; where they differ, the batch wins)

## Who
Concept Accounting & Advisory Professional Corporation, a CPA firm in Kitchener, Ontario. Owner: Hashim Awad, CPA. Hashim is not a developer. Staff are accountants.

## What
One firm web app, **Concept Studio**, owned by the firm, that keeps running without Claude. ("Concept Firm App" is only the internal developer name: the GitHub repository, Supabase projects and Vercel project keep it.) It is the firm's one app and will grow beyond T1 quotes.
Phase order changed by Hashim on 2026-11-08:
- **Phase 1 (now): Concept Studio in the app.** See "Phase 1: Concept Studio" below.
- **Phase 2: Leads, quotes and signing (personal and corporate).** Full instructions in `docs/PHASE2-BATCH.md` (approved by Hashim, Nov 9, 2026; every decision in it is final). Summary in "Phase 2" below.
- **Phase 3: Closebook (year-end).** Governed by `docs/PHASE3-BATCH.md` and its appendices in `docs/phase3/` (Nov 11, 2026). See "Phase 3: Closebook" below. Not built yet; build plan awaiting Hashim's approval.

Already built and kept for Phase 2: staff logins, roles and permissions, activity log, settings, price book, screening questions and pricing rules, staff email through Microsoft 365, design system.

## Decisions made
| # | Topic | Decision |
|---|---|---|
| 1 | Hosting | Vercel Pro, server code in Montréal (yul1). Requirement: all records and files are stored in Canada (Supabase ca-central-1). |
| 2 | Screening form | Built into this app. |
| 3 | HST | Shown as its own line, based on the client's province. Owner-edited rate table, checked against CRA before go-live. |
| 4 | Signed copy | After signing, show "Signed. Download your copy" and a button "Continue to the secure portal" (https://portal.conceptaccounting.ca/en-us/signup). The app does not email the client. (Wording updated by the Phase 2 batch, section 9.) |
| 5 | Engagement terms | T1: approved wording in PHASE2-BATCH.md Appendix A, word for word. Corporate year-end: the Studio corporate master letter with its year-end schedule, plus the two changes in batch section 11. Both stored as editable templates. |
| 6 | Address | studio.conceptaccounting.ca (changed from app.conceptaccounting.ca, 2026-11-08) |
| 7 | Couples pricing | Per-property and per-business add-ons are charged once per household. Per-return add-ons are charged per spouse: investment sales, crypto, T1135, foreign income, employment expenses, moving expenses, US returns. Example: both spouses have investment sales = 2 x $99. |
| 8 | Couples signing | One quote, one document, one price, two signers. One email with two signing buttons, one per spouse. Signed only when both have signed; "Signed by [name], waiting for [name]" until then. After the first signs, offer same-device signing for the second (recorded). No email code. (Batch section 7.) |
| 9 | Backups | Supabase backups plus a "Download full export" button Hashim clicks monthly. |
| 10 | Supabase | Live project "Concept Firm App" exists in Canada (Central). A separate Test project is created with Hashim, one step at a time. Previews use Test only. |
| 11 | Vercel seats | Hashim only. Staff log in to the app through Supabase. |
| 12 | Email | Microsoft 365. Staff login emails go through the firm's M365 mail, not Supabase's built-in sender. |
| 13 | DNS | Hashim manages the domain. Claude guides click by click when connecting studio.conceptaccounting.ca. |
| 14 | Roles and permissions | Role-based access managed by owners on the admin page. See "Roles and permissions". |
| 15 | Lead assignment | A rule set by owners in settings, never a hard-coded person. See "Lead flow". |
| 16 | Old triage items | Hashim is pricing each one and will send it as a price or as out of scope. "Required documents missing" is dropped from screening (TaxDome handles it after sign-up). |
| 17 | Lead sources | Website, Referral, Existing client, Brokerage or team partner, Talk or event, Social media, Other. Owners can edit this list. |
| 18 | Corporate signing | One signing officer (name and title) by default, with an option to add a second signer. |
| 19 | Spam | Hidden trap field plus a submission limit. No third-party captcha. |
| 20 | Sent | Staff click "Copy email", send from Outlook, then click "Mark as sent". The 21-day clock starts at that click. Auto-generated quotes stay draft until a staff member marks them sent. |
| 21 | Retention | Lost and out-of-scope leads, with their screening answers, are deleted automatically 24 months after they close. Owners can change the period in settings. Signed documents and signing records are kept. Each deletion is logged with date and count only. |
| 22 | Sales tax on quotes | GST/HST only, based on the client's province. Concept does not collect PST or QST (an owner can add that later on the admin page). Every rate shows its CRA source page, date checked and who checked it. Rates can be loaded by the app from the CRA rates page (changed 2026-11-08); an owner's approval is still required before any quote or proposal uses them. "Approve all" approves the whole table in one click. If the province is missing or unclear, no quote is generated until it is fixed. Never default to Ontario. |
| 23 | Design system | Approved 2026-11-08 (page: /design). Concept navy #1A3C7C, Concept green #86BC28 accent (navy text on green, never white), warm neutrals, Plus Jakarta Sans with tabular figures, supplied logo artwork. Sidebar active item: navy-tint highlight with green marker. DRAFT FOR REVIEW watermark only on unsent quotes in staff preview, never on the client's copy. One date format on screen: "Nov 5, 2026". Start page headline: "Your tax return, prepared and reviewed by a CPA." Client pages keep "Checked by our team before you sign" and "Your information is stored securely in Canada"; no time estimates, no "No payment today". |
| 24 | Phase order | Phase 1 Concept Studio in the app, Phase 2 T1 workflow, Phase 3 year-end compilation (2026-11-08). |
| 25 | Signer names | Owner-edited setting per document type, not hard-coded. Engagement letters: "Hashim Abouelfetouh, CPA" (CPA Ontario registered name, documents signed in CPA capacity). Proposals and all other documents: "Hashim Awad". (2026-11-08) |
| 26 | Price Floors corrections | Recorded as price-book changes after the import, not during it. From Nov 9, 2026 the corrections are made in Notion at the source (Agent floor $5,388, Core, Finance Office and Custom GCI notes), so the "Apply these corrections" button on the Import page is not used for the Live import. Agent monthly bookkeeping plus year-end T2: software $69; floor ($380 + $69) x 12 = $5,388 (was $5,220); note updated. Team Finance Office: GCI $3M to $5M. Team Core: GCI $1M to $3M. Team Custom: GCI above $5M (unchanged). |
| 27 | T1 price book in Phase 1 | Studio's T1 price book ported exactly for the parity test. After parity sign-off, the brief's T1 changes are applied as a recorded price-book change. |
| 28 | Past letters in the vault | Past corporate letters and proposals: PDF regenerated from Studio's saved data, labelled on every page "Regenerated from Studio records, not the signed original". Past T1 letters: records only. | Live (Nov 9, 2026): Hashim chose not to regenerate past letters; the vault starts empty and past letters stay as records only.
| 29 | Studio import | CSV export per Notion database, owner-only import screen, dry run with counts and problems before saving. Client data never passes through the repo or chat. Quality log stays for Phase 3. Signature image uploaded once by Hashim in the app. |
| 30 | Source of truth | From 2026-11-09 the app and its database are the only source of truth. Concept Studio is phased out: it was the jump start, not a limit on what the app can do. Hashim uses the app alone for one to two weeks, then invites the team. Wording is edited in the app as numbered versions (draft, owner approval, current), not through code. Studio parity stays only as a baseline check that EL v3.31 moved into the app unchanged. |
| 31 | App name | The app is "Concept Studio" everywhere staff see it: sidebar, browser tab, sign-in pages, staff emails, Design page. Logo: Studio's own (white "Concept", green "Studio") on navy, and a navy version on white. Client-facing pages (start page, screening questions, quotes, signing, signed page) use the firm's brand, Concept Accounting & Advisory, never the tool name. The repository, Supabase projects and Vercel project keep their names. (2026-11-08) |
| 32 | GST/HST rate table | All 13 provinces and territories loaded from the CRA rates page (canada.ca), in effect from Apr 1, 2025, checked Nov 8, 2026, approved by Hashim with "Approve all": AB 5% GST, BC 5% GST, MB 5% GST, NB 15% HST, NL 15% HST, NT 5% GST, NS 14% HST, NU 5% GST, ON 13% HST, PE 15% HST, QC 5% GST, SK 5% GST, YT 5% GST. Rule (changes decision 22): the app may load rates from the CRA page; an owner approves before any quote or proposal uses them. A Final proposal needs an approved rate for the client's province. Note: Apr 1, 2025 is the Nova Scotia change date; the other rates started earlier. |
| 33 | Price book clean-up | After the Studio import (Hashim, 2026-11-08), applied by an owner from the clean-up screen, before/after shown first (built; Apply pending as of 2026-11-08): (1) Service Catalog "Order" stored as a decimal (51.5 for PTX-129); (2) Per client items with no price show "Priced per client (see packages)" only when an active package or floor covers the item through its ticked services (comp YE-101, t2 CTX-101, comp and t2 together YE-102, catchup ACC-103, books ACC-102, gst GST-101, payroll PAY-101, pay ACC-105, cfo ADV-101, budget ADV-102, coord ACC-106, t1 PTX-101, software fee SFT-101, monthly fee ACC-101 (the line monthly packages are invoiced under), pnl ACC-101 (included in the monthly service, never billed separately); mapping confirmed by Hashim 2026-11-08); all others show "Quoted per client" (changed by Hashim 2026-11-08). Price book tabs: Catalogue, Packages and floors. (8) One T1 price list: the Catalogue's Personal tax (T1) items (PTX codes), which quotes and the T1 calculator use. Studio's T1 rows from Price Floors were a second copy nothing read; the clean-up removes them and the import no longer brings them in (Hashim 2026-11-08); (3) service lines by code: Bookkeeping ACC-101 to 106, SFT-101; Corporate tax (T2) YE-101, YE-102, CTX-101 to 103; GST/HST GST-101, 102; Payroll PAY-101, 102; CFO reporting ADV-101, 102; Advisory ADV-103; Incorporation INC-101, 102; Adjustments ADJ-101; Personal tax (T1) all PTX; empty Corporate line removed; (4) the brief's 16 seed T1 items removed, screening rules repointed to the Studio PTX codes (T1_BASE_SINGLE to PTX-110, T1_BASE_COUPLE to PTX-111, T1_RENTAL and T1_STR to PTX-120, property sale to PTX-127, the other 11 to PTX-121 to 132), per-spouse charging carried over (decision 7), Studio PTX prices kept; PTX-101 and PTX-190 kept separate; (5) new T1 items PTX-133 crypto or active trading $249 per return (per spouse), PTX-134 partnership with T5013 $149 per partnership, PTX-135 US 1040-NR federal $799 per return (per spouse), PTX-136 US state return $249 per state return (per spouse; both set to per spouse by Hashim 2026-11-08, decision 7) (4020 Tax Preparation - Personal (T1), Fixed); (6) "Charged" keeps only the unit; notes moved to a staff-only internal note (SFT-101, CTX-103, PTX-101, ADV-103, INC-101, PTX-127); QBO income account and Replaces in QBO / TaxDome kept in their own fields; (7) names, codes unchanged (Hashim 2026-11-08): PTX-101 "Owner's personal tax return (T1)" (internal note: for owners of our corporate clients; included in or priced with their package), PTX-110 "Personal tax return (T1), single", PTX-111 "Personal tax returns (T1), couple". |
| 34 | Templates (wording) | Modelled on proposal and letter apps: open a template as a document, click any text to change it, fill-ins shown by name ([Company name]) and kept; changes are saved as unpublished changes; an owner reviews (before/after) and publishes; History lists published versions with Restore (owner, with a reason). New letters use the published wording; letters already made keep theirs; each PDF records the version. Trial templates are marked ready for clients by an owner on the template page. Structure (section order, adding or removing a clause) is still in code. (2026-11-08) |
| 35 | Live set-up and email | Go live before real daily use: live Supabase project with an owner-approved deploy, studio.conceptaccounting.ca on Vercel production, live email hook; setup redone in Live (import, signature, rates, clean-up); real data then cleared from Test (Test is dummy data only). Changes keep coming after go-live: Test first, then Live with approval. Staff email sender to become studio@conceptaccounting.ca (display name "Concept Studio"), keeping app@ as an alias; the Exchange sending lock and MAIL_FROM move with it. (2026-11-08) |
| 36 | Price book: add an item | The suggested code follows the chosen service line: the prefix most used in that line, one above the highest number with that prefix (Personal tax: next PTX; Corporate tax: next CTX). Editable before saving. (2026-11-08) |
| 37 | Menu and navigation | End state set by Hashim 2026-11-08, replacing any earlier menu plan. See "Navigation". |
| 38 | Phase 2 batch | `docs/PHASE2-BATCH.md` adopted Nov 9, 2026. Its decisions are final and win over anything older in this brief. |
| 39 | No price breakdown to clients | Standing rule 1.1 below. |
| 40 | Pricing permission | Covers the price book, quote amounts, quote breakdowns and Issue quote. Owner role today. Tied to roles, never names. |
| 41 | Monthly real estate package suggestion | Batch section 12, corrected by Hashim Nov 9, 2026. Revenue under $1 million: "Agent" for a single agent, "Team: Essential" for a team or brokerage. $1M to $3M: Core. $3M to $5M: Finance Office. Over $5M: Custom (priced by Hashim). Other industries: no suggestion. The form does not ask agent or team, so staff mark it on the lead (Studio pre-fills a guess from the business-type answer). |
| 42 | Phase 2 plan approved | Approved by Hashim Nov 9, 2026, with additions: PTX-100 invoice-only item (QBO 4020); the six new corporate items with QBO income accounts (YE items as YE-102, GST-110 as GST-101); the corporate quote email as an editable template; the client confirmation screen promises no time; the "Download full export" button (decision 9), which includes the vault's PDF files because database backups do not. Each step is built and tested on Test with dummy data only; nothing reaches Live until Hashim approves that step (merge into main). |
| 43 | T2 deadlines from TaxDome | Built right after step 1. "Import from TaxDome": owner uploads the TaxDome Accounts CSV (T2-tagged accounts). Match existing clients by Business Number, then by legal name; show matches, new clients and unmatched rows before saving; never create duplicates. Import only legal name, Business Number, fiscal year-end, TaxDome tags and the TaxDome account link. TaxDome is the master list: a newer export updates these fields, and Studio never edits them by hand. Per client: balance-due period, 2 or 3 months after year-end (staff set it; default 2). Filing deadline: 6 months after year-end. My day "T2 deadlines" card: every filing and balance-due date overdue or due in the next 90 days, oldest first, with the client and days left. T2 clients with no fiscal year-end are flagged, not skipped. |
| 44 | Pricing permission, how it is enforced | Built Nov 9, 2026. Database: prices, packages and floors, proposals, document versions and their PDFs need Pricing; engagement fee columns and letter inputs are readable only through engagement_fees(), which needs Pricing. Staff without Pricing see the document list but cannot open letters and proposals (approved Nov 9, 2026). The old "Price book and rules" area is now "Screening questions and rules", with item names but no prices. |
| 45 | T2 deadlines, how they work | Built Nov 9, 2026 on decision 43 and Hashim's column rules: read only id, Account Name, Account Type (Company only), Tags (must include T2), CRA BN (first 9 digits), Fiscal Year-End (free text read as month and day; anything unclear is flagged, never guessed) and Company State / Province; every other column (SIN, notes, contacts, addresses, the TaxDome "T2 Filing Deadline") is never read or stored; the file is read as UTF-8, in the browser. Individual accounts tagged T2 are flagged, not imported. Accounts without a Business Number match by name and are shown before saving. Balance due: 2 or 3 months after year-end per client (CRA: two months; three for a CCPC that claimed the small business deduction and meets the income conditions; checked Nov 9, 2026). Filing: 6 months. My day shows deadlines for the latest year-end and the next one; staff press Done when a return is filed or a balance is paid (recorded with who and when), since Studio has no filing record until Phase 3. The TaxDome account link is built from the id with an address pattern an owner sets once. New clients from TaxDome get province "Other" when TaxDome has none, never Ontario by default. |
| 46 | Leads, how they work | Built Nov 10, 2026 (Phase 2 step 4). Public start page at /start (firm brand), closed to the public until an owner switches it on in Settings (staff can preview). Lead record per submission through submit_lead(): contact details, province (13 provinces and territories), route, status (New, Call needed, Out of scope, Quote ready, Quote sent, Signed, Lost), source (owner-edited list, decision 17), assigned person by the lead assignment rule (decision 15; only owners reassign). What the client entered cannot be edited; staff add notes. Spam: hidden trap field, minimum fill time, 5 per visitor per hour and 200 per hour in total (visitor address stored only as a keyed hash). Activity log for leads records field names, never values, so deletion after the retention period (decision 21, daily job) leaves only date and count. |
| 47 | Settings layout | Hashim, Nov 10, 2026. Settings follows the Stripe, QuickBooks Online and Xero pattern: its own left-hand menu with a search box, grouped Firm; Sales and quotes; Pricing; Letters and signing; Tax rules; Connections; Data and security. One short page per item, each with its own Save button. Price book, Templates, Screening questions, GST/HST rates, Team and roles, Import from TaxDome, Activity log and Change log moved from the main menu into Settings. The main menu keeps daily work, with Settings pinned at the bottom. A lock marks restricted pages (see decision 48). Layout change only: every page keeps its content, address and permissions. |
| 48 | Settings locks and roles | Hashim, Nov 10, 2026. Locks come from the actual permission rules, not set by hand: a lock shows on pages only owners can open, pages that need the Pricing permission, and pages where only an owner can change something; hovering shows which. An automatic test checks each lock against the page code and the database. Chart of accounts and Vendor rules (soon) moved into Settings under a new Accounting group; the Firm setup group is gone from the main menu. Team and roles: everyone edits their own phone; only owners change a person's role (database rule; was any staff-account editor). The lock sits on the Role column, not the whole page. Staff-account editors can still invite people and switch accounts on or off, within their own access. |
| 49 | Lead alerts, how they work | Built Nov 10, 2026 (Phase 2 step 5, batch section 3). When a lead comes in, the app emails every active staff member whose role has Pricing (owners included), one email each, from the studio@ mailbox. The email shows lead type, household, province and quote total (or "Call needed"), with an "Open the lead" button. It holds no client name or contact details. Household and quote total read "Not asked yet" and "Not worked out yet" until screening (step 6) and quotes (steps 7 and 9) exist. My day, the Leads list and the lead page show "Waiting 25 min", counted in business minutes (Settings, Business hours, Toronto time). The timer pauses outside those hours; if no hours are set, every minute counts. If a lead is still New or Quote ready (quote not marked sent) after 45 business minutes, a second email goes to the same people. Call needed leads get no reminder: they wait for a call, not a quote. Each alert goes once, recorded in lead_alerts, which only the server can read. A check runs every 5 minutes on Live (Vercel scheduler) and when staff open My day or Leads; a first email that failed is retried. Leads from before this feature get no emails. |
| 50 | T1 screening, how it works | Built Nov 10, 2026 (Phase 2 step 6, batch sections 4 and 5.2). The personal questions are batch section 4, published as a new version on Screening questions (the old version retired). Source: src/lib/screening/t1-v2.ts; the migration is generated from it and a test checks they match. The migration refuses to publish if the price book differs from the section 4 prices, or if a personal draft exists. Order: about you, quick checks (out of scope first), who is filing (couple: spouse name and email), income and claims, how did you hear about us. Consent (question 22) is the "Get my quote" button itself, with a line saying so; no checkbox (Hashim, Nov 10). Couples answer per-return questions once as No, Me, My spouse or partner, or Both; follow-ups are asked for each person who said yes. Per-property and per-business items are once per household; per-return items are per spouse. GST/HST returns: once a year = 1, every 3 months = 4, every month = 12 (PTX-124 each). The moving distance and T1135 thresholds in the wording come from Settings, T1 rule values. An out-of-scope answer stops the form there with a polite message; the client can still send their details, and the lead is saved as Out of scope with the reasons and no quote. The browser never receives a price: the server works out the quote from the published questions and today's prices and stores it line by line in lead_quotes, which only Pricing holders can read. The lead page shows the answers as questions (lead viewers) and the quote (Pricing). The alert email shows the household and quote total. PTX-100 added as an invoice-only item (price type "Invoice only", QBO 4020, no price); screening refuses it. |
| 51 | T1 form as steps | Hashim, Nov 10, 2026. Layout only; same questions, prices, per-spouse rules and out-of-scope routing as batch section 4. Steps with a progress bar and Back / Next, one step per screen: About you; Who's filing (two large buttons, then spouse name and email); Quick check ("Do any of these apply?": the 5 fit questions as one checklist plus None of these; any tick stops the form and routes to Hashim); What happened in [tax year] (the 11 income questions as tiles, "Tick everything that applies", plus None of these); A few details (only the follow-ups of ticked tiles, in tile order; skipped when none apply); Last (how did you hear about us, anything else, Get my quote). Couples choose Me / Spouse / Both on the per-return tiles (stocks, crypto, foreign property, foreign income, return in another country, T2200, moving). The per-household tiles (self-employed, rental, sold a property, T5013) are charged once per household, so the form does not ask who. The tax year is last year until June, this year from July. The repeated hint "answer for both of you" is removed from every question (a new published version). The steps map onto the published questions' own answer keys (src/lib/screening/t1-steps.ts); if an owner changes those keys, the start page falls back to the plain form. |
| 52 | T1 quote, how it works | Built Nov 10, 2026 (Phase 2 step 7, batch sections 6 to 8 and Appendix A). On a lead with a quote from its answers, staff with Edit on Pricing and Leads click "Prepare the quote". The quote page shows the email to copy (single or couple template, sender block = the person signed in, with their phone from Team and roles), the recipients and subject, and the quote and engagement letter with DRAFT FOR REVIEW until it is marked sent. Staff send the email from their own Outlook, then click "Mark as sent": the quote is valid 21 days from that day, the lead shows Quote sent, and the quote keeps the wording, signer and sender it was sent with. Each signer has a private link (/q/...), two for a couple; the client's page shows Parts A and B with no watermark and no line prices, and says when the quote has expired. Signing is step 8. The letter (Appendix A) and both emails (section 8) are word for word and editable on the Templates page as three new templates, published like the letters' wording. The services list is in plain words (one line per item; vehicle and home office join the self-employment line, as in the Appendix A example; per-person items name the spouse for a couple). The tax year is stored with each new lead (last year until June, this year from July). Quotes and links are readable only with Pricing and Leads. |
| 53 | T1 signing, how it works | Built Nov 10, 2026 (Phase 2 step 8, batch sections 7 and 9, Appendix A Part C). Each signer opens their own private link, types their full name (shown as a signature), ticks "I have read my quote and these engagement terms, and I agree to them." and clicks Sign. The signing record keeps the typed name, time, IP address, browser, a SHA-256 fingerprint of the exact quote and terms signed (Parts A and B as the client reads them, so any change gives a different fingerprint) and whether a spouse signed on the other's device. A couple: the page shows "Signed by [name], waiting for [name]" and offers "Is [name] with you? They can sign now on this device."; the quote counts as signed only when both have signed. Then the lead shows Signed, the signed PDF is made once (Parts A and B, the signatures, and a signing-record page) and kept in the private documents storage, and both signers get "Signed. Thank you, [first name].", Download your copy (PDF), and Continue to the secure portal (https://portal.conceptaccounting.ca/en-us/signup). The quote (web page and PDF) is on the firm's letterhead, in the engagement letters' style: navy headings, the fee in a box, the letter as one page on screen; the PDF uses the letters' margins and footer and a side-by-side signature block (Hashim, Nov 10). An expired quote cannot be signed. Staff see who signed, open the signed PDF, and copy the TaxDome invoice line: PTX-100 "Personal tax return services, [tax year]", the quote total before tax, and the approved GST/HST rate for the client's province (Settings, GST/HST rates). |
| 54 | Corporate route, how it works | Built Nov 10, 2026 (Phase 2 step 9, batch sections 10 and 11, Appendix C). The start page's "My company" route asks the section 10 questions as steps, word for word. "Your details" (first name, last name, email, province; no phone) is saved as a lead before the questions, so a lead who stops is still captured (staff are alerted after 30 minutes; the lead says the client stopped). The rest of the answers are added once, through a private one-time key. Routing (section 11): auto-price when question 1 is year-end, books are one of the first three answers and no box in question 7 is ticked; otherwise a call (lead marked Call needed, thank-you page shows the booking link from Settings). Price: YE-110 $1,800, YE-111 $2,400, YE-112 $2,900 (includes 1 bank account and 1 credit card), YE-120 $250 per extra bank account, credit card or line of credit, YE-121 $100 per bank loan or car loan or lease, GST-110 $199; tax slips included, no price. The items were added with those prices and the income accounts of YE-102 and GST-101; a code already used for something else stops the deploy and names it. On the lead, staff see every answer, "First year with Concept" (TaxDome tag 1st-yr client), the business type (for TaxDome tags), "year-end not known" when the client was not sure, and the call reasons; they enter the company's legal name and the confirmed year-end, and no quote can be prepared without both. The quote is one page: Part A Appendix C word for word; Part B the corporate master letter built by Studio's own engine with the published wording, word for word, with two changes (table below); Part C the same signing as T1. Same signing, wording snapshot, 21-day expiry, watermark and no-breakdown rules. The email is Appendix C. After signing, staff see the deposit (half, now) and the balance (half, at approval) to copy into TaxDome, and the first-year checklist (tick on the lead). Monthly leads always need a call (package suggestion and Create proposal are step 10). |
| 55 | Monthly company leads, how it works | Built Nov 10, 2026 (Phase 2 step 10, batch section 12, decision 41). A monthly lead always needs a call. The lead page shows every answer (including A to C) and a "Monthly client: package and proposal" card. Real estate: the suggested package from the revenue band (under $1M Agent for a single agent, Team: Essential for a team or brokerage; $1M to $3M Core; $3M to $5M Finance Office; over $5M Custom, priced by Hashim). Other industries: no suggestion. Staff confirm the client type on the lead (single agent, team or brokerage, not real estate); until they do, Studio guesses from the business answer (words like real estate, realtor, PREC, agent; team or brokerage means a team). "Create proposal" opens the existing proposal builder with: company or client name, contact, salutation, province, client type (which sets one price or options), the price book offer when exactly one active offer matches the suggestion, and the answers (business, revenue, people paid, books, up to date) as the three "What we heard" lines for staff to rewrite after the call. The email shows in a note above the builder. Prices and floors come from the price book, unchanged. |
| 56 | Download full export, how it works | Built Nov 10, 2026 (Phase 2 step 11, decision 9). Settings, Data and security, "Download full export" (owners only). One ZIP: every table in the database as exact JSON (data/json, for restoring) and as CSV for Excel (data/csv; lists shown as JSON text; text that looks like a formula is prefixed with ' so Excel does not run it), every stored file in its app folder (files/documents: vault PDFs and signed quotes; files/brand-private: the signature image), manifest.csv (size and SHA-256 of every file) and README.txt (who, when, counts, files that could not be read). The database reads past row security as the owner who clicks; the owner check is in the database. Each export is recorded in Settings (last_full_export) and so in the activity log. The page shows the last export and warns after 31 days. Hashim downloads it monthly and keeps it in the firm's secure storage. No ZIP64: one export must stay under 4 GB and 65,535 files. |
| 57 | T1 form: what the base fee covers | Hashim, Nov 10, 2026 (Live smoke test). The "What happened" step opens with: "Your base fee already covers employment (T4), pension and investment slips. Tick anything else that applies." Hint text only: section 4 questions, prices and rules unchanged; no employment tick box (an option among priced items reads as a charge). Phone stays required (section 4, question 1). |
| 58 | The engagement letter stands on its own | Hashim, Nov 11, 2026 (concern about CPA Ontario practice inspection). Part B of both quotes is a complete letter from its first page: letterhead, the date the quote was sent, an addressee block, a Re line, then "Dear". T1 addressee: the client's name (both names for a couple) and email(s); corporate: the company's legal name, "Attention: [signer]" and email. No mailing address is collected; for a letter delivered and signed electronically the email is the address. The firm signs at the end: firm name, the signature image from Settings, signer name and title. The signature image is not part of the document fingerprint. Signed quotes keep the layout they were signed with. The client page puts the sign form in a panel beside the letter that stays in view (computer and tablet) or a bar at the bottom of the screen that opens the form (phone); after signing the same place shows Continue to the portal and Download your copy. |
| 59 | Phase 3 batch adopted | Hashim, Nov 11, 2026. `docs/PHASE3-BATCH.md` and `docs/phase3/` replace the earlier Phase 3 text (A to W). The Compilation Workpaper request is answered by Appendices A and B. Build starts after Hashim approves the build plan. |
| 60 | Closebook build step 1, part 1 | Built Nov 11, 2026. New permission area "Closebook": owners have Edit; every other role starts at None until an owner grants it on Team and roles (year-end files hold client financials). Reference data loaded from Appendices A and B by scripts/gen-closebook-seed.ts (a test keeps the database equal to the appendices). The 14 captions of today's package (Appendix C, CAP) are written onto their master lines' statement line, so captions match today's statements; the workbook's roll-ups stay (decision 5 in Appendix B), and step 2 shows today's package beside Closebook's for the dummy file. Master lines change only through owner functions that require a reason and keep a log; sub-lines are numbered .10, .20 after the highest existing one. Thresholds and the Note 1 policy are in Settings, Closebook. |

## Navigation (decision 37, 2026-11-08)
End state of the staff menu. Pages not built yet show greyed out with "Soon" and are not links. A section or item shows only if the person's role permits it. Every existing page keeps working; only its place and name changed.

| Section | Items |
|---|---|
| Home | My day: leads to review, proposals awaiting signature, gates waiting, deadlines |
| Sales | Leads (soon); Proposals (one page for T1 instant quotes and business proposals, with a type label and filter; the T1 pricing calculator lives inside it); Engagement letters (corporate and T1 on one page, type chosen at the top) |
| Clients | Clients (individuals and corporations, linked); Engagements (each client, year and service, with status) |
| Work | Personal tax (T1) (soon); CFO reports (soon); Owner pay planner (soon); Incorporations (soon). "Year-End & T2" is replaced by the Closebook section (Phase 3 batch, section 1) |
| Closebook (Phase 3) | My files; All files; Review notes. Setup is the "Closebook" group in Settings (owner-only) |
| Documents | The document vault |
| Quality | Reviews (soon) |
| Settings (pinned at the bottom, decision 47) | Opens the Settings section, below |

Settings section (decision 47). Its own menu on the left with a search box; one short page per item; locks per decision 48.

| Group | Items |
|---|---|
| Firm | Firm profile (soon); Team and roles; Business hours |
| Sales and quotes | Public start page; Lead assignment; Lead sources; Booking link; Screening questions |
| Pricing | Price book (catalogue, packages, floors); GST/HST rates |
| Letters and signing | Signer names; Signature image; Templates (letters, terms, notes library) |
| Tax rules | T1 rule values |
| Accounting (owners) | Chart of accounts (soon; includes GIFI); Vendor rules (soon) |
| Connections | Import from TaxDome; Import from Studio; Email (soon) |
| Data and security | Retention; Download full export (soon); Activity log; Change log |

UI rules:
- Menu groups fold away (remembered per browser), with count badges: proposals awaiting signature (status Sent) on Proposals, engagement letters awaiting signature (EL sent) on Engagement letters. A folded group shows the total.
- Global search (Ctrl+K, or "Find a client" in the menu) jumps to any client by name.
- The client page is the hub, with tabs: Overview (record, linked clients, at a glance), Engagements, Proposals and letters, Year-Ends (corporations; soon), Documents, Activity (owners).
- Every page uses the full width beside the sidebar. Menu labels are never cut off (they wrap if needed).
- Not built, because TaxDome runs them: tasks, jobs, pipelines, calendar, inbox, billing.

How permissions decide what shows (built 2026-11-08):
- My day: everyone; its lists need Documents view. Deadlines: T2 filing due six months after the year end (month-end year ends: last day of the sixth month; CRA rule checked Nov 8, 2026), for open engagements with a T2, overdue or due in 90 days. Tax payment deadlines come with Year-End.
- Leads: Leads view. Proposals and Engagements: Documents view. Engagement letters and the T1 pricing calculator: Documents edit. Clients: Clients view. Document vault: Documents or Vault view.
- Work (all soon): shown with Clients view until each gets its own permission area when built.
- Quality (Reviews) and, in Settings, Chart of accounts and Vendor rules (soon): owners.
- Settings (decision 47): an item shows only to people who can open its page. Price book needs Pricing view; Screening questions need Price book view; Templates need Engagement terms view; GST/HST rates need Tax rates view; Team and roles needs Staff accounts view (Roles tab and changing a person's role: owners only); Business hours, Public start page, Lead assignment, Lead sources, Booking link, Signer names, T1 rule values and Retention need Settings view (Public start page, Signer names and T1 rule values: only owners change them); Signature image, Import from TaxDome, Import from Studio and Activity log: owners; Change log: everyone. Owners have all of these by default; owners can grant them to other roles.

Addresses: My day /, Proposals /proposals (calculator: /proposals?tab=calculator; builder still /documents/proposal), Engagement letters /engagement-letters?type=corporate|t1, Engagements /engagements, Document vault /documents, Team and roles /admin/team, Settings /admin/settings (each setting at /admin/settings/<item>, e.g. /admin/settings/business-hours; pages that moved into Settings keep their /admin addresses). Old addresses (/t1-pricing, /documents?tab=..., /admin/staff, /admin/roles) forward to the new pages; /documents/corporate-letter and /documents/t1-letter still open the same screens.

## Corporate quote: changes from the corporate master letter (decision 54)

Part B of the corporate year-end quote is the corporate master letter (compilation engagement and T2, with GST/HST returns when ticked), built by Studio's engine from the published wording. The changes below are the only ones: the first two are required by section 11, the rest are Hashim's review of the first signed quote (Nov 10, 2026). Everything else is word for word.

| Where | Master wording | New wording | Why |
| --- | --- | --- | --- |
| Fees | "Our fees, billing terms and how to set up your payment details are in Appendix A, Fees and payment. Appendix A forms part of this letter." | "Your fee is the amount in your quote. Our billing terms and how to pay are in Appendix A, Fees and payment. Appendix A forms part of this letter." | The fee wording points to the amount in the quote |
| Closing, before "Yours truly," | None | "You agree that signing this letter electronically has the same effect as signing it by hand." | The client signs in Studio; same sentence as the T1 letter (Appendix A, section 10) |
| Section 5, work not included | "tax planning and reorganizations" | "tax planning beyond how you pay yourself, and reorganizations" | Part A includes "Tax planning on how you pay yourself from the company" |
| Section 3, heading (only with GST-110) | "3. GST/HST returns" | "3. GST/HST return" | The quote covers one return |
| Section 3, text (only with GST-110) | "We will prepare and file the Company's GST/HST returns at the filing frequency CRA has assigned to the Company, from [source]. You remain responsible for paying any GST/HST owing by the due date." | "We will prepare and file the Company's annual GST/HST return for the year, from [source]. You remain responsible for paying any GST/HST owing by the due date." | GST-110 is the annual return only; this quote never promises monthly or quarterly returns |
| Closing | "Please sign and return this letter to confirm that it reflects your understanding. ..." | "Please sign this letter below to confirm that it reflects your understanding. ..." (rest unchanged) | The client signs on the page, not by returning a copy |
| Appendix A, first payment | "$[half] plus HST when you sign this letter" | "$[half] plus GST/HST when you sign up in the portal" | Matches Part A: half when you sign up in the portal |
| Appendix A, second payment | "$[half] plus HST when the work is complete" | "$[half] plus GST/HST when your statements and tax return are ready for your approval" | Matches Part A: half at approval |
| Appendix A, after the payments | "You sign this letter and pay the invoice in the same step, in your secure TaxDome client portal." | Removed | Signing happens in Studio, not TaxDome |
| Appendix A, fee table | "$[total] plus HST" (the engine's tax by province) | "$[total] plus GST/HST" | Always "plus GST/HST", never "plus HST" |

Changes to Part A (Appendix C), Part C and the signing record, from the same review:

| Where | Appendix C / before | Now | Why |
| --- | --- | --- | --- |
| Part A, bookkeeping line (books from statements) | "Bookkeeping for the year from your bank and credit card statements" | "Bookkeeping for the year from your bank and credit card statements: [accounts]", for example "2 bank accounts, 1 credit card, 1 car loan or lease", from the form's counts. Only counts above 0 are listed | The client sees which accounts the fee covers. Quotes made before Nov 10 keep the Appendix C line |
| Part C, company signer | Full name only | Full name and "Your title at the company, for example Director or President" (required). The PDF shows "Title: [title]" above "I have authority to bind the Company." and in the signing record | A company signs through a named officer |
| Signing record (PDF audit page) | "Same device as the other signer: No" for every signer | Shown only when there are two signers | Means nothing with one signer |

Not changed, but placed differently (decision 58, Nov 11, 2026): the letter keeps its letterhead, date and Re line. The address block names the company, "Attention: [signer]" and the signer's email, because the form collects no street address. The firm's half of the signature block keeps the firm name, the signature image, the signer's name and title. The client's half is Part C; its PDF signature keeps the master letter's "Agreed and accepted on behalf of [company]" and "I have authority to bind the Company.", with the signer's title. Appendix A, Fees and payment, shows the quote total as one line and bills it half when the client signs up in the portal and half at approval. Every new wording above is an editable piece on the "Corporate year-end quote (Part A)" template.

T1 letter (Appendix A Part B) additions, decision 58: letterhead, date, addressee (name or names, email or emails), the line "Re: Engagement letter for your [year] personal income tax return(s)" (editable piece), and the signature image between the firm name and the signer. The wording itself is unchanged.

## Screen standard (Hashim, Nov 11, 2026)
Every screen we build is as tidy as Closebook's Trial balance tab after the QuickBooks-style rework:
- One table where possible, with groups that open in place, so columns line up all the way down.
- What needs action comes first (a card with the count and the dollar amount), and a filter shows only that.
- Changes happen in a side panel opened by a pencil, with an explicit Save, so a stray click changes nothing.
- Plain names on screen. Codes (lead sheet letters, document codes such as F3) stay in the build, not on screen.
- Status by colour and a short word: Signed (green), Next (blue), flags (amber), notes and problems (red), Open (grey).
- Check each screen in a browser at desktop and phone sizes before it goes to Hashim.

## Standing rules (Phase 2 batch, section 1)
- **No price breakdown to clients.** A client never sees the price book, a line price or any per-item amount: not on the quote, engagement letter, emails, signed PDF or download page. The client sees the services included and one total fee, plus GST/HST. Applies to T1 quotes and auto-priced corporate quotes. The full breakdown is stored with the signed quote and shown only to staff with the Pricing permission.
- **Living-system maintenance.** The brief is updated first, before the code. Every change is tested in the Test project before Live. Automatic tests grow with the app; a new feature adds its tests. The app keeps a change log in plain words Hashim can read. Backups are restored once before go-live and once a year after, to prove they work.

## Ownership and data rules (non-negotiable)
- All records and files stored in Canada: Supabase project "Concept Firm App", region Canada (Central), ca-central-1. Pro plan from 2026-11-08 (organization-wide, spend cap on).
- Code lives in this private repo. Standard, common technology, documented so any developer could take over.
- No passwords or keys in the repo. Row level security on every table. Nothing exposed unless deliberately opened.
- Client data never leaves the firm's accounts. No third-party tracking or analytics.
- Test only with dummy data. Never real client data in testing.
- All app data lives in this app's database. Not Notion, spreadsheets or Claude. The price book is stored and edited only in the app.

## Foundation
- Clients can be individuals or corporations, with links between them (spouses, owner and corporation).
- One service catalogue for all service lines (T1, T2, bookkeeping, payroll, GST/HST, CFO reporting), each with its own items and rules. The T1 price book is the first section filled in.
- Documents of any type (quotes, engagement letters, proposals, later financial statements) share one vault and one signing record.
- Screening questions and pricing rules can be added and changed from the admin page without code changes.

## Users
- Staff: each person has their own login (email and password). Record who created and sent every document.
- Clients: no login. Each signer gets their own private link that cannot be guessed.
- No staff name is hard-coded anywhere in the app. The first owners are set as data during setup.

## Roles and permissions
- Roles are defined in the app. Each role has a permission per area: leads, clients, quotes and documents, vault, price book and rules, tax rates, engagement terms, custom line, staff accounts, exports, settings, and **Pricing** (price book, quote amounts, quote breakdowns, Issue quote; batch section 2). Staff without Pricing see leads, clients and documents with no prices anywhere.
- Each permission is one of: no access, view, edit.
- Owners create roles, change permissions and assign people to roles from the admin page, without code changes.
- Owner role: full access, cannot be edited. At setup: Hashim Awad and Asmaa Ibrahim.
- Only an owner can grant or remove the owner role. The app always keeps at least one active owner.
- All other staff get a role an owner assigns.
- Every change to roles, permissions and role assignments is recorded in the activity log.

## Lead flow (personal and corporate)
1. Public start page: the client chooses **My personal tax return** or **My company** (small text: "Year-end, tax return or monthly bookkeeping"). Questions: batch sections 4 (personal) and 10 (company).
2. Each route has its own screening questions. Answers are cross-checked automatically.
3. Every submission creates a lead record automatically (CRM style): status, source, answers, assigned staff member. Spam protection: hidden trap field and a submission limit, no third-party captcha.
   - Assignment follows the rule owners set in settings: all new leads to one chosen person, to an unassigned queue, or rotating between chosen people. Owners can reassign any lead.
   - Sources: Website, Referral, Existing client, Brokerage or team partner, Talk or event, Social media, Other (owner-editable list).
4. In-scope answers: the quote is generated automatically, with fees calculated from the screening answers and the price book, and GST/HST by province. Corporate: auto-priced for year-end only (batch section 11); monthly bookkeeping, paper receipts or any complex-situation box routes to a booked call. Corporate quotes need the company legal name, entered by staff, before Issue quote.
   - Lead alerts: everyone with Pricing gets an email at once; My day shows a business-hours timer; a second email if the quote is not marked sent within 45 business minutes (batch section 3). The confirmation screen says the quote will arrive by email and never promises a time.
5. Staff see a pre-drafted email with the quote link, copy it, and send it from their own Outlook. The app does not send this email. Staff then click "Mark as sent". The quote stays draft until then, so the client sees nothing a person has not released.
6. Out-of-scope answers (batch section 4: not resident all year, US person, deceased or trust return, earlier year or adjustment, CRA review; also self-employment without income and expense totals, assignment GST/HST not handled at closing, crypto without a gains report, a foreign return other than US): a polite message, no quote, the lead is flagged for Hashim.
7. Price book completeness: the T1 and T2 price books will be complete before go-live, so every in-scope answer prices automatically. There is no triage route for in-scope answers. An owner-only custom line exists as a safety net only, not as a normal route.
8. Quote link expires 21 days after "Mark as sent". Unsigned quotes expire and the lead is marked lost.
   - Corporate quotes: one signing officer (name and title) by default, with an option to add a second signer.
9. After signing: "Signed. Download your copy." and "Continue to the secure portal" (https://portal.conceptaccounting.ca/en-us/signup). TaxDome runs the work from there.
10. T1: the TaxDome invoice is created after the organizer and documents are in. Studio shows one line to copy: PTX-100 "Personal tax return services, [tax year]", amount = quote total before tax, and the GST/HST rate for the province. Corporate year-end: 50% deposit invoice after signing, balance at client approval; Studio shows both amounts. The design allows a TaxDome API link later.

## Quote rules
- The quote and engagement letter are one document: Part A the quote (services included, one total fee plus GST/HST, never line prices), Part B the engagement terms, Part C signing. T1 wording: batch Appendix A; corporate Part A and email: Appendix C. Valid 21 days after "Mark as sent". DRAFT FOR REVIEW only on unsent quotes in staff preview.
- Prices come only from the price book, never typed freely (except the owner-only custom line).
- Statuses: draft, sent, viewed, signed, expired, withdrawn.
- A revised quote is a new version. Nothing is ever overwritten.

## Signing record (must hold up as a signed agreement)
For every signature keep: signer name, email, date and time, IP address, browser, and a fingerprint (hash) of the exact document shown. Produce a signed PDF with an audit page. Store it in the app and let staff download it.

## Price book status
- T1: loaded from this brief. A few remaining items are being priced by Hashim and will be sent.
- T2 / corporate: year-end auto-pricing items YE-110, YE-111, YE-112, YE-120, YE-121 and GST-110 (batch section 11). Monthly clients are quoted after a call with the existing packages and floors (batch section 12; package suggestion in decision 41).
- PTX-100 "Personal tax return services": invoice-only item, no price, never on quotes or in screening (batch section 5.2).

### T1 price book (all prices before HST, one invoice, charged once; staff only, never shown to clients as line prices)
Base: single return $299; couple filing together $349 (married or common-law, same household, both returns by Concept, one invoice).

Add-ons:
| Item | Price | Unit | Couples |
|---|---|---|---|
| Rental property (T776) | $249 | per property (one address = one property; basement suite in own home counts as one; co-owned charged once) | once |
| Short-term rental | $249 | per property (whether rental or business income) | once |
| Self-employment (T2125) | $499 | per business | once |
| Vehicle claim | +$150 | per vehicle | once |
| Home office | +$150 | per business | once |
| GST/HST return | $149 | per return filed | once |
| Investment sales | $99 | all accounts | per spouse |
| Principal residence sale | $99 | per sale | once |
| Rental or investment property sale | $249 | per property (includes property owned under 12 months and assignment sales) | once |
| T1135 foreign property, simplified | $149 | per return | per spouse |
| T1135 foreign property, detailed | $299 | per return | per spouse |
| Foreign income with no Canadian slip | $149 | per return | per spouse |
| Employment expenses (T2200/T777) | $149 | per return | per spouse |
| Moving expenses | $149 | per return | per spouse |

Remaining T1 items (decided 2026-11-08, all before HST). There is no triage route for T1.
| Situation | Treatment |
|---|---|
| Crypto or active trading, including options | $249 per return (per spouse if both). Required upload: crypto tax report or broker realized gain/loss report. No report: out of scope. |
| Partnership interest with a T5013 slip | $149 per partnership |
| Partnership with no slip (needs its own return) | Out of scope |
| Trust beneficiary with a T3 slip | No add-on, covered by the base |
| Client acting as trustee | Out of scope |
| US non-resident return (1040-NR) for US rental or US-source income | $799 federal, plus $249 per state return (per spouse if both) |
| US persons | Out of scope |
| Other foreign country returns | Out of scope |
| Routine treaty deductions on foreign pensions | Included in the $149 foreign income add-on |
| Residency tie-breaker claims, treaty-exempt employment income | Out of scope |
| GST/HST on an assignment sale not handled at closing | Out of scope |

"Required documents missing" is dropped from screening.

Out of scope (flagged for Hashim, no quote): non-resident, US person, estate or trust, prior years, CRA review underway.

Prices, rules and tax rates are edited only on owner-only admin pages.

## Document vault (like Dext)
- Every generated and signed document stored as a file, with a record: client, type, version, created by, sent date, signed date, status, signing record.
- Staff can search by client, filter by type and status, open and download.
- Backups: Supabase backups plus a "Download full export" button Hashim clicks monthly, saved to a firm records folder. Never save exports into client folders on the T: drive (those sync to the client portal).

## Retention
- Lost and out-of-scope leads, with their screening answers, are deleted automatically 24 months after they close. Owners can change the period in settings.
- Signed documents and their signing records are kept.
- Each deletion run is logged in the activity log with date and count only, no client details.

## Phase 1: Concept Studio in the app (now)
Concept Studio today is a single HTML tool on claude.ai. Its data lives in Notion. It moves into this app so Hashim can use it daily, test it, then invite the team.
- Everything Studio does today: engagement letters (T1 letter, corporate master letter with service schedules), proposals (single price and multi-option), price book, price floors with their checks, packages, and PDF output.
- Same wording and the same results. Parity test: for the same inputs, a letter or proposal from the app must match one from Studio. Side-by-side comparisons are shown to Hashim before it is called done.
- Studio's data moves in once: price book, price floors, packages and letter records. After that the app is the source. The import runs through an owner-only import screen in the app, never through the repo, because letter records contain client names.
- Every generated letter and proposal is stored in the document vault with versions, like quotes.
- Uses the approved design system.
- Tax rates (GST/HST) are built in Phase 1, since proposals need them too (rules in decision 22).
- When Phase 1 is approved, Hashim invites the team.

## Phase 2: Leads, quotes and signing
Governed by `docs/PHASE2-BATCH.md` (sections 1 to 16 and Appendices A to C). Order of work: rules and permissions (1 to 3), personal tax route (4 to 9), corporate routes (10 to 12), fixes and Phase 3 text (13 to 15). Settings Hashim fills before go-live: business hours, booking link for the call path, GST/HST rate approval (section 16). T1 rule values stored as editable settings, not code: the 40 km moving-expense distance and the $100,000 and $250,000 T1135 cost thresholds (checked on canada.ca, Nov 9, 2026).

## Phase 3: Closebook
Governed by `docs/PHASE3-BATCH.md` (Nov 11, 2026), which replaces the earlier Phase 3 text (stages A to W). Every decision in it is final; where this brief and the batch disagree, the batch wins. Appendices in `docs/phase3/`: A `GIFI-Concept-RC4088-Rev23.csv` (404 GIFI codes), B `Closebook-master-lines-APPROVED.xlsx` (419 master lines, 11 tax codes, 20 lead sheets), C `Year-end-package-standard.zip` (the current year-end package: the specification for the statements, MAL, minute book letter and client email), D `Closebook-screen-mockups.zip` (7 approved screens).

In short:
- **Closebook** is the staff-only year-end product. Client documents carry the firm's name only. It is standalone: its only link to the rest of Studio is the client database (kept current by the TaxDome import). Every file starts at All files, New file.
- One file per client per year-end, three phases in order (Planning, Fieldwork, Conclusion). Core documents are always in the file; setup answers only add documents; no "N/A"; every document is signed. One "Next:" line per file. Review notes attach to one document.
- Five tabs per file: Documents, Trial balance (Accounts, Lead sheets, Transactions for full files), Entries, Review notes, Statements.
- Two file types on one trial balance engine: **monthly** (Concept's QuickBooks clients, tag BK: trial balance imported read-only, entries made in QuickBooks) and **full** (year-end-only clients: trial balance built or imported in Closebook, entries AJE/RJE/TJE in Closebook). Same statements, compilation report, MAL and GIFI for both.
- Structure: staff map client accounts to master lines only; GIFI codes, tax codes, lead sheets and statement lines come from the master line. Only the reviewer changes a tax code. Paired lines take opposite balances. Required GIFI codes (2599, 3499, 3620, 8299, 9368, 9999, and 3849 when retained earnings are reported) must be present before any GIFI export.
- The year-end package reproduces the current package (Appendix C) exactly, with figures from the final trial balance. The MAL is signed through Studio signing. The CSRS 4200 report wording is never edited without Hashim.
- Setup lives in Settings, Closebook (owner-only): GIFI lines, tax codes, lead sheets, firm chart matching, standard entries, vendor rules, bank CSV formats, thresholds ($5,000; $5,000 and 20%), Note 1 policy (amortization equal to CCA), GIFI version.
- Build order (batch section 8): 1 trial balance engine; 2 year-end package; 3 compilation shell; 4 schedules, revenue check and setup-added documents; 5 monthly file; 6 ProFile loop. Each step: tests, dummy preview on Test, Hashim's approval, then Live.
- Acceptance test (batch section 9): each step is tested on Test with a dummy client that mirrors the shape of Hashim's real file (invented names and figures); Hashim then runs the real file on Live. Test log in `docs/phase3/TEST-LOG.md`, with no client names or figures.

## Still open
- Quality log: does it come in with Phase 3 (with Studio's template approvals) or is it dropped? (Hashim)

## How to work with Hashim
- Plain words, short answers. Answer first.
- Anything Hashim must do himself: one click-by-click step at a time, then wait for his screenshot.
- Staff never use a command line. Everything they use is screens and buttons.
- Show a working preview with dummy data before calling anything done.
- Ask before doing anything outside this repo.
