# Concept Studio: Phase 2 instruction batch

Prepared Nov 9, 2026 for Claude Code. Hashim Awad approved every item below in planning sessions. Nothing here has been sent before unless a section says so.

## How to use this batch

1. Save this file in the repo as `docs/PHASE2-BATCH.md`.
2. Update `docs/BRIEF.md` first, so the brief matches this batch. Where this batch and the brief disagree, this batch wins.
3. Reply with a plan in plain words: what you will build, in what order, and your questions. Do not build until Hashim approves the plan.
4. Build and test in the Test project with dummy data only. Never real client data in testing.
5. Some items may already be done (sections 13 and 14 say which). Check the code first. Report what was already in place instead of building it twice.
6. Every decision in this batch is final. Build it as written. Do not reopen these decisions or ask Hashim to choose again. Ask only if something in the code makes an instruction impossible.

Order of work: sections 1 to 3 first (rules and permissions), then 4 to 9 (personal tax route), then 10 to 12 (corporate routes), then 13 to 15 (fixes and Phase 3 text).

---

## 1. Standing rules (record in docs/BRIEF.md)

**1.1 No price breakdown to clients.** A client never sees the price book, a line price or any per-item amount, anywhere: quote, engagement letter, emails, signed PDF, download page. The client sees the services included and one total fee, plus GST/HST. This applies to personal (T1) quotes and to auto-priced corporate quotes. The full breakdown is stored with the signed quote and shown only to staff with the Pricing permission (section 2).

**1.2 Living-system maintenance rules.** The app keeps growing, so every change follows these rules:
- The brief is updated first, before the code.
- Every change is tested in the Test project before it reaches the live project.
- Automatic tests grow with the app. A new feature adds its tests.
- The app keeps a change log in plain words that Hashim can read.
- Backups are restored once before go-live, and once a year after that, to prove they work.

---

## 2. Permissions

Add a **Pricing** permission covering: the price book, quote amounts, quote breakdowns and the Issue quote action.
- Only roles with it can see prices or issue quotes. Today that is the owner role (Hashim and Asmaa).
- Other staff see leads, clients and documents with no prices anywhere.
- Permissions are tied to roles, never to staff names.

---

## 3. Lead alerts

- When a lead submits, email everyone with the Pricing permission immediately, through the firm's Microsoft 365 mail. The email shows: lead type (personal or corporate), household (single or couple), province, quote total (or "call needed"), and a button to open the lead.
- Show a timer on the lead in My day, for example "Waiting 25 min".
- If the quote is not marked sent within 45 business minutes, send a second email.
- Business hours are set in Settings. The timer counts business hours only.
- The client's confirmation screen says the quote will arrive by email. It never promises a time.

---

## 4. Personal tax (T1) screening questions

Principles: out-of-scope questions come early, so clients who don't fit stop quickly. Branching opens only what applies. No SIN and no document uploads at this stage.

**Couples.** Per-property and per-business add-ons are charged once per household. Per-return add-ons are charged per spouse: investment sales, crypto, T1135, foreign income, employment expenses, moving expenses, US returns. Example: both spouses have investment sales = 2 x $99. From question 8 on, couples answer each question for Me / Spouse / Both.

**Section 1: About you**
1. Full name, email, phone.
2. Province or territory you lived in on December 31. *Sets the GST/HST line.*

**Section 2: Fit check** (any answer below that routes out of scope shows a polite message, flags the lead for Hashim, and produces no quote)
3. Did you live in Canada for the whole year? No = out of scope.
4. Are you a US citizen or green card holder? Yes = out of scope.
5. Is this return for someone who passed away, or for a trust? Yes = out of scope.
6. Do you need a return for an earlier year, or a change to one already filed? Yes = out of scope.
7. Is CRA reviewing or auditing any of your returns right now? Yes = out of scope.

**Section 3: Who is filing**
8. Just me (**PTX-110, $299**), or me and my spouse or partner, living together (**PTX-111, $349**).
   - Couple: spouse's name and email, for their signing link.

**Section 4: Your income and claims** (each yes opens follow-ups)
9. Self-employment or commission income, not through a corporation?
   - How many businesses? **PTX-121, $499 each.**
   - Can you give us total income and expenses for each? No = out of scope.
   - Did you use a vehicle for the business? How many? **PTX-122, $150 each.**
   - Work from home for the business? **PTX-123, $150 per business.**
   - Registered for GST/HST? Filing annual, quarterly or monthly? **PTX-124, $149 per return filed.**
10. Rental income, including Airbnb or a rented basement?
    - How many addresses? **PTX-120, $249 each.** A property co-owned with your spouse counts once. Short-term rentals use PTX-120 at the same price.
11. Sold a property this year?
    - Your home: **PTX-126, $99.**
    - Rental, investment, owned under 12 months, or an assignment: how many? **PTX-127, $249 each.**
    - Assignment: was GST/HST handled at closing? No or Not sure = out of scope.
12. Sold stocks, ETFs or mutual funds outside an RRSP or TFSA? **PTX-125, $99.**
13. Traded crypto or options? **PTX-133, $249.**
    - Do you have a gains report from your exchange or crypto software? No = out of scope.
14. Foreign property (accounts, shares, property abroad) that cost more than $100,000 in total at any time?
    - Did it cost $250,000 or more at any time? No: **PTX-128, $149.** Yes: **PTX-129, $299.**
    - The question says "cost", never "value".
15. Income from outside Canada with no Canadian slip (foreign pension, job or bank interest)? **PTX-130, $149.**
16. Do you need a tax return filed in another country?
    - US: **PTX-135, $799,** plus how many state returns, **PTX-136, $249 each.**
    - Any other country: out of scope.
17. A T5013 slip from a partnership? How many? **PTX-134, $149 each.**
18. A signed T2200 from your employer? **PTX-131, $149.**
19. Moved at least 40 km closer to a new job, business or full-time school? **PTX-132, $149.**
20. Anything else we should know? Free text, no price.

**Section 5: Last**
21. How did you hear about us? (Lead source list, editable in Settings.)
22. Consent to Concept using the answers to prepare a quote.

**Example:** a couple, both employed, one rental, he has stock sales: $349 + $249 + $99 = **$697** before GST/HST.

**Rules checked on canada.ca:** the 40 km moving-expense rule (Nov 9, 2026) and the $100,000 and $250,000 T1135 thresholds. Store both as editable values on the admin page, not hard-coded, so a CRA change needs no code.

---

## 5. Price book changes

**5.1 Renames:**
- PTX-101: "Owner's personal tax return (T1)"
- PTX-110: "Personal tax return (T1), single"
- PTX-111: "Personal tax returns (T1), couple"

**5.2 PTX-100 "Personal tax return services".** Add it as an invoice-only item: Personal tax service line, QBO income account 4020 Tax Preparation - Personal (T1), no price, never shown on quotes, never selectable in screening. It already exists in TaxDome and QBO. When staff create the TaxDome invoice from a signed T1 quote, Studio shows one line to copy: item PTX-100 "Personal tax return services, [tax year]", amount = quote total before tax, and the GST/HST rate for the client's province.

---

## 6. The T1 quote document

The quote and the engagement letter are one document: Part A (the quote), Part B (the engagement terms), Part C (signing). The exact approved wording is in **Appendix A** of this file. Use it word for word. Fields in [square brackets] are filled by Studio.

- The quote is valid for 21 days after it is marked sent.
- The DRAFT FOR REVIEW watermark shows only on unsent quotes in staff preview. The client's copy never shows it.
- The signer name on the letter comes from Settings: "Hashim Abouelfetouh, CPA".
- Store the approved wording as a template, so Hashim can edit it later from the Templates page without code changes.

---

## 7. Couple quotes: one quote, two signers

- One quote, one document, one price. The pre-drafted email goes to both spouses and contains two signing buttons, one per spouse by name.
- Each button is that spouse's private link. The signing record ties each signature to its own link.
- The quote shows who has signed and who is waiting ("Signed by [name], waiting for [name]"). It counts as signed only when both have signed. Then both get the download page and the TaxDome sign-up step.
- After the first spouse signs, offer: "Is [spouse] with you? They can sign now on this device." The second spouse types their own name and ticks consent. The record notes same-device signing.

---

## 8. The quote email

Staff copy this from Studio and send it from their own Outlook, then click "Mark as sent", which starts the 21-day clock. Studio fills every bracket. The sender block shows the person sending (Asmaa Ibrahim or Hashim Awad) with their own email.

**Single filer**

Subject: Your [tax year] personal tax quote

> Hi [first name],
>
> Thank you for trusting Concept Accounting with your taxes. We're glad to have you with us.
>
> I reviewed your answers, and your quote for your [tax year] return is ready. It shows what's included and your fee, and it's also your engagement letter.
>
> Here's what happens after you sign:
> 1. You'll go straight to our secure client portal to create your own account.
> 2. A short form will be waiting for you there. It walks you through which documents to upload and reminds you of the credits and deductions you may qualify for, so nothing you're owed gets missed.
> 3. Once your documents are in, we send your invoice, prepare your return, and send it to you to review and sign before we file.
>
> Your quote is valid until [date].
>
> [Review and sign your quote]
>
> Asmaa Ibrahim
> Concept Accounting & Advisory Professional Corporation
> 226-789-9591 | asmaa@conceptaccounting.ca

**Couple, two signers**

Subject: Your [tax year] personal tax quote

> Hi [first name] and [first name],
>
> Thank you for trusting Concept Accounting with your taxes. We're glad to have you both with us.
>
> I reviewed your answers, and your quote for your [tax year] returns is ready. It shows what's included and one fee for both returns, and it's also your engagement letter. Each of you signs with your own button.
>
> Here's what happens after you both sign:
> 1. You'll go straight to our secure client portal to create your own account.
> 2. A short form will be waiting for you there. It walks you through which documents to upload and reminds you of the credits and deductions you may qualify for, so nothing you're owed gets missed.
> 3. Once your documents are in, we send your invoice, prepare your returns, and send them to you to review and sign before we file.
>
> Your quote is valid until [date].
>
> [[First name], review and sign]
> [[First name], review and sign]
>
> Asmaa Ibrahim
> Concept Accounting & Advisory Professional Corporation
> 226-789-9591 | asmaa@conceptaccounting.ca

Store both as editable templates. Example wording anywhere in the app uses Asmaa, not Joycelyn.

---

## 9. After signing (T1)

- The signed page shows "Signed. Download your copy." and a button "Continue to the secure portal" that goes to `https://portal.conceptaccounting.ca/en-us/signup`.
- The client picks "My personal tax return" on the TaxDome sign-up page. TaxDome starts the job in the T1 pipeline. That part is already set up in TaxDome and needs no code.
- The TaxDome invoice is created by staff after the organizer and documents are in, using PTX-100 (section 5.2).

---

## 10. Corporate route: the form

The start page offers two routes, labelled exactly:
- **My personal tax return**
- **My company** (small text under it: "Year-end, tax return or monthly bookkeeping")

Show the questions exactly as written below. Text in *[brackets]* is for staff and the pricing engine, and never shows to the client.

**Your details** (first, so a lead who drops off is still captured)

The form does not ask for the company's legal name. Staff enter it on the lead before the quote can be issued. Studio blocks "Issue quote" until it is filled in.

- First name *
- Last name *
- Email *
- Province *

No phone number on this form.

**1. What do you need?** *
- Year-end financial statements and tax return for my company
- Monthly bookkeeping all year, plus the year-end *[route: call, section 12]*

**2. Do you also need any of these?** Check any that apply.
- GST/HST return *[+$199]*
- Tax slips for people the company paid (employees, contractors or yourself) *[included, no price]*

**3. How are your company's books kept today?** *
- A bookkeeper or accountant keeps them *[base $1,800]*
- We keep them ourselves in accounting software, like QuickBooks or Xero *[base $2,400]*
- We don't keep books, but we have bank and credit card statements *[base $2,900]*
- We only have paper receipts *[route: call]*

**4. How many of these does the company have?** *(Shows only for the bank-statements answer in question 3.)*
- Bank accounts: [number]
- Credit cards: [number]
- Lines of credit: [number]
- Bank loans: [number]
- Car loans or leases: [number]

*[Pricing: the base includes 1 bank account and 1 credit card. +$250 for each additional bank account, credit card or line of credit. +$100 for each bank loan or car loan or lease.]*

**5. When does your company's year end?**
- [Month] [Day]
- [ ] I'm not sure

**6. What does your company do?** *
[Short answer. Placeholder: "for example: real estate, dental office, IT consulting"]

**7. Do any of these apply?** Check any that apply.
- We are behind on our tax returns by more than one year *[route: call]*
- We own more than one company *[route: call]*
- The company bought or sold a building, land or shares this year *[route: call]*
- The CRA is reviewing the company *[route: call]*

**Monthly-only questions** (show only when question 1 is "Monthly bookkeeping all year")

**A. Roughly how much does the company earn in a year, before expenses?**
- Under $1 million
- $1 million to $3 million
- $3 million to $5 million
- Over $5 million

**B. How many people does the company pay?**
- Just me
- 1 to 5
- 6 to 20
- More than 20

**C. Are your books up to date today?**
- Yes, up to last month
- A few months behind
- More than a year behind

**Thank-you screen, auto-price path**
> Thank you. We have your answers. A member of our team will review them and email you your quote.

**Thank-you screen, call path**
> Thank you. Your situation needs a short conversation so we quote it correctly. Choose a time below.
> [Booking button. The booking link is a field in Settings that Hashim fills in.]

**Staff-only flags on the lead**
- Every corporate lead is marked "first year with Concept". Staff add the TaxDome tag `1st-yr client` when the account is created (show this as a checklist item on the lead after signing).
- "I'm not sure" on the year-end date flags the lead for staff to confirm before the quote goes out.
- The business type answer is shown to staff so they can set TaxDome tags (for example PREC or RE Team for real estate).

---

## 11. Corporate route: year-end price book and routing

**Routing**
- Auto-price: question 1 is year-end, question 3 is one of the first three answers, and no box in question 7 is checked.
- Call: question 1 is monthly, or question 3 is paper receipts, or any box in question 7 is checked.

**New price book items** (service line Corporate tax (T2); all prices before GST/HST; edited only on the owner-only Price Book page). Use these codes. If one clashes with an existing code, take the next free number in the same series and report it.

QBO income accounts: YE-110, YE-111, YE-112, YE-120 and YE-121 use the same income account as YE-102 (Compiled financial statements and T2). GST-110 uses the same income account as GST-101 (GST/HST returns).

| Proposed code | Item | Price | Unit |
|---|---|---|---|
| YE-110 | Year-end, books kept by a bookkeeper or accountant | $1,800 | per year-end |
| YE-111 | Year-end, books kept by the owner in accounting software | $2,400 | per year-end |
| YE-112 | Year-end, bank and credit card statements only (includes 1 bank account and 1 credit card) | $2,900 | per year-end |
| YE-120 | Additional bank account, credit card or line of credit | $250 | per account |
| YE-121 | Bank loan, or car loan or lease | $100 | per loan or lease |
| GST-110 | Annual GST/HST return (corporate) | $199 | per return |

**Included in every year-end base fee, no separate price:** compiled financial statements (accepted by banks and lenders), the T2 return, T4, T4A and T5 slips, owner tax planning, the shareholder loan schedule, fixed assets and CCA, and first-year setup.

**Example:** bank statements only, 2 bank accounts, 1 credit card, 1 line of credit, 1 car lease, plus a GST/HST return:
- Base (YE-112): $2,900
- Additional bank account (YE-120): $250
- Line of credit (YE-120): $250
- Car lease (YE-121): $100
- GST/HST return (GST-110): $199
- **Total: $3,699 before GST/HST**

**Corporate year-end quote document.** Same structure as the T1 quote: one page, Part A (the quote), Part B (the terms), Part C (signing). The same signing, versioning, 21-day expiry, watermark and no-breakdown rules apply.

- **Part A:** use the wording in **Appendix C** exactly.
- **Part B:** the corporate year-end engagement terms already approved in Concept Studio (the corporate master letter with its year-end schedule), word for word. Change only two things: the fee wording points to the amount in the quote, and add the electronic-signature sentence used in the T1 letter (Appendix A, section 10). Record both changes in the same "changes from the master wording" format as Appendix A.
- **Part C:** the same signing section as the T1 letter. After signing, the page offers "Download your copy" and "Continue to the secure portal".

**Corporate year-end quote email.** Use the wording in **Appendix C**, sent the same way as the T1 email (copied from Studio, sent from the staff member's own Outlook, then "Mark as sent").

**Payment for year-end-only clients** follows the existing year-end letter: a 50% deposit invoice after signing, and the balance invoice at client approval. Studio shows staff both amounts to copy into TaxDome.

---

## 12. Corporate route: monthly leads (always a call)

- The lead page shows all the answers before the call, including questions A to C.
- **Real estate leads** (agents, teams, brokerages): Studio suggests a package from the revenue band:
  - Under $1 million: "Agent" for a single agent; "Team: Essential" for a team or brokerage (corrected by Hashim, Nov 9, 2026)
  - $1 million to $3 million: Core
  - $3 million to $5 million: Finance Office
  - Over $5 million: Custom (priced by Hashim)
- **Every other industry:** Studio fills in all the answers but leaves the price blank for Hashim to set. Do not suggest a package.
- After the call, a **"Create proposal"** button on the lead opens a draft in the existing Studio proposal flow, filled in with: client name, email, province, business type, books status, revenue band, people paid, and the suggested package where one applies. Staff adjust it and send it through the existing proposal and engagement letter flow.
- Use the existing package prices and price floors. Do not change them.

---

## 13. Design fixes (check first; some may already be done)

1. Sidebar active item: no white text on Concept green. Use navy text on green, or a navy-tint highlight with a green marker.
2. DRAFT FOR REVIEW watermark: only on unsent quotes in staff preview.
3. Sidebar: style or hide the browser scrollbar, and fit the menu without scrolling on a normal laptop screen.
4. Dates: one readable format everywhere on screen, for example "Nov 5, 2026".
5. Layout: page content uses the full width beside the sidebar.
6. Menu labels: no truncated labels.

---

## 14. Import fixes from Phase 1 (check first; some may already be done)

1. Service Catalog: the "Order" column must accept decimals (PTX-129 has 51.5). Confirm PTX-129 was imported; import it if not.
2. Engagements: the import fails with "Linked client not found". Match each engagement to its client in the app and report any that cannot be matched. Do not guess a match.
3. Proposals: import after the Engagements fix.

---

## 15. Phase 3 text (do not build yet)

Replace the entire PHASE 3 section of `docs/BRIEF.md` with the text in **Appendix B**. If the brief already holds this exact text, report that and change nothing. Do not build Phase 3 yet. Design the foundation so it fits.

Add this note under Phase 3, section D (Intake): "Monthly clients (TaxDome tag BK) get the Home Office & Auto organizer instead of the CORP year-end organizer. The TaxDome pipeline 'TX - Corporate Tax (T2) - Year-End' handles all corporate year-ends, with tag conditions."

---

## 16. Settings Hashim fills in before go-live

These are values, not decisions. Build the fields; Hashim enters them.
- Business hours (section 3).
- Booking link for the call path (sections 10 and 12).
- GST/HST rate table: already checked against canada.ca on Nov 8, 2026. Hashim approves it on the rate table page before any quote uses it.

---

## Appendix A: T1 quote and engagement letter (approved wording)

Use word for word. The "How it works" notes and the "Changes from the TaxDome master wording" table at the end are for staff and Claude Code, not for the client page.

### How it works

The client reads and signs one page in Concept Studio: the quote first, the engagement terms second, the signature last. Signing the page accepts both the fee and the terms.

- Source: the approved T1 master wording (EL v3.31, the TaxDome template "Individual - Personal Tax Return Engagement T1"), changed only where the new flow requires it. Every change is listed in the last section.
- The client never sees a line price, a per-item amount or the price book. Only the services included and one total.
- Fields in [square brackets] are filled by Studio from the screening answers.
- Writing standard: plain words, short sentences, no em dashes.

### Part A: Your quote

**Concept Accounting & Advisory Professional Corporation** 675 Riverbend Dr., Kitchener, ON N2K 3S3

**Quote and engagement letter: personal income tax [return / returns] for the [tax year] tax year**

Prepared for: [Client name] [and Spouse name] Prepared by: [Asmaa Ibrahim / Hashim Awad], [date] Valid until: [date, 21 days after it is sent]

**Services included**

- Preparation and electronic filing of [your / both] [tax year] T1 Income Tax and Benefit [Return / Returns]
- [One line for each item from the screening answers, in plain words, for example:]
  - Rental income for 1 property (Form T776)
  - Self-employment income for 1 business (Form T2125), including vehicle and home office expenses
  - GST/HST return for your business
  - Sale of investments
  - Foreign property reporting (Form T1135)
- A CPA reviews every return before it is filed

**Your fee: $[total] plus GST/HST**

Your fee covers the services listed above. If your documents include work that is not listed, such as another rental property or a property sale, we confirm the added fee with you in writing before we start that work.

**What happens next**

1. You sign this quote and engagement letter below.
2. You create your secure client portal account. The portal is where you send us your documents and pay your invoice.
3. In the portal, you complete your tax organizer. It is a short online form where you confirm your details and upload your tax slips and receipts. It also shows you, step by step, how to give us access to your CRA information.
4. We send your invoice once your organizer and documents are in. You pay it in the portal.
5. We prepare your return and a CPA reviews it. We send it to you to review and sign Form T183, then we file it.

### Part B: Engagement terms

Dear [Client name],

Thank you for choosing Concept Accounting for your personal income tax. This letter sets out the services we will provide, your responsibilities and ours, and how our fees work. Please read it and sign it to confirm.

This letter applies to the [tax year] tax year and to each later year we prepare your return, until either of us ends it in writing.

**1. Our services**

We will prepare and electronically file the T1 Income Tax and Benefit Return listed in your quote. If your spouse or common-law partner is also included, we will prepare their return too, and each of you must sign.

Each return will include the schedules and forms that apply to you, based on the information you give us. These can include employment and investment income, self-employment or commission income (Form T2125), rental properties (Form T776), foreign property reporting (Form T1135), and the sale of property, including the principal residence designation where it applies.

GST/HST returns. If you have self-employment income and we prepare your GST/HST return, we prepare it from the information you give us. We do not audit or verify it. You are responsible for keeping the records that support your claims and for any tax, interest or penalties if CRA disallows a claim.

We prepare your return from the information and documents you give us through your tax organizer. We do not audit or verify that information, although we may ask you to clarify it.

**2. Your responsibilities**

You are responsible for:

- giving us complete and accurate information, including all tax slips, receipts and records, before we start;
- confirming that the expenses you claim are supported by records and are not personal, such as haircuts, vacations, household costs or personal vehicle use, because personal expenses cannot be deducted;
- keeping your records and supporting documents for the period the Income Tax Act requires, as CRA may ask for them;
- reviewing your return carefully before you sign Form T183, because you have final responsibility for your return; and
- telling us about any CRA letter, review or reassessment you receive.

Our work cannot be relied on to prevent or detect fraud, errors or omissions. That responsibility stays with you.

**3. CRA access**

We need Level 2 online access to your CRA information to prepare your return. Your tax organizer explains how to give it. We start work once access is in place. You can cancel our access at any time in your CRA account.

**4. Filing and deadlines**

When your return is ready, we will send you Form T183. You must review the return and sign Form T183 before we can file it.

Returns are due April 30 of the year after the tax year. If you or your spouse or common-law partner had self-employment income, the filing deadline is June 15, but any balance owing is still due April 30. Late filing and late payment can result in penalties and interest.

**5. Fees and payment**

Your fee is the amount in your quote. It is one fee for the year's return, set from your answers to our scope questions.

- Invoice: we send your invoice once you complete your tax organizer and upload your documents. The invoice is paid before we begin work.
- If your return changes: if your documents include work that is not listed in your quote, such as a rental property, a property sale, foreign property or self-employment income, we confirm the added fee with you in writing before we start that work.
- Late or changed information: if you send slips or information after we have prepared your return and we must redo part of it, we quote the added fee before we do that work.
- Release and filing: we file your return, and release it to you, once your invoice is paid.
- Payment: you pay online through your secure client portal. GST/HST is added to each invoice. Invoices are due on receipt. Interest may be charged on balances unpaid for more than 30 days at 1.5% per month (19.56% per year).
- Questions about your return are included in your fee.
- Legal requests: if a law, regulator or court requires us to produce our files or answer requests about your return, we bill the time and costs involved.

**6. What is not included**

This letter does not include:

- CRA reviews, audits, objections or representation;
- tax planning or advice;
- prior-year returns;
- bookkeeping, or GST/HST returns unless they are listed in your quote;
- payroll, EHT, WSIB or other taxes and levies;
- foreign income tax returns or advice on foreign taxes, unless they are listed in your quote.

If you ask for any of these, we will quote them in writing first.

Unless your quote includes your GST/HST return, we do not review your GST/HST. We may not notice if GST/HST is being collected or claimed incorrectly. Errors can lead to tax, interest and penalties.

**7. Foreign property and foreign reporting**

CRA requires information returns, with significant penalties for filing late or not filing, if at any time in the year you:

- held specified foreign property, such as foreign bank accounts, foreign real estate or shares of foreign companies, costing more than $100,000 in total;
- owned at least 10% of a foreign company, alone or together with related persons; or
- sent money or property to, received money or property from, or were owed money by a non-resident trust, including an inheritance from a foreign estate.

You agree to answer the foreign property questions in your tax organizer completely and to tell us about any of these each year.

**8. Our judgment**

Tax law is not always clear. Where it is unclear, we use our professional judgment to choose a supportable position. Our conclusions are matters of professional opinion, not certainty. CRA may not agree, and you have rights of appeal if it proposes changes.

**9. Your information and confidentiality**

We collect, use and keep your personal information only to provide our services, under our privacy policy (conceptaccounting.ca/privacy-policy) and Canadian privacy laws. If you give us information about another person, such as a spouse or dependant, you confirm you have their consent.

We keep your information confidential and release it only with your consent or as the law requires. Our files may be reviewed by practice inspectors of CPA Ontario, as professional standards require; those inspectors are bound by confidentiality.

Our team includes members and service providers located outside Canada, so your information may be stored or accessed outside Canada, under confidentiality terms equal to ours.

**10. Electronic communications and signatures**

We communicate by email and through our secure client portal. No one fully controls the security of the internet. We are not liable for loss caused by delay, interception or failed delivery of messages sent outside our own systems.

You agree that signing this letter electronically has the same effect as signing it by hand.

**11. Limitation of liability**

Our liability for any claim arising from this engagement, whether in contract, tort or otherwise, is limited to the fees you paid us for the return in question. It does not cover consequential or indirect losses. Our liability is several and not joint: you may only recover our share of any loss, based on our degree of fault. We are not responsible for interest or penalties caused by information that was late, incomplete or inaccurate.

**12. Ending this agreement and governing law**

Either of us may end this agreement in writing. You will pay for work done up to that date. We may withdraw before filing if we cannot complete the work, and we will tell you why.

This agreement is governed by the laws of Ontario, and the courts of Ontario have jurisdiction over any dispute.

Yours truly,

CONCEPT ACCOUNTING & ADVISORY PROFESSIONAL CORPORATION [Signer name from Settings: Hashim Abouelfetouh, CPA]

### Part C: Sign

**Sign your quote and engagement letter**

[Client name], type your full name to sign. [Spouse name] signs with their own link.

Your full name: [text box]

Your typed signature: [shown in signature style]

[ ] I have read my quote and these engagement terms, and I agree to them.

[Sign button]

After signing:

**Signed. Thank you, [first name].** Download your copy now. Next, create your secure client portal account to upload your documents.

[Download your copy (PDF)] [Continue to the secure portal]

Couples: the quote shows "Signed by [name], waiting for [name]" until both have signed. If the second spouse is present, the page offers "Is [name] with you? They can sign now on this device."

### Changes from the TaxDome master wording

Seven changes, all required by the new flow. Everything else is word for word from EL v3.31.

| Where | Master wording | New wording | Why |
| --- | --- | --- | --- |
| New Part A | None | Quote: services included, one total, valid 21 days | The quote and the letter are one document |
| Opening | "your current tax year" | "the [tax year] tax year" | The year is known from the quote |
| 1. Our services | "your T1 Income Tax and Benefit Return" | "the T1 Income Tax and Benefit Return listed in your quote" | Ties the letter to the signed quote |
| 5. Fees, first lines | "Your fee is set from your answers... using our fee schedule" and "we send your fee by invoice with this letter" | "Your fee is the amount in your quote" and "we send your invoice once you complete your tax organizer" | Invoice now goes out after the organizer, and the fee schedule is never mentioned to the client |
| 6. Not included | "GST/HST returns unless you ask for them"; foreign returns excluded | "unless they are listed in your quote" for both | GST/HST returns and US returns can now be in the quote |
| 10. Electronic | Communications only | Adds: electronic signature has the same effect as signing by hand | The client signs in Studio, not TaxDome |
| Closing | "By signing below, you confirm..." | Moved to the consent box in Part C | One clear agreement action |

Decisions confirmed by Hashim (Nov 8, 2026):

- **Section 9, data outside Canada:** keep the sentence as written.
- **Signer name:** the letter closes with the engagement-letter signer setting, "Hashim Abouelfetouh, CPA".

---

## Appendix B: Phase 3 brief text

```
PHASE 3: YEAR-END
One section in the left panel, "Year-End", holds the whole engagement end to end. Staff never leave this section to finish a year-end. It is modelled on CaseWare Working Papers and replaces our Excel Compilation Workpaper. Rule throughout: we never ask the client for information we can get ourselves from CRA, the statements or the trial balance.

A. ENGAGEMENT SETUP
- One engagement per client per fiscal year: client, Business Number, fiscal year end, preparer, reviewer, estimated hours, tax software (ProFile).
- Deadlines calculated from the fiscal year end: tax payment deadline (two or three months, set per corporation) and T2 filing deadline (six months). The app works back from the payment deadline.

B. ROLL FORWARD
- If a prior-year engagement exists, bring forward: closing balances as opening balances, account mapping, client vendor rules, permanent documents (articles, shareholder list, prior notices), schedules with continuity (shareholder loan, fixed assets and CCA, retained earnings), and open issues. Show a list of what rolled forward.
- First year in the app: opening balances are entered once from the prior-year statements and T2.

C. ACCEPTANCE AND PLANNING (CSRS 4200)
- Engagement acceptance or continuance, knowledge of the entity, time budget, withdrawal worksheet if needed.
- The signed engagement letter (from the app's letters) must be linked before work starts.

D. INTAKE
- The client completes our TaxDome organizer "CORP - Year-End T2 (year-end clients)". It goes out automatically from TaxDome after the 50% deposit is paid, with reminders every 7 days, 3 times.
- The app records the date the organizer was submitted and links the client's documents to the engagement.
- There are no Excel information request workbooks.

D2. CRA CHECK
- Using CRA Represent a Client, staff record: GST/HST registration status and filing frequency, GST/HST returns filed for the year, corporate tax and GST/HST instalments, and balances owing.

E. GATE A: RECORDS SUFFICIENCY
- Preparer may pass it. Statements present for every month of every account. Client trial balance balances and agrees to the bank reconciliation (where one is provided). First-year clients: prior-year statements and T2 on file.

F. CLIENT TYPE AND DATA IN
- Client type comes from the organizer's accounting records question:
  "No system, statements only" sets Type 1 (Raw Records): we build the books.
  QuickBooks Online or other software makes the client a Type 2 candidate (Client-Prepared TB), confirmed only by the qualification test.
- Type 2 qualification test, recorded pass/fail with a note for each: (1) TB balances, (2) bank and card accounts reconciled to year end, (3) no material suspense or uncategorized balance, (4) prior-year closing balances carry into this year's opening. Any fail: run as Type 1, or Type 2 with a scoped cleanup, recorded in writing.
- Type 1: one register per bank or card account, no row limits. Import by CSV using one firm template only: Date (YYYY-MM-DD), Description, Amount (single signed number: money out negative, money in positive). The app converts card activity correctly. Account, statement period and opening and closing balances are entered at upload. Each upload must reconcile opening to closing before it can be finalized. Statement continuity check: each closing balance equals the next opening; a missing month blocks Gate A. The app validates every file and rejects anything that doesn't match, naming the row and problem. "Download template" button on the upload screen.
- Type 2: import the client's TB by CSV (firm template: Account number, Account name, Debit, Credit). Must balance before use. Map each client account to a GIFI account with drag-and-drop. The mapping is saved per client and rolls forward. Balance support for each balance sheet account: balance per client TB, what supports it, last reconciled.

G. CODING AND SECOND-ROUND REQUEST
- Firm master chart of accounts based on CRA GIFI: code, name, statement (BS or IS), group, sort order. Owner-edited. Initial list loaded from our current workpaper's GIFI COA tab. Per engagement, bank and card accounts are renamed to the client's accounts.
- Each transaction: GIFI account, status (OK or Ask Client), note. Each line books both sides, so the trial balance always nets to zero.
- Vendor rules suggest the account; staff always confirm. Firm-wide rules (owner-managed) and client-specific rules.
- Clearing accounts 1490 CC Payment and 1495 Suspense - Ask Client must be zero before Gate B and Gate C.
- Staff work out shareholder withdrawals, personal expenses, receivables and payables from the statements or trial balance.
- Second-round request: once coding is done, one batch request goes to the client, never one question at a time. It covers: unknown transactions (including shareholder withdrawals), receipts for purchases over $500, assets sold or disposed of during the year (date and proceeds), and any shareholders beyond two (names and ownership). Answers are logged on each item (date, explanation, disposition) as compilation evidence.

H. WORKING TRIAL BALANCE
- Columns: Prior year, Prelim, AJE, RJE, Final, Change. Must net to zero.
- AJE (adjusting) and RJE (reclass) entries, each must balance, with date, memo, reference and preparer.

I. LEAD SHEETS
- One per group: cash, receivables, prepaids, fixed assets, payables, taxes, shareholder accounts, debt, equity, revenue, expense groups.
- Each shows prior year, current year and change, with links to supporting documents and schedules. Workpaper references and tickmarks.

J. SUPPORTING SCHEDULES (general feature)
- Shareholder loan continuity, one per shareholder: opening balance carried forward; corporate expenses paid personally by the shareholder; personal expenses paid by the corporation; advances and repayments in either direction; salary, bonus or dividends credited; closing balance, which must agree to the balance sheet (difference shown until it ties).
- s.15(2) tracking: for any balance owed by the shareholder, record the date it arose. The app calculates the repayment deadline as one year after the end of the corporation's taxation year in which the balance arose, and flags any balance not repaid by then. Record whether repayments may form part of a series of loans and repayments. Any flag blocks Gate B until an owner reviews it. The app flags; it does not decide the tax treatment.
- Also: fixed assets and CCA continuity, HST reconciliation (using the CRA check in D2), accruals, prepaids, retained earnings continuity.

K. BINDER (DOCUMENT MANAGER)
- Every workpaper, schedule, uploaded file and letter, filed in folders by section.
- Each item has preparer and reviewer sign-off. Any change after reviewer sign-off is flagged and shows who changed what and when.
- Review notes tracked until resolved.

L. REASONABLENESS CHECKS AND GATE B
- Checks, each with an explanation field: revenue against GST/HST returns filed; wages against the T4 Summary; asset additions against invoices; prior-year comparatives for anything that moved without explanation.
- Gate B: pre-statement review. Needs the "gate reviewer" permission (owner role by default). Statements cannot be generated before Gate B is passed.

M. FINANCIAL STATEMENTS
- Balance sheet, statement of earnings and retained earnings, notes from a notes library (including the basis of accounting note CSRS 4200 requires), prior-year comparatives, compilation engagement report.
- Checks, all must pass: balance sheet balances; completeness (every account with a balance appears); retained earnings equals prior closing plus net income less dividends; prior-year closing equals this year's opening.

N. CLIENT APPROVAL
- Client approves the statements and signs the management acknowledgement in writing, using the app's signing (same signing record as quotes).

O. GIFI EXPORT
- Assign GIFI codes and export a standard GIFI file (.GFI) for ProFile, with signs adjusted as GIFI requires.
- GIFI export test before Phase 3 goes live: export a GIFI file from a dummy engagement and import it into ProFile. Every GIFI line and amount on Schedules 100 and 125 must match the app's statements, including sign flips. Hashim runs the import; the app shows the expected figures to compare against.

P. TAX WORKPAPERS
- Accounting-to-taxable income reconciliation, every difference explained.
- Tie-out check: GIFI in ProFile agrees to the app's statements. CCA, SBD and the return itself are prepared in ProFile.

Q. T183 CORP
- Signed by the client and stored in the binder. Filing is blocked until it is on file.

R. GATE C: FINAL REVIEW
- Needs the "gate reviewer" permission. Cannot pass until every item is met or explained: TB nets to zero; statement checks pass; Suspense and CC Payment are zero; second-round request fully answered; revenue agrees to GST/HST returns or difference explained; wages agree to T4 Summary; shareholder loan continuity complete and s.15(2) timing checked; prior-year closing equals opening; every balance maps to a valid GIFI code; client's written approval on file; signed T183 CORP on file; accounting-to-taxable income reconciliation documented.

S. FILING
- The app cannot EFILE (CRA requires certified tax software; we use ProFile). EFILE is done in ProFile.
- The app records the EFILE confirmation number and date and stores the filed T2 PDF. The engagement cannot be closed until these are recorded.

T. T2 PACKAGE AND MINUTE BOOK
- Generate the T2 package in the app: cover, compilation engagement report, balance sheet, statement of earnings and retained earnings, notes, management acknowledgement. Same content and standard as our current package.
- Generate the minute book letter and year-end minute book documents.
- Flag T5 slips needed for dividends declared.
- Everything stored in the vault.

U. DELIVERY
- Year-end letter to the client: what was filed, tax owing and the payment deadline, what to do differently next year.

V. LOCKDOWN
- The engagement locks on completion. Only an owner can unlock it, with a reason recorded in the activity log.

W. YEAR-END CLOSE
- Next-year note: type classification, GIFI mapping used, recurring issues, actual hours against quoted. Ready to roll forward next year.

OUTPUTS AND RULES
- Internal only, never shared with clients: the working file, queries, suspense postings, review notes.
- All gate passes, sign-offs, unlocks and changes recorded in the activity log.
- Data organized by client, fiscal year and engagement, kept like any client file (the 24-month deletion rule applies only to leads that never became clients).

LATER (not Phase 3): send the second-round request online through a private link (no login, like the quote page). Answers land on the matching transactions for staff to code.

I will send our Compilation Workpaper (GIFI COA list) to load as the starting chart of accounts before Phase 3 starts.
```

---

## Appendix C: Corporate year-end quote (Part A) and quote email

Fields in [square brackets] are filled by Studio. Lines marked "if" show only when that answer applies.

### Part A: Your quote

**Concept Accounting & Advisory Professional Corporation** 675 Riverbend Dr., Kitchener, ON

**Quote and engagement letter: year-end financial statements and corporate tax return for [Company legal name]**

Prepared for: [First name Last name], [Company legal name] Prepared by: [Asmaa Ibrahim / Hashim Awad], [date] Valid until: [date, 21 days after it is sent]

**Services included**

- Year-end financial statements for the year ending [year-end date], prepared by a CPA
- Corporate income tax return (T2), prepared and filed electronically
- If books are kept by a bookkeeper or accountant: review of your bookkeeper's year-end records and year-end adjustments
- If books are kept by the owner in software: review of your accounting file and year-end adjustments
- If bank statements only: bookkeeping for the year from your bank and credit card statements
- If ticked: GST/HST return for the year
- If ticked: tax slips for people the company paid (T4, T4A and T5)
- Tax planning on how you pay yourself from the company
- A CPA reviews the statements and the tax return before they are filed

**Your fee: $[total] plus GST/HST**

Your fee covers the services listed above. If your documents include work that is not listed, such as another bank account or a loan, we confirm the added fee with you in writing before we start that work.

You pay in two parts: half when you sign up in the portal, and half when your statements and tax return are ready for your approval.

**What happens next**

1. You sign this quote and engagement letter below.
2. You create your secure client portal account. The portal is where you send us your documents and pay your invoices.
3. We send your first invoice, for half of your fee. You pay it in the portal.
4. In the portal, you complete your year-end form. It is a short online form where you confirm your company's details and upload your bank and credit card statements and other records. It also shows you, step by step, how to give us access to your company's CRA information.
5. We prepare your statements and tax return, and a CPA reviews them.
6. We send them to you to approve and sign Form T183CORP, with the invoice for the other half of your fee.
7. Once it is paid, we file your return.

### Quote email

Subject: Your company's year-end quote

> Hi [first name],
>
> Thank you for trusting Concept Accounting with your company's year-end. We're glad to have you with us.
>
> I reviewed your answers, and your quote for [Company legal name]'s year ending [year-end date] is ready. It shows what's included and your fee, and it's also your engagement letter.
>
> Here's what happens after you sign:
> 1. You'll go straight to our secure client portal to create your own account.
> 2. We send your first invoice, for half of your fee.
> 3. A short form will be waiting for you in the portal. It walks you through which documents to upload.
> 4. We prepare your statements and tax return, and send them to you to approve and sign before we file.
>
> Your quote is valid until [date].
>
> [Review and sign your quote]
>
> Asmaa Ibrahim
> Concept Accounting & Advisory Professional Corporation
> 226-789-9591 | asmaa@conceptaccounting.ca

