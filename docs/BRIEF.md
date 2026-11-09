# Build Brief: Concept Studio

Last updated: 2026-11-09 (Phase 2 batch adopted: docs/PHASE2-BATCH.md governs Phase 2; where they differ, the batch wins)

## Who
Concept Accounting & Advisory Professional Corporation, a CPA firm in Kitchener, Ontario. Owner: Hashim Awad, CPA. Hashim is not a developer. Staff are accountants.

## What
One firm web app, **Concept Studio**, owned by the firm, that keeps running without Claude. ("Concept Firm App" is only the internal developer name: the GitHub repository, Supabase projects and Vercel project keep it.) It is the firm's one app and will grow beyond T1 quotes.
Phase order changed by Hashim on 2026-11-08:
- **Phase 1 (now): Concept Studio in the app.** See "Phase 1: Concept Studio" below.
- **Phase 2: Leads, quotes and signing (personal and corporate).** Full instructions in `docs/PHASE2-BATCH.md` (approved by Hashim, Nov 9, 2026; every decision in it is final). Summary in "Phase 2" below.
- **Phase 3: Year-end.** See "Phase 3: Year-End" below (replaces all earlier Phase 3 wording, 2026-11-08). Not built yet. Foundation fit: `docs/PHASE3-FOUNDATION.md`.

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

## Navigation (decision 37, 2026-11-08)
End state of the staff menu. Pages not built yet show greyed out with "Soon" and are not links. A section or item shows only if the person's role permits it. Every existing page keeps working; only its place and name changed.

| Section | Items |
|---|---|
| Home | My day: leads to review, proposals awaiting signature, gates waiting, deadlines |
| Sales | Leads (soon); Proposals (one page for T1 instant quotes and business proposals, with a type label and filter; the T1 pricing calculator lives inside it); Engagement letters (corporate and T1 on one page, type chosen at the top) |
| Clients | Clients (individuals and corporations, linked); Engagements (each client, year and service, with status) |
| Work | Personal tax (T1) (soon); Year-End & T2 (soon, the CaseWare-style workspace from Phase 3); CFO reports (soon); Owner pay planner (soon); Incorporations (soon) |
| Documents | The document vault |
| Quality | Reviews (soon) |
| Firm setup (owners) | Price book (catalogue, packages, floors); Templates (letters, terms, notes library); Screening questions; Chart of accounts (soon; includes GIFI); Vendor rules (soon); GST/HST rates |
| Admin (owners) | Team and roles (staff merged with roles and permissions); Settings; Activity log |

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
- Quality (Reviews), Chart of accounts, Vendor rules (soon): owners.
- Firm setup: Price book and Screening questions need Price book view; Templates need Engagement terms view; GST/HST rates need Tax rates view. Owners have all of these by default; owners can grant them to other roles.
- Admin: Team and roles needs Staff accounts view (Roles tab: owners only); Settings needs Settings view; Activity log: owners.

Addresses: My day /, Proposals /proposals (calculator: /proposals?tab=calculator; builder still /documents/proposal), Engagement letters /engagement-letters?type=corporate|t1, Engagements /engagements, Document vault /documents, Team and roles /admin/team. Old addresses (/t1-pricing, /documents?tab=..., /admin/staff, /admin/roles) forward to the new pages; /documents/corporate-letter and /documents/t1-letter still open the same screens.

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

## Phase 3: Year-End
(Replaces all earlier Phase 3 wording, 2026-11-08. Not built yet.)

One section in the left panel, "Year-End", holds the whole engagement end to end. Staff never leave this section to finish a year-end. It is modelled on CaseWare Working Papers and replaces our Excel Compilation Workpaper. Rule throughout: we never ask the client for information we can get ourselves from CRA, the statements or the trial balance.

### A. Engagement setup
- One engagement per client per fiscal year: client, Business Number, fiscal year end, preparer, reviewer, estimated hours, tax software (ProFile).
- Deadlines calculated from the fiscal year end: tax payment deadline (two or three months, set per corporation) and T2 filing deadline (six months). The app works back from the payment deadline.

### B. Roll forward
- If a prior-year engagement exists, bring forward: closing balances as opening balances, account mapping, client vendor rules, permanent documents (articles, shareholder list, prior notices), schedules with continuity (shareholder loan, fixed assets and CCA, retained earnings), and open issues. Show a list of what rolled forward.
- First year in the app: opening balances are entered once from the prior-year statements and T2.

### C. Acceptance and planning (CSRS 4200)
- Engagement acceptance or continuance, knowledge of the entity, time budget, withdrawal worksheet if needed.
- The signed engagement letter (from the app's letters) must be linked before work starts.

### D. Intake
- The client completes our TaxDome organizer "CORP - Year-End T2 (year-end clients)". It goes out automatically from TaxDome after the 50% deposit is paid, with reminders every 7 days, 3 times.
- The app records the date the organizer was submitted and links the client's documents to the engagement.
- There are no Excel information request workbooks.
- Monthly clients (TaxDome tag BK) get the Home Office & Auto organizer instead of the CORP year-end organizer. The TaxDome pipeline 'TX - Corporate Tax (T2) - Year-End' handles all corporate year-ends, with tag conditions.

### D2. CRA check
- Using CRA Represent a Client, staff record: GST/HST registration status and filing frequency, GST/HST returns filed for the year, corporate tax and GST/HST instalments, and balances owing.

### E. Gate A: records sufficiency
- Preparer may pass it. Statements present for every month of every account. Client trial balance balances and agrees to the bank reconciliation (where one is provided). First-year clients: prior-year statements and T2 on file.

### F. Client type and data in
- Client type comes from the organizer's accounting records question:
  - "No system, statements only" sets Type 1 (Raw Records): we build the books.
  - QuickBooks Online or other software makes the client a Type 2 candidate (Client-Prepared TB), confirmed only by the qualification test.
- Type 2 qualification test, recorded pass/fail with a note for each: (1) TB balances, (2) bank and card accounts reconciled to year end, (3) no material suspense or uncategorized balance, (4) prior-year closing balances carry into this year's opening. Any fail: run as Type 1, or Type 2 with a scoped cleanup, recorded in writing.
- Type 1: one register per bank or card account, no row limits. Import by CSV using one firm template only: Date (YYYY-MM-DD), Description, Amount (single signed number: money out negative, money in positive). The app converts card activity correctly. Account, statement period and opening and closing balances are entered at upload. Each upload must reconcile opening to closing before it can be finalized. Statement continuity check: each closing balance equals the next opening; a missing month blocks Gate A. The app validates every file and rejects anything that doesn't match, naming the row and problem. "Download template" button on the upload screen.
- Type 2: import the client's TB by CSV (firm template: Account number, Account name, Debit, Credit). Must balance before use. Map each client account to a GIFI account with drag-and-drop. The mapping is saved per client and rolls forward. Balance support for each balance sheet account: balance per client TB, what supports it, last reconciled.

### G. Coding and second-round request
- Firm master chart of accounts based on CRA GIFI: code, name, statement (BS or IS), group, sort order. Owner-edited. Initial list loaded from our current workpaper's GIFI COA tab. Per engagement, bank and card accounts are renamed to the client's accounts.
- Each transaction: GIFI account, status (OK or Ask Client), note. Each line books both sides, so the trial balance always nets to zero.
- Vendor rules suggest the account; staff always confirm. Firm-wide rules (owner-managed) and client-specific rules.
- Clearing accounts 1490 CC Payment and 1495 Suspense - Ask Client must be zero before Gate B and Gate C.
- Staff work out shareholder withdrawals, personal expenses, receivables and payables from the statements or trial balance.
- Second-round request: once coding is done, one batch request goes to the client, never one question at a time. It covers: unknown transactions (including shareholder withdrawals), receipts for purchases over $500, assets sold or disposed of during the year (date and proceeds), and any shareholders beyond two (names and ownership). Answers are logged on each item (date, explanation, disposition) as compilation evidence.

### H. Working trial balance
- Columns: Prior year, Prelim, AJE, RJE, Final, Change. Must net to zero.
- AJE (adjusting) and RJE (reclass) entries, each must balance, with date, memo, reference and preparer.

### I. Lead sheets
- One per group: cash, receivables, prepaids, fixed assets, payables, taxes, shareholder accounts, debt, equity, revenue, expense groups.
- Each shows prior year, current year and change, with links to supporting documents and schedules. Workpaper references and tickmarks.

### J. Supporting schedules (general feature)
- Shareholder loan continuity, one per shareholder: opening balance carried forward; corporate expenses paid personally by the shareholder; personal expenses paid by the corporation; advances and repayments in either direction; salary, bonus or dividends credited; closing balance, which must agree to the balance sheet (difference shown until it ties).
- s.15(2) tracking: for any balance owed by the shareholder, record the date it arose. The app calculates the repayment deadline as one year after the end of the corporation's taxation year in which the balance arose, and flags any balance not repaid by then. Record whether repayments may form part of a series of loans and repayments. Any flag blocks Gate B until an owner reviews it. The app flags; it does not decide the tax treatment.
- Also: fixed assets and CCA continuity, HST reconciliation (using the CRA check in D2), accruals, prepaids, retained earnings continuity.

### K. Binder (document manager)
- Every workpaper, schedule, uploaded file and letter, filed in folders by section.
- Each item has preparer and reviewer sign-off. Any change after reviewer sign-off is flagged and shows who changed what and when.
- Review notes tracked until resolved.

### L. Reasonableness checks and Gate B
- Checks, each with an explanation field: revenue against GST/HST returns filed; wages against the T4 Summary; asset additions against invoices; prior-year comparatives for anything that moved without explanation.
- Gate B: pre-statement review. Needs the "gate reviewer" permission (owner role by default). Statements cannot be generated before Gate B is passed.

### M. Financial statements
- Balance sheet, statement of earnings and retained earnings, notes from a notes library (including the basis of accounting note CSRS 4200 requires), prior-year comparatives, compilation engagement report.
- Checks, all must pass: balance sheet balances; completeness (every account with a balance appears); retained earnings equals prior closing plus net income less dividends; prior-year closing equals this year's opening.

### N. Client approval
- Client approves the statements and signs the management acknowledgement in writing, using the app's signing (same signing record as quotes).

### O. GIFI export
- Assign GIFI codes and export a standard GIFI file (.GFI) for ProFile, with signs adjusted as GIFI requires.
- GIFI export test before Phase 3 goes live: export a GIFI file from a dummy engagement and import it into ProFile. Every GIFI line and amount on Schedules 100 and 125 must match the app's statements, including sign flips. Hashim runs the import; the app shows the expected figures to compare against.

### P. Tax workpapers
- Accounting-to-taxable income reconciliation, every difference explained.
- Tie-out check: GIFI in ProFile agrees to the app's statements. CCA, SBD and the return itself are prepared in ProFile.

### Q. T183 CORP
- Signed by the client and stored in the binder. Filing is blocked until it is on file.

### R. Gate C: final review
- Needs the "gate reviewer" permission. Cannot pass until every item is met or explained: TB nets to zero; statement checks pass; Suspense and CC Payment are zero; second-round request fully answered; revenue agrees to GST/HST returns or difference explained; wages agree to T4 Summary; shareholder loan continuity complete and s.15(2) timing checked; prior-year closing equals opening; every balance maps to a valid GIFI code; client's written approval on file; signed T183 CORP on file; accounting-to-taxable income reconciliation documented.

### S. Filing
- The app cannot EFILE (CRA requires certified tax software; we use ProFile). EFILE is done in ProFile.
- The app records the EFILE confirmation number and date and stores the filed T2 PDF. The engagement cannot be closed until these are recorded.

### T. T2 package and minute book
- Generate the T2 package in the app: cover, compilation engagement report, balance sheet, statement of earnings and retained earnings, notes, management acknowledgement. Same content and standard as our current package.
- Generate the minute book letter and year-end minute book documents.
- Flag T5 slips needed for dividends declared.
- Everything stored in the vault.

### U. Delivery
- Year-end letter to the client: what was filed, tax owing and the payment deadline, what to do differently next year.

### V. Lockdown
- The engagement locks on completion. Only an owner can unlock it, with a reason recorded in the activity log.

### W. Year-end close
- Next-year note: type classification, GIFI mapping used, recurring issues, actual hours against quoted. Ready to roll forward next year.

### Outputs and rules
- Internal only, never shared with clients: the working file, queries, suspense postings, review notes.
- All gate passes, sign-offs, unlocks and changes recorded in the activity log.
- Data organized by client, fiscal year and engagement, kept like any client file (the 24-month deletion rule applies only to leads that never became clients).

### Later (not Phase 3)
Send the second-round request online through a private link (no login, like the quote page). Answers land on the matching transactions for staff to code.

### Still needed from Hashim
Our Compilation Workpaper (GIFI COA list), to load as the starting chart of accounts before Phase 3 starts.

## Still open
- Quality log: does it come in with Phase 3 (with Studio's template approvals) or is it dropped? (Hashim)
- Compilation Workpaper (GIFI COA list) for the Phase 3 starting chart of accounts.

## How to work with Hashim
- Plain words, short answers. Answer first.
- Anything Hashim must do himself: one click-by-click step at a time, then wait for his screenshot.
- Staff never use a command line. Everything they use is screens and buttons.
- Show a working preview with dummy data before calling anything done.
- Ask before doing anything outside this repo.
