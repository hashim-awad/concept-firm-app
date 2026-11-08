# Build Brief: Concept Firm App

## First task
1. Save this brief in the repo as docs/BRIEF.md.
2. Read it fully, then reply with: a build plan in plain words, the tech you propose and why, where the app's pages will be hosted, and a list of questions. Do not build anything until Hashim approves the plan.

## Who
Concept Accounting & Advisory Professional Corporation, a CPA firm in Kitchener, Ontario. Owner: Hashim Awad, CPA. Hashim is not a developer. Staff are accountants.

## What
One firm web app, owned by the firm, that keeps running without Claude.
- Phase 1: quote and sign for standalone personal tax (T1) clients.
- Phase 2: move Concept Studio (engagement letters, proposals) into the same app.

## Ownership and data rules (non-negotiable)
- All records and files stored in Canada: Supabase project "Concept Firm App", region Canada (Central), ca-central-1. Free plan while building; Pro before go-live.
- Code lives in this private repo. Standard, common technology, documented so any developer could take over.
- No passwords or keys in the repo. Row level security on every table. Nothing exposed unless deliberately opened.
- Client data never leaves the firm's accounts. No third-party tracking or analytics.
- Test only with dummy data. Never real client data in testing.

## Users
- Staff: each person has their own login. Hashim is owner and admin. Record who created and sent every document.
- Clients: no login. Each quote has its own private link that cannot be guessed.

## Phase 1: Quote and sign (client journey)
1. Client answers screening questions (where the form lives is an open decision, see below).
2. A named staff member reviews the answers and builds the quote from the price book. The price comes only from the price book, never typed freely.
3. The quote is one document: client name, services with prices, total before tax, then the engagement terms, then a signature section.
4. Staff copy the quote's private link and send it in their own email. The app must not send its own email for this step.
5. Client opens the link, reads the quote, types their name and signs. Couples filing together: both spouses sign.
6. After signing, the client is sent straight to: https://portal.conceptaccounting.ca/en-us/signup
7. Link expires after 21 days. Statuses: draft, sent, viewed, signed, expired, withdrawn.
8. A revised quote is a new version. Nothing is ever overwritten.

## Signing record (must hold up as a signed agreement)
For every signature keep: signer name, email, date and time, IP address, browser, and a fingerprint (hash) of the exact document shown. Produce a signed PDF with an audit page. Store it in the app and let staff download it.

## Price book (all prices before HST, one invoice, charged once)
Base: single return $299; couple filing together $349 (married or common-law, same household, both returns by Concept, one invoice).

Add-ons:
- Rental property (T776): $249 per property (one address = one property; basement suite in own home counts as one; co-owned charged once)
- Short-term rental: $249 per property (whether rental or business income)
- Self-employment (T2125): $499 per business; vehicle claim +$150 per vehicle; home office +$150 per business
- GST/HST return: $149 per return filed
- Investment sales: $99, all accounts
- Principal residence sale: $99 per sale
- Rental or investment property sale: $249 per property (includes property owned under 12 months and assignment sales)
- T1135 foreign property: simplified $149, detailed $299
- Foreign income with no Canadian slip: $149
- Employment expenses (T2200/T777): $149
- Moving expenses: $149

Triage (no automatic price, goes to staff): crypto or options, property held in a partnership or trust, foreign tax return needed, treaty claims, GST/HST on an assignment not handled at closing, required documents missing.

Out of scope (routed to Hashim): non-resident, US person, estate or trust, prior years, CRA review underway.

Prices are edited only on an owner-only Price Book admin page.

## Document vault (like Dext)
- Every generated and signed document stored as a file, with a record: client, type, version, created by, sent date, signed date, status, signing record.
- Staff can search by client, filter by type and status, open and download.
- Backups: Supabase backups plus a regular export to a firm records folder Hashim chooses. Never export into client folders on the T: drive (those sync to the client portal).

## Phase 2: Concept Studio (do not start until Phase 1 is approved)
Concept Studio today is a single HTML tool on claude.ai: engagement letters (T1, corporate master letter with service schedules), proposals (single price and multi-option), price floors, packages, PDF output. Its data lives in Notion. It moves into this app; Notion data is copied in once, then the app is the source.

## Open decisions (ask Hashim, do not assume)
- Where the app's pages are hosted (prefer Canada for anything holding client data)
- Where the screening form lives (in this app or elsewhere)
- How HST appears on the quote (it depends on the client's province)
- Whether the app emails the signed copy to the client
- The exact engagement terms text on the quote (based on the firm's current T1 engagement letter)
- Address for the app (for example quotes.conceptaccounting.ca)

## How to work with Hashim
- Plain words, short answers. Answer first.
- Anything Hashim must do himself: one click-by-click step at a time, then wait for his screenshot.
- Staff never use a command line. Everything they use is screens and buttons.
- Show a working preview with dummy data before calling anything done.
- Ask before doing anything outside this repo.
