import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Notice } from "@/components/ui";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { saveRole, deleteRole } from "../actions";

type AreaRow = { key: string; label: string; description: string; sort_order: number };
type PermRow = { area_key: string; level: string };

const LEVELS = [
  { value: "none", label: "No access" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];

export default async function RolePage({ params, searchParams }: PageProps<"/admin/roles/[id]">) {
  await requireOwner();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data: role } = await supabase.from("roles").select("id, name, description, is_owner").eq("id", id).maybeSingle();
  if (!role) notFound();
  const [{ data: areas }, { data: perms }, { count }] = await Promise.all([
    supabase.from("permission_areas").select("key, label, description, sort_order").order("sort_order"),
    supabase.from("role_permissions").select("area_key, level").eq("role_id", id),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("role_id", id),
  ]);
  const levelOf = new Map(((perms ?? []) as PermRow[]).map((p) => [p.area_key, p.level]));
  const locked = role.is_owner;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/team?tab=roles" className="text-accent underline">All roles</Link></p>
      <PageHeader
        title={role.name}
        description={locked ? "The Owner role always has Edit on every area. It cannot be changed." : `${count ?? 0} staff member(s) have this role.`}
      />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <form action={saveRole} className="card space-y-5">
        <input type="hidden" name="role_id" value={role.id} />
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" name="name" defaultValue={role.name} required maxLength={60} disabled={locked} className="input" />
          </div>
          <div>
            <label htmlFor="description" className="label">Description</label>
            <input id="description" name="description" defaultValue={role.description} maxLength={200} disabled={locked} className="input" />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr><th>Area</th>{LEVELS.map((l) => <th key={l.value} className="text-center">{l.label}</th>)}</tr>
            </thead>
            <tbody>
              {((areas ?? []) as AreaRow[]).map((a) => (
                <tr key={a.key}>
                  <td>
                    <span className="font-medium">{a.label}</span>
                    <span className="block text-xs text-muted">{a.description}</span>
                  </td>
                  {LEVELS.map((l) => (
                    <td key={l.value} className="text-center">
                      <input
                        type="radio"
                        name={`level:${a.key}`}
                        value={l.value}
                        defaultChecked={(levelOf.get(a.key) ?? "none") === l.value}
                        disabled={locked}
                        aria-label={`${a.label}: ${l.label}`}
                        className="h-4 w-4 accent-accent"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {!locked && <button type="submit" className="btn">Save role</button>}
      </form>

      {!locked && (
        <form action={deleteRole} className="mt-6">
          <input type="hidden" name="role_id" value={role.id} />
          <button type="submit" className="btn-danger" disabled={(count ?? 0) > 0}>
            Delete role
          </button>
          {(count ?? 0) > 0 && <span className="ml-3 text-sm text-muted">Move its staff to another role first.</span>}
        </form>
      )}
    </>
  );
}
