// Round 15 (Hashim, Nov 14, 2026; benchmark: CaseWare Cloud). A Closebook file is a few top-level pages:
// one dark header bar (client, year end, status, net income, T2 due, history), five tabs (Steps, Trial
// balance, Entries, Notes, Statements), a left panel that follows the tab, and the page. Sign-offs are
// CaseWare's circles: grey with a pencil when not signed, the person's initials with a blue pencil once
// prepared, with a green tick once reviewed; a click opens a popover to sign or take back.
import Link from "next/link";
import type { ReactNode } from "react";
import { Check, ChevronDown, Clock, Download, FileText, HelpCircle, MessageSquarePlus, Pencil, TriangleAlert } from "lucide-react";
import { formatDate, formatDateTime } from "@/lib/dates";
import type { Progress } from "@/lib/closebook/step-progress";
import type { StepStatus } from "@/lib/closebook/review-server";
import { addNote, signStep, unsignStep } from "../../actions";
import { signSubstep, unsignSubstep } from "../../banking-actions";
import { setPeople } from "../../round16-actions";
import { Drawer, FileToast, LeftPanel, Popover, ToolsMenu } from "./ui";
import { StepMenu, type StepMenuProps } from "./step-menu";

export type Area = "steps" | "tb" | "entries" | "reporting" | "notes" | "statements";
// Round 32: Reporting sits after Entries (QuickBooks Online's Reports page).
export const AREAS: [Area, string][] = [["steps", "Steps"], ["tb", "Trial balance"], ["entries", "Entries"], ["reporting", "Reporting"], ["notes", "Notes"], ["statements", "Statements"]];
export type FileStatus = "Open" | "In progress" | "Ready for review" | "Reviewed" | "Locked";
// Studio's fixed status colours: Signed green, Next blue, flags amber, notes red, Open grey.
const STATUS_CLS: Record<FileStatus, string> = {
  Open: "bg-sand-100 text-ink-2", "In progress": "bg-[#2f5bb0] text-white", "Ready for review": "bg-warning-soft text-warning", Reviewed: "bg-success text-white", Locked: "bg-[#3a3f4d] text-white",
};
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
export const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };

// Round 16 (CaseWare Cloud engagement properties): the file's preparer and reviewer, changed by an owner.
export type PeopleProps = { preparer: { id: string; name: string }; reviewer: { id: string; name: string }; canChange: boolean;
  preparers: { id: string; name: string }[]; reviewers: { id: string; name: string }[]; back: string; error?: string | null };
function PeopleChip({ fileId, p }: { fileId: string; p: PeopleProps }) {
  const same = p.preparer.id === p.reviewer.id;
  const chip = (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/25 py-0.5 pr-2 pl-1 text-xs text-[#dbe3f3] hover:border-white/50">
      <span className="grid h-5 w-5 place-items-center rounded-full bg-white text-[9px] font-bold text-navy-800" title={`Preparer: ${p.preparer.name}`}>{initials(p.preparer.name)}</span>
      {!same && <span className="grid h-5 w-5 place-items-center rounded-full bg-[#e5f3ea] text-[9px] font-bold text-success" title={`Reviewer: ${p.reviewer.name}`}>{initials(p.reviewer.name)}</span>}
      People{p.canChange && <ChevronDown className="h-3 w-3" aria-hidden />}
    </span>
  );
  const sameLine = same && <p className="mt-2 rounded bg-sand-100 px-2 py-1 text-xs text-ink-2">Prepared and reviewed by the same person.</p>;
  if (!p.canChange) return (
    <Popover align="right" width="w-64" label="People" button={chip}>
      <p className="text-[12.5px]"><span className="text-ink-3">Preparer</span> {p.preparer.name}</p><p className="text-[12.5px]"><span className="text-ink-3">Reviewer</span> {p.reviewer.name}</p>{sameLine}
    </Popover>
  );
  return (
    <Popover align="right" width="w-72" label="People" button={chip} open={!!p.error}>
      <form action={setPeople} className="grid gap-2.5">
        <input type="hidden" name="file_id" value={fileId} /><input type="hidden" name="back" value={p.back} />
        <p className="font-semibold">People</p>
        <label className="grid gap-1 text-[11.5px] font-semibold text-ink-2">Preparer
          <select name="preparer" defaultValue={p.preparer.id} className="input input-compact text-[13px] font-normal text-ink">{p.preparers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {/* Only owners are offered as reviewer: the database refuses anyone else. */}
        <label className="grid gap-1 text-[11.5px] font-semibold text-ink-2">Reviewer
          <select name="reviewer" defaultValue={p.reviewer.id} className="input input-compact text-[13px] font-normal text-ink">{p.reviewers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {sameLine}
        {p.error && <p role="alert" className="text-[12.5px] text-danger">{p.error}</p>}
        <div><button type="submit" className="btn btn-compact">Save</button></div>
      </form>
    </Popover>
  );
}

export function FileShell({ fileId, client, yearEnd, source, netNote, status, netCents, t2Due, area, history, left, folded, forceFolded, pinned, toast, notes, people, done, tools, children }: {
  fileId: string; client: string; yearEnd: string; source?: string; netNote?: string; status: FileStatus; netCents: number | null; t2Due: string; area: Area;
  history: boolean; left: ReactNode; folded?: ReactNode; toast: { msg?: string | null; error?: string | null; info?: { id: string; text: string } | null }; notes: number; people?: PeopleProps;
  done?: { n: number; of: number }; children: ReactNode; pinned?: boolean; forceFolded?: boolean;
  tools?: { on: boolean; journal: boolean };   // round 38b: the Tools menu (on: a tool's page is open; journal: New journal entry offered)
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-14 z-30 flex h-[50px] print:hidden flex-none items-center gap-3.5 bg-navy-950 px-4 text-white">
        <Link href="/closebook" className="flex-none text-xs whitespace-nowrap text-[#9fb0d4] hover:text-white">My files ›</Link>
        <h1 className="flex-none text-[15px] font-bold whitespace-nowrap">{client}</h1>
        <span className="text-[12.5px] whitespace-nowrap text-[#c8d2e8]">{formatDate(yearEnd)}</span>
        {source && <span className="hidden flex-none text-[12.5px] whitespace-nowrap text-[#9fb0d4] lg:inline">{source}</span>}
        <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${STATUS_CLS[status]}`}>{status}</span>
        {/* Round 21 (ProFile, TurboTax): how far the file has got, counted from the preparer's sign-offs. */}
        {done && <span className="text-[12.5px] whitespace-nowrap text-[#c8d2e8]" data-steps-done={done.n}>{done.n} of {done.of} steps done</span>}
        <span className="flex-1" />
        {people && <PeopleChip fileId={fileId} p={people} />}
        {netCents !== null && <span className="text-xs whitespace-nowrap text-[#c8d2e8]">{netCents < 0 ? "Net loss" : "Net income"}<b className={`ml-1 font-bold tabular-nums ${netCents < 0 ? "text-[#ffb4ab]" : "text-white"}`}>{money(netCents)}</b>{netNote && <Link href={`/closebook/${fileId}?step=code`} title={netNote} data-net-note={netNote} className="rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffd58a]"><span aria-hidden className="ml-1.5 inline-block h-2 w-2 rounded-full bg-[#ffd58a] align-middle 2xl:hidden" /><span className="sr-only 2xl:not-sr-only 2xl:ml-1.5 2xl:text-[#ffd58a] 2xl:hover:underline">· {netNote}</span></Link>}</span>}
        <span className="text-xs whitespace-nowrap text-[#c8d2e8]">T2 due<b className="ml-1 font-bold text-white">{formatDate(t2Due)}</b></span>
        {history && <Link href={`/closebook/${fileId}?history=1`} title="File history" aria-label="File history" className="rounded p-1.5 text-[#d7deee] hover:bg-navy-800"><Clock className="h-[17px] w-[17px]" /></Link>}
      </header>
      <ShellTabs fileId={fileId} area={area} toast={toast} notes={notes} tools={tools ?? { on: false, journal: false }} />
      <div className="flex flex-1">
        {left !== null && <LeftPanel folded={folded} pinned={pinned} forceFolded={forceFolded}>{left}</LeftPanel>}
        {/* Card headings in small capitals on every file screen (round 15). */}
        <div className="cb-push min-w-0 flex-1 px-5 pt-3.5 pb-12 [&_.card]:rounded-[10px] [&_.card]:shadow-none [&_.card>h2]:text-[11.5px] [&_.card>h2]:font-bold [&_.card>h2]:tracking-[.08em] [&_.card>h2]:text-navy-900 [&_.card>h2]:uppercase [&_.card>div>h2]:text-[11.5px] [&_.card>div>h2]:font-bold [&_.card>div>h2]:tracking-[.08em] [&_.card>div>h2]:text-navy-900 [&_.card>div>h2]:uppercase">{children}</div>
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
    <nav aria-label="File" className="sticky top-[106px] z-30 flex h-10 print:hidden flex-none items-stretch gap-1 border-b border-sand-200 bg-white px-4">
      {AREAS.flatMap(([k, label]) => [
        <Link key={k} href={k === "steps" ? `/closebook/${fileId}` : `/closebook/${fileId}?area=${k}`} aria-current={here(k) ? "page" : undefined}
          className={`flex items-center gap-1.5 border-b-2 px-3 text-[13px] font-semibold ${here(k) ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>
          {label}{k === "notes" && notes > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{notes}</span>}
        </Link>,
        ...(k === "entries" ? [<ToolsMenu key="tools" fileId={fileId} on={tools.on} journal={tools.journal} />] : []),
      ])}
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
type SignProps = { fileId: string; step: string; st: StepStatus | undefined; names: Map<string, string>; me: string; isOwner: boolean; editable: boolean; back: string;
  preparerElsewhere?: boolean; size?: "sm" | "lg"; align?: "left" | "right"; side?: "below" | "right";
  sub?: string;     // round 23: a Banking sub-step (3.1, 3.2, 3.3), signed on its own
  subsOf?: { key: string; href: string; prepared: boolean; reviewed: boolean }[] };   // round 34: step 3 on a bank file, signed in its sub-steps

function Circle({ kind, who, size }: { kind: "none" | "prepared" | "reviewed"; who?: string; size: "sm" | "lg" }) {
  const dim = size === "lg" ? "h-[26px] w-[26px] text-[10px]" : "h-[22px] w-[22px] text-[9px]";
  if (kind === "none") return <span className={`grid ${dim} flex-none place-items-center rounded-full border-[1.5px] border-[#c3c6cf] bg-white text-[#9aa0ae]`}><Pencil className="h-2.5 w-2.5" aria-hidden /></span>;
  const blue = kind === "prepared";
  return (
    <span className={`relative grid ${dim} flex-none place-items-center rounded-full border-[1.5px] bg-white font-bold ${blue ? "border-[#2f6fd6] text-navy-800" : "border-success text-success"}`}>
      {initials(who ?? "")}
      <span className={`absolute -right-1 -bottom-[3px] grid h-3 w-3 place-items-center rounded-full border-[1.5px] border-white text-white ${blue ? "bg-[#2f6fd6]" : "bg-success"}`}>
        {blue ? <Pencil className="h-[7px] w-[7px]" aria-hidden /> : <Check className="h-[8px] w-[8px]" strokeWidth={3} aria-hidden />}
      </span>
    </span>
  );
}

export function SignCircles(p: SignProps) {
  // Round 21: in the step list the box opens beside the circle (CaseWare Cloud), floating above the page.
  const { fileId, step, st, names, me, isOwner, editable, back, size = "sm", align = "left", side = size === "sm" ? "right" : "below" } = p;
  const review = step === "review";
  const prepared = !!st?.prepared_at, reviewed = !!st?.reviewed_at;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const name = (id: string | null | undefined) => (id ? names.get(id) ?? "" : "");
  const signForm = (role: "prepared" | "reviewed", label: string) => (
    <form action={p.sub ? signSubstep : signStep} className="mt-2">{hidden("file_id", fileId)}{hidden("step", step)}{p.sub && hidden("sub", p.sub)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn btn-compact">{label}</button></form>
  );
  const undo = (role: "prepared" | "reviewed") => (
    <form action={p.sub ? unsignSubstep : unsignStep} className="mt-2">{hidden("file_id", fileId)}{hidden("step", step)}{p.sub && hidden("sub", p.sub)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn-secondary btn-compact">Take back my sign-off</button></form>
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
  const prep = !review && (
    <Popover align={align} side={side} label={prepared ? `Prepared by ${name(st!.prepared_by)} · ${formatDate(st!.prepared_at)}` : "Preparer: not signed"} button={<Circle kind={prepared ? "prepared" : "none"} who={name(st?.prepared_by)} size={size} />}>
      <p className="font-bold">{prepared ? `Prepared by ${name(st!.prepared_by)}` : "Preparer"}</p>
      <p className="text-ink-3">{prepared ? formatDate(st!.prepared_at) : "Not signed"}</p>
      {!prepared && problems.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-ink-2">{problems.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul>}
      {!prepared && p.subsOf ? subsNote("prepared") : !prepared && editable && (p.preparerElsewhere ? <p className="mt-2 text-xs text-ink-2">Sign with the schedule below.</p> : signForm("prepared", "Sign as preparer"))}
      {prepared && !reviewed && editable && st?.prepared_by === me && !p.subsOf && undo("prepared")}
    </Popover>
  );
  const rev = (
    <Popover align={align} side={side} label={reviewed ? `Reviewed by ${name(st!.reviewed_by)} · ${formatDate(st!.reviewed_at)}` : "Reviewer: not signed"} button={<Circle kind={reviewed ? "reviewed" : "none"} who={name(st?.reviewed_by)} size={size} />}>
      <p className="font-bold">{reviewed ? `Reviewed by ${name(st!.reviewed_by)}` : "Reviewer"}</p>
      <p className="text-ink-3">{reviewed ? formatDate(st!.reviewed_at) : review || prepared ? "Not signed" : "After the preparer"}</p>
      {reviewed && prepared && st?.prepared_by === st?.reviewed_by && <p className="mt-1 text-xs text-ink-2">Prepared and reviewed by the same person.</p>}
      {!reviewed && p.subsOf ? subsNote("reviewed") : !reviewed && editable && (isOwner ? (review || prepared) && signForm("reviewed", review ? "Sign step 7 as reviewer" : "Sign as reviewer")
        : <p className="mt-2 text-xs text-ink-3">Only owners review.</p>)}
      {reviewed && editable && isOwner && !p.subsOf && undo("reviewed")}
    </Popover>
  );
  return <span className="inline-flex items-center gap-1.5">{prep}{rev}</span>;
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
      <h2 className="pl-px text-xs font-bold tracking-[.1em] text-navy-900 uppercase"><span className="tracking-normal tabular-nums">Step {n}</span> · {name}{paper && <><span className="mx-1.5 text-ink-3">›</span>{paper}</>}</h2>
      {sub && <span className="text-[12.5px] text-ink-3">{sub}</span>}
      {sign && <SignCircles {...sign} size="lg" />}
      {count > 0 && (
        <Drawer label="Issues" title={`Issues · ${name}`} button={
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-bold ${count ? "border-[#efd9a6] bg-warning-soft text-warning" : "border-sand-300 bg-white text-ink-2"}`}>
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
export function StepMark({ n, p }: { n: number; p: Progress }) {
  const box = "grid h-[19px] w-[19px] flex-none place-items-center rounded-full text-[10.5px] tabular-nums";
  if (p === "signed") return <span title={PROGRESS_WORDS[p]} data-progress={p} className={`${box} bg-success text-white`}><Check className="h-[11px] w-[11px]" strokeWidth={3.2} aria-hidden /><span className="sr-only">{n}, {PROGRESS_WORDS[p]}</span></span>;
  if (p === "started") return <span title={PROGRESS_WORDS[p]} data-progress={p} className={`${box} border-[1.5px] border-[#2f6fd6] font-semibold text-navy-800`}>{n}<span className="sr-only">, {PROGRESS_WORDS[p]}</span></span>;
  return <span title={PROGRESS_WORDS[p]} data-progress={p} className={`${box} text-ink-3`}>{n}<span className="sr-only">, {PROGRESS_WORDS[p]}</span></span>;
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
