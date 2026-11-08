import type { ReactNode } from "react";
import { ArrowRight, Archive, BookOpen, Building2, CircleCheck, Download, FileSignature, FileText, History, Home, Inbox, ListChecks, Percent, Settings, ShieldCheck, User, Users } from "lucide-react";
import { ConceptMark, Logo } from "@/components/ds/brand";
import { Alert, ALL_STATUSES, Button, Card, Checkbox, Field, Input, Meta, PageHeader, StatusPill, buttonClass, money, type } from "@/components/ds/primitives";
import { HeroHeader, Sidebar } from "@/components/ds/navigation";
import { ClientShell, DocumentSheet, ProgressBar, RouteCard, TrustRow } from "@/components/ds/client";
import { ChoiceDemo, FormDemo, OverlayDemo, StepsDemo, TableDemo } from "./demos";

const SECTIONS = [
  ["brand", "Brand"], ["colour", "Colour"], ["type", "Type"], ["buttons", "Buttons"], ["status", "Status"],
  ["forms", "Forms"], ["feedback", "Feedback"], ["layout", "Layout"], ["tables", "Tables"],
  ["staff-preview", "Draft preview"], ["navigation", "Navigation"], ["client", "Client pages"],
] as const;

const SWATCHES: { name: string; token: string; hex: string; use: string; contrast?: string; dark?: boolean }[] = [
  { name: "Concept navy", token: "navy-700", hex: "#1A3C7C", use: "Brand, primary buttons, headings", contrast: "White text 10.6:1", dark: true },
  { name: "Navy deep", token: "navy-900", hex: "#0F2350", use: "Sidebar, banners", dark: true },
  { name: "Navy tint", token: "navy-50", hex: "#F2F5FB", use: "Selected rows, info backgrounds" },
  { name: "Concept green", token: "lime-500", hex: "#86BC28", use: "Accent: active item, highlights, one key action", contrast: "Navy text 4.7:1. Never white text." },
  { name: "Green tint", token: "lime-50", hex: "#F6FAEC", use: "Soft highlight" },
  { name: "Paper", token: "paper", hex: "#FAF9F6", use: "Page background (warm white)" },
  { name: "Surface", token: "surface", hex: "#FFFFFF", use: "Cards, documents" },
  { name: "Sand", token: "sand-200", hex: "#E3DFD6", use: "Borders, dividers" },
  { name: "Ink", token: "ink", hex: "#1B2130", use: "Main text", contrast: "15:1 on paper", dark: true },
  { name: "Ink 2", token: "ink-2", hex: "#4E5466", use: "Secondary text", contrast: "7.4:1", dark: true },
  { name: "Ink 3", token: "ink-3", hex: "#6B7080", use: "Small print, hints", contrast: "4.7:1", dark: true },
  { name: "Success", token: "success", hex: "#1F7A4A", use: "Signed, saved", dark: true },
  { name: "Warning", token: "warning", hex: "#8A5A00", use: "Expiring, check this", dark: true },
  { name: "Danger", token: "danger", hex: "#B42318", use: "Errors, lost, destructive", dark: true },
];

export default function DesignPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
      <HeroHeader
        eyebrow="Concept Firm App · Design system · For approval"
        title="How the app looks and feels"
        description="Every colour, size and component the app will use, shown with dummy data. Once approved, existing screens are restyled to match and new screens are built from these parts."
        stats={[{ label: "Colours", value: "14" }, { label: "Components", value: "20+" }, { label: "Client pages", value: "5" }, { label: "Font", value: "1" }]}
      />

      <nav aria-label="Sections" className="sticky top-0 z-10 -mx-4 mt-6 flex gap-1.5 overflow-x-auto border-b border-sand-200 bg-paper/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        {SECTIONS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="rounded-full border border-sand-200 bg-surface px-3 py-1 text-[13px] font-medium whitespace-nowrap text-ink-2 hover:border-navy-600 hover:text-navy-700">{label}</a>
        ))}
      </nav>

      <Section id="brand" title="Brand" note="Your supplied logo artwork, navy on light and white on navy. The small C mark (browser tab, tight spaces) is a vector drawn from the logo's exact shape.">
        <div className="grid gap-4 md:grid-cols-3">
          <Card><p className={`${type.caption} mb-4 text-ink-3`}>On light</p><Logo height={52} /></Card>
          <Card className="!bg-navy-800 !border-navy-800"><p className={`${type.caption} mb-4 text-white/60`}>On navy</p><Logo height={52} tone="white" /></Card>
          <Card><p className={`${type.caption} mb-4 text-ink-3`}>Mark only (favicon, small spaces)</p><div className="flex items-end gap-5"><ConceptMark size={56} /><ConceptMark size={36} /><ConceptMark size={20} /></div></Card>
        </div>
      </Section>

      <Section id="colour" title="Colour" note="Navy leads. Warm whites and soft greys carry the page. Concept green is the single accent. Contrast ratios meet WCAG AA (4.5:1) for text.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SWATCHES.map((s) => (
            <div key={s.token} className="overflow-hidden rounded-xl border border-sand-200 bg-surface">
              <div className="flex h-20 items-end p-3" style={{ background: s.hex }}>
                <span className={`text-xs font-semibold ${s.dark ? "text-white" : "text-ink"}`}>{s.hex}</span>
              </div>
              <div className="p-3">
                <p className="text-sm font-semibold">{s.name}</p>
                <p className="text-[13px] text-ink-2">{s.use}</p>
                {s.contrast && <p className="mt-1 text-xs text-ink-3">{s.contrast}</p>}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section id="type" title="Type" note="One font for the whole app: Plus Jakarta Sans, served from the app itself (no outside font service). Close to Concept Studio's Poppins, with numbers that line up in columns.">
        <Card>
          <div className="space-y-5">
            {([["Display · 32", type.display, "Personal tax, done properly"], ["Heading 1 · 26", type.h1, "Quotes"], ["Heading 2 · 20", type.h2, "Engagement terms"], ["Heading 3 · 16", type.h3, "Services included"], ["Body · 15", type.body, "We prepare and file your return from the documents you upload. A CPA reviews every return before it is filed."], ["Small · 13", type.small, "Prices are before tax. GST/HST is added based on your province."], ["Caption · 12", type.caption, "Total before tax"]] as const).map(([label, cls, sample]) => (
              <div key={label} className="grid gap-1 border-b border-sand-100 pb-4 last:border-0 last:pb-0 md:grid-cols-[10rem_1fr]">
                <span className="text-xs font-medium text-ink-3">{label}</span>
                <span className={cls}>{sample}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card className="mt-4">
          <p className={`${type.h3} mb-3`}>Numbers line up</p>
          <table className="w-full max-w-sm text-sm">
            <tbody>
              {[29900, 34900, 174400, 9900, 1247000].map((c) => (
                <tr key={c} className="border-b border-sand-100 last:border-0"><td className="py-1.5 text-ink-2">Sample amount</td><td className="py-1.5 text-right font-medium tabular-nums">{money(c)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </Section>

      <Section id="buttons" title="Buttons" note="Navy for the main action. Green for one highlight action per screen. Secondary and ghost for everything else. Red only for actions that remove or withdraw.">
        <Card>
          <div className="space-y-5">
            <Row label="Variants"><Button>Primary</Button><Button variant="accent">Accent</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button></Row>
            <Row label="Sizes"><Button size="sm">Small</Button><Button>Medium</Button><Button size="lg">Large (client pages)</Button></Row>
            <Row label="States"><Button loading>Saving</Button><Button disabled>Disabled</Button><Button variant="secondary"><Download className="h-4 w-4" aria-hidden />With icon</Button><a href="#buttons" className={buttonClass("primary")}>Link styled as button<ArrowRight className="h-4 w-4" aria-hidden /></a></Row>
          </div>
        </Card>
      </Section>

      <Section id="status" title="Status pills" note="One colour per status, used the same way on every list and document.">
        <Card><div className="flex flex-wrap gap-2">{ALL_STATUSES.map((s) => <StatusPill key={s} status={s} />)}</div></Card>
      </Section>

      <Section id="forms" title="Form fields" note="Labels above fields, hints in plain words, errors in red with an icon and a sentence that says how to fix it. Press Save to see errors.">
        <Card><FormDemo /></Card>
        <Card className="mt-4"><p className={`${type.h3} mb-3`}>Choice cards (client pages)</p><div className="max-w-md"><ChoiceDemo /></div></Card>
      </Section>

      <Section id="feedback" title="Alerts, dialogs and toasts" note="Dialogs confirm anything that cannot be undone. Toasts confirm that something worked.">
        <div className="grid gap-3 md:grid-cols-2">
          <Alert tone="info" title="Rates need approval">The GST/HST table must be approved by an owner before quotes use it.</Alert>
          <Alert tone="success" title="Signed">Both spouses signed on Nov 7, 2026.</Alert>
          <Alert tone="warning" title="Expires in 3 days">The client has not signed yet.</Alert>
          <Alert tone="danger" title="Province missing">This quote cannot be made until the client&apos;s province is entered.</Alert>
        </div>
        <Card className="mt-4"><OverlayDemo /></Card>
      </Section>

      <Section id="layout" title="Page headers and cards" note="Every staff page starts with the same header. Cards group related details.">
        <Card>
          <PageHeader eyebrow="Leads" title="Jordan Sample" description="Personal tax · Assigned to Test Staff A · Lead from Website"
            actions={<><Button variant="secondary">Reassign</Button><Button>Open quote</Button></>} />
          <Meta items={[
            { label: "Status", value: <StatusPill status="viewed" /> },
            { label: "Quote total before tax", value: <span className="tabular-nums">{money(54700)}</span> },
            { label: "Sent", value: "Nov 5, 2026 by Test Staff A" },
            { label: "Link expires", value: "Nov 26, 2026" },
          ]} />
        </Card>
      </Section>

      <Section id="staff-preview" title="Staff preview of an unsent quote" note="Staff see DRAFT FOR REVIEW until the quote is sent. The client's copy never shows it.">
        <div className="max-w-xl">
          <DocumentSheet draft>
            <p className={`${type.caption} text-ink-3`}>Quote · Personal tax · Draft</p>
            <h3 className="mt-1 text-xl font-semibold">Taylor Dummy</h3>
            <p className="mt-4 text-sm text-ink-2">Personal tax return, single</p>
            <p className="text-sm font-semibold tabular-nums">{money(29900)}</p>
          </DocumentSheet>
        </div>
      </Section>

      <Section id="tables" title="Tables" note="Click a column heading to sort. Every table has a plain empty state.">
        <Card padded={false}><TableDemo /></Card>
      </Section>

      <Section id="navigation" title="Navigation" note="Staff sidebar in Concept navy with grouped sections, like Concept Studio. Step tracker for multi-step work.">
        <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
          <div className="h-[640px] overflow-hidden rounded-2xl shadow-[var(--shadow-raised)]">
            <Sidebar user={{ name: "Test Owner", role: "Owner" }} groups={[
              { label: "Workspace", items: [
                { href: "#navigation", label: "Home", icon: <Home />, active: true },
                { href: "#navigation", label: "Leads", icon: <Inbox /> },
                { href: "#navigation", label: "Clients", icon: <Users /> },
                { href: "#navigation", label: "Quotes", icon: <FileSignature /> },
                { href: "#navigation", label: "Document vault", icon: <Archive /> },
              ] },
              { label: "Price book", items: [
                { href: "#navigation", label: "Price book", icon: <BookOpen /> },
                { href: "#navigation", label: "Screening questions", icon: <ListChecks /> },
                { href: "#navigation", label: "Tax rates", icon: <Percent /> },
                { href: "#navigation", label: "Engagement letters", icon: <FileText />, badge: "Soon" },
              ] },
              { label: "Admin", items: [
                { href: "#navigation", label: "Staff and roles", icon: <ShieldCheck /> },
                { href: "#navigation", label: "Settings", icon: <Settings /> },
                { href: "#navigation", label: "Activity log", icon: <History /> },
              ] },
            ]} />
          </div>
          <Card><p className={`${type.h3} mb-4`}>Step tracker</p><StepsDemo /></Card>
        </div>
      </Section>

      <Section id="client" title="Client pages" note="What clients see, on a phone. Calm, spacious, one clear action per screen, large tap targets. Figures and tax wording are samples only.">
        <div className="grid justify-items-center gap-6 md:grid-cols-2 xl:grid-cols-3">
          <Phone label="1. Start page">
            <ClientShell>
              <h1 className="text-[28px] leading-9 font-semibold tracking-tight">Your tax return, prepared and reviewed by a CPA.</h1>
              <p className="mt-3 text-[15px] leading-6 text-ink-2">Answer a few questions and we prepare your quote.</p>
              <div className="mt-6 space-y-3">
                <RouteCard href="#client" icon={<User />} title="File your personal tax return" body="For individuals and couples." />
                <RouteCard href="#client" icon={<Building2 />} title="File your corporate tax return" body="For corporations and PRECs." />
              </div>
              <div className="mt-6"><TrustRow /></div>
            </ClientShell>
          </Phone>

          <Phone label="2. Screening question">
            <ClientShell step="Personal tax">
              <ProgressBar value={0.35} label="Question 3 of 9" />
              <h1 className="mt-8 text-[22px] leading-8 font-semibold tracking-tight">Who is filing?</h1>
              <p className="mt-1 mb-5 text-sm text-ink-2">Couples on one invoice pay one combined base price.</p>
              <ChoiceDemo />
              <div className="mt-8 flex gap-3">
                <Button variant="secondary" size="lg" className="flex-1">Back</Button>
                <Button size="lg" className="flex-[2]">Continue</Button>
              </div>
            </ClientShell>
          </Phone>

          <Phone label="3. Quote">
            <ClientShell step="Your quote">
              <DocumentSheet>
                <p className={`${type.caption} text-ink-3`}>Quote · Personal tax</p>
                <h1 className="mt-1 text-[22px] leading-8 font-semibold">Riley and Sam Example</h1>
                <p className="text-sm text-ink-2">Prepared by Test Staff A · Nov 5, 2026</p>
                <table className="mt-6 w-full text-sm">
                  <tbody>
                    {[["Personal tax returns, couple", 34900], ["Investment sales (Riley)", 9900], ["Investment sales (Sam)", 9900]].map(([n, c]) => (
                      <tr key={n as string} className="border-b border-sand-100"><td className="py-2.5 pr-2">{n}</td><td className="py-2.5 text-right tabular-nums">{money(c as number)}</td></tr>
                    ))}
                    <tr><td className="pt-3 font-semibold">Total before tax</td><td className="pt-3 text-right font-semibold tabular-nums">{money(54700)}</td></tr>
                  </tbody>
                </table>
                <p className="mt-2 text-[13px] text-ink-3">GST/HST for your province is added here from the approved rate table.</p>
                <h2 className="mt-8 text-base font-semibold">Engagement terms</h2>
                <p className="mt-2 text-sm leading-6 text-ink-2">The approved T1 engagement terms appear here in full, in plain words, before the signature section.</p>
              </DocumentSheet>
            </ClientShell>
          </Phone>

          <Phone label="4. Signing">
            <ClientShell step="Sign">
              <h1 className="text-[22px] leading-8 font-semibold tracking-tight">Sign your agreement</h1>
              <p className="mt-1 text-sm text-ink-2">Riley, type your full name to sign. Sam gets their own link.</p>
              <div className="mt-6 space-y-5">
                <Field id="sig-name" label="Your full name"><Input id="sig-name" size="lg" defaultValue="Riley Example" /></Field>
                <div className="rounded-xl border border-sand-200 bg-sand-50 p-4"><p className="font-[cursive] text-3xl text-navy-800">Riley Example</p><p className="mt-1 text-xs text-ink-3">Your typed signature</p></div>
                <Checkbox id="sig-ok" label="I have read the quote and the engagement terms and I agree to them." />
                <Button size="lg" className="w-full">Sign agreement</Button>
                <TrustRow />
              </div>
            </ClientShell>
          </Phone>

          <Phone label="5. Signed">
            <ClientShell>
              <div className="text-center">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success-soft text-success"><CircleCheck className="h-8 w-8" aria-hidden /></span>
                <h1 className="mt-5 text-[26px] leading-8 font-semibold tracking-tight">Signed. Thank you, Riley.</h1>
                <p className="mx-auto mt-2 max-w-sm text-[15px] leading-6 text-ink-2">Download your copy now. Next, create your secure portal account to upload your documents.</p>
                <div className="mt-8 space-y-3">
                  <Button variant="secondary" size="lg" className="w-full"><Download className="h-4 w-4" aria-hidden />Download your copy (PDF)</Button>
                  <Button variant="accent" size="lg" className="w-full">Continue to the secure portal<ArrowRight className="h-4 w-4" aria-hidden /></Button>
                </div>
              </div>
            </ClientShell>
          </Phone>
        </div>
      </Section>

      <p className="mt-16 border-t border-sand-200 pt-6 text-center text-[13px] text-ink-3">All names and figures on this page are dummy data.</p>
    </div>
  );
}

function Section({ id, title, note, children }: { id: string; title: string; note: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 pt-12">
      <h2 className={type.h2}>{title}</h2>
      <p className="mt-1 mb-5 max-w-3xl text-sm text-ink-2">{note}</p>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 md:grid-cols-[8rem_1fr] md:items-center">
      <span className="text-xs font-medium text-ink-3">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Phone({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="w-full max-w-[360px]">
      <figcaption className="mb-2 text-center text-[13px] font-medium text-ink-2">{label}</figcaption>
      <div className="h-[760px] overflow-y-auto rounded-[2rem] border-[6px] border-navy-950 bg-paper shadow-[var(--shadow-raised)]">{children}</div>
    </figure>
  );
}
