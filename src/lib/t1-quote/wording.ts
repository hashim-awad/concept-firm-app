// The T1 quote and engagement letter (Phase 2 batch, Appendix A) and the two quote emails (section 8),
// word for word, as editable wording pieces. They join the letters' pieces on the Templates page:
// owners change them there and publish, with no code change (batch section 6).
// {1}, {2} ... are fill-ins; their names show on the Templates page in [square brackets].
// Each piece has a fixed id (never reuse or renumber one: saved edits are stored by key).

export type QPiece = { key: string; text: string; fills: string[]; fns: string[] };

const key = (id: number) => `wa1${id.toString(16).padStart(8, "0")}`;
const P = (id: number, text: string, fills: string[] = [], fn = "t1quote"): QPiece => ({ key: key(id), text, fills, fns: [fn] });

// ---------- Part A: Your quote ----------
export const A = {
  firm: P(1, "Concept Accounting & Advisory Professional Corporation"),
  address: P(2, "675 Riverbend Dr., Kitchener, ON N2K 3S3"),
  title: P(3, "Quote and engagement letter: personal income tax {1} for the {2} tax year", ["return or returns", "Tax year"]),
  preparedFor: P(4, "Prepared for: {1}", ["Client names"]),
  preparedBy: P(5, "Prepared by: {1}, {2}", ["Sender name", "Date"]),
  validUntil: P(6, "Valid until: {1}", ["Valid until date"]),
  servicesHeading: P(7, "Services included"),
  base: P(8, "Preparation and electronic filing of {1} {2} T1 Income Tax and Benefit {3}", ["your or both", "Tax year", "Return or Returns"]),
  cpaReview: P(9, "A CPA reviews every return before it is filed"),
  fee: P(10, "Your fee: {1} plus GST/HST", ["Total"]),
  feeCovers: P(11, "Your fee covers the services listed above. If your documents include work that is not listed, such as another rental property or a property sale, we confirm the added fee with you in writing before we start that work."),
  nextHeading: P(12, "What happens next"),
  next1: P(13, "You sign this quote and engagement letter below."),
  next2: P(14, "You create your secure client portal account. The portal is where you send us your documents and pay your invoice."),
  next3: P(15, "In the portal, you complete your tax organizer. It is a short online form where you confirm your details and upload your tax slips and receipts. It also shows you, step by step, how to give us access to your CRA information."),
  next4: P(16, "We send your invoice once your organizer and documents are in. You pay it in the portal."),
  next5: P(17, "We prepare your return and a CPA reviews it. We send it to you to review and sign Form T183, then we file it."),
  partA: P(18, "Your quote"),
};

// The services line for each price book item, in plain words. One piece for one, one for more.
export const ITEM_LINES: Record<string, [QPiece, QPiece?]> = {
  "PTX-120": [P(40, "Rental income for 1 property (Form T776)"), P(41, "Rental income for {1} properties (Form T776)", ["Number"])],
  "PTX-121": [P(42, "Self-employment income for 1 business (Form T2125)"), P(43, "Self-employment income for {1} businesses (Form T2125)", ["Number"])],
  "PTX-122": [P(44, "Vehicle expenses for 1 vehicle"), P(45, "Vehicle expenses for {1} vehicles", ["Number"])],
  "PTX-123": [P(46, "Home office expenses for 1 business"), P(47, "Home office expenses for {1} businesses", ["Number"])],
  "PTX-124": [P(48, "GST/HST return for your business"), P(49, "{1} GST/HST returns for your business", ["Number"])],
  "PTX-125": [P(50, "Sale of investments")],
  "PTX-126": [P(51, "Sale of your home, with the principal residence designation")],
  "PTX-127": [P(52, "Sale of 1 other property"), P(53, "Sale of {1} other properties", ["Number"])],
  "PTX-128": [P(54, "Foreign property reporting (Form T1135)")],
  "PTX-129": [P(55, "Foreign property reporting (Form T1135, detailed method)")],
  "PTX-130": [P(56, "Foreign income with no Canadian slip")],
  "PTX-131": [P(57, "Employment expenses (Form T2200)")],
  "PTX-132": [P(58, "Moving expenses")],
  "PTX-133": [P(59, "Crypto or options trading")],
  "PTX-134": [P(60, "Partnership income from 1 partnership (T5013 slip)"), P(61, "Partnership income from {1} partnerships (T5013 slips)", ["Number"])],
  "PTX-135": [P(62, "US non-resident return (Form 1040-NR)")],
  "PTX-136": [P(63, "1 US state return"), P(64, "{1} US state returns", ["Number"])],
};

// Appendix A's example joins vehicle and home office to the self-employment line.
export const SELF_EMPLOYED_WITH = {
  both: P(65, ", including vehicle and home office expenses"),
  vehicle: P(66, ", including vehicle expenses"),
  homeOffice: P(67, ", including home office expenses"),
};

// ---------- Part B: Engagement terms ----------
export const B = {
  partB: P(100, "Engagement terms"),
  dear: P(101, "Dear {1},", ["Client names"]),
  intro: P(102, "Thank you for choosing Concept Accounting for your personal income tax. This letter sets out the services we will provide, your responsibilities and ours, and how our fees work. Please read it and sign it to confirm."),
  applies: P(103, "This letter applies to the {1} tax year and to each later year we prepare your return, until either of us ends it in writing.", ["Tax year"]),
  h1: P(104, "1. Our services"),
  s1a: P(105, "We will prepare and electronically file the T1 Income Tax and Benefit Return listed in your quote. If your spouse or common-law partner is also included, we will prepare their return too, and each of you must sign."),
  s1b: P(106, "Each return will include the schedules and forms that apply to you, based on the information you give us. These can include employment and investment income, self-employment or commission income (Form T2125), rental properties (Form T776), foreign property reporting (Form T1135), and the sale of property, including the principal residence designation where it applies."),
  s1c: P(107, "GST/HST returns. If you have self-employment income and we prepare your GST/HST return, we prepare it from the information you give us. We do not audit or verify it. You are responsible for keeping the records that support your claims and for any tax, interest or penalties if CRA disallows a claim."),
  s1d: P(108, "We prepare your return from the information and documents you give us through your tax organizer. We do not audit or verify that information, although we may ask you to clarify it."),
  h2: P(109, "2. Your responsibilities"),
  s2lead: P(110, "You are responsible for:"),
  s2a: P(111, "giving us complete and accurate information, including all tax slips, receipts and records, before we start;"),
  s2b: P(112, "confirming that the expenses you claim are supported by records and are not personal, such as haircuts, vacations, household costs or personal vehicle use, because personal expenses cannot be deducted;"),
  s2c: P(113, "keeping your records and supporting documents for the period the Income Tax Act requires, as CRA may ask for them;"),
  s2d: P(114, "reviewing your return carefully before you sign Form T183, because you have final responsibility for your return; and"),
  s2e: P(115, "telling us about any CRA letter, review or reassessment you receive."),
  s2f: P(116, "Our work cannot be relied on to prevent or detect fraud, errors or omissions. That responsibility stays with you."),
  h3: P(117, "3. CRA access"),
  s3: P(118, "We need Level 2 online access to your CRA information to prepare your return. Your tax organizer explains how to give it. We start work once access is in place. You can cancel our access at any time in your CRA account."),
  h4: P(119, "4. Filing and deadlines"),
  s4a: P(120, "When your return is ready, we will send you Form T183. You must review the return and sign Form T183 before we can file it."),
  s4b: P(121, "Returns are due April 30 of the year after the tax year. If you or your spouse or common-law partner had self-employment income, the filing deadline is June 15, but any balance owing is still due April 30. Late filing and late payment can result in penalties and interest."),
  h5: P(122, "5. Fees and payment"),
  s5: P(123, "Your fee is the amount in your quote. It is one fee for the year's return, set from your answers to our scope questions."),
  s5a: P(124, "Invoice: we send your invoice once you complete your tax organizer and upload your documents. The invoice is paid before we begin work."),
  s5b: P(125, "If your return changes: if your documents include work that is not listed in your quote, such as a rental property, a property sale, foreign property or self-employment income, we confirm the added fee with you in writing before we start that work."),
  s5c: P(126, "Late or changed information: if you send slips or information after we have prepared your return and we must redo part of it, we quote the added fee before we do that work."),
  s5d: P(127, "Release and filing: we file your return, and release it to you, once your invoice is paid."),
  s5e: P(128, "Payment: you pay online through your secure client portal. GST/HST is added to each invoice. Invoices are due on receipt. Interest may be charged on balances unpaid for more than 30 days at 1.5% per month (19.56% per year)."),
  s5f: P(129, "Questions about your return are included in your fee."),
  s5g: P(130, "Legal requests: if a law, regulator or court requires us to produce our files or answer requests about your return, we bill the time and costs involved."),
  h6: P(131, "6. What is not included"),
  s6lead: P(132, "This letter does not include:"),
  s6a: P(133, "CRA reviews, audits, objections or representation;"),
  s6b: P(134, "tax planning or advice;"),
  s6c: P(135, "prior-year returns;"),
  s6d: P(136, "bookkeeping, or GST/HST returns unless they are listed in your quote;"),
  s6e: P(137, "payroll, EHT, WSIB or other taxes and levies;"),
  s6f: P(138, "foreign income tax returns or advice on foreign taxes, unless they are listed in your quote."),
  s6g: P(139, "If you ask for any of these, we will quote them in writing first."),
  s6h: P(140, "Unless your quote includes your GST/HST return, we do not review your GST/HST. We may not notice if GST/HST is being collected or claimed incorrectly. Errors can lead to tax, interest and penalties."),
  h7: P(141, "7. Foreign property and foreign reporting"),
  s7lead: P(142, "CRA requires information returns, with significant penalties for filing late or not filing, if at any time in the year you:"),
  s7a: P(143, "held specified foreign property, such as foreign bank accounts, foreign real estate or shares of foreign companies, costing more than $100,000 in total;"),
  s7b: P(144, "owned at least 10% of a foreign company, alone or together with related persons; or"),
  s7c: P(145, "sent money or property to, received money or property from, or were owed money by a non-resident trust, including an inheritance from a foreign estate."),
  s7d: P(146, "You agree to answer the foreign property questions in your tax organizer completely and to tell us about any of these each year."),
  h8: P(147, "8. Our judgment"),
  s8: P(148, "Tax law is not always clear. Where it is unclear, we use our professional judgment to choose a supportable position. Our conclusions are matters of professional opinion, not certainty. CRA may not agree, and you have rights of appeal if it proposes changes."),
  h9: P(149, "9. Your information and confidentiality"),
  s9a: P(150, "We collect, use and keep your personal information only to provide our services, under our privacy policy (conceptaccounting.ca/privacy-policy) and Canadian privacy laws. If you give us information about another person, such as a spouse or dependant, you confirm you have their consent."),
  s9b: P(151, "We keep your information confidential and release it only with your consent or as the law requires. Our files may be reviewed by practice inspectors of CPA Ontario, as professional standards require; those inspectors are bound by confidentiality."),
  s9c: P(152, "Our team includes members and service providers located outside Canada, so your information may be stored or accessed outside Canada, under confidentiality terms equal to ours."),
  h10: P(153, "10. Electronic communications and signatures"),
  s10a: P(154, "We communicate by email and through our secure client portal. No one fully controls the security of the internet. We are not liable for loss caused by delay, interception or failed delivery of messages sent outside our own systems."),
  s10b: P(155, "You agree that signing this letter electronically has the same effect as signing it by hand."),
  h11: P(156, "11. Limitation of liability"),
  s11: P(157, "Our liability for any claim arising from this engagement, whether in contract, tort or otherwise, is limited to the fees you paid us for the return in question. It does not cover consequential or indirect losses. Our liability is several and not joint: you may only recover our share of any loss, based on our degree of fault. We are not responsible for interest or penalties caused by information that was late, incomplete or inaccurate."),
  h12: P(158, "12. Ending this agreement and governing law"),
  s12a: P(159, "Either of us may end this agreement in writing. You will pay for work done up to that date. We may withdraw before filing if we cannot complete the work, and we will tell you why."),
  s12b: P(160, "This agreement is governed by the laws of Ontario, and the courts of Ontario have jurisdiction over any dispute."),
  yours: P(161, "Yours truly,"),
  firmCaps: P(162, "CONCEPT ACCOUNTING & ADVISORY PROFESSIONAL CORPORATION"),
  // The letter stands on its own (Hashim, Nov 11, 2026): letterhead, date, addressee and this line
  // before "Dear", and the firm's signature at the end. Recorded in docs/BRIEF.md.
  reLine: P(163, "Re: Engagement letter for your {1} personal income tax {2}", ["Tax year", "return or returns"]),
};

// ---------- Part C: Sign (the signing itself is built in Phase 2 step 8) ----------
export const C = {
  partC: P(200, "Sign your quote and engagement letter"),
  typeName: P(201, "{1}, type your full name to sign.", ["Client name"]),
  spouseOwnLink: P(202, "{1} signs with their own link.", ["Spouse name"]),
  fullName: P(203, "Your full name"),
  typed: P(204, "Your typed signature"),
  agree: P(205, "I have read my quote and these engagement terms, and I agree to them."),
  signButton: P(206, "Sign"),
  signed: P(207, "Signed. Thank you, {1}.", ["First name"]),
  afterSign: P(208, "Download your copy now. Next, create your secure client portal account to upload your documents."),
  download: P(209, "Download your copy (PDF)"),
  portal: P(210, "Continue to the secure portal"),
  waiting: P(211, "Signed by {1}, waiting for {2}", ["Signed name", "Waiting name"]),
  sameDevice: P(212, "Is {1} with you? They can sign now on this device.", ["Spouse first name"]),
};

// ---------- Quote emails (section 8) ----------
const E1 = "t1email1", E2 = "t1email2";
export const EMAIL = {
  subject: P(300, "Your {1} personal tax quote", ["Tax year"], E1),
  hi1: P(301, "Hi {1},", ["First name"], E1),
  thanks1: P(302, "Thank you for trusting Concept Accounting with your taxes. We're glad to have you with us.", [], E1),
  ready1: P(303, "I reviewed your answers, and your quote for your {1} return is ready. It shows what's included and your fee, and it's also your engagement letter.", ["Tax year"], E1),
  after1: P(304, "Here's what happens after you sign:", [], E1),
  step1: P(305, "You'll go straight to our secure client portal to create your own account.", [], E1),
  step2: P(306, "A short form will be waiting for you there. It walks you through which documents to upload and reminds you of the credits and deductions you may qualify for, so nothing you're owed gets missed.", [], E1),
  step3a: P(307, "Once your documents are in, we send your invoice, prepare your return, and send it to you to review and sign before we file.", [], E1),
  valid1: P(308, "Your quote is valid until {1}.", ["Valid until date"], E1),
  button1: P(309, "Review and sign your quote", [], E1),
  firm1: P(310, "Concept Accounting & Advisory Professional Corporation", [], E1),
  // Front office batch, section 3: phone quotes only.
  phone1: P(311, "This quote is based on what you told us on {1}. If anything was missed, tell us before you sign.", ["Call date"], E1),

  subject2: P(320, "Your {1} personal tax quote", ["Tax year"], E2),
  hi2: P(321, "Hi {1} and {2},", ["First name", "Spouse first name"], E2),
  thanks2: P(322, "Thank you for trusting Concept Accounting with your taxes. We're glad to have you both with us.", [], E2),
  ready2: P(323, "I reviewed your answers, and your quote for your {1} returns is ready. It shows what's included and one fee for both returns, and it's also your engagement letter. Each of you signs with your own button.", ["Tax year"], E2),
  after2: P(324, "Here's what happens after you both sign:", [], E2),
  step1b: P(325, "You'll go straight to our secure client portal to create your own account.", [], E2),
  step2b: P(326, "A short form will be waiting for you there. It walks you through which documents to upload and reminds you of the credits and deductions you may qualify for, so nothing you're owed gets missed.", [], E2),
  step3b: P(327, "Once your documents are in, we send your invoice, prepare your returns, and send them to you to review and sign before we file.", [], E2),
  valid2: P(328, "Your quote is valid until {1}.", ["Valid until date"], E2),
  button2: P(329, "{1}, review and sign", ["First name"], E2),
  firm2: P(330, "Concept Accounting & Advisory Professional Corporation", [], E2),
  phone2: P(331, "This quote is based on what you told us on {1}. If anything was missed, tell us before you sign.", ["Call date"], E2),
};

// ---------- Corporate year-end quote, Part A (Appendix C) ----------
const CQ = "corpquote", CE = "corpemail";
export const CORP = {
  title: P(400, "Quote and engagement letter: year-end financial statements and corporate tax return for {1}", ["Company legal name"], CQ),
  preparedFor: P(401, "Prepared for: {1}, {2}", ["Client name", "Company legal name"], CQ),
  preparedBy: P(402, "Prepared by: {1}, {2}", ["Sender name", "Date"], CQ),
  validUntil: P(403, "Valid until: {1}", ["Valid until date"], CQ),
  servicesHeading: P(404, "Services included", [], CQ),
  statements: P(405, "Year-end financial statements for the year ending {1}, prepared by a CPA", ["Year-end date"], CQ),
  t2: P(406, "Corporate income tax return (T2), prepared and filed electronically", [], CQ),
  bookkeeper: P(407, "Review of your bookkeeper's year-end records and year-end adjustments", [], CQ),
  software: P(408, "Review of your accounting file and year-end adjustments", [], CQ),
  bankOnly: P(409, "Bookkeeping for the year from your bank and credit card statements", [], CQ),
  gst: P(410, "GST/HST return for the year", [], CQ),
  slips: P(411, "Tax slips for people the company paid (T4, T4A and T5)", [], CQ),
  planning: P(412, "Tax planning on how you pay yourself from the company", [], CQ),
  review: P(413, "A CPA reviews the statements and the tax return before they are filed", [], CQ),
  fee: P(414, "Your fee: {1} plus GST/HST", ["Total"], CQ),
  feeCovers: P(415, "Your fee covers the services listed above. If your documents include work that is not listed, such as another bank account or a loan, we confirm the added fee with you in writing before we start that work.", [], CQ),
  twoParts: P(416, "You pay in two parts: half when you sign up in the portal, and half when your statements and tax return are ready for your approval.", [], CQ),
  nextHeading: P(417, "What happens next", [], CQ),
  next1: P(418, "You sign this quote and engagement letter below.", [], CQ),
  next2: P(419, "You create your secure client portal account. The portal is where you send us your documents and pay your invoices.", [], CQ),
  next3: P(420, "We send your first invoice, for half of your fee. You pay it in the portal.", [], CQ),
  next4: P(421, "In the portal, you complete your year-end form. It is a short online form where you confirm your company's details and upload your bank and credit card statements and other records. It also shows you, step by step, how to give us access to your company's CRA information.", [], CQ),
  next5: P(422, "We prepare your statements and tax return, and a CPA reviews them.", [], CQ),
  next6: P(423, "We send them to you to approve and sign Form T183CORP, with the invoice for the other half of your fee.", [], CQ),
  next7: P(424, "Once it is paid, we file your return.", [], CQ),
  // The two recorded changes to the master letter in Part B (section 11).
  feePointer: P(430, "Your fee is the amount in your quote. Our billing terms and how to pay are in Appendix A, Fees and payment. Appendix A forms part of this letter.", [], CQ),
  esign: P(431, "You agree that signing this letter electronically has the same effect as signing it by hand.", [], CQ),
  // Hashim's review of the first corporate quote (Nov 10): more recorded changes, in docs/BRIEF.md.
  exclPlanning: P(432, "tax planning beyond how you pay yourself, and reorganizations", [], CQ),
  gstHeading: P(433, "{1}. GST/HST return", ["Section number"], CQ),
  gstText: P(434, "We will prepare and file the Company's annual GST/HST return for the year, from {1}. You remain responsible for paying any GST/HST owing by the due date.", ["Source of the information"], CQ),
  pay1: P(435, "{1} plus GST/HST when you sign up in the portal", ["Half the fee"], CQ),
  pay2: P(436, "{1} plus GST/HST when your statements and tax return are ready for your approval", ["Other half of the fee"], CQ),
  signBelow: P(437, "Please sign this letter below to confirm that it reflects your understanding. We will start work once we receive the signed letter{1}", ["Ending"], CQ),
  signerTitle: P(438, "Your title at the company, for example Director or President", [], CQ),
  bankOnlyCounts: P(439, "Bookkeeping for the year from your bank and credit card statements: {1}", ["Accounts covered"], CQ),
};

// ---------- Corporate year-end quote email (Appendix C) ----------
export const CORP_EMAIL = {
  subject: P(500, "Your company's year-end quote", [], CE),
  hi: P(501, "Hi {1},", ["First name"], CE),
  thanks: P(502, "Thank you for trusting Concept Accounting with your company's year-end. We're glad to have you with us.", [], CE),
  ready: P(503, "I reviewed your answers, and your quote for {1}'s year ending {2} is ready. It shows what's included and your fee, and it's also your engagement letter.", ["Company legal name", "Year-end date"], CE),
  after: P(504, "Here's what happens after you sign:", [], CE),
  step1: P(505, "You'll go straight to our secure client portal to create your own account.", [], CE),
  step2: P(506, "We send your first invoice, for half of your fee.", [], CE),
  step3: P(507, "A short form will be waiting for you in the portal. It walks you through which documents to upload.", [], CE),
  step4: P(508, "We prepare your statements and tax return, and send them to you to approve and sign before we file.", [], CE),
  valid: P(509, "Your quote is valid until {1}.", ["Valid until date"], CE),
  button: P(510, "Review and sign your quote", [], CE),
  firm: P(511, "Concept Accounting & Advisory Professional Corporation", [], CE),
  phone: P(512, "This quote is based on what you told us on {1}. If anything was missed, tell us before you sign.", ["Call date"], CE),
};

// ---------- Proposal email (front office batch, section 3): the signing link for a monthly proposal ----------
const PE = "propemail";
export const PROPOSAL_EMAIL = {
  subject: P(600, "Your proposal from Concept Accounting", [], PE),
  hi: P(601, "Hi {1},", ["First name"], PE),
  thanks: P(602, "Thank you for your time on our call. Your proposal is ready.", [], PE),
  howOptions: P(603, "Open it with the button below. Choose the option that suits you, read the engagement letter for it and sign online. It takes about five minutes.", [], PE),
  howOne: P(604, "Open it with the button below. Read the proposal and the engagement letter, then sign online. It takes about five minutes.", [], PE),
  valid: P(605, "This proposal is valid until {1}.", ["Valid until date"], PE),
  questions: P(606, "If you have questions, reply to this email or call me.", [], PE),
  button: P(607, "Review and sign your proposal", [], PE),
  firm: P(608, "Concept Accounting & Advisory Professional Corporation", [], PE),
};

// ---------- Engagement letter email (front office batch, section 7): a New letter sent for signing ----------
const LE = "letteremail";
export const LETTER_EMAIL = {
  subject: P(620, "Your engagement letter from Concept Accounting", [], LE),
  hi: P(621, "Hi {1},", ["First names"], LE),
  ready: P(622, "Your engagement letter is ready. Open it with the button below, read it and sign online. It takes about five minutes.", [], LE),
  couple: P(623, "Each of you has your own button. If you are together, the second person can sign on the same device after the first.", [], LE),
  valid: P(624, "Please sign by {1}.", ["Sign by date"], LE),
  questions: P(625, "If you have questions, reply to this email or call me.", [], LE),
  button: P(626, "Review and sign your letter", [], LE),
  buttonFor: P(627, "Review and sign: {1}", ["First name"], LE),
  firm: P(628, "Concept Accounting & Advisory Professional Corporation", [], LE),
};

// ---------- Signing page statements (front office batch): a New letter and a proposal sign under their own words ----------
const SP = "signpage";
export const SIGN_PAGE = {
  agreeLetter: P(640, "I have read this engagement letter, and I agree to it.", [], SP),
  agreeProposal: P(641, "I have read the proposal and the engagement letter for the option I chose, and I agree to them.", [], SP),
  // Round 11: the signing officer signs the Management Responsibility Acknowledgement (Closebook step 9).
  agreeMal: P(642, "I have read this letter, and I confirm it on behalf of the company.", [], SP),
  withdrawn: P(643, "This letter was withdrawn because the financial statements changed. We will send you a new one.", [], SP),
};

export const T1Q_PIECES: QPiece[] = [
  ...Object.values(A), ...Object.values(ITEM_LINES).flat().filter(Boolean) as QPiece[], ...Object.values(SELF_EMPLOYED_WITH),
  ...Object.values(B), ...Object.values(C), ...Object.values(EMAIL), ...Object.values(CORP), ...Object.values(CORP_EMAIL), ...Object.values(PROPOSAL_EMAIL), ...Object.values(LETTER_EMAIL), ...Object.values(SIGN_PAGE),
];

// The three templates on the Templates page.
export const T1Q_TEMPLATES = [
  { k: "t1quote", name: "T1 quote and engagement letter", group: "Engagement letters", basis: "Phase 2 batch, Appendix A (from EL v3.31)", status: "In use" },
  { k: "t1email1", name: "T1 quote email: single filer", group: "Engagement letters", basis: "Phase 2 batch, section 8", status: "In use" },
  { k: "t1email2", name: "T1 quote email: couple, two signers", group: "Engagement letters", basis: "Phase 2 batch, section 8", status: "In use" },
  { k: "corpquote", name: "Corporate year-end quote (Part A)", group: "Engagement letters", basis: "Phase 2 batch, Appendix C; Part B is the corporate master letter", status: "In use" },
  { k: "corpemail", name: "Corporate year-end quote email", group: "Engagement letters", basis: "Phase 2 batch, Appendix C", status: "In use" },
  { k: "signpage", name: "Signing page: statement above Sign (letters and proposals)", group: "Engagement letters", basis: "Front office batch: New letters and proposals signed online", status: "In use" },
  { k: "letteremail", name: "Engagement letter email", group: "Engagement letters", basis: "Front office batch, section 7: the signing link for a New letter", status: "In use" },
  { k: "propemail", name: "Proposal email", group: "Engagement letters", basis: "Front office batch, section 3: the signing link for a monthly proposal", status: "In use" },
];
