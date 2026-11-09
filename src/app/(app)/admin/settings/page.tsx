import Link from "next/link";
import { PageHeader, Notice } from "@/components/ui";
import { fileInputClass } from "@/components/ds/primitives";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { formatDateTime } from "@/lib/dates";
import { saveBookingLink, saveBusinessHours, saveLeadAssignment, saveLeadSources, saveRetention, saveSigner, saveStartPage, saveT1Rules, uploadSignature } from "./actions";
import { formatDate } from "@/lib/dates";

type Assignment = { mode: "single" | "unassigned" | "rotate"; staff_ids: string[] };

export default async function SettingsPage({ searchParams }: PageProps<"/admin/settings">) {
  const access = await requireAccess("settings", "view");
  const editable = canEdit(access, "settings");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: settings }, { data: staff }] = await Promise.all([
    supabase.from("settings").select("key, value"),
    supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name"),
  ]);
  const byKey = new Map((settings ?? []).map((s: { key: string; value: unknown }) => [s.key, s.value]));
  const assignment = (byKey.get("lead_assignment") ?? { mode: "unassigned", staff_ids: [] }) as Assignment;
  const retention = Number(byKey.get("retention_months") ?? 24);
  const people = (staff ?? []) as { id: string; full_name: string }[];
  const signer = (k: string) => (byKey.get(k) ?? { name: "", title: "Director" }) as { name: string; title: string };
  const sigInfo = (byKey.get("signature_image") ?? { uploaded: false }) as { uploaded: boolean; uploaded_at?: string };
  const hours = (byKey.get("business_hours") ?? {}) as Record<string, [string, string] | null>;
  const booking = String(byKey.get("booking_link") ?? "");
  const t1 = (byKey.get("t1_rules") ?? {}) as { moving_km?: number; t1135_simple_over?: number; t1135_detailed_from?: number; checked_on?: string };
  const DAYS: [string, string][] = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]];
  const hoursSet = DAYS.some(([d]) => hours[d]);
  const sources = (byKey.get("lead_sources") ?? []) as string[];
  const startOpen = byKey.get("start_page_open") === true;
  const SIGNERS: [string, string, string][] = [
    ["signer_engagement_letter", "Engagement letters", "Corporate and T1 letters. Use the name registered with CPA Ontario."],
    ["signer_proposal", "Proposals", "The name on proposals."],
    ["signer_other", "Everything else", "Other documents the app makes."],
  ];

  return (
    <>
      <PageHeader title="Settings" description={editable ? "Changes are recorded in the activity log." : "You can view these settings. Only people with Edit can change them."} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Signer names</h2>
        <p className="mb-4 text-sm text-muted">The name and title printed in the signature block. Only an owner can change these.</p>
        <div className="grid gap-5">
          {SIGNERS.map(([key, label, hint]) => (
            <form key={key} action={saveSigner} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <input type="hidden" name="key" value={key} />
              <div>
                <label htmlFor={`${key}-name`} className="label">{label}</label>
                <input id={`${key}-name`} name="name" defaultValue={signer(key).name} disabled={!access.is_owner} className="input" />
                <span className="text-xs text-muted">{hint}</span>
              </div>
              <div>
                <label htmlFor={`${key}-title`} className="label">Title</label>
                <input id={`${key}-title`} name="title" defaultValue={signer(key).title} disabled={!access.is_owner} className="input" />
                <span className="text-xs">&nbsp;</span>
              </div>
              {access.is_owner && <button type="submit" className="btn mb-5">Save</button>}
            </form>
          ))}
        </div>
      </section>

      {access.is_owner && (
        <form action={uploadSignature} className="card mb-6 space-y-3">
          <h2 className="font-semibold">Signature image</h2>
          <p className="text-sm text-muted">
            Placed only on Final letters, which only an owner can issue. Stored privately in Canada and readable by owners only. Never stored in the app&rsquo;s code.
          </p>
          <p className="text-sm">{sigInfo.uploaded ? <>Uploaded{sigInfo.uploaded_at ? ` ${formatDateTime(sigInfo.uploaded_at)}` : ""}.</> : "Not uploaded yet. Final letters are blocked until it is."}</p>
          {sigInfo.uploaded && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/documents/signature" alt="Current signature" className="h-16 w-auto rounded border border-sand-200 bg-white p-1" />
          )}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="signature" className="label">PNG image, under 1 MB</label>
              <input id="signature" name="signature" type="file" accept="image/png" required className={fileInputClass} />
            </div>
            <button type="submit" className="btn">{sigInfo.uploaded ? "Replace signature" : "Upload signature"}</button>
          </div>
        </form>
      )}

      {access.is_owner && (
        <section className="card mb-6 text-sm">
          <h2 className="mb-1 text-base font-semibold">Import from Studio</h2>
          <p className="text-muted">One-time move of Studio&rsquo;s data from Notion CSV files. <a href="/admin/import" className="text-navy-700 underline">Open the import page</a></p>
        </section>
      )}

      <form action={saveLeadAssignment} className="card mb-6">
        <fieldset disabled={!editable} className="space-y-4">
          <legend className="mb-1 font-semibold">Lead assignment</legend>
          <p className="text-sm text-muted">Who gets each new lead from the public forms. Owners can reassign any lead later.</p>

          <label className="flex items-start gap-3">
            <input type="radio" name="mode" value="unassigned" defaultChecked={assignment.mode === "unassigned"} className="mt-1 h-4 w-4 accent-accent" />
            <span><span className="font-medium">Unassigned queue</span><span className="block text-sm text-muted">New leads wait in a queue until someone picks them up.</span></span>
          </label>

          <label className="flex items-start gap-3">
            <input type="radio" name="mode" value="single" defaultChecked={assignment.mode === "single"} className="mt-1 h-4 w-4 accent-accent" />
            <span className="flex-1">
              <span className="font-medium">One person</span>
              <span className="block text-sm text-muted">Every new lead goes to the person you choose.</span>
              <select name="single_staff_id" defaultValue={assignment.mode === "single" ? assignment.staff_ids[0] : ""} className="input mt-2 max-w-xs" aria-label="Person for all new leads">
                <option value="">Choose a person</option>
                {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </span>
          </label>

          <label className="flex items-start gap-3">
            <input type="radio" name="mode" value="rotate" defaultChecked={assignment.mode === "rotate"} className="mt-1 h-4 w-4 accent-accent" />
            <span className="flex-1">
              <span className="font-medium">Rotate</span>
              <span className="block text-sm text-muted">New leads go to the chosen people in turn. Choose two or more.</span>
              <span className="mt-2 grid gap-1 sm:grid-cols-2">
                {people.map((p) => (
                  <span key={p.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" name="rotate_staff_ids" value={p.id} id={`rot-${p.id}`}
                      defaultChecked={assignment.mode === "rotate" && assignment.staff_ids.includes(p.id)} className="h-4 w-4 accent-accent" />
                    <label htmlFor={`rot-${p.id}`}>{p.full_name}</label>
                  </span>
                ))}
              </span>
            </span>
          </label>

          {editable && <button type="submit" className="btn">Save lead assignment</button>}
        </fieldset>
      </form>

      <form action={saveRetention} className="card">
        <fieldset disabled={!editable} className="space-y-3">
          <legend className="mb-1 font-semibold">Retention</legend>
          <p className="text-sm text-muted">
            Lost and out-of-scope leads, with their screening answers, are deleted automatically this many months after they close.
            Signed documents and signing records are always kept.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="months" className="label">Months</label>
              <input id="months" name="months" type="number" min={1} max={120} step={1} defaultValue={retention} required className="input w-28" />
            </div>
            {editable && <button type="submit" className="btn">Save retention</button>}
          </div>
        </fieldset>
      </form>
      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Business hours</h2>
        <p className="mb-4 text-sm text-muted">Toronto time. The lead timer on My day and the second alert after 45 business minutes count only these hours.{!hoursSet && <span className="text-warning"> Not set yet.</span>}</p>
        <form action={saveBusinessHours} className="grid gap-2">
          <fieldset disabled={!editable} className="grid gap-2">
            {DAYS.map(([d, label]) => {
              const h = hours[d];
              return (
                <div key={d} className="grid grid-cols-[7rem_5rem_11rem_2rem_11rem] items-center justify-start gap-2 text-sm">
                  <span>{label}</span>
                  <label className="flex items-center gap-1.5"><input type="checkbox" name={`${d}_open`} defaultChecked={!!h} className="h-4 w-4 accent-navy-700" />Open</label>
                  <input type="time" name={`${d}_start`} defaultValue={h?.[0] ?? "09:00"} aria-label={`${label} start`} className="input" />
                  <span className="text-center text-muted">to</span>
                  <input type="time" name={`${d}_end`} defaultValue={h?.[1] ?? "17:00"} aria-label={`${label} end`} className="input" />
                </div>
              );
            })}
            {editable && <button type="submit" className="btn mt-2 w-fit">Save business hours</button>}
          </fieldset>
        </form>
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Booking link</h2>
        <p className="mb-4 text-sm text-muted">The &ldquo;Choose a time&rdquo; button when a company lead needs a short call (monthly bookkeeping, paper receipts, or a complex situation).{!booking && <span className="text-warning"> Not set yet.</span>}</p>
        <form action={saveBookingLink} className="flex flex-wrap gap-2">
          <input name="url" defaultValue={booking} placeholder="https://…" disabled={!editable} aria-label="Booking link" className="input min-w-[20rem] flex-1" />
          {editable && <button type="submit" className="btn-secondary">Save link</button>}
        </form>
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">T1 rule values</h2>
        <p className="mb-4 text-sm text-muted">Used by the personal tax screening questions. Check them on canada.ca when CRA changes a rule. Only an owner can change them.{t1.checked_on ? ` Last checked ${formatDate(t1.checked_on)}.` : ""}</p>
        <form action={saveT1Rules} className="grid gap-3 sm:grid-cols-2">
          <fieldset disabled={!access.is_owner} className="contents">
            <div><label htmlFor="moving_km" className="label">Moving expenses: minimum distance closer (km)</label><input id="moving_km" name="moving_km" inputMode="numeric" defaultValue={t1.moving_km ?? ""} className="input" /></div>
            <div><label htmlFor="checked_on" className="label">Checked on canada.ca on</label><input id="checked_on" name="checked_on" type="date" defaultValue={t1.checked_on ?? ""} className="input" /></div>
            <div><label htmlFor="t1135_simple_over" className="label">T1135 needed when foreign property cost more than ($)</label><input id="t1135_simple_over" name="t1135_simple_over" inputMode="numeric" defaultValue={t1.t1135_simple_over ?? ""} className="input" /></div>
            <div><label htmlFor="t1135_detailed_from" className="label">T1135 detailed method when cost was at least ($)</label><input id="t1135_detailed_from" name="t1135_detailed_from" inputMode="numeric" defaultValue={t1.t1135_detailed_from ?? ""} className="input" /></div>
            {access.is_owner && <div className="sm:col-span-2"><button type="submit" className="btn w-fit">Save T1 rule values</button></div>}
          </fieldset>
        </form>
      </section>
      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Public start page</h2>
        <p className="mb-4 text-sm text-muted">The page clients use to ask for a quote: <Link href="/start" className="text-navy-700 underline">/start</Link>. While closed, only signed-in staff can see it. Open it when the screening questions are ready. Only an owner can change this.</p>
        <form action={saveStartPage} className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" name="open" defaultChecked={startOpen} disabled={!access.is_owner} className="h-4 w-4 accent-navy-700" />Open to the public</label>
          {access.is_owner && <button type="submit" className="btn-secondary">Save</button>}
          <span className={startOpen ? "font-medium text-success" : "text-muted"}>Now: {startOpen ? "open" : "closed"}</span>
        </form>
      </section>

      <section className="card mb-6">
        <h2 className="mb-1 font-semibold">Lead sources</h2>
        <p className="mb-4 text-sm text-muted">The choices for &ldquo;How did you hear about us?&rdquo; and the Source on each lead. One per line.</p>
        <form action={saveLeadSources} className="grid max-w-md gap-2">
          <textarea name="sources" rows={8} defaultValue={sources.join("\n")} disabled={!editable} aria-label="Lead sources, one per line" className="input" />
          {editable && <button type="submit" className="btn-secondary w-fit">Save lead sources</button>}
        </form>
      </section>
    </>
  );
}
