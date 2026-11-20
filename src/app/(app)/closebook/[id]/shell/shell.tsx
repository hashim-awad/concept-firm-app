// Round 15 (Hashim, Nov 14, 2026; benchmark: CaseWare Cloud). A Closebook file is a few top-level pages:
// one dark header bar (client, year end, status, net income, T2 due, history), five tabs (Steps, Trial
// balance, Entries, Notes, Statements), a left panel that follows the tab, and the page. Sign-offs are
// CaseWare's circles: grey with a pencil when not signed, the person's initials with a blue pencil once
// prepared, with a green tick once reviewed; a click opens a popover to sign or take back.
// Piece UI1 (Hashim, Nov 20, 2026; M1 A): a white header (client name, year end, status, people, net income, T2 due,
// History, My files), a 4-part strip counting reviewed steps per module, then the tabs with Tools last. Sign-offs are
// tags: filled blue "Prepared", green "Reviewed", grey "Not prepared"/"Not reviewed"; the same popover signs or takes back.
import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ChevronDown, Clock, Download, FileText, HelpCircle, Lock, MessageSquarePlus, TriangleAlert } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { Progress } from "@/lib/closebook/step-progress";
import type { StepStatus } from "@/lib/closebook/review-server";
import { addNote, signStep, unsignStep } from "../../actions";
import { signSubstep, unsignSubstep } from "../../banking-actions";
import { setPeople } from "../../round16-actions";
import { Drawer, FileToast, LeftPanel, Popover, ToolsMenu, TopSync } from "./ui";
import { StepMenu, type StepMenuProps } from "./step-menu";

export type Area = "steps" | "tb" | "entries" | "reporting" | "notes" | "statements";
// Round 32: Reporting sits after Entries (QuickBooks Online's Reports page). UI1: the tab reads "Reports" (the address
// keeps area=reporting) and Tools comes last.
export const AREAS: [Area, string][] = [["steps", "Steps"], ["tb", "Trial balance"], ["entries", "Entries"], ["reporting", "Reports"], ["notes", "Notes"], ["statements", "Statements"]];
export type FileStatus = "Open" | "In progress" | "Ready for review" | "Reviewed" | "Locked";
// UI1 colour rule (Q9): green = done (Reviewed), blue = in progress, amber = needs someone's attention, grey = not started,
// dark = locked. Red only for review notes and errors.
export const STATUS_CLS: Record<FileStatus, string> = {
  Open: "bg-sand-100 text-[#3F4246]", "In progress": "bg-info-soft text-info", "Ready for review": "bg-warning-soft text-warning", Reviewed: "bg-success-soft text-success", Locked: "bg-ink text-white",
};
const TAG = "inline-flex items-center gap-1 px-2 py-0.5 text-[12px] font-medium whitespace-nowrap";
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
export const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };

// Round 16 (CaseWare Cloud engagement properties): the file's preparer and reviewer, changed by an Admin with Edit on Closebook (R3a-1).
export type PeopleProps = { preparer: { id: string; name: string }; reviewer: { id: string; name: string }; canChange: boolean;
  preparers: { id: string; name: string }[]; reviewers: { id: string; name: string }[]; back: string; error?: string | null };
function PeopleChip({ fileId, p }: { fileId: string; p: PeopleProps }) {
  const same = p.preparer.id === p.reviewer.id;
  const chip = (
    <span className="inline-flex items-center gap-1 border border-sand-300 px-2 py-1 text-[12.5px] whitespace-nowrap text-ink-2 hover:border-ink-3" data-people
      aria-label={`People on this file: preparer ${p.preparer.name}, reviewer ${p.reviewer.name}`}>
      <span className="max-[1440px]:hidden">Preparer</span> <b className="font-semibold text-ink" title={p.preparer.name}>{initials(p.preparer.name)}</b><span aria-hidden>·</span><span className="max-[1440px]:hidden">Reviewer</span> <b className="font-semibold text-ink" title={p.reviewer.name}>{initials(p.reviewer.name)}</b>
      {p.canChange && <ChevronDown className="h-3 w-3" aria-hidden />}
    </span>
  );
  // WCAG 2.5.3: the name starts with the words on the chip.
  const peopleLabel = `Preparer ${initials(p.preparer.name)}, Reviewer ${initials(p.reviewer.name)}. People on this file: preparer ${p.preparer.name}, reviewer ${p.reviewer.name}`;
  const sameLine = same && <p className="mt-2 rounded bg-sand-100 px-2 py-1 text-xs text-ink-2">Prepared and reviewed by the same person.</p>;
  if (!p.canChange) return (
    <Popover align="right" width="w-64" label={peopleLabel} button={chip}>
      <p className="text-[12.5px]"><span className="text-ink-3">Preparer</span> {p.preparer.name}</p><p className="text-[12.5px]"><span className="text-ink-3">Reviewer</span> {p.reviewer.name}</p>{sameLine}
    </Popover>
  );
  return (
    <Popover align="right" width="w-72" label={peopleLabel} button={chip} open={!!p.error}>
      <form action={setPeople} className="grid gap-2.5">
        <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={p.back} />
        <p className="font-semibold">People</p>
        <label className="grid gap-1 text-[11.5px] font-semibold text-ink-2">Preparer
          <select name="preparer" defaultValue={p.preparer.id} className="input input-compact text-[13px] font-normal text-ink">{p.preparers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {/* Only people with the Review right are offered as reviewer: the database refuses anyone else. */}
        <label className="grid gap-1 text-[11.5px] font-semibold text-ink-2">Reviewer
          <select name="reviewer" defaultValue={p.reviewer.id} className="input input-compact text-[13px] font-normal text-ink">{p.reviewers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {sameLine}
        {p.error && <p role="alert" className="text-[12.5px] text-danger">{p.error}</p>}
        <div><button type="submit" className="btn btn-compact">Save</button></div>
      </form>
    </Popover>
  );
}

export type StripPart = { name: string; reviewed: number; of: number };
export function FileShell({ fileId, client, clientHref, yearEnd, source, netNote, status, netCents, t2Due, area, history, left, folded, forceFolded, narrowFold, pinned, toast, notes, people, done, strip, tools, stepSum, children }: {
  fileId: string; client: string; clientHref?: string; yearEnd: string; source?: string; netNote?: string; status: FileStatus; netCents: number | null; t2Due: string; area: Area;
  history: boolean; left: ReactNode; folded?: ReactNode; toast: { msg?: string | null; error?: string | null; info?: { id: string; text: string } | null }; notes: number; people?: PeopleProps;
  done?: { n: number; of: number }; children: ReactNode; pinned?: boolean; forceFolded?: boolean; narrowFold?: boolean;
  strip?: StripPart[];      // UI1: the 4 modules, each counting its reviewed steps
  stepSum?: string;         // UI1: below 1024 px the step list folds behind one button naming the open step
  tools?: { on: boolean; journal: boolean };   // round 38b: the Tools menu (on: a tool's page is open; journal: New journal entry offered)
}) {
  const locked = status === "Locked";
  const stripWords = strip ? `Progress: ${strip.map((m) => `${m.name} ${m.reviewed} of ${m.of} reviewed`).join(", ")}` : "";
  return (
    // Below the 56 px top bar: the file fills the rest of the screen, never more (so the trial balance page never scrolls).
    <div className="flex min-h-[calc(100vh-56px)] flex-col bg-paper">
      <TopSync />
      <section aria-label="File" data-fhead className="z-30 flex-none border-b border-sand-200 bg-white px-4 pt-3 print:hidden lg:sticky lg:top-14 lg:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="min-w-[11rem] shrink text-[18px] leading-tight font-semibold">
            {clientHref ? <Link href={clientHref} className="text-navy-700 underline decoration-1 underline-offset-[3px] hover:decoration-2 min-[1100px]:line-clamp-1" title={client}>{client}</Link> : client}
          </h1>
          <span className="text-[13px] whitespace-nowrap text-ink-2">Year end {formatDate(yearEnd)}{source && <span className="max-[1440px]:hidden"> · {source}</span>}</span>
          <span className={`${TAG} ${STATUS_CLS[status]}`} data-file-status>{locked && <Lock className="h-3 w-3" aria-hidden />}{status}</span>
          {people && <PeopleChip fileId={fileId} p={people} />}
          {/* Round 21 (ProFile, TurboTax): how far the file has got, counted from the preparer's sign-offs (read by tests and screen readers). */}
          {done && <span className="sr-only" data-steps-done={done.n}>{done.n} of {done.of} steps done</span>}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 max-[1099px]:ml-0 max-[1099px]:w-full">
            {netCents !== null && <span className="text-[13px] whitespace-nowrap text-ink-2">{netCents < 0 ? "Net loss" : "Net income"}<b className="ml-1.5 text-[15px] font-semibold text-ink tabular-nums">{money(netCents)}</b>
              {netNote && <Link href={`/closebook/${fileId}?step=code`} title={netNote} data-net-note={netNote} className="ml-1.5 inline-flex min-h-6 min-w-6 items-center justify-center text-[12.5px] text-warning underline underline-offset-2 hover:decoration-2"><span aria-hidden className="mr-1 h-2 w-2 rounded-full bg-warning min-[1440px]:hidden" /><span className="min-[1440px]:hidden">Not final<span className="sr-only">, {netNote}</span></span><span className="max-[1440px]:hidden">{netNote}</span></Link>}</span>}
            <span className="text-[13px] whitespace-nowrap text-ink-2">T2 due<b className="ml-1.5 text-[15px] font-semibold text-ink">{formatDate(t2Due)}</b></span>
            {history && <Link href={`/closebook/${fileId}?history=1`} title="File history" className="inline-flex h-8 items-center gap-1.5 border border-navy-700 px-2.5 text-[13px] font-medium text-navy-700 hover:bg-navy-50"><Clock className="h-[15px] w-[15px]" aria-hidden />History</Link>}
            <Link href="/closebook" className="text-[13px] whitespace-nowrap text-navy-700 hover:underline">My files</Link>
          </div>
        </div>
        {strip && (
          <div className="mt-2.5 flex gap-1" role="img" aria-label={stripWords} data-strip>
            {strip.map((m) => <span key={m.name} title={`${m.name}: ${m.reviewed} of ${m.of} reviewed`} className="h-1 flex-1 bg-sand-200"><i className="block h-1 bg-success" style={{ width: `${m.of ? Math.round((m.reviewed / m.of) * 100) : 0}%` }} /></span>)}
          </div>
        )}
        <ShellTabs fileId={fileId} area={area} toast={toast} notes={notes} tools={tools ?? { on: false, journal: false }} />
      </section>
      {locked && (
        <p role="status" className="flex items-center gap-2 border-b border-sand-200 bg-sand-100 px-4 py-2 text-[13px] text-ink lg:px-6" data-locked-line>
          <Lock className="h-3.5 w-3.5" aria-hidden />This file is locked. Everything is read-only until someone with the Lock and unlock right reopens it in step 10.
        </p>
      )}
      <div className="flex flex-1 max-lg:flex-col">
        {left !== null && <LeftPanel wide={area === "steps"} folded={folded} pinned={pinned} forceFolded={forceFolded} narrowFold={narrowFold} summary={stepSum}>{left}</LeftPanel>}
        {/* Card headings in small capitals on every file screen (round 15). */}
        <div id="paper" tabIndex={-1} className="cb-push min-w-0 flex-1 px-5 pt-3.5 pb-12 outline-none [&_.card]:shadow-none [&_.card>h2]:text-[11.5px] [&_.card>h2]:font-bold [&_.card>h2]:tracking-[.08em] [&_.card>h2]:text-navy-900 [&_.card>h2]:uppercase [&_.card>div>h2]:text-[11.5px] [&_.card>div>h2]:font-bold [&_.card>div>h2]:tracking-[.08em] [&_.card>div>h2]:text-navy-900 [&_.card>div>h2]:uppercase">{children}</div>
      </div>
    </div>
  );
}

// Round 38b (Hashim, Nov 18, 2026; benchmark QuickBooks Online Accountant's "Accountant tools"): "Tools ▾" after
// Entries is a menu, not a page. A tool's page (Reclassify) marks Tools, not Trial balance, as where the person is.
function ShellTabs({ fileId, area, toast, notes, tools }: { fileId: string; area: Area; toast: { msg?: string | null; error?: string | null; info?: { id: string; text: string } | null }; notes: number;
  tools: { on: boolean; journal: boolean } }) {
  const here = (k: Area) => k === area && !tools.on;
  return (
    <nav aria-label="File areas" className="mt-1.5 flex h-[42px] flex-none items-stretch gap-0 max-lg:h-auto max-lg:flex-wrap">
      {AREAS.map(([k, label]) => (
        <Link key={k} href={k === "steps" ? `/closebook/${fileId}` : `/closebook/${fileId}?area=${k}`} aria-current={here(k) ? "page" : undefined}
          className={`flex items-center gap-1.5 border-b-[3px] px-3.5 py-2 text-[14px] whitespace-nowrap ${here(k) ? "border-navy-700 font-semibold text-navy-700" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}>
          {label}{k === "notes" && notes > 0 && <><span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-danger px-1 text-[10.5px] font-bold text-white" aria-hidden>{notes}</span><span className="sr-only">, {notes} open note{notes === 1 ? "" : "s"}</span></>}
        </Link>
      ))}
      <ToolsMenu fileId={fileId} on={tools.on} journal={tools.journal} />
      <FileToast msg={toast.msg} error={toast.error} info={toast.info} />
    </nav>
  );
}

// A section heading in the left panel.
export const PanelHead = ({ children }: { children: ReactNode }) => <p className="px-3.5 pt-2.5 pb-1 text-[10.5px] font-bold tracking-[.1em] text-ink-3 uppercase">{children}</p>;
export function PanelLink({ href, on, children, count, title }: { href: string; on?: boolean; children: ReactNode; count?: ReactNode; title?: string }) {
  return (
    <Link href={href} title={title} aria-current={on ? "page" : undefined}
      className={`flex items-center gap-2 px-3.5 py-1.5 text-[12.5px] ${on ? "bg-navy-50 font-semibold text-navy-900 shadow-[inset_3px_0_0_var(--color-navy-700)]" : "text-ink-2 hover:bg-sand-50"}`}>
      <span className="min-w-0 flex-1 truncate">{children}</span>{count !== undefined && <span className="text-[11.5px] text-ink-3 tabular-nums">{count}</span>}
    </Link>
  );
}

// ---------------------------------------------------------------------------------------------------
// Sign-off circles.
// ---------------------------------------------------------------------------------------------------
type SignProps = { fileId: string; step: string; st: StepStatus | undefined; names: Map<string, string>; me: string; editable: boolean; back: string;
  canPrepare: boolean; canReview: boolean; canRemove: boolean;   // R3a-1: the Closebook switches on the person's role
  preparerElsewhere?: boolean; size?: "sm" | "lg"; align?: "left" | "right"; side?: "below" | "right";
  sub?: string;     // round 23: a Banking sub-step (3.1, 3.2, 3.3), signed on its own
  subsOf?: { key: string; href: string; prepared: boolean; reviewed: boolean }[];   // round 34: step 3 on a bank file, signed in its sub-steps
  signers?: { prepared: string[]; reviewed: string[] } };   // UI1 Q3: everyone who signed the parts, by name

// UI1 (M1 A, Q2, Q3): a sign-off is a tag. Blue "Prepared" and green "Reviewed" are filled; grey says what is not signed.
// In the title row the tag names the person's initials and the date; in the step list it is one word.
function Tag({ kind, who, at, size, words }: { kind: "none-p" | "none-r" | "prepared" | "reviewed" | "progress"; who?: string; at?: string | null; size: "sm" | "lg"; words?: string }) {
  const cls = kind === "prepared" || kind === "progress" ? "bg-info-soft text-info" : kind === "reviewed" ? "bg-success-soft text-success" : "bg-sand-100 text-[#3F4246]";
  const signed = size === "lg" && (kind === "prepared" || kind === "reviewed");
  const text = words ?? (kind === "none-p" ? "Not prepared" : kind === "none-r" ? "Not reviewed" : kind === "progress" ? "In progress" : kind === "prepared" ? "Prepared" : "Reviewed");
  return <span className={`${TAG} ${cls}`} data-sign={kind}>{text}{signed && who ? ` ${who}` : ""}{signed && at ? `, ${formatDate(at)}` : ""}</span>;
}

export function SignCircles(p: SignProps) {
  // Round 21: in the step list the box opens beside the circle (CaseWare Cloud), floating above the page.
  const { fileId, step, st, names, me, canPrepare, canReview, canRemove, editable, back, size = "sm", align = "left", side = size === "sm" ? "right" : "below" } = p;
  const review = step === "review";
  const prepared = !!st?.prepared_at, reviewed = !!st?.reviewed_at;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const name = (id: string | null | undefined) => (id ? names.get(id) ?? "" : "");
  const signForm = (role: "prepared" | "reviewed", label: string) => (
    <form action={p.sub ? signSubstep : signStep} className="mt-2">{hidden("file_id", fileId)}{hidden("step", step)}{p.sub && hidden("sub", p.sub)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn btn-compact">{label}</button></form>
  );
  // R3a-1 (decision 6B): your own sign-off, or anyone's with the Remove others' sign-offs switch.
  const mine = (role: "prepared" | "reviewed") => (role === "prepared" ? st?.prepared_by : st?.reviewed_by) === me;
  const canUndo = (role: "prepared" | "reviewed") => mine(role) || canRemove;
  const undo = (role: "prepared" | "reviewed") => (
    <form action={p.sub ? unsignSubstep : unsignStep} className="mt-2">{hidden("file_id", fileId)}{hidden("step", step)}{p.sub && hidden("sub", p.sub)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn-secondary btn-compact">{mine(role) ? "Take back my sign-off" : "Remove this sign-off"}</button></form>
  );
  const problems = st?.problems ?? [];
  // Round 34: step 3 on a bank file has no sign-off of its own. Its circles say what is left, in the normal info style.
  const subsNote = (role: "prepared" | "reviewed") => {
    const left = (p.subsOf ?? []).filter((x) => !x[role]);
    return (
      <div className="mt-2 rounded-md bg-navy-50 px-2.5 py-2 text-xs text-ink-2" data-step3-note>
        <p>Step 3 is {role === "prepared" ? "complete" : "reviewed"} when 3.1, 3.2 and 3.3 are {role === "prepared" ? "signed" : "reviewed"}.</p>
        {left.length > 0 && <p className="mt-1">Still to {role === "prepared" ? "sign" : "review"}: {left.map((x, i) => <span key={x.key}>{i > 0 && ", "}<Link href={x.href} className="font-semibold text-navy-700 underline">{x.key}</Link></span>)}</p>}
      </div>
    );
  };
  // Q3: on a step signed in parts (step 3 on a bank file), every signer's initials.
  const whoP = p.signers?.prepared.length ? p.signers.prepared.map(initials).join(", ") : initials(name(st?.prepared_by));
  const whoR = p.signers?.reviewed.length ? p.signers.reviewed.map(initials).join(", ") : initials(name(st?.reviewed_by));
  // Q2: a step signed in parts reads "In progress" until every part is.
  const partly = (role: "prepared" | "reviewed") => !!p.subsOf && p.subsOf.some((x) => x[role]) && !p.subsOf.every((x) => x[role]);
  const prepContent = (
    <>
      <p className="font-bold">{prepared ? `Prepared by ${name(st!.prepared_by)}` : "Preparer"}</p>
      <p className="text-ink-3">{prepared ? formatDateTime(st!.prepared_at) : "Not signed"}</p>
      {!prepared && problems.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-ink-2">{problems.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul>}
      {!prepared && p.subsOf ? subsNote("prepared") : !prepared && editable && (p.preparerElsewhere ? <p className="mt-2 text-xs text-ink-2">Sign with the schedule below.</p> : canPrepare ? signForm("prepared", "Sign as preparer") : <p className="mt-2 text-xs text-ink-3">You need the Prepare right to sign as preparer.</p>)}
      {prepared && !reviewed && editable && canUndo("prepared") && !p.subsOf && undo("prepared")}
    </>
  );
  const revContent = (
    <>
      <p className="font-bold">{reviewed ? `Reviewed by ${name(st!.reviewed_by)}` : "Reviewer"}</p>
      <p className="text-ink-3">{reviewed ? formatDateTime(st!.reviewed_at) : review || prepared ? "Not signed" : "After the preparer"}</p>
      {reviewed && prepared && st?.prepared_by === st?.reviewed_by && <p className="mt-1 text-xs text-ink-2">Prepared and reviewed by the same person.</p>}
      {!reviewed && p.subsOf ? subsNote("reviewed") : !reviewed && editable && (canReview ? (review || prepared) && signForm("reviewed", review ? "Sign step 7 as reviewer" : "Sign as reviewer")
        : <p className="mt-2 text-xs text-ink-3">You need the Review right to sign as reviewer.</p>)}
      {reviewed && editable && canUndo("reviewed") && !p.subsOf && undo("reviewed")}
    </>
  );
  // WCAG 2.5.3: each name starts with the words on the tag, then the full name with date and time.
  const partWords = (role: "prepared" | "reviewed") => `In progress, ${role} ${p.subsOf!.filter((x) => x[role]).length} of ${p.subsOf!.length}`;
  const pWords = partly("prepared") ? (size === "lg" ? partWords("prepared") : "In progress") : prepared ? (size === "lg" ? `Prepared ${whoP}, ${formatDate(st!.prepared_at)}` : "Prepared") : size === "lg" ? "Not prepared" : "Open";
  const rWords = partly("reviewed") ? (size === "lg" ? partWords("reviewed") : "In progress") : reviewed ? (size === "lg" ? `Reviewed ${whoR}, ${formatDate(st!.reviewed_at)}` : "Reviewed") : size === "lg" ? "Not reviewed" : "Open";
  const pLabel = prepared ? `${pWords}. Prepared by ${name(st!.prepared_by)}, ${formatDateTime(st!.prepared_at)}, open sign-off` : `${pWords}. Preparer not signed, open sign-off`;
  const rLabel = reviewed ? `${rWords}. Reviewed by ${name(st!.reviewed_by)}, ${formatDateTime(st!.reviewed_at)}, open sign-off` : `${rWords}. Reviewer not signed, open sign-off`;
  if (size === "sm") {
    // The step list: one tag, the furthest sign-off; the box holds both.
    const kind = reviewed ? "reviewed" : partly("reviewed") || (!prepared && partly("prepared")) ? "progress" : prepared ? "prepared" : null;
    if (!kind) {
      // Nothing signed: "Open" in the list, still opening the sign-off box.
      return (
        <Popover align={align} side={side} label={review ? rLabel : pLabel} button={<Tag kind="none-p" size="sm" words="Open" />}>
          {!review && prepContent}{review && revContent}
        </Popover>
      );
    }
    return (
      <Popover align={align} side={side} label={kind === "progress" ? `In progress. ${partly("reviewed") ? partWords("reviewed") : partWords("prepared")}, open sign-off` : reviewed ? rLabel : pLabel} button={<Tag kind={kind} size="sm" />}>
        {!review && <div className="mb-3">{prepContent}</div>}{revContent}
      </Popover>
    );
  }
  const prep = !review && (
    <Popover align={align} side={side} label={pLabel} button={partly("prepared") ? <Tag kind="progress" size="lg" words={partWords("prepared")} /> : <Tag kind={prepared ? "prepared" : "none-p"} who={whoP} at={st?.prepared_at} size="lg" />}>{prepContent}</Popover>
  );
  const rev = (
    <Popover align={align} side={side} label={rLabel} button={partly("reviewed") ? <Tag kind="progress" size="lg" words={partWords("reviewed")} /> : <Tag kind={reviewed ? "reviewed" : "none-r"} who={whoR} at={st?.reviewed_at} size="lg" />}>{revContent}</Popover>
  );
  // D4 (mock 1280-banking-states): the Sign button sits beside an unsigned tag for someone who may sign; the box keeps the details.
  const signNow = (role: "prepared" | "reviewed", label: string) => (
    <form action={p.sub ? signSubstep : signStep} className="inline-flex">{hidden("file_id", fileId)}{hidden("step", step)}{p.sub && hidden("sub", p.sub)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn btn-compact">{label}</button></form>
  );
  const canSignP = !review && !prepared && editable && canPrepare && !p.subsOf && !p.preparerElsewhere;
  const canSignR = !reviewed && editable && canReview && (review || prepared) && !p.subsOf;
  return <span className="inline-flex flex-wrap items-center gap-1.5">{prep}{canSignP && signNow("prepared", "Sign as preparer")}{rev}{canSignR && signNow("reviewed", review ? "Sign step 7 as reviewer" : "Sign as reviewer")}</span>;
}

// ---------------------------------------------------------------------------------------------------
// A step's title row: the name in small capitals, the circles, the Issues chip, then add note, export
// and help on the right.
// ---------------------------------------------------------------------------------------------------
export function StepTitle({ n, name, paper, sub, sign, issues, notesPanel, next, addNoteFor, exports, help, menu, action }: {
  n: number; name: string; paper?: string; sub?: ReactNode; sign: SignProps | null; notesOpen?: number;
  action?: ReactNode;   // round 23: the page's one button, top right (Banking: "+ Add account", "Upload statements")
  issues: { problems: string[]; waiting: string[]; review: boolean };
  notesPanel: ReactNode; next?: string;
  addNoteFor: { fileId: string; step: string; back: string } | null;
  exports: [string, string][]; help: ReactNode; menu?: StepMenuProps | null;
}) {
  // Round 15b fix 2: the chip shows only when something is open: problems, waiting items or open notes.
  // Round 21 (Hashim item 11, one problem counts as one issue): an open review note is already a "To fix"
  // line (cb_step_status), and a note marked fixed is a "With the reviewer" line; it is not counted again.
  const count = issues.problems.length + issues.waiting.length;
  const icon = "grid h-[30px] w-[30px] place-items-center rounded-md text-ink-2 hover:bg-sand-100";
  // Round 21: a signed step says so in one line under the title (who and when).
  const st = sign?.st, signedBy = sign && sign.step !== "review" && st?.prepared_at ? st.prepared_by : sign?.step === "review" && st?.reviewed_at ? st.reviewed_by : null;
  const signedAt = sign?.step === "review" ? st?.reviewed_at : st?.prepared_at;
  return (
    <>
    <div className="mb-3 flex min-h-[30px] flex-wrap items-center gap-2.5">
      {/* Round 21 fix: "1 · SET UP" read as "I · SET UP" (a small bold 1 with wide letter spacing). The word
          Step and a plain, unspaced number say it clearly. */}
      <h2 className="pl-px text-[18px] font-semibold text-ink"><span className="tabular-nums">Step {n}</span> · {name}{paper && <><span className="mx-1.5 text-ink-3">›</span>{paper}</>}</h2>
      {sub && <span className="text-[12.5px] text-ink-3">{sub}</span>}
      {sign && <SignCircles {...sign} size="lg" />}
      {count > 0 && (
        <Drawer label="Issues" title={`Issues · ${name}`} button={
          <span className={`inline-flex items-center gap-1.5 border px-2.5 py-0.5 text-[12px] font-semibold ${count ? "border-[#E8C98F] bg-warning-soft text-warning" : "border-sand-300 bg-white text-ink-2"}`}>
            <TriangleAlert className="h-3.5 w-3.5" aria-hidden />Issues {count}</span>}>
          {next && <><p className="mb-1 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">Next</p><p className="mb-3">{next}</p></>}
          {issues.problems.length > 0 && <><p className="mb-1 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">{issues.review ? "Before step 7 can be signed" : "To fix"} ({issues.problems.length})</p>
            <ul className="mb-3 grid gap-1.5">{issues.problems.map((x) => <li key={x} className="rounded-md border border-sand-200 px-2.5 py-1.5">{x}</li>)}</ul></>}
          {issues.waiting.length > 0 && <><p className="mb-1 text-[11px] font-bold tracking-[.08em] text-ink-3 uppercase">With the reviewer ({issues.waiting.length})</p>
            <ul className="mb-3 grid gap-1.5">{issues.waiting.map((x) => <li key={x} className="rounded-md border border-sand-200 px-2.5 py-1.5 text-ink-2">{x}</li>)}</ul></>}
          {!count && !notesPanel && <p className="text-ink-3">Nothing open.</p>}
          {notesPanel}
        </Drawer>
      )}
      <span className="flex-1" />
      {addNoteFor && (
        <Popover align="right" width="w-80" label="Add review note" button={<span className={icon}><MessageSquarePlus className="h-[17px] w-[17px]" aria-hidden /></span>}>
          <form action={addNote} className="grid gap-2">
            <input type="hidden" name="file_id" value={addNoteFor.fileId} /><input type="hidden" name="step" value={addNoteFor.step} />
            <input type="hidden" name="target_type" value="step" /><input type="hidden" name="back" value={addNoteFor.back} />
            <label htmlFor={`note-${addNoteFor.step}`} className="text-xs font-bold">Review note</label>
            <textarea id={`note-${addNoteFor.step}`} name="body" rows={3} maxLength={2000} className="input" />
            <button type="submit" className="btn-secondary btn-compact justify-self-start">Add review note</button>
          </form>
        </Popover>
      )}
      {exports.length > 0 && (
        <Popover align="right" width="w-56" label="Export" button={<span className={icon}><Download className="h-[17px] w-[17px]" aria-hidden /></span>}>
          <ul className="grid gap-1">{exports.map(([href, label]) => <li key={href}><a href={href} className="block rounded px-2 py-1 hover:bg-sand-100">{label}</a></li>)}</ul>
        </Popover>
      )}
      <span data-page-help className="inline-flex"><Drawer label="Help" title={`Help · ${name}`} button={<span className={icon}><HelpCircle className="h-[17px] w-[17px]" aria-hidden /></span>}>
        <div className="grid gap-3 leading-relaxed text-ink-2 [&_h4]:text-[11px] [&_h4]:font-bold [&_h4]:tracking-[.08em] [&_h4]:text-ink-3 [&_h4]:uppercase">{help}</div>
        <p className="mt-6 rounded-md border border-dashed border-sand-300 px-3 py-2 text-xs text-ink-3">An assistant will answer questions here later.</p>
      </Drawer></span>
      {menu && <StepMenu {...menu} />}
      {action}
    </div>
    {sign && st?.prepared_at && st?.reviewed_at && st.prepared_by === st.reviewed_by && (
      <p className="-mt-1 mb-3 inline-block bg-warning-soft px-2.5 py-1 text-[13px] text-warning" data-same-person>Prepared and reviewed by the same person.</p>
    )}
    {signedBy && sign && (
      <p className="-mt-1.5 mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-success" data-signed-line>
        <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />Signed by {signedBy === sign.me ? "you" : sign.names.get(signedBy) ?? "someone"}, {formatDateTime(signedAt)}
      </p>
    )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------
// Round 21 (Hashim; ProFile and TurboTax side menus): a step's number shows its progress. Grey number:
// not started; blue ring: work started, not signed; green circle with a tick: signed by the preparer.
// ---------------------------------------------------------------------------------------------------
const PROGRESS_WORDS: Record<Progress, string> = { not_started: "Not started", started: "Work started, not signed", signed: "Signed by the preparer" };
// UI1 (M1 A): the number always shows. Green filled: reviewed. Blue ring: work started or prepared. Navy ring: the step open now.
export function StepMark({ n, p, reviewed, on }: { n: number; p: Progress; reviewed?: boolean; on?: boolean }) {
  const words = reviewed ? "Reviewed" : PROGRESS_WORDS[p];
  const box = "grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-semibold tabular-nums";
  const cls = reviewed ? "bg-success text-white" : on ? "border-2 border-navy-700 bg-white text-navy-700" : p !== "not_started" ? "border-[1.5px] border-info bg-white text-info" : "border-[1.5px] border-[#8C8F94] bg-white text-[#3F4246]";
  return <span title={words} data-progress={reviewed ? "reviewed" : p} className={`${box} ${cls}`}>{n}<span className="sr-only">, {words}</span></span>;
}
// The same states on a working paper under a step (Setup questions, Acceptance).
export function PaperMark({ p }: { p: Progress }) {
  if (p === "signed") return <span title={PROGRESS_WORDS[p]} data-progress={p} className="grid h-[15px] w-[15px] flex-none place-items-center rounded-full bg-success text-white"><Check className="h-[9px] w-[9px]" strokeWidth={3.4} aria-hidden /><span className="sr-only">{PROGRESS_WORDS[p]}</span></span>;
  if (p === "started") return <span title={PROGRESS_WORDS[p]} data-progress={p} className="grid h-[15px] w-[15px] flex-none place-items-center rounded-full border-[1.5px] border-[#2f6fd6] text-[#2f6fd6]"><FileText className="h-[9px] w-[9px]" aria-hidden /><span className="sr-only">{PROGRESS_WORDS[p]}</span></span>;
  return <span title={PROGRESS_WORDS[p]} data-progress={p} className="grid h-[15px] w-[15px] flex-none place-items-center text-ink-3"><FileText className="h-3.5 w-3.5" aria-hidden /><span className="sr-only">{PROGRESS_WORDS[p]}</span></span>;
}

// A title row for pages that are not steps (the trial balance, entries, notes, statements).
export function PageTitle({ children, right, help }: { children: ReactNode; right?: ReactNode; help?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-[30px] flex-wrap items-center gap-2.5">
      <h2 className="text-xs font-bold tracking-[.1em] text-navy-900 uppercase">{children}</h2>
      <span className="flex-1" />{right}
      {help && <span data-page-help className="inline-flex"><Drawer label="Help" title="Help" button={<span className="grid h-[30px] w-[30px] place-items-center rounded-md text-ink-2 hover:bg-sand-100"><HelpCircle className="h-[17px] w-[17px]" aria-hidden /></span>}>
        <div className="grid gap-3 leading-relaxed text-ink-2 [&_h4]:text-[11px] [&_h4]:font-bold [&_h4]:tracking-[.08em] [&_h4]:text-ink-3 [&_h4]:uppercase">{help}</div></Drawer></span>}
    </div>
  );
}
