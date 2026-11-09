"use client";

import { useState } from "react";
import { Download, Plus, Search, Trash2 } from "lucide-react";
import { DataTable, type Column } from "@/components/ds/data-table";
import { ConfirmDialog, useToast } from "@/components/ds/overlays";
import { Button, ChoiceCards, Field, Input, Select, StatusPill, type Status, money, Checkbox, Textarea } from "@/components/ds/primitives";
import { Steps } from "@/components/ds/navigation";
import { formatDate } from "@/lib/dates";

type Row = { id: string; client: string; route: string; staff: string; status: Status; total: number; sent: string };
const ROWS: Row[] = [
  { id: "1", client: "Jordan Sample", route: "Personal", staff: "Test Staff A", status: "signed", total: 54700, sent: "2026-11-02" },
  { id: "2", client: "Riley & Sam Example", route: "Personal", staff: "Test Staff B", status: "viewed", total: 174400, sent: "2026-11-05" },
  { id: "3", client: "Example Holdings Inc.", route: "Corporate", staff: "Test Staff A", status: "sent", total: 280000, sent: "2026-11-06" },
  { id: "4", client: "Taylor Dummy", route: "Personal", staff: "Unassigned", status: "draft", total: 29900, sent: "" },
  { id: "5", client: "Casey Placeholder", route: "Personal", staff: "Test Staff B", status: "expired", total: 64800, sent: "2026-10-12" },
  { id: "6", client: "Morgan Test", route: "Personal", staff: "Test Staff A", status: "out_of_scope", total: 0, sent: "" },
];

const COLUMNS: Column<Row>[] = [
  { key: "client", header: "Client", sortValue: (r) => r.client, render: (r) => <span className="font-medium">{r.client}</span> },
  { key: "route", header: "Type", sortValue: (r) => r.route },
  { key: "staff", header: "Assigned", sortValue: (r) => r.staff, render: (r) => <span className={r.staff === "Unassigned" ? "text-ink-3" : ""}>{r.staff}</span> },
  { key: "status", header: "Status", sortValue: (r) => r.status, render: (r) => <StatusPill status={r.status} /> },
  { key: "sent", header: "Sent", sortValue: (r) => r.sent, render: (r) => (r.sent ? formatDate(r.sent) : <span className="text-ink-3">Not sent</span>) },
  { key: "total", header: "Total before tax", align: "right", sortValue: (r) => r.total, render: (r) => (r.total ? money(r.total) : "") },
];

export function TableDemo() {
  const [empty, setEmpty] = useState(false);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-sand-200 p-4">
        <div className="relative min-w-56 flex-1 basis-64">
          <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input placeholder="Search clients" className="pl-9" aria-label="Search clients" />
        </div>
        <div className="w-44"><Select aria-label="Filter by status"><option>All statuses</option><option>Sent</option><option>Signed</option></Select></div>
        <Button variant="secondary" onClick={() => setEmpty((e) => !e)}>{empty ? "Show rows" : "Show empty state"}</Button>
        <Button><Plus className="h-4 w-4" aria-hidden />New quote</Button>
      </div>
      <DataTable columns={COLUMNS} rows={empty ? [] : ROWS} caption="Sample quotes"
        empty={{ title: "No quotes yet", description: "Quotes appear here when a client finishes the screening questions.", action: <Button variant="secondary"><Plus className="h-4 w-4" aria-hidden />New quote</Button> }} />
    </div>
  );
}

export function OverlayDemo() {
  const toast = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmDialog
        title="Withdraw this quote?"
        body={<>The client&apos;s link stops working right away. You can make a new version later. This is recorded in the activity log.</>}
        confirmLabel="Withdraw quote" tone="danger"
        onConfirm={() => toast({ tone: "success", text: "Quote withdrawn. The link no longer works." })}
        trigger={(open) => <Button variant="danger" onClick={open}><Trash2 className="h-4 w-4" aria-hidden />Withdraw quote</Button>}
      />
      <ConfirmDialog
        title="Mark as sent?"
        body="Do this after you send the email from Outlook. The link expires 21 days from now."
        confirmLabel="Mark as sent"
        onConfirm={() => toast({ tone: "success", text: "Marked as sent. Link expires in 21 days." })}
        trigger={(open) => <Button onClick={open}>Mark as sent</Button>}
      />
      <Button variant="secondary" onClick={() => toast({ tone: "info", text: "Email text copied. Paste it into Outlook." })}>Info toast</Button>
      <Button variant="secondary" onClick={() => toast({ tone: "error", text: "Could not save. Check your connection and try again." })}>Error toast</Button>
    </div>
  );
}

export function FormDemo() {
  const [errors, setErrors] = useState(false);
  return (
    <form className="grid gap-5 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); setErrors(true); }}>
      <Field id="f-name" label="Full name" error={errors ? "Enter the client's full legal name." : undefined}>
        <Input id="f-name" invalid={errors} aria-describedby={errors ? "f-name-error" : undefined} />
      </Field>
      <Field id="f-email" label="Email" hint="We send the quote link to this address.">
        <Input id="f-email" type="email" defaultValue="client@example.test" aria-describedby="f-email-hint" />
      </Field>
      <Field id="f-prov" label="Province or territory on December 31" error={errors ? "Choose a province. We need it to work out the tax on your quote." : undefined}>
        <Select id="f-prov" invalid={errors} defaultValue=""><option value="">Choose</option><option>Ontario</option><option>Alberta</option><option>British Columbia</option></Select>
      </Field>
      <Field id="f-count" label="How many rental properties do you have?" hint="One address is one property." optional>
        <Input id="f-count" type="number" inputMode="numeric" defaultValue={1} className="max-w-32" />
      </Field>
      <div className="md:col-span-2">
        <Field id="f-notes" label="Anything else we should know?" optional>
          <Textarea id="f-notes" placeholder="For example: I moved provinces this year." />
        </Field>
      </div>
      <div className="md:col-span-2"><Checkbox id="f-cb" label="Each person" hint="Ask this question for both spouses when a couple files." defaultChecked /></div>
      <div className="flex gap-2 md:col-span-2">
        <Button type="submit">Save</Button>
        <Button type="button" variant="secondary" onClick={() => setErrors(false)}>Clear errors</Button>
        <Button type="button" variant="ghost"><Download className="h-4 w-4" aria-hidden />Download</Button>
      </div>
    </form>
  );
}

export function ChoiceDemo() {
  const [v, setV] = useState("couple");
  return (
    <ChoiceCards name="demo-filing" value={v} onChange={setV} options={[
      { value: "single", label: "Just me" },
      { value: "couple", label: "Me and my spouse or partner", hint: "We live together. Concept prepares both returns on one invoice." },
    ]} />
  );
}

export function StepsDemo() {
  const [n, setN] = useState(1);
  return (
    <div className="space-y-4">
      <Steps steps={["Type", "Client", "People", "Letter", "Fees"]} current={n} />
      <div className="flex justify-between">
        <Button variant="secondary" size="sm" onClick={() => setN((x) => Math.max(0, x - 1))}>Back</Button>
        <Button size="sm" onClick={() => setN((x) => Math.min(5, x + 1))}>Next</Button>
      </div>
    </div>
  );
}
