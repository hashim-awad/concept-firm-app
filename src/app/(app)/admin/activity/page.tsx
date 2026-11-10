import { PageHeader, formatDateTime } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireOwner } from "@/lib/access";
import { createClient } from "@/lib/supabase/server";

type Entry = { id: number; occurred_at: string; actor_id: string | null; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown> };

const ENTITY_LABEL: Record<string, string> = {
  staff: "Staff",
  roles: "Role",
  role_permissions: "Permissions",
  settings: "Setting",
  catalogue_items: "Price book item",
  item_prices: "Price",
  questionnaires: "Screening version",
  questions: "Screening question",
  rules: "Screening rule",
  service_lines: "Service line",
};

export default async function ActivityPage() {
  await requireOwner();
  const supabase = await createClient();
  const [{ data: entries }, { data: staff }, { data: roles }] = await Promise.all([
    supabase.from("activity_log").select("id, occurred_at, actor_id, action, entity_type, entity_id, details").order("occurred_at", { ascending: false }).limit(200),
    supabase.from("staff").select("id, full_name"),
    supabase.from("roles").select("id, name"),
  ]);
  const staffName = new Map((staff ?? []).map((s: { id: string; full_name: string }) => [s.id, s.full_name]));
  const roleName = new Map((roles ?? []).map((r: { id: string; name: string }) => [r.id, r.name]));

  return (
    <>
      <PageHeader title="Activity log" description="Every change to staff, roles, permissions, settings, the price book and screening. The latest 200 entries. Entries cannot be changed or deleted." />
      <section className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr><th>When</th><th>Who</th><th>What</th><th>Change</th></tr>
          </thead>
          <tbody>
            {((entries ?? []) as Entry[]).map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap text-muted">{formatDateTime(e.occurred_at)}</td>
                <td>{e.actor_id ? staffName.get(e.actor_id) ?? "Unknown" : "System"}</td>
                <td className="whitespace-nowrap">{ENTITY_LABEL[e.entity_type] ?? e.entity_type} · {e.action}</td>
                <td className="text-muted">{describe(e, staffName, roleName)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

function describe(e: Entry, staffName: Map<string, string>, roleName: Map<string, string>): string {
  const oldRow = (e.details?.old ?? {}) as Record<string, unknown>;
  const newRow = (e.details?.new ?? {}) as Record<string, unknown>;
  if (e.action === "bootstrap_owner") return `First owner set: ${staffName.get(e.entity_id ?? "") ?? ""}`;
  if (e.entity_type === "role_permissions") {
    const area = String(newRow.area_key ?? oldRow.area_key ?? "");
    const role = roleName.get(String(newRow.role_id ?? oldRow.role_id)) ?? "role";
    return oldRow.level ? `${role}: ${area} ${oldRow.level} → ${newRow.level ?? "removed"}` : `${role}: ${area} set to ${newRow.level}`;
  }
  if (e.entity_type === "staff") {
    const name = String(newRow.full_name ?? oldRow.full_name ?? "");
    const parts: string[] = [];
    if (e.action === "insert") parts.push(`added with role ${roleName.get(String(newRow.role_id)) ?? ""}`);
    if (oldRow.role_id && newRow.role_id && oldRow.role_id !== newRow.role_id)
      parts.push(`role ${roleName.get(String(oldRow.role_id)) ?? "?"} → ${roleName.get(String(newRow.role_id)) ?? "?"}`);
    if (oldRow.is_active !== undefined && oldRow.is_active !== newRow.is_active)
      parts.push(newRow.is_active ? "switched on" : "switched off");
    if (oldRow.full_name && oldRow.full_name !== newRow.full_name) parts.push(`name changed from ${oldRow.full_name}`);
    return `${name}: ${parts.join(", ") || "updated"}`;
  }
  if (e.entity_type === "roles") {
    const name = String(newRow.name ?? oldRow.name ?? "");
    if (e.action === "insert") return `Role created: ${name}`;
    if (e.action === "delete") return `Role deleted: ${name}`;
    return oldRow.name !== newRow.name ? `Role renamed: ${oldRow.name} → ${newRow.name}` : `Role updated: ${name}`;
  }
  if (e.entity_type === "item_prices") {
    const cents = Number(newRow.amount_cents ?? 0);
    return `New price ${new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100)} from ${formatDate(String(newRow.effective_from ?? ""))}${newRow.note ? ` (${newRow.note})` : ""}`;
  }
  if (e.entity_type === "catalogue_items") {
    const name = String(newRow.name ?? oldRow.name ?? "");
    if (e.action === "insert") return `Item added: ${name} (${newRow.code})`;
    if (oldRow.is_active !== newRow.is_active) return `${name}: ${newRow.is_active ? "switched on" : "switched off"}`;
    return `Item changed: ${name}`;
  }
  if (e.entity_type === "questionnaires") {
    const label = `${newRow.route ?? oldRow.route} v${newRow.version ?? oldRow.version}`;
    if (e.action === "insert") return `Draft started: ${label}`;
    if (e.action === "delete") return `Draft deleted: ${label}`;
    if (oldRow.status !== newRow.status) return `${label}: ${oldRow.status} → ${newRow.status}`;
    return `${label}: details changed`;
  }
  if (e.entity_type === "questions") {
    return `${e.action === "insert" ? "Added" : e.action === "delete" ? "Deleted" : "Changed"}: ${String(newRow.prompt ?? oldRow.prompt ?? "")}`;
  }
  if (e.entity_type === "rules") {
    const r = (e.action === "delete" ? oldRow : newRow) as { kind?: string; item_code?: string; message?: string };
    const what = r.kind === "add_item" ? `price rule for ${r.item_code}` : `${r.kind === "check" ? "check" : "out of scope rule"}: ${r.message}`;
    return `${e.action === "insert" ? "Added" : e.action === "delete" ? "Deleted" : "Changed"} ${what}`;
  }
  if (e.entity_type === "settings") {
    if (e.entity_id === "lead_assignment") {
      return `Lead assignment: ${assignmentText(oldRow.value, staffName)} → ${assignmentText(newRow.value, staffName)}`;
    }
    if (e.entity_id === "retention_months") {
      return `Retention: ${oldRow.value ?? "?"} months → ${newRow.value} months`;
    }
    return `${e.entity_id} changed`;
  }
  return "";
}

function assignmentText(value: unknown, staffName: Map<string, string>): string {
  const v = (value ?? {}) as { mode?: string; staff_ids?: string[] };
  const names = (v.staff_ids ?? []).map((id) => staffName.get(id) ?? "unknown").join(", ");
  if (v.mode === "single") return `One person (${names})`;
  if (v.mode === "rotate") return `Rotate (${names})`;
  if (v.mode === "unassigned") return "Unassigned queue";
  return "not set";
}
