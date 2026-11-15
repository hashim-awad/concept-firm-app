// Round 15 (Hashim, Nov 14, 2026; benchmark: CaseWare Cloud). A Closebook file is a few top-level pages:
// one dark header bar (client, year end, status, net income, T2 due, history), five tabs (Steps, Trial
// balance, Entries, Notes, Statements), a left panel that follows the tab, and the page. Sign-offs are
// CaseWare's circles: grey with a pencil when not signed, the person's initials with a blue pencil once
// prepared, with a green tick once reviewed; a click opens a popover to sign or take back.
import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Clock, Download, HelpCircle, MessageSquarePlus, Pencil, TriangleAlert } from "lucide-react";
import { formatDate } from "@/lib/dates";
import type { StepStatus } from "@/lib/closebook/review-server";
import { addNote, signStep, unsignStep } from "../../actions";
import { Drawer, FileToast, LeftPanel, Popover } from "./ui";

export type Area = "steps" | "tb" | "entries" | "notes" | "statements";
export const AREAS: [Area, string][] = [["steps", "Steps"], ["tb", "Trial balance"], ["entries", "Entries"], ["notes", "Notes"], ["statements", "Statements"]];
export type FileStatus = "Open" | "In progress" | "Ready for review" | "Reviewed" | "Locked";
// Studio's fixed status colours: Signed green, Next blue, flags amber, notes red, Open grey.
const STATUS_CLS: Record<FileStatus, string> = {
  Open: "bg-sand-100 text-ink-2", "In progress": "bg-[#2f5bb0] text-white", "Ready for review": "bg-warning-soft text-warning", Reviewed: "bg-success text-white", Locked: "bg-[#3a3f4d] text-white",
};
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
export const money = (c: number) => { const t = (Math.abs(c) / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return c < 0 ? `(${t})` : t; };

export function FileShell({ fileId, client, yearEnd, status, netCents, t2Due, area, history, left, folded, toast, notes, children }: {
  fileId: string; client: string; yearEnd: string; status: FileStatus; netCents: number | null; t2Due: string; area: Area;
  history: boolean; left: ReactNode; folded?: ReactNode; toast: { msg?: string | null; error?: string | null }; notes: number; children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="sticky top-0 z-30 flex h-[50px] print:hidden flex-none items-center gap-3.5 bg-navy-950 px-4 text-white">
        <Link href="/closebook" className="text-xs text-[#9fb0d4] hover:text-white">My files ›</Link>
        <h1 className="truncate text-[15px] font-bold">{client}</h1>
        <span className="text-[12.5px] whitespace-nowrap text-[#c8d2e8]">{formatDate(yearEnd)}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${STATUS_CLS[status]}`}>{status}</span>
        <span className="flex-1" />
        {netCents !== null && <span className="text-xs whitespace-nowrap text-[#c8d2e8]">{netCents < 0 ? "Net loss" : "Net income"}<b className="ml-1 font-bold text-white tabular-nums">{money(netCents)}</b></span>}
        <span className="text-xs whitespace-nowrap text-[#c8d2e8]">T2 due<b className="ml-1 font-bold text-white">{formatDate(t2Due)}</b></span>
        {history && <Link href={`/closebook/${fileId}?history=1`} title="File history" aria-label="File history" className="rounded p-1.5 text-[#d7deee] hover:bg-navy-800"><Clock className="h-[17px] w-[17px]" /></Link>}
      </header>
      <ShellTabs fileId={fileId} area={area} toast={toast} notes={notes} />
      <div className="flex flex-1">
        <LeftPanel folded={folded}>{left}</LeftPanel>
        {/* Card headings in small capitals on every file screen (round 15). */}
        <div className="cb-push min-w-0 flex-1 px-5 pt-3.5 pb-12 [&_.card]:rounded-[10px] [&_.card]:shadow-none [&_.card>h2]:text-[11.5px] [&_.card>h2]:font-bold [&_.card>h2]:tracking-[.08em] [&_.card>h2]:text-navy-900 [&_.card>h2]:uppercase [&_.card>div>h2]:text-[11.5px] [&_.card>div>h2]:font-bold [&_.card>div>h2]:tracking-[.08em] [&_.card>div>h2]:text-navy-900 [&_.card>div>h2]:uppercase">{children}</div>
      </div>
    </div>
  );
}

function ShellTabs({ fileId, area, toast, notes }: { fileId: string; area: Area; toast: { msg?: string | null; error?: string | null }; notes: number }) {
  return (
    <nav aria-label="File" className="sticky top-[50px] z-30 flex h-10 print:hidden flex-none items-stretch gap-1 border-b border-sand-200 bg-white px-4">
      {AREAS.map(([k, label]) => (
        <Link key={k} href={k === "steps" ? `/closebook/${fileId}` : `/closebook/${fileId}?area=${k}`} aria-current={k === area ? "page" : undefined}
          className={`flex items-center gap-1.5 border-b-2 px-3 text-[13px] font-semibold ${k === area ? "border-navy-700 text-navy-900" : "border-transparent text-ink-2 hover:text-ink"}`}>
          {label}{k === "notes" && notes > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">{notes}</span>}
        </Link>
      ))}
      <FileToast msg={toast.msg} error={toast.error} />
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
  preparerElsewhere?: boolean; size?: "sm" | "lg"; align?: "left" | "right" };

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
  const { fileId, step, st, names, me, isOwner, editable, back, size = "sm", align = "left" } = p;
  const review = step === "review";
  const prepared = !!st?.prepared_at, reviewed = !!st?.reviewed_at;
  const hidden = (k: string, v: string) => <input type="hidden" name={k} value={v} />;
  const name = (id: string | null | undefined) => (id ? names.get(id) ?? "" : "");
  const signForm = (role: "prepared" | "reviewed", label: string) => (
    <form action={signStep} className="mt-2">{hidden("file_id", fileId)}{hidden("step", step)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn btn-compact">{label}</button></form>
  );
  const undo = (role: "prepared" | "reviewed") => (
    <form action={unsignStep} className="mt-2">{hidden("file_id", fileId)}{hidden("step", step)}{hidden("role", role)}{hidden("back", back)}
      <button type="submit" className="btn-secondary btn-compact">Take back my sign-off</button></form>
  );
  const problems = st?.problems ?? [];
  const prep = !review && (
    <Popover align={align} label={prepared ? `Prepared by ${name(st!.prepared_by)} · ${formatDate(st!.prepared_at)}` : "Preparer: not signed"} button={<Circle kind={prepared ? "prepared" : "none"} who={name(st?.prepared_by)} size={size} />}>
      <p className="font-bold">{prepared ? `Prepared by ${name(st!.prepared_by)}` : "Preparer"}</p>
      <p className="text-ink-3">{prepared ? formatDate(st!.prepared_at) : "Not signed"}</p>
      {!prepared && problems.length > 0 && <ul className="mt-2 list-disc pl-4 text-xs text-ink-2">{problems.slice(0, 6).map((x) => <li key={x}>{x}</li>)}</ul>}
      {!prepared && editable && (p.preparerElsewhere ? <p className="mt-2 text-xs text-ink-2">Sign with the schedule below.</p> : signForm("prepared", "Sign as preparer"))}
      {prepared && !reviewed && editable && st?.prepared_by === me && undo("prepared")}
    </Popover>
  );
  const rev = (
    <Popover align={align} label={reviewed ? `Reviewed by ${name(st!.reviewed_by)} · ${formatDate(st!.reviewed_at)}` : "Reviewer: not signed"} button={<Circle kind={reviewed ? "reviewed" : "none"} who={name(st?.reviewed_by)} size={size} />}>
      <p className="font-bold">{reviewed ? `Reviewed by ${name(st!.reviewed_by)}` : "Reviewer"}</p>
      <p className="text-ink-3">{reviewed ? formatDate(st!.reviewed_at) : review || prepared ? "Not signed" : "After the preparer"}</p>
      {reviewed && prepared && st?.prepared_by === st?.reviewed_by && <p className="mt-1 text-xs text-ink-2">Prepared and reviewed by the same person.</p>}
      {!reviewed && editable && (isOwner ? (review || prepared) && signForm("reviewed", review ? "Sign step 7 as reviewer" : "Sign as reviewer")
        : <p className="mt-2 text-xs text-ink-3">Only owners review.</p>)}
      {reviewed && editable && isOwner && undo("reviewed")}
    </Popover>
  );
  return <span className="inline-flex items-center gap-1.5">{prep}{rev}</span>;
}

// ---------------------------------------------------------------------------------------------------
// A step's title row: the name in small capitals, the circles, the Issues chip, then add note, export
// and help on the right.
// ---------------------------------------------------------------------------------------------------
export function StepTitle({ n, name, paper, sub, sign, issues, notesPanel, notesOpen = 0, next, addNoteFor, exports, help }: {
  n: number; name: string; paper?: string; sub?: string; sign: SignProps | null; notesOpen?: number;
  issues: { problems: string[]; waiting: string[]; review: boolean };
  notesPanel: ReactNode; next?: string;
  addNoteFor: { fileId: string; step: string; back: string } | null;
  exports: [string, string][]; help: ReactNode;
}) {
  // Round 15b fix 2: the chip shows only when something is open: problems, waiting items or open notes.
  const count = issues.problems.length + issues.waiting.length + notesOpen;
  const icon = "grid h-[30px] w-[30px] place-items-center rounded-md text-ink-2 hover:bg-sand-100";
  return (
    <div className="mb-3 flex min-h-[30px] flex-wrap items-center gap-2.5">
      <h2 className="text-xs font-bold tracking-[.1em] text-navy-900 uppercase">{n} · {name}{paper && <><span className="mx-1.5 text-ink-3">›</span>{paper}</>}</h2>
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
      <Drawer label="Help" title={`Help · ${name}`} button={<span className={icon}><HelpCircle className="h-[17px] w-[17px]" aria-hidden /></span>}>
        <div className="grid gap-3 leading-relaxed text-ink-2 [&_h4]:text-[11px] [&_h4]:font-bold [&_h4]:tracking-[.08em] [&_h4]:text-ink-3 [&_h4]:uppercase">{help}</div>
        <p className="mt-6 rounded-md border border-dashed border-sand-300 px-3 py-2 text-xs text-ink-3">An assistant will answer questions here later.</p>
      </Drawer>
    </div>
  );
}

// A title row for pages that are not steps (the trial balance, entries, notes, statements).
export function PageTitle({ children, right, help }: { children: ReactNode; right?: ReactNode; help?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-[30px] flex-wrap items-center gap-2.5">
      <h2 className="text-xs font-bold tracking-[.1em] text-navy-900 uppercase">{children}</h2>
      <span className="flex-1" />{right}
      {help && <Drawer label="Help" title="Help" button={<span className="grid h-[30px] w-[30px] place-items-center rounded-md text-ink-2 hover:bg-sand-100"><HelpCircle className="h-[17px] w-[17px]" aria-hidden /></span>}>
        <div className="grid gap-3 leading-relaxed text-ink-2 [&_h4]:text-[11px] [&_h4]:font-bold [&_h4]:tracking-[.08em] [&_h4]:text-ink-3 [&_h4]:uppercase">{help}</div></Drawer>}
    </div>
  );
}
