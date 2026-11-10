// The app's change log in plain words (standing rule 1.2). Newest first. Every change that staff
// would notice gets an entry here in the same commit as the change.
export type ChangeEntry = { date: string; title: string; points: string[] };

export const CHANGELOG: ChangeEntry[] = [
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
