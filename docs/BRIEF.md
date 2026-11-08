# Build Brief: Concept Firm App

Last updated: 2026-11-08 (roles, lead assignment, sources, retention added)

## Who
Concept Accounting & Advisory Professional Corporation, a CPA firm in Kitchener, Ontario. Owner: Hashim Awad, CPA. Hashim is not a developer. Staff are accountants.

## What
One firm web app, owned by the firm, that keeps running without Claude. It is the firm's one app and will grow beyond T1 quotes.
Phase order changed by Hashim on 2026-11-08:
- **Phase 1 (now): Concept Studio in the app.** See "Phase 1: Concept Studio" below.
- **Phase 2: T1 workflow.** Public start page, screening questions, leads, automatic quotes, signing and the TaxDome handoff, as described in this brief. Starts after Phase 1 is approved.
- **Phase 3: Year-end compilation.** Unchanged.

Already built and kept for Phase 2: staff logins, roles and permissions, activity log, settings, price book, screening questions and pricing rules, staff email through Microsoft 365, design system.

## Decisions made
| # | Topic | Decision |
|---|---|---|
| 1 | Hosting | Vercel Pro, server code in Montréal (yul1). Requirement: all records and files are stored in Canada (Supabase ca-central-1). |
| 2 | Screening form | Built into this app. |
| 3 | HST | Shown as its own line, based on the client's province. Owner-edited rate table, checked against CRA before go-live. |
| 4 | Signed copy | After signing, show "Signed. Download your copy", then a Continue button to the TaxDome sign-up page. The app does not email the client. |
| 5 | Engagement terms | Hashim sends the current T1 engagement letter. Claude adapts it. Hashim approves the final wording. |
| 6 | Address | app.conceptaccounting.ca |
| 7 | Couples pricing | Per-property and per-business add-ons are charged once. Per-return add-ons (investment sales, T1135, foreign income, employment expenses, moving) are charged per spouse. Example: both spouses have investment sales = 2 x $99. |
| 8 | Couples signing | One link per spouse. The quote counts as signed only when both have signed. No email code. |
| 9 | Backups | Supabase backups plus a "Download full export" button Hashim clicks monthly. |
| 10 | Supabase | Live project "Concept Firm App" exists in Canada (Central). A separate Test project is created with Hashim, one step at a time. Previews use Test only. |
| 11 | Vercel seats | Hashim only. Staff log in to the app through Supabase. |
| 12 | Email | Microsoft 365. Staff login emails go through the firm's M365 mail, not Supabase's built-in sender. |
| 13 | DNS | Hashim manages the domain. Claude guides click by click when connecting app.conceptaccounting.ca. |
| 14 | Roles and permissions | Role-based access managed by owners on the admin page. See "Roles and permissions". |
| 15 | Lead assignment | A rule set by owners in settings, never a hard-coded person. See "Lead flow". |
| 16 | Old triage items | Hashim is pricing each one and will send it as a price or as out of scope. "Required documents missing" is dropped from screening (TaxDome handles it after sign-up). |
| 17 | Lead sources | Website, Referral, Existing client, Brokerage or team partner, Talk or event, Social media, Other. Owners can edit this list. |
| 18 | Corporate signing | One signing officer (name and title) by default, with an option to add a second signer. |
| 19 | Spam | Hidden trap field plus a submission limit. No third-party captcha. |
| 20 | Sent | Staff click "Copy email", send from Outlook, then click "Mark as sent". The 21-day clock starts at that click. Auto-generated quotes stay draft until a staff member marks them sent. |
| 21 | Retention | Lost and out-of-scope leads, with their screening answers, are deleted automatically 24 months after they close. Owners can change the period in settings. Signed documents and signing records are kept. Each deletion is logged with date and count only. |
| 22 | Sales tax on quotes | GST/HST only, based on the client's province. Concept does not collect PST or QST (an owner can add that later on the admin page). Every rate shows its CRA source page, date checked and who checked it. Hashim approves the rate table before any quote uses it. If the province is missing or unclear, no quote is generated until it is fixed. Never default to Ontario. |
| 23 | Design system | Approved 2026-11-08 (page: /design). Concept navy #1A3C7C, Concept green #86BC28 accent (navy text on green, never white), warm neutrals, Plus Jakarta Sans with tabular figures, supplied logo artwork. Sidebar active item: navy-tint highlight with green marker. DRAFT FOR REVIEW watermark only on unsent quotes in staff preview, never on the client's copy. One date format on screen: "Nov 5, 2026". Start page headline: "Your tax return, prepared and reviewed by a CPA." Client pages keep "Checked by our team before you sign" and "Your information is stored securely in Canada"; no time estimates, no "No payment today". |
| 24 | Phase order | Phase 1 Concept Studio in the app, Phase 2 T1 workflow, Phase 3 year-end compilation (2026-11-08). |

## Ownership and data rules (non-negotiable)
- All records and files stored in Canada: Supabase project "Concept Firm App", region Canada (Central), ca-central-1. Free plan while building; Pro before go-live.
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
- Roles are defined in the app. Each role has a permission per area: leads, clients, quotes and documents, vault, price book and rules, tax rates, engagement terms, custom line, staff accounts, exports, settings.
- Each permission is one of: no access, view, edit.
- Owners create roles, change permissions and assign people to roles from the admin page, without code changes.
- Owner role: full access, cannot be edited. At setup: Hashim Awad and Asmaa Ibrahim.
- Only an owner can grant or remove the owner role. The app always keeps at least one active owner.
- All other staff get a role an owner assigns.
- Every change to roles, permissions and role assignments is recorded in the activity log.

## Lead flow (personal and corporate)
1. Public start page: the client chooses "File your personal tax return" or "File your corporate tax return".
2. Each route has its own screening questions. Answers are cross-checked automatically.
3. Every submission creates a lead record automatically (CRM style): status, source, answers, assigned staff member. Spam protection: hidden trap field and a submission limit, no third-party captcha.
   - Assignment follows the rule owners set in settings: all new leads to one chosen person, to an unassigned queue, or rotating between chosen people. Owners can reassign any lead.
   - Sources: Website, Referral, Existing client, Brokerage or team partner, Talk or event, Social media, Other (owner-editable list).
4. In-scope answers: the quote is generated automatically, with fees calculated from the screening answers and the price book, and HST by province.
5. Staff see a pre-drafted email with the quote link, copy it, and send it from their own Outlook. The app does not send this email. Staff then click "Mark as sent". The quote stays draft until then, so the client sees nothing a person has not released.
6. Out-of-scope answers (non-resident, US person, estate or trust, prior years, CRA review underway): no quote. The lead is flagged for Hashim.
7. Price book completeness: the T1 and T2 price books will be complete before go-live, so every in-scope answer prices automatically. There is no triage route for in-scope answers. An owner-only custom line exists as a safety net only, not as a normal route.
8. Quote link expires 21 days after "Mark as sent". Unsigned quotes expire and the lead is marked lost.
   - Corporate quotes: one signing officer (name and title) by default, with an option to add a second signer.
9. After signing: download-your-copy page, then Continue to https://portal.conceptaccounting.ca/en-us/signup. TaxDome runs the work from there.
10. The TaxDome invoice is created after the client completes the organizer and uploads documents, not at sign-up. Staff create it manually from the signed quote for now. The design allows a TaxDome API link to be added later.

## Quote rules
- The quote is one document: client name, services with prices, total before tax, HST line, total, then the engagement terms, then a signature section.
- Prices come only from the price book, never typed freely (except the owner-only custom line).
- Statuses: draft, sent, viewed, signed, expired, withdrawn.
- A revised quote is a new version. Nothing is ever overwritten.

## Signing record (must hold up as a signed agreement)
For every signature keep: signer name, email, date and time, IP address, browser, and a fingerprint (hash) of the exact document shown. Produce a signed PDF with an audit page. Store it in the app and let staff download it.

## Price book status
- T1: loaded from this brief. A few remaining items are being priced by Hashim and will be sent.
- T2: built from Concept Studio's current corporate price book, sent before go-live. The corporate route and screening structure are built now.

### T1 price book (all prices before HST, one invoice, charged once)
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
| US non-resident return (1040-NR) for US rental or US-source income | $799 federal, plus $249 per state return |
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

## Still open
- Engagement terms text (waiting for the current T1 engagement letter).
- T2 price book from Concept Studio.

## How to work with Hashim
- Plain words, short answers. Answer first.
- Anything Hashim must do himself: one click-by-click step at a time, then wait for his screenshot.
- Staff never use a command line. Everything they use is screens and buttons.
- Show a working preview with dummy data before calling anything done.
- Ask before doing anything outside this repo.
