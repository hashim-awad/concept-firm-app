// The app's change log in plain words (standing rule 1.2). Newest first. Every change that staff
// would notice gets an entry here in the same commit as the change.
export type ChangeEntry = { date: string; title: string; points: string[] };

export const CHANGELOG: ChangeEntry[] = [
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
