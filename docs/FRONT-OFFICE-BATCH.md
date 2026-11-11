# Concept Studio: front office batch (the client spine)

Prepared Nov 11, 2026 for Claude Code. Hashim Awad approved every item below. Every decision is final. Build it as written. Do not reopen decisions or ask Hashim to choose again. Ask only if something in the code makes an instruction impossible.

## How to use this batch

1. Save this file as `docs/FRONT-OFFICE-BATCH.md` and the attachments in `docs/front-office/`:
   - `Front-office-screen-mockups.zip` (Appendix A): the five approved screens.
   - `Client-workflow-diagram.zip` (Appendix B): the approved swimlane workflow.
2. **Timing:** finish the Phase 3 step you are on now. Then build this batch in full. Then resume Phase 3 where you stopped. Do not run this batch and Phase 3 at the same time.
3. Update `docs/BRIEF.md` first. Where the brief, PHASE2-BATCH.md or PHASE3-BATCH.md disagree with this file, this file wins.
4. Reply with a build plan in plain words: steps in section 12's order, tests per step, and anything in the code that makes an instruction impossible. Do not build until Hashim approves the plan.
5. Test project, dummy data only. Nothing reaches Live until Hashim approves each step.
6. Standing rules still apply: no price breakdown to clients anywhere, brief first, tests grow with each step, plain-words change log.

---

## 1. The spine: one path for every client

Every client, whatever they buy and however they arrive, goes through the same five stages. Each stage has one place in Studio and one record type.

| Stage | Where | Record |
|---|---|---|
| 1. Lead | Leads | Lead (two front doors: online start page, or phone) |
| 2. Offer | Quotes | Quote (personal tax, company year-end, or monthly proposal) |
| 3. Signed engagement | Engagement letters | The signed quote or letter, signed online in Studio |
| 4. Client | Clients | Client record, added on signing as "waiting for TaxDome", matched at the next TaxDome import |
| 5. Work | TaxDome (jobs, invoices); Closebook (year-end files, from the client database) | Unchanged |

**Who does what (Appendix B):**
- Client: fills the online start page or calls; signs online.
- Asmaa (staff): takes phone calls and enters the screening answers in Studio.
- Studio: one screening and price engine; issues the quote; files the signed letter; adds the client.
- Hashim: out-of-scope and "needs you" follow-ups; **every monthly company call** and its proposal; final review and filing.
- TaxDome: portal, deposit invoice, job pipeline.
- Closebook: new file from the client database, year-end work.

## 2. Leads

**Two front doors, one list.**
- Online: the public start page, as built in Phase 2.
- Phone: a primary button **"New lead by phone"** on the Leads page.

**"New lead by phone" opens the same screening the client sees online, in staff mode:**
1. Who is calling: name, email, phone, province; or pick an existing client from the client database.
2. What they need: "My personal tax return" or "My company".
3. The screening questions: the same steps, wording and order as the online form, using the same engine (section 4).
4. A live price panel beside the questions, updating as answers are entered. Visible only to staff with the Pricing permission. Staff tell the client the one total, never line prices.
5. Finish with one of: **Issue quote** (sends the quote email, section 3), **Save as draft**, or **Send to Hashim** (out of scope, needs Hashim, or a monthly company).

For a phone lead, Asmaa's answers count as the client's answers. The client does not redo the screening online.

**Leads list:**
- Filters: Open / Closed / All, and source: Any / Website / Phone.
- Columns: Name, Type (Personal tax, Company year-end, Monthly company), Source (Website, or "Phone (staff name)"), Received, Status (New, Quote sent, With Hashim, Signed, Lost), Next (the next action and who does it, for example "Issue quote (Asmaa)", "Discovery call (Hashim)").
- The menu badge counts new leads.
- A signed quote closes the lead.

## 3. Quotes (rename "Proposals" to "Quotes")

**One record type for every offer:** personal tax quotes, company year-end quotes, and monthly proposals. All three use the same statuses: Draft, Sent, Viewed, Signed, Declined, Expired.

**Quotes page:**
- Rename the menu item and page "Proposals" to **"Quotes"**.
- Filters: type (All, Personal tax, Company year-end, Monthly proposal) and status.
- Columns: Client, Type, Source, Total, Sent, Expires, Status.
- Total shows only to staff with the Pricing permission.
- One primary button: **New proposal** (opens the builder, section 5).
- The whole section lives under one address (`/quotes`). Move the builder out of `/documents/proposal`.
- "Recent proposals" is this list. It is no longer a step in the builder.

**Every quote:** valid 21 days; sent by email with a signing link; signed online with the Phase 2 signing engine.

**Phone quotes (personal tax and company year-end):** the quote email adds this line, exactly:
> This quote is based on what you told us on [date]. If anything was missed, tell us before you sign.

## 4. One price engine

The Phase 2 screening and pricing engine is the only engine that produces client-facing prices: online quotes, phone quotes, and the price panel. It reads the live price book.

## 5. Proposal builder (monthly companies, Hashim)

Fix the seven items from Hashim's review:
1. **It saves.** A proposal is a quote record with a status from the moment it is started (Draft), and appears in the Quotes list.
2. **One way to accept.** The client opens the proposal, picks an option and signs online, in one step. Remove every "reply to this email with your choice" instruction. The chosen option becomes the corporate engagement letter and is signed in that same step.
3. **Choosing a package fills it in.** Selecting a package fills its services and prices from the price book. The price floor check stays.
4. **No risky defaults.** No fee is pre-filled in a way that reads as the full fee. The main fee starts empty and the proposal cannot be sent until it is filled. Software shows on its own line, never folded into the monthly fee.
5. **Defaults do not clash.** "Team or brokerage" opens as one option with no warning. The "add a second option" warning shows only when staff choose the Options format and have fewer than two options.
6. **What sells is ticked.** For a team, Monthly P&L report and Quarterly production and financial review are ticked by default.
7. **Recent proposals** is removed from the builder's steps (it is the Quotes list, section 3).

## 6. T1 price check (internal, in Settings)

- Move the existing T1 pricing calculator **as it is** to **Settings › Pricing › "T1 price check"**.
- Owners and staff with the Pricing permission only. Lock icon from the real permission.
- It reads the live price book. It does not create leads, quotes or records.
- Purpose: Hashim cross-checks that the client-facing engine prices correctly, and tries price changes before they go live.
- Remove its tab from the Quotes page.

## 7. Engagement letters

**The archive of every signed letter, whatever the path.**
- Tabs: **Waiting for signature** (opens by default), Signed, All.
- Columns: Client, Letter, Came from (Quote (phone), Quote (website), Proposal (option chosen), New letter), Sent, Signed, Status.
- The menu badge counts letters waiting for a signature.

**Quote route:** for personal tax and company year-end, the signed quote is the engagement letter. It is filed here automatically. For a monthly proposal, the chosen option becomes the corporate letter and is filed here when signed.

**New letter (owners):** for clients who never go through a quote (renewals, a new service, a changed fee).
- Opens the existing Letter Builder unchanged: the Corporate / Personal tax switch at the top, the four steps (Client, Services, Fees, Payment), the live preview.
- When marked **Final**, the letter is sent for **online signing** with the same signing engine, so it appears under "Waiting for signature" and moves to "Signed" automatically. No TaxDome or Adobe signing needed.
- **Keep "Download PDF"** for the final version, always available.

## 8. Clients

- Add a **Status** column: "Active" or "Waiting for TaxDome", with a filter for each.
- A signed quote or letter for a new client adds a client record as "Waiting for TaxDome".
- The TaxDome import matches it (Business Number first, then legal name, as built) and sets it to "Active". TaxDome stays the master list.
- Add an **Import from TaxDome** button on the page, next to Add client.

## 9. Engagements

- Created automatically when a quote or letter is signed: client, service, year-end, fee, signed date.
- Replace the wording-version label under each engagement (EL v3.18, Pre-Studio template) with a **Came from** column. Keep the wording version inside the engagement record.
- Keep **Update** (owners) on every row, for: older engagements signed outside Studio (dates and status entered by hand), status changes (on hold, client left), and ending an engagement.

## 10. My day

Add: quotes waiting for signature, and quotes expiring this week.

## 11. Menu

- Sales: Leads, **Quotes**, Engagement letters.
- Hide every "Soon" item (Work: Personal tax (T1), CFO reports, Owner pay planner, Incorporations; Quality: Reviews) until each is built.
- Closebook is unaffected: its only link to the rest of Studio stays the client database, and the engagement letter status in Closebook stays owner-set, as in PHASE3-BATCH.md.

## 12. Build order

1. Quote record with statuses, one address (`/quotes`), the rename, and online pick-and-sign for proposals (sections 3 and 5, items 1 and 2).
2. Leads: "New lead by phone" with the staff-mode screening and price panel; Source, Status and Next columns; the phone-quote email line (sections 2 and 3).
3. Proposal builder: package pre-fill and the safe defaults (section 5, items 3 to 7).
4. Engagement letters: archive, tabs, Came from, New letter with online signing and PDF download (section 7).
5. Clients status and automatic client records; Engagements created on signing with Came from and Update (sections 8 and 9).
6. T1 price check moved to Settings; menu changes; My day additions (sections 6, 10, 11).

Each step: tests, a preview on dummy data, Hashim's approval, then Live.

## 13. Appendices

- **A.** `Front-office-screen-mockups.zip`: the five approved screens (Leads, Quotes, Engagement letters, Clients, Engagements). Sample data only. Match their structure, labels, columns and order; build with Studio's existing components and styles.
- **B.** `Client-workflow-diagram.zip`: the approved swimlane diagram (Client, Asmaa, Studio, Hashim, TaxDome, Closebook), lead to year-end.
