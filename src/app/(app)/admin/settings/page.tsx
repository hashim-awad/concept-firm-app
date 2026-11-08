import { PageHeader, Notice } from "@/components/ui";
import { requireAccess, canEdit } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { saveLeadAssignment, saveRetention } from "./actions";

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

  return (
    <>
      <PageHeader title="Settings" description={editable ? "Changes are recorded in the activity log." : "You can view these settings. Only people with Edit can change them."} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

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
    </>
  );
}
