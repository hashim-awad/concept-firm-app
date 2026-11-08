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

// ---- Screen cases: the same steps are played on Studio's forms and on the app's screens ----
const setAll = (fields, prefix = "") => Object.entries(fields).map(([k, v]) => ({ set: "#" + prefix + k, value: v }));

function proposalSteps(p) {
  const steps = setAll(p.fields, "p_");
  const base = p.fields.format === "options" ? 2 : 1; // options format starts with two options
  for (let i = base; i < p.opts.length; i++) steps.push({ click: "#p_addopt" });
  p.opts.forEach((o, i) => {
    steps.push({ set: `#po_name${i}`, value: o.name }, { set: `#po_offer${i}`, value: o.offer });
    for (const k of ["comp", "t2", "catchup", "books", "pnl", "gst", "payroll", "pay", "cfo", "budget", "coord"]) steps.push({ set: `[data-o="${i}"][data-s="${k}"]`, value: !!o.svc[k] });
    // Each option starts with Studio's two default fee lines; add or remove to match.
    for (let j = 2; j < o.lines.length; j++) steps.push({ click: `[data-ladd="${i}"]` });
    for (let j = 2; j > o.lines.length; j--) steps.push({ click: `[data-ldel="${i}:${j - 1}"]` });
    o.lines.forEach((l, j) => {
      steps.push({ set: `[data-o="${i}"][data-l="${j}"][data-f="svc"]`, value: l.svc }, { set: `[data-o="${i}"][data-l="${j}"][data-f="kind"]`, value: l.kind }, { set: `[data-o="${i}"][data-l="${j}"][data-f="amt"]`, value: l.amt });
    });
  });
  if (p.opts.length > 1) steps.push({ set: `input[name=prec][value="${p.rec}"]`, value: true });
  return steps;
}

export const SCREEN_CASES = [
  ...CORPORATE.map((c) => ({ screen: "corporate", name: c.name, steps: [...setAll(c.fields), ...c.feeAmounts.map((a, i) => ({ set: "#fa_" + i, value: a }))] })),
  {
    screen: "corporate", name: "Package applied, fee line added and edited, Final with review box",
    steps: [
      ...setAll({ company: "Sample Agent PREC Inc.", signer: "Drew Example", salutation: "Drew", addr1: "5 Test Way", city: "Kitchener", postal: "N2B 2B2", province: "ON", letterDate: "2026-11-08", ye: "2026-12-31" }),
      { set: "#pkgSel", value: "Agent: monthly bookkeeping plus year-end T2" }, { click: "#pkgApply" },
      { set: "#feeAddSel", value: "5" }, { click: "#feeAddBtn" },
      { set: "#payMethod", value: "pad" }, { set: "#ploLink", value: "https://example.com/pay/dummy" },
      { set: "input[name=mode][value=final]", value: true }, { set: "#reviewed", value: true },
    ],
  },
  {
    screen: "corporate", name: "Alberta registration check, catch-up not known yet, custom basis",
    steps: setAll({ company: "Test Alberta Holdings Ltd.", signer: "Robin Sample", salutation: "Robin", addr1: "1 Placeholder Rd", city: "Edmonton", postal: "T5J 0A1", province: "AB",
      letterDate: "2026-11-08", ye: "2026-08-31", svc_catchup: true, catchTBD: true, catchTo: "2026-08-31", basis: "custom", basisCustom: "the dummy loan agreement dated March 1, 2026, which requires the cash basis" }),
  },
  ...T1.map((c) => ({ screen: "t1", name: c.name, steps: Object.entries(c.fields).map(([k, v]) => (k === "card" ? { click: `.t1card[data-card="${v}"]` } : { set: "#t1_" + k, value: v })) })),
  {
    screen: "t1", name: "T1 company client, spouse without a name, BC, Final",
    steps: [
      ...setAll({ name0: "Avery Sample", letterDate: "2026-11-08", taxYear: "2026", salutation: "Avery", addr1: "8 Dummy St", city: "Victoria", postal: "V8W 1A1", province: "BC", corp: "Sample Holdings Ltd.", spouseBlank: true }, "t1_"),
      { set: "input[name=t1mode][value=final]", value: true }, { set: "#t1_reviewed", value: true },
    ],
  },
  ...PROPOSALS.map((p) => ({ screen: "proposal", name: p.name, steps: proposalSteps(p) })),
];
