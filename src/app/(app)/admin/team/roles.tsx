import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createRole } from "../roles/actions";

type Role = { id: string; name: string; description: string; is_owner: boolean };

// Roles and permissions (owners only). Shown on Team and roles.
export async function RolesSection() {
  const supabase = await createClient();
  const [{ data: roles }, { data: staff }] = await Promise.all([
    supabase.from("roles").select("id, name, description, is_owner").order("is_owner", { ascending: false }).order("name"),
    supabase.from("staff").select("role_id, is_active"),
  ]);
  const counts = new Map<string, number>();
  (staff ?? []).forEach((s: { role_id: string; is_active: boolean }) => {
    if (s.is_active) counts.set(s.role_id, (counts.get(s.role_id) ?? 0) + 1);
  });

  return (
    <>
      <p className="mb-4 text-sm text-ink-2">Each role sets No access, View or Edit for every area. Only owners can change roles.</p>

      <section className="card mb-6 overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th>Role</th><th>Description</th><th>Active staff</th><th></th></tr>
          </thead>
          <tbody>
            {((roles ?? []) as Role[]).map((r) => (
              <tr key={r.id}>
                <td className="font-medium">{r.name}{r.is_owner && <span className="ml-2 rounded bg-background px-1.5 py-0.5 text-xs text-muted">Locked</span>}</td>
                <td className="text-muted">{r.description}</td>
                <td>{counts.get(r.id) ?? 0}</td>
                <td className="text-right">
                  <Link href={`/admin/roles/${r.id}`} className="btn-secondary">{r.is_owner ? "View" : "Edit"}</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2 className="mb-3 font-semibold">Create a role</h2>
        <form action={createRole} className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-end">
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" name="name" required maxLength={60} className="input" />
          </div>
          <div>
            <label htmlFor="description" className="label">Description</label>
            <input id="description" name="description" maxLength={200} className="input" />
          </div>
          <button type="submit" className="btn">Create role</button>
        </form>
      </section>
    </>
  );
}
