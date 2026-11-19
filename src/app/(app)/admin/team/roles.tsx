import Link from "next/link";
import { InfoTip } from "@/components/ds/info-tip";
import { createClient } from "@/lib/supabase/server";
import { createRole } from "../roles/actions";
import { CB_SWITCHES, isAdminRole, type CbCol } from "../roles/rights";

type Role = { id: string; name: string; description: string; role_permissions: { area_key: string; level: string }[] } & Record<CbCol, boolean>;

// Roles and permissions (Admins only). Shown on Team and roles. Piece R3a-1: a role is a title; Admin is a right
// (Edit on Staff accounts and Settings), shown as a tag.
export async function RolesSection() {
  const supabase = await createClient();
  const [{ data: roles }, { data: staff }] = await Promise.all([
    supabase.from("roles").select(`id, name, description, ${CB_SWITCHES.map((c) => c.col).join(", ")}, role_permissions(area_key, level)`).order("name"),
    supabase.from("staff").select("role_id, is_active"),
  ]);
  const counts = new Map<string, number>();
  (staff ?? []).forEach((s: { role_id: string; is_active: boolean }) => {
    if (s.is_active) counts.set(s.role_id, (counts.get(s.role_id) ?? 0) + 1);
  });
  const list = ((roles ?? []) as unknown as Role[]).map((r) => ({ ...r, admin: isAdminRole(r.role_permissions), cbEdit: r.role_permissions.some((p) => p.area_key === "closebook" && p.level === "edit") }))
    .sort((a, b) => Number(b.admin) - Number(a.admin) || CB_SWITCHES.filter((c) => b[c.col]).length - CB_SWITCHES.filter((c) => a[c.col]).length || a.name.localeCompare(b.name));

  return (
    <>
      <p className="mb-4 text-sm text-ink-2">A role is a title. It sets No access, View or Edit for every area, and the Closebook rights. People with Edit on Staff accounts and Settings manage roles.</p>

      <section className="card mb-6 overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th>Role</th><th>Description</th><th>Closebook rights</th><th>Active staff</th><th></th></tr>
          </thead>
          <tbody>
            {list.map((r) => (
              <tr key={r.id}>
                <td className="font-medium whitespace-nowrap">{r.name}{r.admin && <span className="ml-2 rounded bg-background px-1.5 py-0.5 text-xs text-muted">Admin</span>}</td>
                <td className="text-muted">{r.description}</td>
                <td className="text-sm">{CB_SWITCHES.filter((c) => r[c.col]).map((c) => c.label).join(" · ") || <span className="text-ink-3">None</span>}
                  {!r.cbEdit && CB_SWITCHES.some((c) => r[c.col]) && <span className="block text-xs text-ink-3">Off until the role has Edit on Closebook.</span>}</td>
                <td>{counts.get(r.id) ?? 0}</td>
                <td className="text-right">
                  <Link href={`/admin/roles/${r.id}`} className="btn-secondary">Edit</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="mb-6 flex items-center gap-1 text-sm text-ink-2">Admin: Edit on Staff accounts and Settings. At least one active person always keeps it.
        <InfoTip label="About Admin">Admin is not a role. Any role with Edit on Staff accounts and Settings is Admin. The app refuses a change that would leave no active person with it.</InfoTip></p>

      <section className="card">
        <h2 className="mb-3 font-semibold">Create a role</h2>
        <form action={createRole} className="grid gap-3 md:grid-cols-[14rem_1fr_auto] md:items-end">
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" name="name" required maxLength={60} placeholder="For example Bookkeeper" className="input" />
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
