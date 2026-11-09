import { PageHeader, Notice } from "@/components/ui";
import { messageFrom } from "@/lib/messages";
import { loadSettings, readOnlyNote } from "../data";
import { saveLeadAssignment } from "../actions";

type Assignment = { mode: "single" | "unassigned" | "rotate"; staff_ids: string[] };

export default async function LeadAssignmentPage({ searchParams }: PageProps<"/admin/settings/lead-assignment">) {
  const { editable, byKey, supabase } = await loadSettings();
  const sp = await searchParams;
  const { data: staff } = await supabase.from("staff").select("id, full_name").eq("is_active", true).order("full_name");
  const people = (staff ?? []) as { id: string; full_name: string }[];
  const assignment = (byKey.get("lead_assignment") ?? { mode: "unassigned", staff_ids: [] }) as Assignment;
  return (
    <>
      <PageHeader title="Lead assignment" description={readOnlyNote(editable)} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />
      <form action={saveLeadAssignment} className="card">
        <fieldset disabled={!editable} className="space-y-4">
          <legend className="sr-only">Lead assignment</legend>
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
    </>
  );
}
