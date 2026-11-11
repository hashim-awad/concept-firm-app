// The app's change log in plain words (standing rule 1.2). Newest first. Every change that staff
// would notice gets an entry here in the same commit as the change.
export type ChangeEntry = { date: string; title: string; points: string[] };

export const CHANGELOG: ChangeEntry[] = [
  {
    date: "2026-11-11",
    title: "Quotes: one list for every offer, and proposals signed online",
    points: [
      "Proposals is now Quotes. Personal tax quotes, company year-end quotes and monthly proposals are in one list with the statuses Draft, Sent, Viewed, Signed, Declined and Expired. Totals show only to staff with Pricing.",
      "Viewed means the client opened their link. A quote expires 21 days after it is sent. Staff mark a quote declined when the client says no.",
      "A proposal saves itself as a draft in Quotes as soon as you start. A new Letter details step collects what the engagement letter needs, and shows what is still missing for each option.",
      "Hashim sends a proposal for signing. The client opens the link, picks an option, reads the engagement letter for that option and signs once. The signed PDF holds the proposal, the chosen letter and the signing record.",
      "Templates, Proposal: the preview also shows a one-price proposal, so its first next step can be edited. The option boxes no longer show stray style text, and their border colours are no longer listed as wording.",
      "Templates, Proposal: a Next steps line can be left blank to remove that step. It stays in the list of lines, so it can be filled in again.",
      "The proposal builder is at Quotes, New proposal. The T1 pricing calculator moved to Settings, Pricing, T1 price check. My day lists quotes waiting for signature.",
    ],
  },
  {
    date: "2026-11-11",
    title: "Closebook: locked GIFI lines and a shorter line list",
    points: [
      "A main GIFI line with sub-lines to choose from shows a lock and cannot be picked: Due to shareholders, Due from shareholders and Dividends. Pick shareholder 1 or 2, or eligible or non-eligible, instead.",
      "An account already on a locked line goes to the card at the top, to be moved to a sub-line.",
      "The GIFI line list shows only lines on the account's side: a credit balance sees liabilities, equity and revenue. Show all lines brings back the rest.",
      "In lead sheets, the Explain panel has a link, Wrong GIFI line? Change it, that opens that account's matching panel.",
      "Settings, Closebook, GIFI lines: owners can lock or unlock a main line that has sub-lines, with a reason. Locked lines show a lock in the list.",
    ],
  },
  {
    date: "2026-11-11",
    title: "Closebook: match accounts to GIFI, lead sheets and entries",
    points: [
      "Importing a trial balance matches accounts to GIFI lines by itself: last year's matches first, then by account name.",
      "A card at the top lists the accounts that need a decision, with their dollar total. The pencil on any account opens a side panel to change its GIFI line (and, for the reviewer, its tax code). Nothing changes until Save.",
      "By GIFI line shows one row per line with its accounts and total. A line whose total is on the wrong side (for example an asset in credit) gets an amber flag.",
      "The GIFI line list in the side panel shows each line's section in grey and an info mark with CRA's description of the code. Type a number or words; arrows and Enter work.",
      "Only the file's reviewer changes an account's tax code. A balance that flips sign moves to its paired line, for example a bank account in overdraft.",
      "Lead sheets are one table: a row per lead sheet, opened to show its accounts. Lines that moved by more than $5,000 and more than 20% are flagged; Flagged only shows just those.",
      "The pencil on a flagged line opens a side panel to pick why it changed (new asset, new loan, revenue grew, one-time expense, reclassified, error found and fixed) and add a note. The reviewer judges it at sign-off.",
      "Full files have an Entries tab for adjusting, reclassifying and tax entries. Every entry must balance and goes to the reviewer.",
    ],
  },
  {
    date: "2026-11-11",
    title: "Closebook: start a year-end file and import the trial balance",
    points: [
      "All files, New file: pick the company, confirm the year-end, choose monthly or full and how the books are kept, and assign the preparer and reviewer. The file starts with its core documents.",
      "My files shows your files, oldest deadline first, with what to do next and the file-by date.",
      "On a file, the Trial balance tab imports QuickBooks, Xero or bookkeeper trial balances (CSV or Excel). It must balance. Import last year's balances into their own column.",
    ],
  },
  {
    date: "2026-11-11",
    title: "Closebook: setup and menu",
    points: [
      "New menu section Closebook with My files, All files and Review notes. Year-end files arrive in the next update.",
      "Settings has a Closebook group (owners only): the 419 GIFI lines, tax codes, lead sheets, thresholds and the Note 1 accounting policy. Every change to a GIFI line needs a reason and is logged.",
      "A new permission, Closebook, controls who sees year-end files. Owners have it; give it to other roles on Team and roles when they start year-end work.",
    ],
  },
  {
    date: "2026-11-11",
    title: "Engagement letters stand on their own; new signing layout",
    points: [
      "Each quote's engagement letter now starts like a letter: letterhead, date, the client's name and email (the company, attention line and email for a company), and a Re line.",
      "The firm signs at the end with your signature image from Settings, your name and title, and the firm name.",
      "The client's page puts the sign form beside the letter, where it stays in view while they read. On a phone it is a bar at the bottom of the screen. After signing, the same place shows the portal and download buttons.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Personal tax form: what the base fee covers",
    points: [
      "The \"What happened\" step now says the base fee already covers employment (T4), pension and investment slips, so an employed client knows to tick None of these.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Menu fits a laptop screen; readable dates",
    points: [
      "Menu groups whose pages are not built yet (Work, Quality) start folded and show how many are coming. Click a group to unfold it; your browser remembers.",
      "Your name and Sign out share one row at the bottom of the menu.",
      "Letters show the template approval date as Nov 8, 2026, and the activity log shows price dates the same way.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Download full export",
    points: [
      "Owners: Settings, Data and security, Download full export. One ZIP with every table (JSON and Excel CSV) and every stored file, including the vault PDFs and signed quotes.",
      "The page shows when the last export was made and reminds you after 31 days.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Monthly company leads: package suggestion and proposal",
    points: [
      "A monthly company lead shows a package suggestion for real estate, from the revenue band: Agent or Team: Essential under $1 million, Core, Finance Office, or Custom over $5 million. Other industries get no suggestion.",
      "Staff confirm on the lead whether the client is a single agent, a team or brokerage, or not real estate. Until then Studio shows its guess.",
      "Create proposal opens the proposal builder with the client's details, client type, the matching price book offer and their answers filled in.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Company leads and year-end quotes",
    points: [
      "The start page's \"My company\" route asks the year-end questions in steps. The client's details are saved first, so a lead who stops partway is still on the Leads page.",
      "Year-end leads with books kept by a bookkeeper, in software or from bank statements, and nothing unusual, get a price straight away. Monthly bookkeeping, paper receipts and the special cases need a call; the client sees the booking link.",
      "New price book items YE-110, YE-111, YE-112, YE-120, YE-121 and GST-110 (section 11 prices).",
      "On a company lead, staff enter the company's legal name and the confirmed year-end, then prepare the quote: Part A from Appendix C, Part B the corporate master letter, Part C signing. The email is ready to copy.",
      "After signing, the quote page shows the deposit and balance to invoice in TaxDome, and the lead has the first-year checklist (TaxDome tag 1st-yr client).",
      "The company form counts accounts with minus and plus buttons. One bank account and one credit card are filled in, so no one has to type 0.",
      "The signing page is wider, has a Go to signing button at the top, and shows the download and portal buttons right under the signature. There is no checkbox: clicking Sign is the agreement.",
      "The quote email buttons now keep their look when pasted into Outlook.",
      "Company quotes: the bookkeeping line lists the accounts it covers, the company's signer types their title, and the letter's wording changes are recorded in the brief (annual GST/HST return, payment timing, plus GST/HST, sign below).",
    ],
  },
  {
    date: "2026-11-10",
    title: "Signing T1 quotes",
    points: [
      "Clients sign on their own private link: type their full name, tick the agreement, click Sign. We keep the time, IP address, browser and a fingerprint of the exact quote and terms signed.",
      "Couples each sign. The page shows who is still waiting, and the second spouse can sign on the same device. The quote counts as signed when both have signed.",
      "Once signed, the client downloads a signed PDF with a signing-record page, and continues to the secure portal to sign up.",
      "The quote and the signed PDF are on the firm's letterhead, in the same style as the engagement letters.",
      "On the quote page, staff see who signed, open the signed PDF, and copy the TaxDome invoice line: PTX-100, the total before tax, and the GST/HST rate for the province.",
    ],
  },
  {
    date: "2026-11-10",
    title: "T1 quotes",
    points: [
      "On a personal tax lead, staff with Pricing click Prepare the quote. The quote page shows the email to send, with Copy buttons, and the quote and engagement letter marked DRAFT FOR REVIEW until it is sent.",
      "Send the email from your own Outlook, then click Mark as sent. The quote is valid for 21 days from then, and the lead shows Quote sent.",
      "Each person gets their own private link to read the quote; a couple gets two. The client sees the services and one total, never a line price. Online signing comes next.",
      "The quote wording (Appendix A) and both emails are on the Templates page, editable and published like the letters.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Personal tax screening questions",
    points: [
      "The public personal tax form asks the screening questions from the Phase 2 batch, in steps with a progress bar: About you, Who's filing, Quick check, What happened this year, A few details, Last. Quick check is one list of five boxes; What happened is a grid of tiles, \"Tick everything that applies\". Couples pick Me, Spouse or Both on each item charged per person. A few details asks only about the ticked tiles. The client clicks Get my quote; no consent checkbox.",
      "If an answer means we cannot quote online, the form stops there with a polite message. The client can still send their details; the lead is marked Out of scope with the reasons.",
      "The quote is worked out on the server from today's prices. The client never sees a price on the form. Staff with Pricing see the quote line by line on the lead; the alert email shows the total.",
      "The moving distance and the T1135 amounts in the questions come from Settings, T1 rule values.",
      "New price book item PTX-100, Personal tax return services: invoice only, no price, never on quotes or in screening.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Lead alerts",
    points: [
      "When a lead comes in, everyone with the Pricing permission gets an email with the lead type, household, province and quote, and a button to open the lead. The email has no client name or contact details.",
      "My day, the Leads list and each lead show how long the lead has waited, for example \"Waiting 25 min\". Only business hours count (Settings, Business hours). The timer turns amber at 30 minutes and red at 45.",
      "If the quote is not marked sent within 45 business minutes, a second email goes to the same people. Leads marked Call needed get no reminder.",
    ],
  },
  {
    date: "2026-11-10",
    title: "New Settings layout",
    points: [
      "Settings now has its own menu on the left, grouped: Firm, Sales and quotes, Pricing, Letters and signing, Tax rules, Connections, and Data and security. A search box at the top finds a setting by name.",
      "Each setting has its own short page with its own Save button.",
      "Price book, Templates, Screening questions, GST/HST rates, Team and roles, Import from TaxDome, Activity log and Change log moved from the main menu into Settings. The main menu keeps daily work, with Settings at the bottom.",
      "A lock shows where something is limited to owners or to the Pricing permission. Point at it to see what. The locks follow the real permission rules and are checked automatically.",
      "Chart of accounts and Vendor rules (still coming) moved into Settings, under Accounting.",
      "Team and roles: everyone can change their own phone number. Only an owner can change someone's role.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Leads",
    points: [
      "Public start page at /start, in the firm's branding: \"My personal tax return\" or \"My company\", then the client's details. It stays closed to the public until an owner opens it in Settings; staff can always preview it.",
      "Every request becomes a lead: Leads in the menu (with a count of new ones), a page per lead with status, source, notes and the person assigned. Only owners reassign. What the client entered is kept as sent.",
      "Spam protection: a hidden trap field, a minimum time to fill the form, and a limit of 5 requests per visitor per hour.",
      "Lost and out-of-scope leads are deleted automatically after the retention period (24 months). The activity log keeps no client details for leads.",
      "My day lists new leads to review. Settings has the lead sources list and the start page switch.",
    ],
  },
  {
    date: "2026-11-09",
    title: "Settings for leads and quotes",
    points: [
      "Settings has three new sections: business hours (for the lead timer and the 45-minute reminder), the booking link for company leads that need a call, and the T1 rule values (moving distance 40 km; T1135 thresholds $100,000 and $250,000), which an owner can change when CRA does.",
      "Team and roles shows each person's phone number, used in the sender block of quote emails. Everyone can set their own.",
    ],
  },
  {
    date: "2026-11-09",
    title: "T2 deadlines from TaxDome",
    points: [
      "New page, Admin, Import from TaxDome (owners): upload the TaxDome Accounts export. Company accounts tagged T2 come in with their legal name, Business Number, fiscal year-end, tags and TaxDome link. Nothing else in the file is read.",
      "Matches existing clients by Business Number, then by legal name. You see the matches, new clients and flagged rows before anything is saved. It never creates duplicates.",
      "If a Studio company has a different name in TaxDome, choose it in the \"Same as existing Studio client\" list next to the new account, so it updates that client instead of adding a second one.",
      "TaxDome is the master list: the legal name, Business Number and year-end of a linked client change only through a new import.",
      "Each corporate client has a balance-due setting (2 or 3 months after year-end) and an \"Exclude from deadlines\" switch.",
      "My day shows every T2 filing and balance-due date that is overdue or due in the next 90 days, oldest first. Press Done when it is filed or paid, or tick several and press \"Mark selected done\". T2 clients with no year-end are listed so they can be fixed in TaxDome.",
    ],
  },
  {
    date: "2026-11-09",
    title: "Pricing permission",
    points: [
      "New permission, Pricing: it covers the price book, packages and floors, quote amounts and breakdowns, and issuing quotes. The Owner role has it.",
      "Staff without it see leads, clients, engagements and the document list with no prices anywhere. They cannot open letters and proposals, because those show fees.",
      "The old permission \"Price book and rules\" is now \"Screening questions and rules\". It no longer includes prices.",
      "This change log page.",
    ],
  },
  {
    date: "2026-11-09",
    title: "Concept Studio is live",
    points: [
      "Live at studio.conceptaccounting.ca, on the live database in Canada (Central).",
      "Client data imported from Studio and checked: 8 clients, 5 engagements, the price book, packages and floors, and 13 approved GST/HST rates.",
      "Backups restored once into a scratch copy to prove they work. The copy was deleted the same hour.",
    ],
  },
  {
    date: "2026-11-08",
    title: "New menu",
    points: [
      "Menu grouped as Home, Sales, Clients, Work, Documents, Quality, Firm setup and Admin. Pages not built yet show greyed out with \"Soon\".",
      "My day, Proposals with a type filter and the T1 pricing calculator, Engagement letters on one page, Engagements, Document vault, Team and roles.",
      "The client page has tabs, and Ctrl+K finds any client.",
    ],
  },
];
