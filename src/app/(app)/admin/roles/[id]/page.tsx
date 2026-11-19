import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, Notice } from "@/components/ui";
import { InfoTip } from "@/components/ds/info-tip";
import { requireAdmin, canEdit, type Area } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";
import { messageFrom } from "@/lib/messages";
import { saveRole, deleteRole } from "../actions";
import { ADMIN_AREAS, CB_SWITCHES, type CbCol } from "../rights";

type AreaRow = { key: string; label: string; description: string; sort_order: number };
type PermRow = { area_key: string; level: string };
type RoleRow = { id: string; name: string; description: string; can_t1_letters: boolean; can_corporate_letters: boolean; can_final_letters: boolean } & Record<CbCol, boolean>;

const LEVELS = [
  { value: "none", label: "No access" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
];
const RANK: Record<string, number> = { none: 0, view: 1, edit: 2 };

// Piece R3a-1 (Hashim, Nov 19, 2026): every role is a title and is edited the same way. A box or switch the
// person saving does not hold cannot be turned on (the database refuses it too).
export default async function RolePage({ params, searchParams }: PageProps<"/admin/roles/[id]">) {
  const access = await requireAdmin();
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();

  const { data } = await supabase.from("roles")
    .select(`id, name, description, can_t1_letters, can_corporate_letters, can_final_letters, ${CB_SWITCHES.map((c) => c.col).join(", ")}`).eq("id", id).maybeSingle();
  const role = data as unknown as RoleRow | null;
  if (!role) notFound();
  const [{ data: areas }, { data: perms }, { count }] = await Promise.all([
    supabase.from("permission_areas").select("key, label, description, sort_order").order("sort_order"),
    supabase.from("role_permissions").select("area_key, level").eq("role_id", id),
    supabase.from("staff").select("id", { count: "exact", head: true }).eq("role_id", id),
  ]);
  const levelOf = new Map(((perms ?? []) as PermRow[]).map((p) => [p.area_key, p.level]));
  const mine = (area: string) => RANK[access.permissions[area as Area] ?? "none"] ?? 0;
  const letters: [string, string, boolean, boolean][] = [
    ["can_t1_letters", "Can prepare T1 letters", role.can_t1_letters, access.letters.t1],
    ["can_corporate_letters", "Can prepare corporate letters", role.can_corporate_letters, access.letters.corporate],
    ["can_final_letters", "Can issue Final and send for signing", role.can_final_letters, access.letters.final],
  ];
  const n = count ?? 0;

  return (
    <>
      <p className="mb-2 text-sm"><Link href="/admin/team?tab=roles" className="text-accent underline">All roles</Link></p>
      <PageHeader title={role.name} description={`${n} staff member${n === 1 ? " has" : "s have"} this role.`} />
      <Notice msg={messageFrom(sp.msg)} error={messageFrom(sp.error)} />

      <form action={saveRole} className="card space-y-5">
        <input type="hidden" name="role_id" value={role.id} />
        <div className="grid gap-3 md:grid-cols-[14rem_1fr]">
          <div>
            <label htmlFor="name" className="label">Name</label>
            <input id="name" name="name" defaultValue={role.name} required maxLength={60} className="input" />
          </div>
          <div>
            <label htmlFor="description" className="label">Description</label>
            <input id="description" name="description" defaultValue={role.description} maxLength={200} className="input" />
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
                    {(ADMIN_AREAS as readonly string[]).includes(a.key) && <span className="ml-2 rounded bg-background px-1.5 py-0.5 text-xs text-muted">Admin</span>}
                    <span className="block text-xs text-muted">{a.description}</span>
                  </td>
                  {LEVELS.map((l) => {
                    const current = (levelOf.get(a.key) ?? "none") === l.value;
                    return (
                      <td key={l.value} className="text-center">
                        <input type="radio" name={`level:${a.key}`} value={l.value} defaultChecked={current}
                          disabled={!current && RANK[l.value] > mine(a.key)} aria-label={`${a.label}: ${l.label}`} className="h-4 w-4 accent-accent disabled:opacity-40" />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <fieldset className="rounded-lg border border-sand-200 p-4">
          <legend className="flex items-center px-1 font-semibold">Closebook<InfoTip label="About the Closebook rights">Who signs on a file. Closebook Edit above lets a person work the steps; these switches decide which circles they sign and what else they may do. You can switch on only a right you have yourself.</InfoTip></legend>
          <div className="grid gap-2">
            {CB_SWITCHES.map((c) => {
              const on = role[c.col], allowed = on || access.closebook[c.key];
              return (
                <label key={c.key} className={`flex items-center justify-between gap-4 rounded-lg border border-sand-200 px-4 py-3 ${allowed ? "cursor-pointer" : "opacity-60"}`}>
                  <span>
                    <span className="block font-medium">{c.label}{"later" in c && <span className="ml-2 rounded bg-background px-1.5 py-0.5 text-xs font-normal text-muted">{c.later}</span>}</span>
                    <span className="block text-sm text-ink-2">{c.hint}</span>
                  </span>
                  <input type="checkbox" role="switch" name={`cb:${c.key}`} defaultChecked={on} disabled={!allowed} aria-label={c.label} className="peer sr-only" />
                  <span aria-hidden className="relative h-6 w-11 flex-none rounded-full bg-sand-300 transition-colors peer-checked:bg-success peer-focus-visible:ring-2 peer-focus-visible:ring-navy-700 peer-focus-visible:ring-offset-2 after:absolute after:top-0.5 after:left-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition-all peer-checked:after:left-[22px]" />
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Round 19 (QuickBooks Online: permissions ticked on the role): the letter types this role prepares. */}
        <fieldset className="rounded-lg border border-sand-200 p-4">
          <legend className="flex items-center px-1 font-semibold">Letters<InfoTip label="About letter permissions">A person sees and starts only the letter types ticked here, in Engagements › Letters and in New letter. Marking a letter Final and sending it for signing needs the third box. Only an Admin changes the signature and the signers.</InfoTip></legend>
          <div className="grid gap-2">
            {letters.map(([name, label, on, have]) => (
              <label key={name} className={`flex items-center gap-2 text-sm ${on || have ? "" : "opacity-60"}`}>
                <input type="checkbox" name={name} defaultChecked={on} disabled={!on && !have} className="h-4 w-4 accent-accent" />{label}
              </label>
            ))}
          </div>
        </fieldset>

        {canEdit(access, "staff_accounts") && <button type="submit" className="btn">Save role</button>}
      </form>

      <form action={deleteRole} className="mt-6">
        <input type="hidden" name="role_id" value={role.id} />
        <button type="submit" className="btn-danger" disabled={n > 0}>Delete role</button>
        {n > 0 && <span className="ml-3 text-sm text-muted">Move its staff to another role first.</span>}
      </form>
    </>
  );
}
