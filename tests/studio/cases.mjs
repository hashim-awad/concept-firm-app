// Dummy test cases for the Studio parity test. Made-up names only; never real client data.

// Corporate letter: Studio form field id -> value. Fee amounts are typed into the fee table
// rows Studio adds when services are ticked (by row order).
export const CORPORATE = [
  {
    name: "Year-end compilation and T2, Ontario",
    fields: { company: "Example Holdings Inc.", signer: "Taylor Sample", signerTitle: "Director", salutation: "Taylor",
      addr1: "1 Test Street", city: "Kitchener", postal: "N2A 1A1", province: "ON", letterDate: "2026-11-08", ye: "2026-12-31",
      svc_comp: true, svc_t2: true, svc_gst: true },
    feeAmounts: ["2800", "Included", "Included"],
  },
  {
    name: "Monthly full service with catch-up and payroll, Alberta, first year",
    fields: { company: "Sample Realty Ltd.", signer: "Morgan Example", signerTitle: "President", salutation: "Morgan",
      addr1: "200 Dummy Avenue", addr2: "Suite 5", city: "Calgary", postal: "T2P 0A1", province: "AB",
      letterDate: "2026-11-08", ye: "2027-03-31", firstYear: true, periodStart: "2026-04-01",
      svc_comp: true, svc_t2: true, svc_books: true, svc_gst: true, svc_payroll: true, svc_catchup: true,
      catchFrom: "2026-04-01", catchTo: "2026-10-31", startMonth: "2026-12" },
    feeAmounts: ["1150", "69", "Included", "Included", "Included", "Included", "3200"],
  },
  {
    name: "T2 only, BC, cash basis",
    fields: { company: "Placeholder Consulting Corp.", signer: "Casey Test", signerTitle: "Director", salutation: "Casey",
      addr1: "9 Fake Road", city: "Vancouver", postal: "V6B 1A1", province: "BC", letterDate: "2026-11-08", ye: "2026-06-30",
      svc_t2: true, basis: "cash" },
    feeAmounts: ["1500"],
  },
];

export const T1 = [
  {
    name: "T1 standalone, couple (master wording preview; Studio sends standalone letters from TaxDome)",
    fields: { letterDate: "2026-11-08", taxYear: "2026", addr1: "3 Sample Lane", city: "Waterloo", province: "ON", postal: "N2L 1A1",
      salutation: "Riley and Sam", card: "standalone", name0: "Riley Example", name1: "Sam Example" },
  },
  {
    name: "T1 company client, fee included",
    fields: { letterDate: "2026-11-08", taxYear: "2026", addr1: "4 Test Court", city: "Guelph", province: "ON", postal: "N1G 1A1",
      salutation: "Jordan", card: "company", corp: "Example Holdings Inc.", name0: "Jordan Sample" },
  },
];

// Proposal options are passed directly (Studio keeps them in a JS array, not form fields).
export const PROPOSALS = [
  {
    name: "Single price",
    fields: { name: "Dummy Team Inc.", contact: "Alex Sample", salutation: "Alex", province: "ON", segment: "Team or brokerage", date: "2026-11-08", valid: "30", format: "single" },
    opts: [{ name: "Option A", offer: "Team: Essential", svc: { books: true, gst: true, comp: true, t2: true, payroll: true },
      lines: [{ svc: "Monthly accounting and compliance services", kind: "month", amt: "1150" }, { svc: "Software subscription (QuickBooks Online and Dext)", kind: "month", amt: "69" }] }],
    rec: 0,
  },
  {
    name: "Three options, one below floor",
    fields: { name: "Example Agent PREC", contact: "Pat Test", salutation: "Pat", province: "ON", segment: "Agent", date: "2026-11-08", valid: "30", format: "options" },
    opts: [
      { name: "Option A", offer: "Agent: year-end T2 only", svc: { comp: true, t2: true, gst: true }, lines: [{ svc: "Compiled financial statements and T2", kind: "year", amt: "2500" }] },
      { name: "Option B", offer: "Agent: year-end T2 with bookkeeping", svc: { comp: true, t2: true, catchup: true }, lines: [{ svc: "Compiled financial statements and T2", kind: "year", amt: "4560" }] },
      { name: "Option C", offer: "Agent: monthly bookkeeping plus year-end T2", svc: { books: true, gst: true, comp: true, t2: true }, lines: [{ svc: "Monthly accounting and compliance services", kind: "month", amt: "380" }, { svc: "Software subscription (QuickBooks Online and Dext)", kind: "month", amt: "69" }] },
    ],
    rec: 1,
  },
];

// Made-up floor rows in Studio's Notion shape (the real ones come in through the import screen).
export const FLOORS = [
  { Offer: "Agent: year-end T2 only", Segment: "Agent", "Annual floor": 2800, "Year-end fee": 2800, Package: "__YES__", Services: '["comp","t2","gst"]' },
  { Offer: "Agent: year-end T2 with bookkeeping", Segment: "Agent", "Annual floor": 4560, "Year-end fee": 4560, Package: "__YES__", Services: '["comp","t2","catchup","t1"]' },
  { Offer: "Agent: monthly bookkeeping plus year-end T2", Segment: "Agent", "Annual floor": 5388, "Monthly fee": 380, "Software per month": 69, Package: "__YES__", Services: '["comp","t2","books","gst","t1"]' },
  { Offer: "Team: Essential", Segment: "Team or brokerage", "Annual floor": 14400, "Monthly fee": 1150, "Software per month": 69, Package: "__YES__", Services: '["comp","t2","books","gst","payroll","cfo"]' },
];

export const T1CALC = [
  { name: "T1 calculator sample", inputs: null },
];
