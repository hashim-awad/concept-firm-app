# Build Brief: Concept Firm App

Last updated: 2026-11-08 (decisions from Hashim's answers added)

## Who
Concept Accounting & Advisory Professional Corporation, a CPA firm in Kitchener, Ontario. Owner: Hashim Awad, CPA. Hashim is not a developer. Staff are accountants.

## What
One firm web app, owned by the firm, that keeps running without Claude. It is the firm's one app and will grow beyond T1 quotes.
- Phase 1: leads, screening, quote and sign for personal (T1) and corporate (T2) tax clients.
- Phase 2: move Concept Studio (engagement letters, proposals) into the same app.

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
- Staff: each person has their own login (email and password). Hashim is owner and admin. Record who created and sent every document.
- Clients: no login. Each signer gets their own private link that cannot be guessed.

## Lead flow (personal and corporate)
1. Public start page: the client chooses "File your personal tax return" or "File your corporate tax return".
2. Each route has its own screening questions. Answers are cross-checked automatically.
3. Every submission creates a lead record automatically (CRM style): status, source, answers, assigned staff member.
4. In-scope answers: the quote is generated automatically, with fees calculated from the screening answers and the price book, and HST by province.
5. Staff see a pre-drafted email with the quote link, copy it, and send it from their own Outlook. The app does not send this email.
6. Out-of-scope answers (non-resident, US person, estate or trust, prior years, CRA review underway): no quote. The lead is flagged for Hashim.
7. Price book completeness: the T1 and T2 price books will be complete before go-live, so every in-scope answer prices automatically. There is no triage route for in-scope answers. An owner-only custom line exists as a safety net only, not as a normal route.
8. Quote link expires 21 days after it is sent. Unsigned quotes expire and the lead is marked lost.
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

Items from the first brief still to be priced or moved to out of scope (pending Hashim): crypto or options, property held in a partnership or trust, foreign tax return needed, treaty claims, GST/HST on an assignment not handled at closing.

Out of scope (flagged for Hashim, no quote): non-resident, US person, estate or trust, prior years, CRA review underway.

Prices, rules and tax rates are edited only on owner-only admin pages.

## Document vault (like Dext)
- Every generated and signed document stored as a file, with a record: client, type, version, created by, sent date, signed date, status, signing record.
- Staff can search by client, filter by type and status, open and download.
- Backups: Supabase backups plus a "Download full export" button Hashim clicks monthly, saved to a firm records folder. Never save exports into client folders on the T: drive (those sync to the client portal).

## Phase 2: Concept Studio (do not start until Phase 1 is approved)
Concept Studio today is a single HTML tool on claude.ai: engagement letters (T1, corporate master letter with service schedules), proposals (single price and multi-option), price floors, packages, PDF output. Its data lives in Notion. It moves into this app; Notion data is copied in once, then the app is the source.

## Still open
- Engagement terms text (waiting for the current T1 engagement letter).
- Remaining T1 items and their prices.
- T2 price book from Concept Studio.

## How to work with Hashim
- Plain words, short answers. Answer first.
- Anything Hashim must do himself: one click-by-click step at a time, then wait for his screenshot.
- Staff never use a command line. Everything they use is screens and buttons.
- Show a working preview with dummy data before calling anything done.
- Ask before doing anything outside this repo.
